//! ACP Server module for iOS app integration.
//!
//! This module implements the Agent side of the Agent Client Protocol (ACP),
//! allowing iOS clients to connect and interact with coding CLIs (Claude Code,
//! Codex, Gemini, OpenCode) via WebSocket.
//!
//! Architecture:
//! - iOS App → WebSocket → ACP Server → CLI Spawner → Coding CLI
//! - Conversations are persisted to Convex via HTTP API
//! - Supports multiple isolation modes via bubblewrap namespaces
//! - API keys are held by internal proxy servers, not passed to CLIs

mod agent;
mod api_proxy;
pub mod callback;
mod persistence;
pub mod rest;
mod spawner;
mod websocket;

pub use agent::WrappedAgent;
pub use api_proxy::{
    ApiProxies, ApiProxy, ConversationApiProxies, ConversationApiProxy, JwtHolder, ProviderConfig,
};
pub use callback::{
    CallbackClient, CallbackContentBlock, CallbackToolCall, CallbackToolCallStatus, StopReason,
};
pub use persistence::{ConversationData, ConvexClient};
pub use rest::{init_conversation, receive_prompt, RestApiDoc, RestApiState};
pub use spawner::{AcpProvider, CliSpawner, IsolationMode};
pub use websocket::{
    acp_websocket_handler, set_conversation_jwt, AcpServerState, ApiKeys, ConversationProxyManager,
    SetJwtRequest, SetJwtResponse, SharedProxyManager,
};
