use std::{
    collections::VecDeque,
    io::{Read, Write},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::SystemTime,
};

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use portable_pty::PtySize;
use tokio::{sync::broadcast, task::JoinHandle};
use uuid::Uuid;

use crate::pty::{Pty, PtyReader, PtyWriter};
use portable_pty::{Child, MasterPty};

const BACKLOG_LIMIT: usize = 200_000;

pub struct AppState {
    pub sessions: Arc<dashmap::DashMap<Uuid, Arc<Session>>>,
    next_sequence: AtomicU64,
}

impl AppState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            sessions: Arc::new(dashmap::DashMap::new()),
            next_sequence: AtomicU64::new(0),
        })
    }

    pub fn next_sequence(&self) -> u64 {
        self.next_sequence.fetch_add(1, Ordering::Relaxed)
    }
}

#[derive(Default)]
struct Backlog {
    chunks: VecDeque<Vec<u8>>,
    total_bytes: usize,
}

impl Backlog {
    fn new() -> Self {
        Self {
            chunks: VecDeque::new(),
            total_bytes: 0,
        }
    }

    fn push(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        self.chunks.push_back(data.to_vec());
        self.total_bytes += data.len();
        while self.total_bytes > BACKLOG_LIMIT {
            if let Some(removed) = self.chunks.pop_front() {
                self.total_bytes = self.total_bytes.saturating_sub(removed.len());
            } else {
                self.total_bytes = 0;
                break;
            }
        }
    }

    fn snapshot(&self) -> Vec<Vec<u8>> {
        self.chunks.iter().cloned().collect()
    }
}

pub struct Session {
    pub id: Uuid,
    pub created_order: u64,
    pub created_at: SystemTime,
    writer: Arc<Mutex<PtyWriter>>, // sync write to pty
    reader_task: JoinHandle<()>,
    kill: Arc<dyn Fn() + Send + Sync>,
    master: Option<Arc<Mutex<Box<dyn MasterPty + Send>>>>, // for PTY resize
    tx: broadcast::Sender<Vec<u8>>,                        // output broadcast
    backlog: Arc<Mutex<Backlog>>,
}

#[derive(serde::Deserialize)]
struct ControlMsg {
    #[serde(rename = "type")]
    typ: String,
    cols: Option<u16>,
    rows: Option<u16>,
}

impl Session {
    fn spawn_pipe_reader(
        mut reader: Box<dyn Read + Send>,
        tx: broadcast::Sender<Vec<u8>>,
        backlog: Arc<Mutex<Backlog>>,
    ) -> JoinHandle<()> {
        tokio::task::spawn_blocking(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = buf[..n].to_vec();
                        if let Ok(mut backlog) = backlog.lock() {
                            backlog.push(&chunk);
                        }
                        let _ = tx.send(chunk);
                    }
                    Err(_) => break,
                }
            }
        })
    }

    pub fn spawn(
        created_order: u64,
        cmd: Option<&str>,
        args: Vec<String>,
        cols: u16,
        rows: u16,
    ) -> anyhow::Result<(Uuid, Arc<Self>)> {
        let backend = std::env::var("CMUX_BACKEND").unwrap_or_default();
        if backend == "pipe" {
            Self::spawn_pipe(created_order, cmd, args)
        } else {
            Self::spawn_pty(created_order, cmd, args, cols, rows)
        }
    }

    fn spawn_pty(
        created_order: u64,
        cmd: Option<&str>,
        args: Vec<String>,
        cols: u16,
        rows: u16,
    ) -> anyhow::Result<(Uuid, Arc<Self>)> {
        let id = Uuid::new_v4();
        let mut pty = Pty::open(cols, rows)?;
        // Keep a handle to the PTY child so we can terminate it explicitly.
        let child = pty.spawn_shell(cmd, args)?;
        let child_handle: Arc<Mutex<Option<Box<dyn Child + Send>>>> =
            Arc::new(Mutex::new(Some(child)));
        let kill_child = Arc::clone(&child_handle);

        // Extract master for IO and resizing
        let master = pty.pair.master;
        let reader: PtyReader = master.try_clone_reader()?;
        let writer: PtyWriter = master.take_writer()?;
        let (tx, _rx) = broadcast::channel::<Vec<u8>>(256);
        let tx_reader = tx.clone();
        let backlog = Arc::new(Mutex::new(Backlog::new()));
        let backlog_reader = backlog.clone();
        let reader_task = tokio::task::spawn_blocking(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let chunk = buf[..n].to_vec();
                        if let Ok(mut backlog) = backlog_reader.lock() {
                            backlog.push(&chunk);
                        }
                        let _ = tx_reader.send(chunk);
                    }
                    Err(_) => break,
                }
            }
        });

        let writer = Arc::new(Mutex::new(writer));
        let kill: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            if let Ok(mut guard) = kill_child.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });
        let master = Arc::new(Mutex::new(master));
        let session = Arc::new(Session {
            id,
            created_order,
            created_at: SystemTime::now(),
            writer,
            reader_task,
            kill,
            master: Some(master),
            tx,
            backlog,
        });
        Ok((id, session))
    }

    fn spawn_pipe(
        created_order: u64,
        cmd: Option<&str>,
        args: Vec<String>,
    ) -> anyhow::Result<(Uuid, Arc<Self>)> {
        let id = Uuid::new_v4();
        let command = cmd
            .map(|s| s.to_string())
            .unwrap_or_else(|| "/bin/cat".to_string());
        let mut child = Command::new(command)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let stdout = child.stdout.take().expect("stdout pipe");
        let stderr = child.stderr.take().expect("stderr pipe");
        let stdin = child.stdin.take().expect("stdin pipe");

        // Convert to blocking std::io handles (already are std::process pipes)
        let stdout_reader: Box<dyn Read + Send> = Box::new(stdout);
        let stderr_reader: Box<dyn Read + Send> = Box::new(stderr);
        let writer: Box<dyn Write + Send> = Box::new(stdin);

        let (tx, _rx) = broadcast::channel::<Vec<u8>>(256);
        let backlog = Arc::new(Mutex::new(Backlog::new()));
        let stdout_task = Self::spawn_pipe_reader(stdout_reader, tx.clone(), backlog.clone());
        let stderr_task = Self::spawn_pipe_reader(stderr_reader, tx.clone(), backlog.clone());
        let reader_task = tokio::spawn(async move {
            let _ = stdout_task.await;
            let _ = stderr_task.await;
        });

        let child_arc = Arc::new(Mutex::new(Some(child)));
        let kill_child = Arc::clone(&child_arc);
        let kill: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            if let Ok(mut guard) = kill_child.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });

        let writer = Arc::new(Mutex::new(writer));
        let session = Arc::new(Session {
            id,
            created_order,
            created_at: SystemTime::now(),
            writer,
            reader_task,
            kill,
            master: None,
            tx,
            backlog,
        });
        Ok((id, session))
    }

    pub async fn terminate(&self) {
        let kill = Arc::clone(&self.kill);
        let _ = tokio::task::spawn_blocking(move || (kill.as_ref())()).await;
        self.reader_task.abort();
    }

    pub async fn attach_socket(self: Arc<Self>, socket: WebSocket) {
        let mut rx = self.tx.subscribe();
        let backlog_chunks = {
            match self.backlog.lock() {
                Ok(backlog) => backlog.snapshot(),
                Err(_) => Vec::new(),
            }
        };

        // Split socket for send/receive
        let (mut ws_tx, mut ws_rx) = socket.split();

        // Sender task: PTY -> WS
        let send_task = tokio::spawn(async move {
            for chunk in backlog_chunks {
                if ws_tx.send(Message::Binary(chunk)).await.is_err() {
                    return;
                }
            }

            while let Ok(data) = rx.recv().await {
                if ws_tx.send(Message::Binary(data)).await.is_err() {
                    break;
                }
            }
        });

        // Receiver loop: WS -> PTY
        while let Some(Ok(msg)) = ws_rx.next().await {
            match msg {
                Message::Text(text) => {
                    // Try parse control JSON first
                    if let Ok(ctrl) = serde_json::from_str::<ControlMsg>(&text) {
                        self.handle_control(ctrl).await;
                    } else {
                        let mut w = self.writer.lock().unwrap();
                        let _ = w.write_all(text.as_bytes());
                    }
                }
                Message::Binary(bin) => {
                    let mut w = self.writer.lock().unwrap();
                    let _ = w.write_all(&bin);
                }
                Message::Close(_) => break,
                Message::Ping(_) => {}
                Message::Pong(_) => {}
            }
        }

        send_task.abort();
    }

    async fn handle_control(&self, ctrl: ControlMsg) {
        if ctrl.typ.as_str() == "resize" {
            if let (Some(cols), Some(rows)) = (ctrl.cols, ctrl.rows) {
                let size = PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                };
                if let Some(master) = &self.master {
                    // Try to resize via master pty if available
                    if let Ok(m) = master.lock() {
                        let _ = m.resize(size);
                    }
                }
            }
        }
    }
}
