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
mod opencode_proxy;
mod pty_proxy;
pub mod rest;
mod spawner;
mod stream;
mod ui_proxy;
mod ws_util;

pub use api_proxy::{
    build_llm_proxy_router, get_boot_api_proxy, get_integrated_llm_proxy, set_boot_api_proxy,
    set_integrated_llm_proxy, set_lazy_prewarm, trigger_lazy_prewarm, ApiProxies, ApiProxy,
    ConversationApiProxies, ConversationApiProxy, JwtHolder, LazyPrewarm, LlmProxyState,
    UnifiedApiProxy,
};
pub use callback::{
    CallbackClient, CallbackContentBlock, CallbackToolCall, CallbackToolCallStatus, StopReason,
};
pub use opencode_proxy::{opencode_preflight, opencode_proxy, opencode_pty_ws};
pub use pty_proxy::{
    pty_capture_session, pty_create_session, pty_delete_session, pty_get_session, pty_health,
    pty_input_session, pty_list_sessions, pty_preflight, pty_resize_session, pty_session_ws,
    pty_update_session,
};
pub use rest::{
    configure, init_conversation, receive_prompt, send_rpc, stream_acp_events, stream_preflight,
    RestApiDoc, RestApiState,
};
pub use spawner::{AcpProvider, CliSpawner, IsolationMode};
pub use stream::{StreamEvent, StreamOffset, StreamReadResult, StreamStore};
pub use ui_proxy::{cmux_code_asset_proxy, cmux_code_proxy, novnc_proxy, novnc_ws, vnc_ws};
