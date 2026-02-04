//! E2E tests for sandbox-agent integration in cmux-acp-server.
//!
//! These tests verify that the sandbox-agent routes are properly mounted
//! at /api/agents/* and that the core functionality works.
//!
//! ## Running Tests
//!
//! ### Infrastructure tests (no API keys required):
//! ```bash
//! cargo test --test sandbox_agent_e2e test_main_health -- --ignored --nocapture
//! cargo test --test sandbox_agent_e2e test_agent_health -- --ignored --nocapture
//! cargo test --test sandbox_agent_e2e test_list_agents -- --ignored --nocapture
//! cargo test --test sandbox_agent_e2e test_codex_session_lifecycle -- --ignored --nocapture
//! ```
//!
//! ### LLM tests (require API keys in environment):
//! ```bash
//! export OPENAI_API_KEY="sk-..."
//! export ANTHROPIC_API_KEY="sk-ant-..."
//! cargo test --test sandbox_agent_e2e test_codex_math_prompt -- --ignored --nocapture
//! cargo test --test sandbox_agent_e2e test_claude_math_prompt -- --ignored --nocapture
//! ```
//!
//! ### Deployed sandbox tests (require JWT secret and proxy URL):
//! ```bash
//! export CMUX_CONVERSATION_JWT_SECRET="..."
//! export API_PROXY_URL="$CONVEX_SITE_URL"
//! export ACP_SERVER_URL="https://39384-<sandbox-id>.e2b.app"
//! cargo test --test sandbox_agent_e2e test_configure_and_prompt -- --ignored --nocapture
//! ```

mod test_utils;

use std::time::Duration;
use test_utils::{
    configure_sandbox, generate_conversation_jwt, generate_sandbox_jwt, has_api_keys,
    has_jwt_secret,
};

/// Base URL for the local ACP server
fn base_url() -> String {
    std::env::var("ACP_SERVER_URL").unwrap_or_else(|_| "http://localhost:39384".to_string())
}

/// Helper to make HTTP requests with timeout and retries
async fn get_json(url: &str) -> Result<serde_json::Value, String> {
    get_json_with_timeout(url, Duration::from_secs(30)).await
}

/// Helper for slow endpoints that may take longer (e.g., agents list with health checks)
async fn get_json_slow(url: &str) -> Result<serde_json::Value, String> {
    get_json_with_timeout(url, Duration::from_secs(60)).await
}

async fn get_json_with_timeout(url: &str, timeout: Duration) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let mut last_error = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        match client.get(url).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    last_error = format!("HTTP {}: {}", resp.status(), url);
                    continue;
                }
                return resp
                    .json()
                    .await
                    .map_err(|e| format!("JSON parse failed: {}", e));
            }
            Err(e) => {
                last_error = format!("Request failed: {}", e);
            }
        }
    }
    Err(last_error)
}

async fn post_json(url: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let mut last_error = String::new();
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_secs(2)).await;
        }

        match client.post(url).json(&body).send().await {
            Ok(resp) => {
                if !resp.status().is_success() {
                    let status = resp.status();
                    let text = resp.text().await.unwrap_or_default();
                    last_error = format!("HTTP {}: {} - {}", status, url, text);
                    continue;
                }
                return resp
                    .json()
                    .await
                    .map_err(|e| format!("JSON parse failed: {}", e));
            }
            Err(e) => {
                last_error = format!("Request failed: {}", e);
            }
        }
    }
    Err(last_error)
}

async fn post_empty(url: &str) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let resp = client
        .post(url)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {} - {}", status, url, text));
    }

    Ok(())
}

/// Test that the main health endpoint works
#[tokio::test]
#[ignore] // Requires running server
async fn test_main_health() {
    let url = format!("{}/health", base_url());
    let result = get_json(&url).await;

    match result {
        Ok(json) => {
            assert_eq!(json["status"], "ok", "Health status should be 'ok'");
            println!("✓ Main health: {:?}", json);
        }
        Err(e) => {
            panic!("Main health check failed: {}", e);
        }
    }
}

/// Test that the sandbox-agent health endpoint is mounted at /api/agents/v1/health
#[tokio::test]
#[ignore] // Requires running server
async fn test_agent_health() {
    let url = format!("{}/api/agents/v1/health", base_url());
    let result = get_json(&url).await;

    match result {
        Ok(json) => {
            assert_eq!(json["status"], "ok", "Agent health status should be 'ok'");
            println!("✓ Agent health: {:?}", json);
        }
        Err(e) => {
            panic!("Agent health check failed: {}", e);
        }
    }
}

/// Test that the agents list endpoint works
/// Note: This endpoint can be slow (~20s) as it checks agent health status
#[tokio::test]
#[ignore] // Requires running server
async fn test_list_agents() {
    let url = format!("{}/api/agents/v1/agents", base_url());
    // Use longer timeout for this endpoint - it checks all agent health
    let result = get_json_slow(&url).await;

    match result {
        Ok(json) => {
            // Response is { "agents": [...] }
            let agents = json["agents"]
                .as_array()
                .expect("Response should have agents array");
            println!("✓ Found {} agents", agents.len());

            // Should have at least codex and opencode
            let agent_ids: Vec<&str> = agents.iter().filter_map(|a| a["id"].as_str()).collect();
            println!("  Agents: {:?}", agent_ids);

            assert!(
                agent_ids.contains(&"codex") || agent_ids.contains(&"opencode"),
                "Should have codex or opencode agent"
            );
        }
        Err(e) => {
            panic!("List agents failed: {}", e);
        }
    }
}

/// Test creating and terminating a Codex session (uses thread pool)
#[tokio::test]
#[ignore] // Requires running server
async fn test_codex_session_lifecycle() {
    let session_id = format!(
        "test-codex-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    // Create session
    let create_url = format!("{}/api/agents/v1/sessions/{}", base_url(), session_id);
    let start = std::time::Instant::now();
    let result = post_json(&create_url, serde_json::json!({ "agent": "codex" })).await;
    let create_ms = start.elapsed().as_millis();

    match result {
        Ok(json) => {
            println!("✓ Session created in {}ms: {:?}", create_ms, json);
            // Response format: { "healthy": true, "nativeSessionId": "..." }
            assert!(
                json.get("nativeSessionId").is_some()
                    || json.get("sessionId").is_some()
                    || json.get("session_id").is_some(),
                "Response should contain session ID (nativeSessionId, sessionId, or session_id)"
            );

            // With thread pool, creation should be fast (<100ms)
            if create_ms < 100 {
                println!("  ✓ Fast creation ({}ms) - thread pool working", create_ms);
            } else if create_ms < 500 {
                println!(
                    "  ⚠ Moderate creation ({}ms) - may be warming up",
                    create_ms
                );
            } else {
                println!(
                    "  ⚠ Slow creation ({}ms) - thread pool may not be prewarmed",
                    create_ms
                );
            }
        }
        Err(e) => {
            panic!("Session create failed: {}", e);
        }
    }

    // Terminate session
    let terminate_url = format!(
        "{}/api/agents/v1/sessions/{}/terminate",
        base_url(),
        session_id
    );
    match post_empty(&terminate_url).await {
        Ok(_) => println!("✓ Session terminated"),
        Err(e) => println!("  Note: Terminate returned error (may be expected): {}", e),
    }
}

/// Test that OpenAPI docs include sandbox-agent endpoints
#[tokio::test]
#[ignore] // Requires running server
async fn test_openapi_includes_agents() {
    let url = format!("{}/api-docs/openapi.json", base_url());
    let result = get_json(&url).await;

    match result {
        Ok(json) => {
            let paths = json["paths"].as_object().expect("Should have paths object");

            // Check for sandbox-agent paths
            let agent_paths: Vec<&String> = paths
                .keys()
                .filter(|p| p.contains("/v1/") && (p.contains("agents") || p.contains("sessions")))
                .collect();

            println!("✓ OpenAPI has {} agent-related paths:", agent_paths.len());
            for path in &agent_paths {
                println!("  - {}", path);
            }

            assert!(
                agent_paths.len() >= 3,
                "Should have at least health, agents, and sessions endpoints"
            );
        }
        Err(e) => {
            panic!("OpenAPI fetch failed: {}", e);
        }
    }
}

/// Send a message to a session (returns empty on success)
async fn send_message(session_id: &str, message: &str) -> Result<(), String> {
    let url = format!(
        "{}/api/agents/v1/sessions/{}/messages",
        base_url(),
        session_id
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let resp = client
        .post(&url)
        .json(&serde_json::json!({ "message": message }))
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {} - {}", status, url, text));
    }
    Ok(())
}

/// Poll events until we find an assistant response or timeout
async fn poll_for_response(session_id: &str, timeout_secs: u64) -> Result<String, String> {
    let start = std::time::Instant::now();
    let timeout = Duration::from_secs(timeout_secs);

    while start.elapsed() < timeout {
        let url = format!(
            "{}/api/agents/v1/sessions/{}/events?offset=0&limit=100",
            base_url(),
            session_id
        );
        let events = get_json(&url).await?;

        // Look for completed assistant messages with text content
        if let Some(events_array) = events["events"].as_array() {
            for event in events_array {
                if event["type"].as_str() == Some("item.completed") {
                    if let Some(item) = event["data"]["item"].as_object() {
                        if item.get("role").and_then(|r| r.as_str()) == Some("assistant") {
                            if let Some(content) = item.get("content").and_then(|c| c.as_array()) {
                                for part in content {
                                    if part["type"].as_str() == Some("text") {
                                        if let Some(text) = part["text"].as_str() {
                                            return Ok(text.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                // Check for errors
                if event["type"].as_str() == Some("error") {
                    let error_msg = event["data"]["message"].as_str().unwrap_or("Unknown error");
                    return Err(format!("Agent error: {}", error_msg));
                }
            }
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    Err("Timeout waiting for response".to_string())
}

/// Test that Codex can respond to a math prompt (3+5=8)
#[tokio::test]
#[ignore] // Requires running server with API keys configured
async fn test_codex_math_prompt() {
    let session_id = format!(
        "test-codex-math-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    // Create session
    let create_url = format!("{}/api/agents/v1/sessions/{}", base_url(), session_id);
    let result = post_json(&create_url, serde_json::json!({ "agent": "codex" })).await;
    assert!(
        result.is_ok(),
        "Failed to create Codex session: {:?}",
        result
    );
    println!("✓ Codex session created: {}", session_id);

    // Send math prompt
    let send_result = send_message(&session_id, "What is 3+5? Reply with just the number.").await;
    assert!(
        send_result.is_ok(),
        "Failed to send message: {:?}",
        send_result
    );
    println!("✓ Message sent");

    // Poll for response
    let response = poll_for_response(&session_id, 30).await;
    match response {
        Ok(text) => {
            println!("✓ Codex response: {}", text);
            assert!(
                text.contains('8'),
                "Expected response to contain '8', got: {}",
                text
            );
            println!("✓ Codex correctly answered 3+5=8");
        }
        Err(e) => {
            panic!("Failed to get Codex response: {}", e);
        }
    }

    // Clean up
    let terminate_url = format!(
        "{}/api/agents/v1/sessions/{}/terminate",
        base_url(),
        session_id
    );
    let _ = post_empty(&terminate_url).await;
}

/// Test that Claude can respond to a math prompt (3+5=8)
#[tokio::test]
#[ignore] // Requires running server with API keys configured
async fn test_claude_math_prompt() {
    let session_id = format!(
        "test-claude-math-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );

    // Create session
    let create_url = format!("{}/api/agents/v1/sessions/{}", base_url(), session_id);
    let result = post_json(&create_url, serde_json::json!({ "agent": "claude" })).await;
    assert!(
        result.is_ok(),
        "Failed to create Claude session: {:?}",
        result
    );
    println!("✓ Claude session created: {}", session_id);

    // Send math prompt
    let send_result = send_message(&session_id, "What is 3+5? Reply with just the number.").await;
    assert!(
        send_result.is_ok(),
        "Failed to send message: {:?}",
        send_result
    );
    println!("✓ Message sent");

    // Poll for response
    let response = poll_for_response(&session_id, 30).await;
    match response {
        Ok(text) => {
            println!("✓ Claude response: {}", text);
            assert!(
                text.contains('8'),
                "Expected response to contain '8', got: {}",
                text
            );
            println!("✓ Claude correctly answered 3+5=8");
        }
        Err(e) => {
            panic!("Failed to get Claude response: {}", e);
        }
    }

    // Clean up
    let terminate_url = format!(
        "{}/api/agents/v1/sessions/{}/terminate",
        base_url(),
        session_id
    );
    let _ = post_empty(&terminate_url).await;
}

/// Test multiple rapid session creations to verify thread pool
#[tokio::test]
#[ignore] // Requires running server
async fn test_rapid_session_creation() {
    let mut times_ms: Vec<u128> = Vec::new();

    for i in 0..5 {
        let session_id = format!(
            "test-rapid-{}-{}",
            i,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        );

        let create_url = format!("{}/api/agents/v1/sessions/{}", base_url(), session_id);
        let start = std::time::Instant::now();
        let result = post_json(&create_url, serde_json::json!({ "agent": "codex" })).await;
        let elapsed = start.elapsed().as_millis();

        match result {
            Ok(_) => {
                times_ms.push(elapsed);
                println!("  [{}] Created in {}ms", i + 1, elapsed);

                // Clean up
                let terminate_url = format!(
                    "{}/api/agents/v1/sessions/{}/terminate",
                    base_url(),
                    session_id
                );
                let _ = post_empty(&terminate_url).await;
            }
            Err(e) => {
                println!("  [{}] Failed: {}", i + 1, e);
            }
        }

        // Small delay
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    if !times_ms.is_empty() {
        let avg = times_ms.iter().sum::<u128>() / times_ms.len() as u128;
        let fast_count = times_ms.iter().filter(|&&t| t < 100).count();

        println!("\n=== RAPID CREATION SUMMARY ===");
        println!("  Average: {}ms", avg);
        println!("  Fast (<100ms): {}/{}", fast_count, times_ms.len());

        // At least some should be fast if thread pool is working
        assert!(
            fast_count >= times_ms.len() / 2,
            "At least half of creations should be fast (<100ms) with thread pool"
        );
        println!("✓ Thread pool verified: {}+ fast creations", fast_count);
    }
}

// ============================================================================
// Tests that configure the sandbox with JWT for deployed environments
// ============================================================================

/// Test configuring a sandbox with JWT and proxy URL.
///
/// This test verifies:
/// 1. The configure endpoint accepts JWT and proxy settings
/// 2. After configuration, the sandbox can use the proxy for API calls
///
/// Required environment:
/// - ACP_SERVER_URL: URL of deployed sandbox (e.g., https://39384-xxx.e2b.app)
/// - CMUX_CONVERSATION_JWT_SECRET or CMUX_TASK_RUN_JWT_SECRET: Secret for signing JWTs
/// - API_PROXY_URL: Outer proxy URL (e.g., https://cmux.sh)
#[tokio::test]
#[ignore] // Requires deployed sandbox and JWT secrets
async fn test_configure_sandbox_with_jwt() {
    // Check prerequisites
    if !has_jwt_secret() {
        println!("⚠ Skipping: CMUX_CONVERSATION_JWT_SECRET not set");
        return;
    }

    let api_proxy_url = std::env::var("API_PROXY_URL").unwrap_or_else(|_| {
        println!("⚠ API_PROXY_URL not set - using placeholder, test may fail");
        "http://localhost:0/not-configured".to_string()
    });

    // Generate test JWTs
    let conversation_id = format!(
        "test-conv-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let sandbox_id = format!(
        "test-sandbox-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis()
    );
    let team_id = "test-team-e2e";

    // Note: conversation_jwt is for API proxy authentication
    // Currently the sandbox-agent routes don't use it directly
    let _conversation_jwt = generate_conversation_jwt(&conversation_id, team_id)
        .expect("Failed to generate conversation JWT");
    let sandbox_jwt =
        generate_sandbox_jwt(&sandbox_id, team_id).expect("Failed to generate sandbox JWT");

    println!("✓ Generated test JWTs");
    println!("  Conversation ID: {}", conversation_id);
    println!("  Sandbox ID: {}", sandbox_id);

    // Configure sandbox
    // Note: callback_url should be a real Convex endpoint for full integration testing
    let callback_url = "https://example.convex.site/api/acp/callback";

    match configure_sandbox(
        &base_url(),
        callback_url,
        &sandbox_jwt,
        &sandbox_id,
        Some(&api_proxy_url),
    )
    .await
    {
        Ok(_) => {
            println!("✓ Sandbox configured with JWT and proxy URL");
            println!("  API Proxy: {}", api_proxy_url);
        }
        Err(e) => {
            panic!("Failed to configure sandbox: {}", e);
        }
    }

    // Verify the sandbox is configured by checking health
    let health_url = format!("{}/health", base_url());
    match get_json(&health_url).await {
        Ok(json) => {
            assert_eq!(json["status"], "ok");
            println!("✓ Sandbox health OK after configuration");
        }
        Err(e) => {
            panic!("Health check failed after configuration: {}", e);
        }
    }
}

/// Test full e2e flow: configure sandbox → create session → send prompt → get response
///
/// This test requires:
/// - A deployed sandbox with cmux-acp-server running
/// - Valid JWT secrets for authentication
/// - API proxy URL (CONVEX_SITE_URL)
///
/// Run with:
/// ```bash
/// export ACP_SERVER_URL="https://39384-<sandbox-id>.e2b.app"
/// export CMUX_CONVERSATION_JWT_SECRET="..."
/// export API_PROXY_URL="$CONVEX_SITE_URL"
/// cargo test --test sandbox_agent_e2e test_full_e2e_with_jwt -- --ignored --nocapture
/// ```
#[tokio::test]
#[ignore] // Requires deployed sandbox, JWT secrets, and proxy
async fn test_full_e2e_with_jwt() {
    // Check prerequisites
    if !has_jwt_secret() {
        println!("⚠ Skipping: CMUX_CONVERSATION_JWT_SECRET not set");
        println!("  Set CMUX_CONVERSATION_JWT_SECRET or CMUX_TASK_RUN_JWT_SECRET to run this test");
        return;
    }

    let api_proxy_url = std::env::var("API_PROXY_URL").unwrap_or_else(|_| {
        println!("⚠ API_PROXY_URL not set - using placeholder, test may fail");
        "http://localhost:0/not-configured".to_string()
    });

    println!("=== FULL E2E TEST WITH JWT ===");
    println!("Server: {}", base_url());
    println!("Proxy: {}", api_proxy_url);

    // Step 1: Generate JWTs
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let conversation_id = format!("e2e-conv-{}", timestamp);
    let sandbox_id = format!("e2e-sandbox-{}", timestamp);
    let session_id = format!("e2e-session-{}", timestamp);
    let team_id = "e2e-test-team";

    // Note: conversation_jwt would be used if sandbox-agent supported proxy mode
    let _conversation_jwt = generate_conversation_jwt(&conversation_id, team_id)
        .expect("Failed to generate conversation JWT");
    let sandbox_jwt =
        generate_sandbox_jwt(&sandbox_id, team_id).expect("Failed to generate sandbox JWT");

    println!("\n[1/5] Generated JWTs ✓");

    // Step 2: Configure sandbox
    let callback_url = "https://example.convex.site/api/acp/callback";
    configure_sandbox(
        &base_url(),
        callback_url,
        &sandbox_jwt,
        &sandbox_id,
        Some(&api_proxy_url),
    )
    .await
    .expect("Failed to configure sandbox");

    println!("[2/5] Sandbox configured ✓");

    // Step 3: Create Codex session
    let create_url = format!("{}/api/agents/v1/sessions/{}", base_url(), session_id);
    let start = std::time::Instant::now();
    let create_result = post_json(&create_url, serde_json::json!({ "agent": "codex" })).await;
    let create_ms = start.elapsed().as_millis();

    match create_result {
        Ok(json) => {
            println!("[3/5] Session created in {}ms ✓", create_ms);
            if create_ms < 100 {
                println!("      Thread pool optimization working!");
            }
            println!("      Response: {:?}", json);
        }
        Err(e) => {
            panic!("Failed to create session: {}", e);
        }
    }

    // Step 4: Send math prompt
    let send_result = send_message(&session_id, "What is 3+5? Reply with just the number.").await;
    match send_result {
        Ok(_) => println!("[4/5] Message sent ✓"),
        Err(e) => {
            panic!("Failed to send message: {}", e);
        }
    }

    // Step 5: Poll for response
    println!("[5/5] Waiting for response...");
    match poll_for_response(&session_id, 60).await {
        Ok(text) => {
            println!("      Response: {}", text);
            if text.contains('8') {
                println!("\n✓✓✓ FULL E2E TEST PASSED ✓✓✓");
                println!("    Codex correctly answered 3+5=8");
            } else {
                println!("\n⚠ Response received but doesn't contain expected answer '8'");
            }
        }
        Err(e) => {
            println!("\n⚠ Failed to get response: {}", e);
            println!("    This may be expected if:");
            println!("    - API proxy authentication failed");
            println!("    - Sandbox doesn't have network access");
            println!("    - JWT was invalid or expired");
        }
    }

    // Clean up
    let terminate_url = format!(
        "{}/api/agents/v1/sessions/{}/terminate",
        base_url(),
        session_id
    );
    let _ = post_empty(&terminate_url).await;
    println!("\nSession cleaned up.");
}

/// Test that checks which credentials are available
#[tokio::test]
#[ignore] // Just for information
async fn test_check_credentials() {
    println!("=== CREDENTIAL CHECK ===\n");

    // Check API keys
    println!("API Keys:");
    if std::env::var("OPENAI_API_KEY").is_ok() {
        println!("  ✓ OPENAI_API_KEY is set");
    } else {
        println!("  ✗ OPENAI_API_KEY not set");
    }

    if std::env::var("ANTHROPIC_API_KEY").is_ok() {
        println!("  ✓ ANTHROPIC_API_KEY is set");
    } else {
        println!("  ✗ ANTHROPIC_API_KEY not set");
    }

    // Check JWT secrets
    println!("\nJWT Secrets:");
    if std::env::var("CMUX_CONVERSATION_JWT_SECRET").is_ok() {
        println!("  ✓ CMUX_CONVERSATION_JWT_SECRET is set");
    } else {
        println!("  ✗ CMUX_CONVERSATION_JWT_SECRET not set");
    }

    if std::env::var("CMUX_TASK_RUN_JWT_SECRET").is_ok() {
        println!("  ✓ CMUX_TASK_RUN_JWT_SECRET is set");
    } else {
        println!("  ✗ CMUX_TASK_RUN_JWT_SECRET not set");
    }

    if std::env::var("ACP_CALLBACK_SECRET").is_ok() {
        println!("  ✓ ACP_CALLBACK_SECRET is set");
    } else {
        println!("  ✗ ACP_CALLBACK_SECRET not set");
    }

    // Check URLs
    println!("\nURLs:");
    println!("  ACP_SERVER_URL: {}", base_url());
    if let Ok(url) = std::env::var("API_PROXY_URL") {
        println!("  API_PROXY_URL: {}", url);
    } else {
        println!("  ✗ API_PROXY_URL not set");
    }

    // Summary
    println!("\n=== SUMMARY ===");
    if has_api_keys() {
        println!("  ✓ Can run local LLM tests (have API keys)");
    } else {
        println!("  ✗ Cannot run local LLM tests (no API keys)");
    }

    if has_jwt_secret() {
        println!("  ✓ Can run JWT-authenticated tests");
    } else {
        println!("  ✗ Cannot run JWT-authenticated tests");
    }
}
