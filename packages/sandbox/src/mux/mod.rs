pub mod character;
pub mod colors;
pub mod commands;
pub mod events;
pub mod grid;
pub mod layout;
pub mod onboard;
pub mod palette;
pub mod runner;
pub mod sidebar;
pub mod state;
pub mod terminal;
pub mod ui;

pub use colors::{
    get_outer_bg, get_outer_fg, query_outer_terminal_colors, spawn_theme_change_listener,
    TerminalColors, ThemeChangeEvent,
};
pub use runner::run_mux_tui;
