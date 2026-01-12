//! Callback client for posting ACP updates to Convex.
//!
//! This module provides an HTTP client for sandboxes to POST state updates
//! back to Convex via the `/api/acp/callback` endpoint.
//!
//! Authentication uses a JWT token provided at sandbox startup.

use anyhow::{Context, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tracing::{debug, error, warn};

/// Content block types for callbacks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum CallbackContentBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image {
        data: Option<String>,
        #[serde(rename = "mimeType")]
        mime_type: Option<String>,
    },
    #[serde(rename = "resource_link")]
    ResourceLink { uri: String, name: Option<String> },
}

/// Tool call status for callbacks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CallbackToolCallStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

/// Tool call for callbacks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallbackToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
    pub status: CallbackToolCallStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

/// Stop reason for message completion.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    MaxTokens,
    MaxTurnRequests,
    Refusal,
    Cancelled,
}

impl std::fmt::Display for StopReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StopReason::EndTurn => write!(f, "end_turn"),
            StopReason::MaxTokens => write!(f, "max_tokens"),
            StopReason::MaxTurnRequests => write!(f, "max_turn_requests"),
            StopReason::Refusal => write!(f, "refusal"),
            StopReason::Cancelled => write!(f, "cancelled"),
        }
    }
}

/// Callback payload types (discriminated union).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
enum CallbackPayload {
    #[serde(rename = "message_chunk")]
    MessageChunk {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "messageId", skip_serializing_if = "Option::is_none")]
        message_id: Option<String>,
        content: CallbackContentBlock,
    },
    #[serde(rename = "message_complete")]
    MessageComplete {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(rename = "stopReason")]
        stop_reason: StopReason,
    },
    #[serde(rename = "tool_call")]
    ToolCall {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "messageId")]
        message_id: String,
        #[serde(rename = "toolCall")]
        tool_call: CallbackToolCall,
    },
    #[serde(rename = "error")]
    Error {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        code: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
    #[serde(rename = "sandbox_ready")]
    SandboxReady {
        #[serde(rename = "sandboxId")]
        sandbox_id: String,
        #[serde(rename = "sandboxUrl")]
        sandbox_url: String,
    },
}

/// Callback response from Convex.
#[derive(Debug, Deserialize)]
struct CallbackResponse {
    #[allow(dead_code)]
    success: Option<bool>,
    #[allow(dead_code)]
    code: Option<u16>,
    message: Option<String>,
}

/// Client for posting ACP callbacks to Convex.
#[derive(Clone)]
pub struct CallbackClient {
    http: Client,
    callback_url: String,
    callback_jwt: String,
}

impl CallbackClient {
    /// Create a new callback client.
    ///
    /// # Arguments
    /// * `callback_url` - The Convex callback URL (e.g., `https://polite-canary-804.convex.site/api/acp/callback`)
    /// * `callback_jwt` - JWT token for authenticating callbacks
    pub fn new(callback_url: impl Into<String>, callback_jwt: impl Into<String>) -> Self {
        Self {
            http: Client::new(),
            callback_url: callback_url.into(),
            callback_jwt: callback_jwt.into(),
        }
    }

    /// Post a callback payload to Convex.
    async fn post_callback(&self, payload: CallbackPayload) -> Result<()> {
        debug!(
            callback_url = %self.callback_url,
            payload_type = ?std::mem::discriminant(&payload),
            "Posting callback to Convex"
        );

        let response = self
            .http
            .post(&self.callback_url)
            .header("Authorization", format!("Bearer {}", self.callback_jwt))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await
            .context("Failed to send callback request")?;

        let status = response.status();
        if !status.is_success() {
            let body: CallbackResponse = response.json().await.unwrap_or(CallbackResponse {
                success: None,
                code: Some(status.as_u16()),
                message: Some("Failed to parse error response".to_string()),
            });

            let error_msg = body.message.unwrap_or_else(|| format!("HTTP {}", status));
            error!(
                status = %status,
                error = %error_msg,
                "Callback request failed"
            );
            anyhow::bail!("Callback failed: {}", error_msg);
        }

        debug!("Callback posted successfully");
        Ok(())
    }

    /// Send a text chunk for a message.
    ///
    /// If `message_id` is None, a new assistant message will be created.
    /// Returns without error even on failure to avoid blocking the agent.
    pub async fn send_text_chunk(
        &self,
        conversation_id: &str,
        message_id: Option<&str>,
        text: &str,
    ) {
        let payload = CallbackPayload::MessageChunk {
            conversation_id: conversation_id.to_string(),
            message_id: message_id.map(|s| s.to_string()),
            content: CallbackContentBlock::Text {
                text: text.to_string(),
            },
        };

        if let Err(e) = self.post_callback(payload).await {
            warn!(
                conversation_id = %conversation_id,
                error = %e,
                "Failed to send text chunk callback"
            );
        }
    }

    /// Send a content block for a message.
    pub async fn send_content_chunk(
        &self,
        conversation_id: &str,
        message_id: Option<&str>,
        content: CallbackContentBlock,
    ) {
        let payload = CallbackPayload::MessageChunk {
            conversation_id: conversation_id.to_string(),
            message_id: message_id.map(|s| s.to_string()),
            content,
        };

        if let Err(e) = self.post_callback(payload).await {
            warn!(
                conversation_id = %conversation_id,
                error = %e,
                "Failed to send content chunk callback"
            );
        }
    }

    /// Mark a message as complete.
    pub async fn complete_message(
        &self,
        conversation_id: &str,
        message_id: &str,
        stop_reason: StopReason,
    ) {
        let payload = CallbackPayload::MessageComplete {
            conversation_id: conversation_id.to_string(),
            message_id: message_id.to_string(),
            stop_reason,
        };

        if let Err(e) = self.post_callback(payload).await {
            warn!(
                conversation_id = %conversation_id,
                message_id = %message_id,
                error = %e,
                "Failed to send message complete callback"
            );
        }
    }

    /// Record a tool call update.
    pub async fn record_tool_call(
        &self,
        conversation_id: &str,
        message_id: &str,
        tool_call: CallbackToolCall,
    ) {
        let payload = CallbackPayload::ToolCall {
            conversation_id: conversation_id.to_string(),
            message_id: message_id.to_string(),
            tool_call,
        };

        if let Err(e) = self.post_callback(payload).await {
            warn!(
                conversation_id = %conversation_id,
                message_id = %message_id,
                error = %e,
                "Failed to send tool call callback"
            );
        }
    }

    /// Report an error for a conversation.
    pub async fn report_error(&self, conversation_id: &str, code: &str, detail: Option<&str>) {
        let payload = CallbackPayload::Error {
            conversation_id: conversation_id.to_string(),
            code: code.to_string(),
            detail: detail.map(|s| s.to_string()),
        };

        if let Err(e) = self.post_callback(payload).await {
            error!(
                conversation_id = %conversation_id,
                error = %e,
                "Failed to send error callback"
            );
        }
    }

    /// Notify Convex that the sandbox is ready.
    pub async fn sandbox_ready(&self, sandbox_id: &str, sandbox_url: &str) -> Result<()> {
        let payload = CallbackPayload::SandboxReady {
            sandbox_id: sandbox_id.to_string(),
            sandbox_url: sandbox_url.to_string(),
        };

        self.post_callback(payload).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_callback_content_block_serialization() {
        let block = CallbackContentBlock::Text {
            text: "Hello".to_string(),
        };
        let json = serde_json::to_string(&block).expect("Serialization failed");
        assert!(json.contains("\"type\":\"text\""));
        assert!(json.contains("\"text\":\"Hello\""));
    }

    #[test]
    fn test_message_chunk_payload_serialization() {
        let payload = CallbackPayload::MessageChunk {
            conversation_id: "conv123".to_string(),
            message_id: Some("msg456".to_string()),
            content: CallbackContentBlock::Text {
                text: "test".to_string(),
            },
        };
        let json = serde_json::to_string(&payload).expect("Serialization failed");
        assert!(json.contains("\"type\":\"message_chunk\""));
        assert!(json.contains("\"conversationId\":\"conv123\""));
        assert!(json.contains("\"messageId\":\"msg456\""));
    }

    #[test]
    fn test_stop_reason_serialization() {
        let payload = CallbackPayload::MessageComplete {
            conversation_id: "conv123".to_string(),
            message_id: "msg456".to_string(),
            stop_reason: StopReason::EndTurn,
        };
        let json = serde_json::to_string(&payload).expect("Serialization failed");
        assert!(json.contains("\"stopReason\":\"end_turn\""));
    }

    #[test]
    fn test_tool_call_serialization() {
        let tool_call = CallbackToolCall {
            id: "tc123".to_string(),
            name: "read_file".to_string(),
            arguments: r#"{"path": "/test.txt"}"#.to_string(),
            status: CallbackToolCallStatus::Running,
            result: None,
        };
        let json = serde_json::to_string(&tool_call).expect("Serialization failed");
        assert!(json.contains("\"status\":\"running\""));
        assert!(!json.contains("\"result\"")); // Should be skipped when None
    }

    #[test]
    fn test_error_payload_serialization() {
        let payload = CallbackPayload::Error {
            conversation_id: "conv123".to_string(),
            code: "cli_crashed".to_string(),
            detail: Some("Process exited with code 1".to_string()),
        };
        let json = serde_json::to_string(&payload).expect("Serialization failed");
        assert!(json.contains("\"type\":\"error\""));
        assert!(json.contains("\"code\":\"cli_crashed\""));
        assert!(json.contains("\"detail\":"));
    }

    #[test]
    fn test_sandbox_ready_payload_serialization() {
        let payload = CallbackPayload::SandboxReady {
            sandbox_id: "sandbox123".to_string(),
            sandbox_url: "http://localhost:39384".to_string(),
        };
        let json = serde_json::to_string(&payload).expect("Serialization failed");
        assert!(json.contains("\"type\":\"sandbox_ready\""));
        assert!(json.contains("\"sandboxId\":\"sandbox123\""));
        assert!(json.contains("\"sandboxUrl\":\"http://localhost:39384\""));
    }
}
