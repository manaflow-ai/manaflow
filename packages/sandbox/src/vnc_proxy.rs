//! WebSocket-to-VNC TCP proxy.
//!
//! Proxies WebSocket connections from noVNC clients to VNC servers over TCP.
//! Runs in the same process as sandboxd for minimal latency.

use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tracing::{debug, error};

/// Proxy a WebSocket connection to a VNC server over TCP.
///
/// This function handles the bidirectional relay between a noVNC WebSocket client
/// and a VNC server (e.g., TigerVNC's Xvnc). The RFB protocol uses binary frames.
///
/// # Arguments
/// * `client_socket` - The WebSocket connection from the noVNC client
/// * `vnc_addr` - The address of the VNC server (e.g., "10.201.0.2:5910")
pub async fn proxy_vnc_websocket(
    client_socket: WebSocket,
    vnc_addr: SocketAddr,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    debug!("Connecting to VNC server at {}", vnc_addr);

    // Connect to VNC server
    let stream = TcpStream::connect(vnc_addr).await?;

    // Enable TCP_NODELAY for low-latency interactive sessions
    stream.set_nodelay(true)?;

    debug!("Connected to VNC server, TCP_NODELAY enabled");

    let (mut tcp_read, mut tcp_write) = stream.into_split();
    let (mut ws_sink, mut ws_stream) = client_socket.split();

    // Spawn task to forward WebSocket -> TCP
    let ws_to_tcp = tokio::spawn(async move {
        while let Some(msg_result) = ws_stream.next().await {
            match msg_result {
                Ok(Message::Binary(data)) => {
                    if tcp_write.write_all(&data).await.is_err() {
                        break;
                    }
                }
                Ok(Message::Close(_)) => break,
                Ok(Message::Ping(data)) => {
                    // Respond to pings to keep connection alive
                    // (handled by axum, but we still receive them)
                    debug!("Received ping: {} bytes", data.len());
                }
                Ok(Message::Pong(_)) => {}
                Ok(Message::Text(_)) => {
                    // VNC protocol is binary-only, ignore text messages
                    debug!("Ignoring text message from WebSocket client");
                }
                Err(e) => {
                    debug!("WebSocket receive error: {}", e);
                    break;
                }
            }
        }
        debug!("WebSocket -> TCP relay ended");
    });

    // Forward TCP -> WebSocket in main task
    let mut buf = vec![0u8; 16384]; // 16KB buffer for VNC framebuffer data
    loop {
        match tcp_read.read(&mut buf).await {
            Ok(0) => {
                debug!("VNC server closed connection");
                break;
            }
            Ok(n) => {
                if ws_sink
                    .send(Message::Binary(buf[..n].to_vec().into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
            Err(e) => {
                error!("TCP read error: {}", e);
                break;
            }
        }
    }

    // Clean up
    ws_to_tcp.abort();
    let _ = ws_sink.close().await;

    debug!("VNC proxy session ended");
    Ok(())
}
