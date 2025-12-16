use std::time::Duration;

use axum::Router;
use cmux_xterm_server::{build_router, session::AppState};
use reqwest::Client;
use serde_json::json;
use tokio::time::sleep;

#[tokio::test]
async fn list_tabs_is_ordered_by_creation_time() {
    let state = AppState::new();
    let app: Router = build_router(state, None);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    let base = format!("http://{}", addr);
    let client = Client::builder().no_proxy().build().unwrap();

    let mut created_ids = Vec::new();
    for _ in 0..3 {
        let resp = client
            .post(format!("{}/api/tabs", base))
            .json(&json!({
                "cmd": "/usr/bin/env",
                "args": ["cat"],
                "cols": 80,
                "rows": 24
            }))
            .send()
            .await
            .unwrap();
        assert!(resp.status().is_success());
        let body: serde_json::Value = resp.json().await.unwrap();
        created_ids.push(body.get("id").unwrap().as_str().unwrap().to_string());
        sleep(Duration::from_millis(5)).await;
    }

    let resp = client
        .get(format!("{}/api/tabs", base))
        .send()
        .await
        .unwrap();
    assert!(resp.status().is_success());
    let listed_ids: Vec<String> = resp.json().await.unwrap();
    assert_eq!(listed_ids, created_ids);

    for id in listed_ids {
        let _ = client
            .delete(format!("{}/api/tabs/{}", base, id))
            .send()
            .await;
    }

    server.abort();
}
