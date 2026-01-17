//! ACP Server module for sandbox integration.
//!
//! This module provides REST API endpoints for Convex to control the sandbox.
//! The sandbox spawns coding CLIs (Claude Code, Codex, Gemini, OpenCode) and
//! communicates back to Convex ONLY via callbacks using JWT authentication.
//!
//! Architecture:
//! - Convex → REST API → Sandbox → CLI Spawner → Coding CLI
//! - Sandbox → Callback Client → Convex (persistence via JWT-authenticated callbacks)
//!
//! SECURITY: The sandbox has NO direct Convex query/mutation access.
//! All persistence goes through the callback client using the JWT provided at spawn time.

mod api_proxy;
pub mod callback;
pub mod rest;
mod spawner;

pub use api_proxy::{
    ApiProxies, ApiProxy, ConversationApiProxies, ConversationApiProxy, JwtHolder,
};
pub use callback::{
    CallbackClient, CallbackContentBlock, CallbackToolCall, CallbackToolCallStatus, StopReason,
};
pub use rest::{configure, init_conversation, receive_prompt, send_rpc, RestApiDoc, RestApiState};
pub use spawner::{AcpProvider, CliSpawner, IsolationMode};
