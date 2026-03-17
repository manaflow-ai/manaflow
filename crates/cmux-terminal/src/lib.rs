//! cmux-terminal: Terminal emulation library
//!
//! This crate provides:
//! - `VirtualTerminal`: Full ANSI/VT100 terminal emulator with scrollback
//! - `DaFilter`: Filter for Device Attributes queries to prevent feedback loops
//! - `Grid`, `Row`, `TerminalCharacter`: Terminal buffer types
//!
//! # Usage
//!
//! ```rust
//! use cmux_terminal::{VirtualTerminal, DaFilter};
//!
//! // Create a terminal emulator
//! let mut term = VirtualTerminal::new(24, 80);
//! term.process(b"Hello, World!\r\n");
//!
//! // Filter DA queries from PTY output
//! let mut filter = DaFilter::new();
//! let filtered = filter.filter(b"\x1b[c"); // DA1 query filtered out
//! ```

mod character;
mod filter;
mod grid;
mod terminal;

pub use character::{CharacterStyles, ColorPalette, Row, SharedStyles, TerminalCharacter};
pub use filter::{filter_da_queries, DaFilter};
pub use grid::Grid;
pub use terminal::{Cell, VirtualTerminal};

// Re-export ratatui types that are used in the public API
pub use ratatui::style::{Color, Modifier, Style};
