//! Test utilities for sandbox e2e tests.
//!
//! Provides JWT generation and sandbox configuration helpers.

use std::time::Duration;

/// Generate a conversation JWT for testing.
///
/// Requires CMUX_CONVERSATION_JWT_SECRET environment variable to be set.
pub fn generate_conversation_jwt(conversation_id: &str, team_id: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let secret = std::env::var("CMUX_CONVERSATION_JWT_SECRET")
        .or_else(|_| std::env::var("CMUX_TASK_RUN_JWT_SECRET"))
        .map_err(|_| {
            "CMUX_CONVERSATION_JWT_SECRET or CMUX_TASK_RUN_JWT_SECRET required".to_string()
        })?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let exp = now + 12 * 3600; // 12 hours

    // JWT Header
    let header = serde_json::json!({
        "alg": "HS256",
        "typ": "JWT"
    });
    let header_b64 = URL_SAFE_NO_PAD.encode(header.to_string().as_bytes());

    // JWT Payload
    let payload = serde_json::json!({
        "conversationId": conversation_id,
        "teamId": team_id,
        "iat": now,
        "exp": exp
    });
    let payload_b64 = URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());

    // Sign
    let message = format!("{}.{}", header_b64, payload_b64);
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(|e| e.to_string())?;
    mac.update(message.as_bytes());
    let signature = mac.finalize().into_bytes();
    let sig_b64 = URL_SAFE_NO_PAD.encode(signature);

    Ok(format!("{}.{}.{}", header_b64, payload_b64, sig_b64))
}

/// Generate a sandbox JWT for testing callbacks.
///
/// Requires ACP_CALLBACK_SECRET or CMUX_TASK_RUN_JWT_SECRET environment variable.
pub fn generate_sandbox_jwt(sandbox_id: &str, team_id: &str) -> Result<String, String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    let secret = std::env::var("ACP_CALLBACK_SECRET")
        .or_else(|_| std::env::var("CMUX_TASK_RUN_JWT_SECRET"))
        .map_err(|_| "ACP_CALLBACK_SECRET or CMUX_TASK_RUN_JWT_SECRET required".to_string())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let exp = now + 24 * 3600; // 24 hours

    // JWT Header
    let header = serde_json::json!({
        "alg": "HS256",
        "typ": "JWT"
    });
    let header_b64 = URL_SAFE_NO_PAD.encode(header.to_string().as_bytes());

    // JWT Payload
    let payload = serde_json::json!({
        "sandboxId": sandbox_id,
        "teamId": team_id,
        "iat": now,
        "exp": exp
    });
    let payload_b64 = URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());

    // Sign
    let message = format!("{}.{}", header_b64, payload_b64);
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).map_err(|e| e.to_string())?;
    mac.update(message.as_bytes());
    let signature = mac.finalize().into_bytes();
    let sig_b64 = URL_SAFE_NO_PAD.encode(signature);

    Ok(format!("{}.{}.{}", header_b64, payload_b64, sig_b64))
}

/// Configure a sandbox with JWT and proxy settings.
pub async fn configure_sandbox(
    base_url: &str,
    callback_url: &str,
    sandbox_jwt: &str,
    sandbox_id: &str,
    api_proxy_url: Option<&str>,
) -> Result<(), String> {
    let url = format!("{}/api/acp/configure", base_url);

    let body = serde_json::json!({
        "callback_url": callback_url,
        "sandbox_jwt": sandbox_jwt,
        "sandbox_id": sandbox_id,
        "api_proxy_url": api_proxy_url,
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Configure request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Configure failed HTTP {}: {}", status, text));
    }

    Ok(())
}

/// Check if API keys are available for LLM tests.
pub fn has_api_keys() -> bool {
    std::env::var("ANTHROPIC_API_KEY").is_ok() || std::env::var("OPENAI_API_KEY").is_ok()
}

/// Check if conversation JWT secret is available.
pub fn has_jwt_secret() -> bool {
    std::env::var("CMUX_CONVERSATION_JWT_SECRET").is_ok()
        || std::env::var("CMUX_TASK_RUN_JWT_SECRET").is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jwt_generation_requires_secret() {
        // Clear any existing secrets for this test
        std::env::remove_var("CMUX_CONVERSATION_JWT_SECRET");
        std::env::remove_var("CMUX_TASK_RUN_JWT_SECRET");

        let result = generate_conversation_jwt("conv_123", "team_456");
        assert!(result.is_err());
    }

    #[test]
    fn test_jwt_generation_with_secret() {
        std::env::set_var(
            "CMUX_CONVERSATION_JWT_SECRET",
            "test_secret_key_for_testing",
        );

        let result = generate_conversation_jwt("conv_123", "team_456");
        assert!(result.is_ok());

        let jwt = result.unwrap();
        let parts: Vec<&str> = jwt.split('.').collect();
        assert_eq!(parts.len(), 3, "JWT should have 3 parts");

        // Clean up
        std::env::remove_var("CMUX_CONVERSATION_JWT_SECRET");
    }
}
