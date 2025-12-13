use std::time::Duration;

use axum::Router;
use cmux_xterm_server::{build_router, session::AppState};
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde_json::json;
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[tokio::test]
async fn ws_reconnect_and_reattach() {
    let state = AppState::new();
    let app: Router = build_router(state, None);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    // Run server in background
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let base = format!("http://{}", addr);
    let ws_base = format!("ws://{}", addr);

    // Create a tab running /usr/bin/env cat
    let client = Client::builder().no_proxy().build().unwrap();
    let resp = tokio::time::timeout(Duration::from_secs(10), async {
        client
            .post(format!("{}/api/tabs", base))
            .json(&json!({
                "cmd": "/usr/bin/env",
                "args": ["cat"],
                "cols": 80,
                "rows": 24
            }))
            .send()
            .await
    })
    .await
    .expect("create tab timed out")
    .unwrap();
    assert!(resp.status().is_success());
    let v: serde_json::Value = resp.json().await.unwrap();
    let id = v.get("id").unwrap().as_str().unwrap().to_string();

    // First connection
    let (mut ws1, _resp1) = tokio::time::timeout(Duration::from_secs(10), async {
        connect_async(format!("{}/ws/{}", ws_base, id)).await
    })
    .await
    .expect("ws connect #1 timed out")
    .unwrap();

    // Send text and expect same back
    ws1.send(Message::Text("hello-one\n".into())).await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(Ok(msg)) = ws1.next().await {
                match msg {
                    Message::Text(t) => {
                        if t.contains("hello-one") {
                            break;
                        }
                    }
                    Message::Binary(data) => {
                        if String::from_utf8_lossy(&data).contains("hello-one") {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
    })
    .await
    .expect("did not receive first echo in time");

    // Close first connection
    let _ = ws1.send(Message::Close(None)).await; // best-effort
    drop(ws1);

    // Reconnect to the same session
    let (mut ws2, _resp2) = tokio::time::timeout(Duration::from_secs(10), async {
        connect_async(format!("{}/ws/{}", ws_base, id)).await
    })
    .await
    .expect("ws connect #2 timed out")
    .unwrap();

    // Expect backlog to include earlier output
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(Ok(msg)) = ws2.next().await {
                match msg {
                    Message::Text(t) => {
                        if t.contains("hello-one") {
                            break;
                        }
                    }
                    Message::Binary(data) => {
                        if String::from_utf8_lossy(&data).contains("hello-one") {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
    })
    .await
    .expect("did not receive backlog echo in time");

    // Send again and expect echo
    ws2.send(Message::Text("hello-two\n".into())).await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(Ok(msg)) = ws2.next().await {
                match msg {
                    Message::Text(t) => {
                        if t.contains("hello-two") {
                            break;
                        }
                    }
                    Message::Binary(data) => {
                        if String::from_utf8_lossy(&data).contains("hello-two") {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
    })
    .await
    .expect("did not receive second echo in time");

    // Cleanup
    let resp = client
        .delete(format!("{}/api/tabs/{}", base, id))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success() || resp.status().as_u16() == 204);

    server.abort();
}
