//! End-to-end tests for the two-tier API proxy chain.
//!
//! Tests the flow: ConversationApiProxy → External API Proxy → Anthropic
//!
//! Requires:
//! - WWW server running at localhost:9779 with /api/proxy/anthropic endpoint
//! - Valid conversation JWT

use std::time::Duration;

/// Test that the per-conversation proxy correctly forwards requests to the external API proxy.
/// This test requires:
/// - WWW server running at localhost:9779
/// - Valid conversation JWT from Convex
///
/// Run with: cargo test --test proxy_e2e test_proxy_chain -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn test_proxy_chain_with_jwt() {
    use cmux_sandbox::acp_server::ConversationApiProxy;

    // Skip if www server is not running
    let client = reqwest::Client::new();
    let health_check = client
        .get("http://localhost:9779/api/health")
        .timeout(Duration::from_secs(2))
        .send()
        .await;

    if health_check.is_err() {
        eprintln!("Skipping test: www server not running at localhost:9779");
        return;
    }

    // This JWT must be valid - create one via:
    // bunx convex run conversations:createInternal '{"teamId": "...", "sessionId": "test", "providerId": "claude", "cwd": "/tmp"}'
    // For CI, this would need to be generated fresh or use a long-lived test JWT
    let jwt = std::env::var("TEST_CONVERSATION_JWT").unwrap_or_else(|_| {
        eprintln!("Set TEST_CONVERSATION_JWT to run this test");
        String::new()
    });

    if jwt.is_empty() {
        eprintln!("Skipping test: no JWT provided");
        return;
    }

    // Start per-conversation proxy pointing to our www server
    let proxy = ConversationApiProxy::start(
        "http://localhost:9779/api/proxy/anthropic".to_string(),
        Some(jwt),
        Duration::from_secs(5),
    )
    .await
    .expect("Failed to start proxy");

    eprintln!("Local proxy started at: {}", proxy.base_url());

    // Make a request through the full chain:
    // Test client → ConversationApiProxy → www (Vercel) → Anthropic
    let response = client
        .post(format!("{}/v1/messages", proxy.base_url()))
        .header("Content-Type", "application/json")
        .header("anthropic-version", "2023-06-01")
        .body(r#"{"model": "claude-sonnet-4-20250514", "max_tokens": 100, "messages": [{"role": "user", "content": "What is 2+3? Answer with just the number."}]}"#)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .expect("Request failed");

    let status = response.status();
    let body = response.text().await.unwrap();

    eprintln!("Response status: {}", status);
    eprintln!("Response body: {}", body);

    assert!(
        status.is_success(),
        "Expected 200 OK, got {}: {}",
        status,
        body
    );
    assert!(
        body.contains("5") || body.contains("five"),
        "Expected answer to contain 5"
    );
}

/// Test the JWT holder timing behavior in isolation.
#[tokio::test]
async fn test_jwt_holder_wait_and_set() {
    use cmux_sandbox::acp_server::JwtHolder;

    let holder = JwtHolder::new(None);
    let holder_clone = holder.clone();

    // Spawn task to wait for JWT
    let waiter = tokio::spawn(async move { holder.get_with_timeout(Duration::from_secs(5)).await });

    // Wait a bit then set JWT
    tokio::time::sleep(Duration::from_millis(100)).await;
    holder_clone.set("test-jwt".to_string()).await;

    // Verify waiter received the JWT
    let result = waiter.await.unwrap();
    assert_eq!(result, Some("test-jwt".to_string()));
}

/// Test the ConversationApiProxy starts and binds to a port.
#[tokio::test]
async fn test_conversation_proxy_starts() {
    use cmux_sandbox::acp_server::ConversationApiProxy;

    // Start proxy with dummy URL (won't actually connect)
    let proxy = ConversationApiProxy::start(
        "http://localhost:12345/proxy/anthropic".to_string(),
        Some("test-jwt".to_string()),
        Duration::from_secs(5),
    )
    .await
    .unwrap();

    // Verify it got a port
    assert!(proxy.addr.port() > 0);
    assert!(proxy.base_url().starts_with("http://127.0.0.1:"));

    eprintln!("Proxy started at: {}", proxy.base_url());
}
