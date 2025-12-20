//! PTY Session Management
//!
//! This module provides PTY session management with support for:
//! - Host-namespace PTYs (for development)
//! - Sandbox-scoped PTYs (using nsenter to enter bwrap namespaces)

pub mod api;
mod session;
mod state;
mod types;

pub use api::pty_routes;
pub use session::PtySession;
pub use state::PtyState;
pub use types::*;
