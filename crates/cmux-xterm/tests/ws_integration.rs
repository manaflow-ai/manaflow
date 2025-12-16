use std::time::Duration;

use axum::Router;
use cmux_xterm_server::{build_router, session::AppState};
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde_json::json;
use tokio_tungstenite::tungstenite::Message;

#[tokio::test]
async fn ws_echo_cat() {
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

    // Create a tab running /bin/cat
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

    // Connect to websocket
    let (mut ws, _resp) = tokio::time::timeout(Duration::from_secs(10), async {
        tokio_tungstenite::connect_async(format!("{}/ws/{}", ws_base, id)).await
    })
    .await
    .expect("ws connect timed out")
    .unwrap();

    // Send text and expect same back
    ws.send(Message::Text("hello world\n".into()))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(Ok(msg)) = ws.next().await {
                match msg {
                    Message::Text(t) => {
                        if t.contains("hello world") {
                            break;
                        }
                    }
                    Message::Binary(data) => {
                        if String::from_utf8_lossy(&data).contains("hello world") {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
    })
    .await
    .expect("did not receive echo in time");

    // Send resize control message and ensure no error
    ws.send(Message::Text(
        serde_json::to_string(&json!({
            "type": "resize", "cols": 100, "rows": 40
        }))
        .unwrap(),
    ))
    .await
    .unwrap();

    // Cleanup
    let resp = client
        .delete(format!("{}/api/tabs/{}", base, id))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success() || resp.status().as_u16() == 204);

    server.abort();
}
