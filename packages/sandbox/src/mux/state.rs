use std::collections::HashSet;
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use tokio::sync::mpsc;

use crate::models::{NotificationLevel, SandboxNetwork, SandboxStatus, SandboxSummary};
use crate::mux::commands::MuxCommand;
use crate::mux::events::MuxEvent;
use crate::mux::layout::{Direction, NavDirection, Pane, PaneId, SandboxId, WorkspaceManager};
use crate::mux::onboard::OnboardState;
use crate::mux::palette::CommandPalette;
use crate::mux::sidebar::Sidebar;
use crate::mux::terminal::{SharedTerminalManager, TerminalRenderView};
use uuid::Uuid;

/// Which area of the UI has focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusArea {
    Sidebar,
    MainArea,
    CommandPalette,
    Notifications,
    Onboard,
}

#[derive(Debug, Clone)]
pub struct NotificationEntry {
    pub id: Uuid,
    pub message: String,
    pub level: NotificationLevel,
    pub sandbox_id: Option<String>,
    pub tab_id: Option<String>,
    pub pane_id: Option<String>,
    pub sent_at: DateTime<Utc>,
    pub read_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Default)]
pub struct NotificationsState {
    pub items: Vec<NotificationEntry>,
    pub selected_index: usize,
    pub is_open: bool,
}

impl NotificationsState {
    pub fn new() -> Self {
        Self {
            items: Vec::new(),
            selected_index: 0,
            is_open: false,
        }
    }

    pub fn unread_count(&self) -> usize {
        self.items
            .iter()
            .filter(|item| item.read_at.is_none())
            .count()
    }

    pub fn add_notification(&mut self, entry: NotificationEntry) {
        let insert_at = self
            .items
            .iter()
            .position(|existing| existing.sent_at <= entry.sent_at)
            .unwrap_or(self.items.len());
        self.items.insert(insert_at, entry);
        self.selected_index = 0;
    }

    pub fn combined_order(&self) -> Vec<usize> {
        let mut unread: Vec<usize> = self
            .items
            .iter()
            .enumerate()
            .filter_map(|(idx, item)| (item.read_at.is_none()).then_some(idx))
            .collect();
        let mut read: Vec<usize> = self
            .items
            .iter()
            .enumerate()
            .filter_map(|(idx, item)| item.read_at.is_some().then_some(idx))
            .collect();
        // Items are already sorted by sent_at desc; preserve that order
        unread.sort_by_key(|idx| std::cmp::Reverse(self.items[*idx].sent_at));
        read.sort_by_key(|idx| std::cmp::Reverse(self.items[*idx].sent_at));
        unread.extend(read);
        unread
    }

    pub fn selected_item_index(&self) -> Option<usize> {
        let order = self.combined_order();
        if order.is_empty() {
            return None;
        }
        let clamped = self.selected_index.min(order.len().saturating_sub(1));
        order.get(clamped).copied()
    }

    pub fn selected_item(&self) -> Option<&NotificationEntry> {
        self.selected_item_index()
            .and_then(|idx| self.items.get(idx))
    }

    pub fn selected_item_mut(&mut self) -> Option<&mut NotificationEntry> {
        let order = self.combined_order();
        let idx = order.get(self.selected_index).copied()?;
        self.items.get_mut(idx)
    }

    pub fn select_next(&mut self) {
        let total = self.combined_order().len();
        if total == 0 {
            self.selected_index = 0;
            return;
        }
        self.selected_index = (self.selected_index + 1).min(total.saturating_sub(1));
    }

    pub fn select_previous(&mut self) {
        if self.selected_index == 0 {
            return;
        }
        self.selected_index -= 1;
    }

    pub fn mark_read(&mut self) {
        if let Some(item) = self.selected_item_mut() {
            if item.read_at.is_none() {
                item.read_at = Some(Utc::now());
            }
        }
    }

    pub fn mark_unread(&mut self) {
        if let Some(item) = self.selected_item_mut() {
            item.read_at = None;
        }
    }

    pub fn toggle_read(&mut self) {
        if let Some(item) = self.selected_item_mut() {
            if item.read_at.is_some() {
                item.read_at = None;
            } else {
                item.read_at = Some(Utc::now());
            }
        }
    }
}

/// The main application state for the multiplexer.
pub struct MuxApp<'a> {
    // Core state - WorkspaceManager holds all sandbox workspaces
    pub workspace_manager: WorkspaceManager,
    pub sidebar: Sidebar,
    pub command_palette: CommandPalette<'a>,
    pub focus: FocusArea,

    // Zoom state
    pub zoomed_pane: Option<crate::mux::layout::PaneId>,

    // Help overlay
    pub show_help: bool,
    // Notifications overlay/state
    pub notifications: NotificationsState,

    // Event channel
    pub event_tx: mpsc::UnboundedSender<MuxEvent>,

    // Base URL for API calls
    pub base_url: String,

    // Workspace path used for new sandboxes
    pub workspace_path: PathBuf,

    // Status message to display
    pub status_message: Option<(String, std::time::Instant)>,

    // Tab rename state
    pub renaming_tab: bool,
    pub rename_input: Option<tui_textarea::TextArea<'a>>,

    // Terminal manager for handling sandbox connections
    pub terminal_manager: Option<SharedTerminalManager>,

    // Queue of sandboxes that need terminal connections
    pub pending_connects: std::collections::VecDeque<String>,

    // Flag to indicate we need to create a sandbox on startup
    pub needs_initial_sandbox: bool,

    // Last rendered terminal views per pane for damage-aware drawing
    pub last_terminal_views:
        std::collections::HashMap<PaneId, crate::mux::terminal::TerminalRenderView>,

    /// Cursor blink state for the active terminal pane (set during render)
    pub cursor_blink: bool,
    /// Cursor color for the active terminal pane (set during render)
    /// When Some, we render our own colored cursor instead of using native cursor
    pub cursor_color: Option<(u8, u8, u8)>,

    /// Onboarding state for Docker image setup
    pub onboard: Option<OnboardState>,

    /// Sandboxes that have delta pager enabled
    pub delta_enabled_sandboxes: HashSet<SandboxId>,

    /// Tab IDs of all pending sandbox creations - ALL will get terminal connections.
    pub pending_creation_tab_ids: HashSet<String>,

    /// The tab_id of the most recently initiated sandbox creation.
    /// Only this sandbox will steal focus/selection when it completes.
    pub most_recent_creation_tab_id: Option<String>,
}

impl<'a> MuxApp<'a> {
    pub fn new(
        base_url: String,
        event_tx: mpsc::UnboundedSender<MuxEvent>,
        workspace_path: PathBuf,
    ) -> Self {
        Self {
            workspace_manager: WorkspaceManager::new(),
            sidebar: Sidebar::new(),
            command_palette: CommandPalette::new(),
            focus: FocusArea::MainArea,
            zoomed_pane: None,
            show_help: false,
            notifications: NotificationsState::new(),
            event_tx,
            base_url,
            workspace_path,
            status_message: None,
            renaming_tab: false,
            rename_input: None,
            terminal_manager: None,
            pending_connects: std::collections::VecDeque::new(),
            needs_initial_sandbox: false,
            last_terminal_views: std::collections::HashMap::new(),
            cursor_blink: true,
            cursor_color: None,
            onboard: None,
            delta_enabled_sandboxes: HashSet::new(),
            pending_creation_tab_ids: HashSet::new(),
            most_recent_creation_tab_id: None,
        }
    }

    /// Get the currently selected sandbox ID.
    pub fn selected_sandbox_id(&self) -> Option<SandboxId> {
        self.workspace_manager.active_sandbox_id
    }

    /// Get the currently selected sandbox ID as a string.
    pub fn selected_sandbox_id_string(&self) -> Option<String> {
        self.workspace_manager
            .active_sandbox_id
            .map(|id| id.to_string())
    }

    /// Select a sandbox by its ID string and switch to its workspace.
    pub fn select_sandbox(&mut self, sandbox_id_str: &str) -> bool {
        if let Ok(sandbox_id) = sandbox_id_str.parse::<SandboxId>() {
            if self.workspace_manager.has_sandbox(sandbox_id) {
                self.workspace_manager.select_sandbox(sandbox_id);
                return true;
            }
        }
        false
    }

    /// Add a new sandbox and create its workspace.
    pub fn add_sandbox(&mut self, sandbox_id_str: &str, name: &str) {
        if let Ok(sandbox_id) = sandbox_id_str.parse::<SandboxId>() {
            self.workspace_manager.add_sandbox(sandbox_id, name);
        }
    }

    /// Set the terminal manager
    pub fn set_terminal_manager(&mut self, manager: SharedTerminalManager) {
        self.terminal_manager = Some(manager);
    }

    /// Get a render-ready snapshot of the terminal for a pane.
    pub fn get_terminal_view(&self, pane_id: PaneId, height: usize) -> Option<TerminalRenderView> {
        let manager = self.terminal_manager.as_ref()?;
        // We need to use try_lock for non-async context
        let mut guard = manager.try_lock().ok()?;
        let buffer = guard.get_buffer_mut(pane_id)?;
        Some(buffer.render_view(height))
    }

    /// Get the active pane ID from the active workspace.
    pub fn active_pane_id(&self) -> Option<PaneId> {
        self.workspace_manager
            .active_tab()
            .and_then(|tab| tab.active_pane)
    }

    /// Get the active tab from the active workspace.
    pub fn active_tab(&self) -> Option<&crate::mux::layout::Tab> {
        self.workspace_manager.active_tab()
    }

    /// Get the active tab from the active workspace mutably.
    pub fn active_tab_mut(&mut self) -> Option<&mut crate::mux::layout::Tab> {
        self.workspace_manager.active_tab_mut()
    }

    /// Set a status message that will be displayed temporarily.
    pub fn set_status(&mut self, message: impl Into<String>) {
        self.status_message = Some((message.into(), std::time::Instant::now()));
    }

    /// Check if delta pager is enabled for the current sandbox.
    pub fn is_delta_enabled(&self) -> bool {
        self.selected_sandbox_id()
            .is_some_and(|id| self.delta_enabled_sandboxes.contains(&id))
    }

    /// Clear expired status messages.
    pub fn clear_expired_status(&mut self) {
        if let Some((_, time)) = &self.status_message {
            if time.elapsed() > std::time::Duration::from_secs(3) {
                self.status_message = None;
            }
        }
    }

    pub fn open_notifications(&mut self) {
        self.notifications.is_open = true;
        self.focus = FocusArea::Notifications;
    }

    pub fn close_notifications(&mut self) {
        self.notifications.is_open = false;
        if self.focus == FocusArea::Notifications {
            self.focus = FocusArea::MainArea;
        }
    }

    pub fn record_notification(
        &mut self,
        message: String,
        level: NotificationLevel,
        sandbox_id: Option<String>,
        tab_id: Option<String>,
        pane_id: Option<String>,
    ) {
        let entry = NotificationEntry {
            id: Uuid::new_v4(),
            message: message.clone(),
            level,
            sandbox_id,
            tab_id,
            pane_id,
            sent_at: Utc::now(),
            read_at: None,
        };
        self.notifications.add_notification(entry);
    }

    pub fn open_notification_target(&mut self, entry: &NotificationEntry) {
        let mut sandbox_selected = false;
        if let Some(sandbox_id_str) = &entry.sandbox_id {
            if let Ok(uuid) = Uuid::parse_str(sandbox_id_str) {
                let sandbox_id = SandboxId::from_uuid(uuid);
                if self.workspace_manager.has_sandbox(sandbox_id) {
                    self.workspace_manager.select_sandbox(sandbox_id);
                    self.sidebar.select_by_id(uuid);
                    sandbox_selected = true;
                }
            }
        }

        let mut tab_selected = false;
        if let Some(tab_id_str) = &entry.tab_id {
            if let Ok(uuid) = Uuid::parse_str(tab_id_str) {
                let tab_id = crate::mux::layout::TabId::from_uuid(uuid);
                if sandbox_selected {
                    tab_selected = self
                        .workspace_manager
                        .select_tab_in_workspace_for_active(tab_id);
                } else if self.workspace_manager.select_tab_in_any_workspace(tab_id) {
                    if let Some(active_id) = self.workspace_manager.active_sandbox_id {
                        self.sidebar.select_by_id(active_id.0);
                    }
                    sandbox_selected = true;
                    tab_selected = true;
                }
            }
        }

        if sandbox_selected || tab_selected {
            self.focus = FocusArea::MainArea;
        }

        self.set_status("Opened notification");
    }

    /// Execute a command.
    pub fn execute_command(&mut self, cmd: MuxCommand) {
        match cmd {
            // Navigation
            MuxCommand::FocusLeft => {
                if self.focus == FocusArea::MainArea {
                    if let Some(tab) = self.active_tab_mut() {
                        tab.navigate(NavDirection::Left);
                    }
                }
            }
            MuxCommand::FocusRight => {
                if self.focus == FocusArea::MainArea {
                    if let Some(tab) = self.active_tab_mut() {
                        tab.navigate(NavDirection::Right);
                    }
                }
            }
            MuxCommand::FocusUp => {
                if self.focus == FocusArea::MainArea {
                    if let Some(tab) = self.active_tab_mut() {
                        tab.navigate(NavDirection::Up);
                    }
                } else if self.focus == FocusArea::Sidebar {
                    self.sidebar.select_previous();
                }
            }
            MuxCommand::FocusDown => {
                if self.focus == FocusArea::MainArea {
                    if let Some(tab) = self.active_tab_mut() {
                        tab.navigate(NavDirection::Down);
                    }
                } else if self.focus == FocusArea::Sidebar {
                    self.sidebar.select_next();
                }
            }
            MuxCommand::FocusSidebar => {
                if self.sidebar.visible {
                    self.focus = FocusArea::Sidebar;
                }
            }
            MuxCommand::FocusMainArea => {
                self.focus = FocusArea::MainArea;
            }
            MuxCommand::NextPane => {
                if let Some(tab) = self.active_tab_mut() {
                    tab.next_pane();
                }
            }
            MuxCommand::PrevPane => {
                if let Some(tab) = self.active_tab_mut() {
                    tab.prev_pane();
                }
            }
            MuxCommand::NextTab => self.workspace_manager.next_tab(),
            MuxCommand::PrevTab => self.workspace_manager.prev_tab(),
            MuxCommand::GoToTab1 => self.workspace_manager.go_to_tab(0),
            MuxCommand::GoToTab2 => self.workspace_manager.go_to_tab(1),
            MuxCommand::GoToTab3 => self.workspace_manager.go_to_tab(2),
            MuxCommand::GoToTab4 => self.workspace_manager.go_to_tab(3),
            MuxCommand::GoToTab5 => self.workspace_manager.go_to_tab(4),
            MuxCommand::GoToTab6 => self.workspace_manager.go_to_tab(5),
            MuxCommand::GoToTab7 => self.workspace_manager.go_to_tab(6),
            MuxCommand::GoToTab8 => self.workspace_manager.go_to_tab(7),
            MuxCommand::GoToTab9 => self.workspace_manager.go_to_tab(8),

            // Pane management - new tabs/splits belong to the active sandbox
            MuxCommand::SplitHorizontal => {
                if let Some(tab) = self.active_tab_mut() {
                    tab.split(Direction::Horizontal, Pane::terminal(None, "Terminal"));
                    self.set_status("Split horizontally");
                    // Auto-connect the new pane to the sandbox terminal
                    let _ = self.event_tx.send(MuxEvent::ConnectActivePaneToSandbox);
                }
            }
            MuxCommand::SplitVertical => {
                if let Some(tab) = self.active_tab_mut() {
                    tab.split(Direction::Vertical, Pane::terminal(None, "Terminal"));
                    self.set_status("Split vertically");
                    // Auto-connect the new pane to the sandbox terminal
                    let _ = self.event_tx.send(MuxEvent::ConnectActivePaneToSandbox);
                }
            }
            MuxCommand::ClosePane => {
                if let Some(tab) = self.active_tab_mut() {
                    if tab.close_active_pane() {
                        self.set_status("Pane closed");
                    }
                }
            }
            MuxCommand::ToggleZoom => {
                if let Some(tab) = self.active_tab() {
                    if self.zoomed_pane.is_some() {
                        self.zoomed_pane = None;
                        self.set_status("Zoom off");
                    } else if let Some(pane_id) = tab.active_pane {
                        self.zoomed_pane = Some(pane_id);
                        self.set_status("Zoom on");
                    }
                }
            }
            MuxCommand::SwapPaneLeft
            | MuxCommand::SwapPaneRight
            | MuxCommand::SwapPaneUp
            | MuxCommand::SwapPaneDown => {
                self.set_status("Pane swapping not yet implemented");
            }
            MuxCommand::ResizeLeft => {
                if let Some(tab) = self.active_tab_mut() {
                    tab.resize(NavDirection::Left, 0.05);
                }
            }
            MuxCommand::ResizeRight => {
                if let Some(tab) = self.active_tab_mut() {
                    tab.resize(NavDirection::Right, 0.05);
                }
            }
            MuxCommand::ResizeUp => {
                if let Some(tab) = self.active_tab_mut() {
                    tab.resize(NavDirection::Up, 0.05);
                }
            }
            MuxCommand::ResizeDown => {
                if let Some(tab) = self.active_tab_mut() {
                    tab.resize(NavDirection::Down, 0.05);
                }
            }

            // Tab management - tabs belong to the active sandbox workspace
            MuxCommand::NewTab => {
                if self.workspace_manager.new_tab().is_some() {
                    self.set_status("New tab created");
                    // Auto-connect the new pane to the sandbox terminal
                    let _ = self.event_tx.send(MuxEvent::ConnectActivePaneToSandbox);
                } else {
                    self.set_status("No sandbox selected");
                }
            }
            MuxCommand::CloseTab => {
                if self.workspace_manager.close_active_tab() {
                    self.set_status("Tab closed");
                }
            }
            MuxCommand::RenameTab => {
                self.start_tab_rename();
            }
            MuxCommand::MoveTabLeft => {
                self.workspace_manager.move_tab_left();
            }
            MuxCommand::MoveTabRight => {
                self.workspace_manager.move_tab_right();
            }

            // Sidebar - Ctrl+S toggles focus between sidebar and main area
            MuxCommand::ToggleSidebar => {
                // Ensure sidebar is visible
                if !self.sidebar.visible {
                    self.sidebar.visible = true;
                }
                // Toggle focus
                if self.focus == FocusArea::Sidebar {
                    self.focus = FocusArea::MainArea;
                } else {
                    self.focus = FocusArea::Sidebar;
                }
            }
            MuxCommand::SelectSandbox => {
                if self.focus == FocusArea::Sidebar {
                    if let Some(sandbox) = self.sidebar.selected_sandbox() {
                        let sandbox_id_str = sandbox.id.to_string();
                        let sandbox_name = sandbox.name.clone();
                        // Select the sandbox and switch to its workspace
                        self.select_sandbox(&sandbox_id_str);
                        self.set_status(format!("Selected: {}", sandbox_name));
                        // Switch to main area after selection
                        self.focus = FocusArea::MainArea;
                    }
                }
            }
            MuxCommand::NextSandbox => {
                if let Some(sandbox_id) = self.workspace_manager.next_sandbox() {
                    // Also update sidebar selection to match
                    self.sidebar.select_by_id(sandbox_id.0);
                    if let Some(ws) = self.workspace_manager.active_workspace() {
                        self.set_status(format!("Switched to: {}", ws.name));
                    }
                }
            }
            MuxCommand::PrevSandbox => {
                if let Some(sandbox_id) = self.workspace_manager.prev_sandbox() {
                    // Also update sidebar selection to match
                    self.sidebar.select_by_id(sandbox_id.0);
                    if let Some(ws) = self.workspace_manager.active_workspace() {
                        self.set_status(format!("Switched to: {}", ws.name));
                    }
                }
            }

            // Sandbox management
            MuxCommand::NewSandbox => {
                self.set_status("Creating new sandbox...");
                // Generate a UNIQUE correlation ID for each creation request
                // Using active_tab_id() was wrong because it's the SAME for all rapid Alt+N presses
                // which caused HashMap overwrites and broken placeholder correlation
                let correlation_id = crate::mux::layout::TabId::new();
                let _ = self.event_tx.send(MuxEvent::CreateSandboxWithWorkspace {
                    workspace_path: self.workspace_path.clone(),
                    tab_id: Some(correlation_id.to_string()),
                });
                self.add_placeholder_sandbox("Creating sandbox", Some(correlation_id));
            }
            MuxCommand::DeleteSandbox => {
                if let Some(sandbox) = self.sidebar.selected_sandbox() {
                    self.set_status(format!("Deleting sandbox: {}", sandbox.name));
                } else {
                    self.set_status("No sandbox selected");
                }
            }
            MuxCommand::RefreshSandboxes => {
                self.set_status("Refreshing sandboxes...");
            }

            // Session
            MuxCommand::NewSession => {
                self.set_status("Creating new session...");
            }
            MuxCommand::AttachSandbox => {
                if let Some(sandbox_id) = self.selected_sandbox_id_string() {
                    self.set_status(format!("Attaching to sandbox: {}", sandbox_id));
                } else if let Some(sandbox) = self.sidebar.selected_sandbox() {
                    let sandbox_id_str = sandbox.id.to_string();
                    let sandbox_name = sandbox.name.clone();
                    self.select_sandbox(&sandbox_id_str);
                    self.set_status(format!("Attaching to sandbox: {}", sandbox_name));
                } else {
                    self.set_status("No sandbox selected");
                }
            }
            MuxCommand::DetachSandbox => {
                self.set_status("Detaching from sandbox...");
                // Don't clear workspace_manager.active_sandbox_id - just show status
            }

            // UI
            MuxCommand::OpenCommandPalette => {
                self.command_palette.open();
                self.focus = FocusArea::CommandPalette;
            }
            MuxCommand::ToggleHelp => {
                self.show_help = !self.show_help;
            }
            MuxCommand::ShowNotifications => {
                if self.notifications.is_open {
                    self.close_notifications();
                } else {
                    self.open_notifications();
                }
            }
            MuxCommand::Quit => {
                // Handled by the runner
            }

            // Scrolling (handled in pane content)
            MuxCommand::ScrollUp
            | MuxCommand::ScrollDown
            | MuxCommand::ScrollPageUp
            | MuxCommand::ScrollPageDown
            | MuxCommand::ScrollToTop
            | MuxCommand::ScrollToBottom => {
                // TODO: Forward to active pane
            }

            // Terminal utilities - execute git config silently via exec API
            MuxCommand::EnableDeltaPager => {
                if let Some(sandbox_id) = self.selected_sandbox_id() {
                    // Enable delta with line numbers, navigation, and always-pager mode
                    let cmd = vec![
                        "/bin/sh".to_string(),
                        "-c".to_string(),
                        "git config --global core.pager 'delta --paging=always' && \
                         git config --global interactive.diffFilter 'delta --color-only' && \
                         git config --global delta.navigate true && \
                         git config --global delta.line-numbers true && \
                         git config --global delta.paging always"
                            .to_string(),
                    ];
                    let _ = self.event_tx.send(MuxEvent::ExecInSandbox {
                        sandbox_id: sandbox_id.to_string(),
                        command: cmd,
                    });
                    self.delta_enabled_sandboxes.insert(sandbox_id);
                    self.set_status("Delta pager enabled");
                }
            }
            MuxCommand::DisableDeltaPager => {
                if let Some(sandbox_id) = self.selected_sandbox_id() {
                    let cmd = vec![
                        "/bin/sh".to_string(),
                        "-c".to_string(),
                        "git config --global --unset core.pager; \
                         git config --global --unset interactive.diffFilter; \
                         git config --global --unset delta.navigate; \
                         git config --global --unset delta.line-numbers; \
                         git config --global --unset delta.paging; \
                         true"
                            .to_string(),
                    ];
                    let _ = self.event_tx.send(MuxEvent::ExecInSandbox {
                        sandbox_id: sandbox_id.to_string(),
                        command: cmd,
                    });
                    self.delta_enabled_sandboxes.remove(&sandbox_id);
                    self.set_status("Delta pager disabled");
                }
            }
            MuxCommand::CopyScrollback => {
                // Get the active pane's terminal content and copy to clipboard
                // Extract the text first to avoid borrow conflicts with set_status
                let result: Result<String, &'static str> = (|| {
                    let pane_id = self.active_pane_id().ok_or("No active pane")?;
                    let manager = self
                        .terminal_manager
                        .as_ref()
                        .ok_or("Terminal manager not available")?;
                    let mut guard = manager
                        .try_lock()
                        .map_err(|_| "Could not access terminal")?;
                    let buffer = guard
                        .get_buffer_mut(pane_id)
                        .ok_or("No terminal in active pane")?;
                    Ok(buffer.get_all_text())
                })();

                match result {
                    Ok(text) if text.is_empty() => {
                        self.set_status("Terminal is empty");
                    }
                    Ok(text) => match arboard::Clipboard::new() {
                        Ok(mut clipboard) => match clipboard.set_text(&text) {
                            Ok(()) => {
                                let lines = text.lines().count();
                                self.set_status(format!("Copied {} lines to clipboard", lines));
                            }
                            Err(e) => {
                                self.set_status(format!("Failed to copy: {}", e));
                            }
                        },
                        Err(e) => {
                            self.set_status(format!("Clipboard not available: {}", e));
                        }
                    },
                    Err(msg) => {
                        self.set_status(msg);
                    }
                }
            }
        }
    }

    /// Close the command palette.
    pub fn close_command_palette(&mut self) {
        self.command_palette.close();
        self.focus = FocusArea::MainArea;
    }

    /// Start tab rename mode.
    fn start_tab_rename(&mut self) {
        if let Some(tab) = self.active_tab() {
            let mut input = tui_textarea::TextArea::default();
            input.insert_str(&tab.name);
            self.rename_input = Some(input);
            self.renaming_tab = true;
        }
    }

    /// Finish tab rename.
    pub fn finish_tab_rename(&mut self, apply: bool) {
        if apply {
            if let Some(input) = &self.rename_input {
                let new_name = input.lines().join("");
                if !new_name.is_empty() {
                    self.workspace_manager.rename_active_tab(new_name);
                }
            }
        }
        self.rename_input = None;
        self.renaming_tab = false;
    }

    /// Handle an event.
    pub fn handle_event(&mut self, event: MuxEvent) {
        match event {
            MuxEvent::CreateSandboxWithWorkspace { .. } => {
                self.set_status("Creating sandbox...");
            }
            MuxEvent::SandboxesRefreshed(sandboxes) => {
                let had_active = self.selected_sandbox_id().is_some();

                // SIMPLIFIED: Server is source of truth for sandbox list.
                // Just merge server sandboxes with local placeholders.
                // Selection is preserved by ID (not index) - handled automatically by Sidebar.
                use std::collections::HashSet;

                // Build new list: server sandboxes first (server order), then local placeholders
                let server_ids: HashSet<_> = sandboxes.iter().map(|s| s.id).collect();

                // Build a map from correlation_id -> server sandbox UUID for selection transfer
                let server_by_correlation: std::collections::HashMap<_, _> = sandboxes
                    .iter()
                    .filter_map(|s| s.correlation_id.as_ref().map(|cid| (cid.clone(), s.id)))
                    .collect();

                // If currently selected sandbox is a placeholder being replaced by server,
                // transfer selection to the server sandbox
                if let Some(selected_id) = self.sidebar.selected_id {
                    if let Some(selected_placeholder) = self
                        .sidebar
                        .sandboxes
                        .iter()
                        .find(|s| s.id == selected_id && s.status == SandboxStatus::Creating)
                    {
                        if let Some(cid) = &selected_placeholder.correlation_id {
                            if let Some(&server_sandbox_id) = server_by_correlation.get(cid) {
                                // Transfer selection to the server sandbox that replaced the placeholder
                                self.sidebar.selected_id = Some(server_sandbox_id);
                            }
                        }
                    }
                }

                // Collect correlation_ids from server sandboxes - if server has a sandbox
                // with a matching correlation_id, that placeholder has been "resolved"
                let server_correlation_ids: HashSet<_> =
                    server_by_correlation.keys().cloned().collect();

                // Keep local placeholders (Creating status) only if:
                // 1. Their ID isn't in server list (always true for client-generated IDs)
                // 2. Their correlation_id isn't in server list (meaning server hasn't created it yet)
                let local_placeholders: Vec<_> = self
                    .sidebar
                    .sandboxes
                    .iter()
                    .filter(|s| {
                        s.status == SandboxStatus::Creating
                            && !server_ids.contains(&s.id)
                            && s.correlation_id
                                .as_ref()
                                .map(|cid| !server_correlation_ids.contains(cid))
                                .unwrap_or(false) // No correlation_id = can't match, drop it
                    })
                    .cloned()
                    .collect();

                // Server sandboxes + pending placeholders
                let mut new_list = sandboxes.clone();
                new_list.extend(local_placeholders);

                // set_sandboxes preserves selection by ID automatically
                self.sidebar.set_sandboxes(new_list);

                // Sync workspace manager with server sandboxes
                for sandbox in &sandboxes {
                    let sandbox_id_str = sandbox.id.to_string();
                    self.add_sandbox(&sandbox_id_str, &sandbox.name);
                }

                // Only add to pending_connects on first load (when we had no active sandbox)
                if !had_active && self.pending_connects.is_empty() {
                    if let Some(first) = self.sidebar.sandboxes.first() {
                        let first_id = first.id.to_string();
                        self.pending_connects.push_back(first_id);
                    }
                }
            }
            MuxEvent::SandboxRefreshFailed(error) => {
                self.sidebar.set_error(error.clone());
                self.set_status(format!("Error: {}", error));
            }
            MuxEvent::SandboxCreated { sandbox, tab_id } => {
                let sandbox_id_str = sandbox.id.to_string();

                // Find placeholder by correlation_id directly in the sandbox list
                // This is the single source of truth - no separate HashMap
                let mut updated_in_place = false;

                if let Some(tab_id_str) = &tab_id {
                    // Find placeholder with matching correlation_id
                    let placeholder_pos = self.sidebar.sandboxes.iter().position(|s| {
                        s.status == SandboxStatus::Creating
                            && s.correlation_id.as_ref() == Some(tab_id_str)
                    });

                    if let Some(pos) = placeholder_pos {
                        let placeholder_uuid = self.sidebar.sandboxes[pos].id;
                        let was_selected = self.sidebar.selected_id == Some(placeholder_uuid);

                        // Update the placeholder entry in-place
                        let entry = &mut self.sidebar.sandboxes[pos];
                        let old_id = entry.id;
                        entry.id = sandbox.id;
                        entry.index = sandbox.index;
                        entry.name = sandbox.name.clone();
                        entry.created_at = sandbox.created_at;
                        entry.workspace = sandbox.workspace.clone();
                        entry.status = sandbox.status.clone();
                        entry.network = sandbox.network.clone();
                        entry.correlation_id = None; // Clear correlation after matching
                        updated_in_place = true;

                        // Update selection to follow the new ID
                        if was_selected {
                            self.sidebar.selected_id = Some(sandbox.id);
                        }

                        // Update workspace_manager
                        self.workspace_manager
                            .remove_sandbox(SandboxId::from_uuid(old_id));
                        self.add_sandbox(&sandbox_id_str, &sandbox.name);
                        if was_selected {
                            self.workspace_manager
                                .select_sandbox(SandboxId::from_uuid(sandbox.id));
                        }
                    }
                }

                // If no placeholder found, just add the sandbox
                if !updated_in_place {
                    // Remove duplicate if exists
                    self.sidebar
                        .sandboxes
                        .retain(|existing| existing.id != sandbox.id);
                    self.sidebar.sandboxes.push(sandbox.clone());
                    self.add_sandbox(&sandbox_id_str, &sandbox.name);
                }

                // Map tab_id to sandbox in workspace manager
                if let Some(tab_id_str) = &tab_id {
                    if let Ok(tab_uuid) = Uuid::parse_str(tab_id_str) {
                        let tab_id = crate::mux::layout::TabId::from_uuid(tab_uuid);
                        let _ = self.workspace_manager.set_active_tab_id_for_sandbox(
                            crate::mux::layout::SandboxId::from_uuid(sandbox.id),
                            tab_id,
                        );
                    }
                }

                // Check if this sandbox was user-initiated (tab_id in pending_creation_tab_ids)
                let is_user_initiated = tab_id
                    .as_ref()
                    .is_some_and(|id| self.pending_creation_tab_ids.remove(id));

                if is_user_initiated {
                    // Add to pending_connects queue - ALL user-initiated sandboxes get terminals
                    self.pending_connects.push_back(sandbox_id_str.clone());
                }

                // Only select the MOST RECENT creation (prevents focus jumping)
                let is_most_recent = tab_id
                    .as_ref()
                    .is_some_and(|id| self.most_recent_creation_tab_id.as_ref() == Some(id));
                if is_most_recent {
                    self.most_recent_creation_tab_id = None;
                    // Select the newly created sandbox
                    self.sidebar.select_by_id(sandbox.id);
                    self.workspace_manager
                        .select_sandbox(SandboxId::from_uuid(sandbox.id));
                }

                self.set_status(format!("Created sandbox: {}", sandbox.name));
            }
            MuxEvent::SandboxTabMapped { sandbox_id, tab_id } => {
                if let (Ok(sandbox_uuid), Ok(tab_uuid)) =
                    (Uuid::parse_str(&sandbox_id), Uuid::parse_str(&tab_id))
                {
                    let sandbox_id = SandboxId::from_uuid(sandbox_uuid);
                    let tab_id = crate::mux::layout::TabId::from_uuid(tab_uuid);
                    let _ = self
                        .workspace_manager
                        .set_active_tab_id_for_sandbox(sandbox_id, tab_id);
                }
            }
            MuxEvent::SandboxDeleted(id) => {
                self.remove_sandbox_by_id_string(&id);
                self.focus = FocusArea::Sidebar;
                self.set_status(format!("Deleted sandbox: {}", id));
            }
            MuxEvent::SandboxConnectionChanged {
                sandbox_id,
                connected,
            } => {
                let state = if connected {
                    "connected"
                } else {
                    "disconnected"
                };
                self.set_status(format!("Sandbox {}: {}", sandbox_id, state));
            }
            MuxEvent::TerminalOutput { .. } => {
                // TODO: Forward to appropriate pane
            }
            MuxEvent::Error(msg) => {
                self.set_status(format!("Error: {}", msg));
            }
            MuxEvent::Notification {
                message,
                level,
                sandbox_id,
                tab_id,
                pane_id,
            } => {
                self.record_notification(message, level, sandbox_id, tab_id, pane_id);
            }
            MuxEvent::StatusMessage { message } => {
                self.set_status(message);
            }
            MuxEvent::ConnectToSandbox { sandbox_id } => {
                // DON'T select here - selection was already done SYNC in add_placeholder_sandbox
                // The runner handles pending_connect for terminal connection
                self.set_status(format!("Connecting to sandbox: {}", sandbox_id));
            }
            MuxEvent::ConnectActivePaneToSandbox => {
                // This is handled in the runner, just acknowledge here
            }
            MuxEvent::TerminalExited { .. } => {
                // Cleanup is handled in the runner where terminal state is available
            }
            MuxEvent::ThemeChanged { .. } => {
                // Theme change is handled in the runner
            }
            MuxEvent::Onboard(_) => {
                // Onboard events are handled in the runner
            }
            MuxEvent::SendTerminalInput { .. } => {
                // Terminal input is handled in the runner
            }
            MuxEvent::ExecInSandbox { .. } => {
                // Exec requests are handled in the runner
            }
        }
    }

    /// Add a local placeholder sandbox for immediate UI feedback while creation runs.
    /// The tab_id is stored as correlation_id on the sandbox itself to match placeholders
    /// with created sandboxes even when sandbox creation completes out-of-order.
    pub fn add_placeholder_sandbox(
        &mut self,
        name: impl Into<String>,
        tab_id: Option<crate::mux::layout::TabId>,
    ) {
        let sandbox_id = SandboxId::new();
        let name = name.into();
        let tab_id_str = tab_id.map(|t| t.to_string());

        let summary = SandboxSummary {
            id: sandbox_id.0,
            index: self.sidebar.sandboxes.len(),
            name: name.clone(),
            created_at: Utc::now(),
            workspace: "/workspace".to_string(),
            status: SandboxStatus::Creating, // Creating status = placeholder
            network: SandboxNetwork {
                host_interface: "pending".to_string(),
                sandbox_interface: "pending".to_string(),
                host_ip: "0.0.0.0".to_string(),
                sandbox_ip: "0.0.0.0".to_string(),
                cidr: 24,
            },
            correlation_id: tab_id_str.clone(), // Stored on sandbox itself - single source of truth
        };

        self.sidebar.sandboxes.push(summary);
        self.workspace_manager.add_sandbox(sandbox_id, name.clone());

        // IMMEDIATELY select the new placeholder - this is SYNC feedback for user's key press
        // With ID-based selection, just set the selected_id directly
        self.sidebar.select_by_id(sandbox_id.0);
        self.workspace_manager.select_sandbox(sandbox_id);

        if let Some(tab_id) = tab_id {
            let _ = self
                .workspace_manager
                .set_active_tab_id_for_sandbox(sandbox_id, tab_id);
        }

        // Track ALL pending creations for terminal connections + the most recent for selection
        if let Some(ref tid) = tab_id_str {
            self.pending_creation_tab_ids.insert(tid.clone());
            self.most_recent_creation_tab_id = Some(tid.clone());
        }
    }
    fn remove_sandbox_by_id_string(&mut self, id: &str) {
        let removed_uuid = Uuid::parse_str(id).ok();
        let was_selected = removed_uuid == self.sidebar.selected_id;

        // Find the index of the removed sandbox (for selecting neighbor if needed)
        let removed_index = self
            .sidebar
            .sandboxes
            .iter()
            .position(|sandbox| sandbox.id.to_string() == id);

        if let Ok(sandbox_id) = id.parse::<SandboxId>() {
            self.workspace_manager.remove_sandbox(sandbox_id);
        }

        self.sidebar
            .sandboxes
            .retain(|sandbox| sandbox.id.to_string() != id);

        // Remove deleted sandbox from pending_connects queue
        self.pending_connects.retain(|pending| pending != id);

        if self.sidebar.sandboxes.is_empty() {
            // List is now empty - clear selection
            self.sidebar.selected_id = None;
            self.workspace_manager.active_sandbox_id = None;
        } else if was_selected {
            // We removed the currently selected item - select a neighbor
            if let Some(removed_idx) = removed_index {
                let next_index = if removed_idx < self.sidebar.sandboxes.len() {
                    removed_idx
                } else {
                    self.sidebar.sandboxes.len() - 1
                };
                let next_sandbox = &self.sidebar.sandboxes[next_index];
                let next_id = next_sandbox.id;
                self.sidebar.select_by_id(next_id);
                let _ = self.select_sandbox(&next_id.to_string());
            }
        }
        // If we didn't remove the selected item, selection is preserved by ID automatically
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{NotificationLevel, SandboxNetwork, SandboxStatus, SandboxSummary};
    use chrono::Utc;
    use uuid::Uuid;

    #[test]
    fn sandbox_created_sets_pending_and_selection() {
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let mut app = MuxApp::new("http://localhost".to_string(), tx, PathBuf::from("."));
        let sandbox = sample_sandbox("demo");
        let tab_id = Uuid::new_v4().to_string();

        // Simulate user-initiated creation by setting the trackers
        app.pending_creation_tab_ids.insert(tab_id.clone());
        app.most_recent_creation_tab_id = Some(tab_id.clone());

        app.handle_event(MuxEvent::SandboxCreated {
            sandbox: sandbox.clone(),
            tab_id: Some(tab_id),
        });

        assert_eq!(
            app.pending_connects.back(),
            Some(&sandbox.id.to_string()),
            "pending_connects should contain the new sandbox"
        );
        assert_eq!(
            app.selected_sandbox_id_string(),
            Some(sandbox.id.to_string())
        );
        assert_eq!(
            app.sidebar.selected_sandbox().map(|s| s.id),
            Some(sandbox.id)
        );
    }

    #[test]
    fn sandbox_created_without_matching_tab_id_does_not_steal_focus() {
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let mut app = MuxApp::new("http://localhost".to_string(), tx, PathBuf::from("."));
        let sandbox = sample_sandbox("demo");

        // Create with a different tab_id than what was initiated
        let initiated_tab_id = Uuid::new_v4().to_string();
        app.pending_creation_tab_ids
            .insert(initiated_tab_id.clone());
        app.most_recent_creation_tab_id = Some(initiated_tab_id);

        app.handle_event(MuxEvent::SandboxCreated {
            sandbox: sandbox.clone(),
            tab_id: Some(Uuid::new_v4().to_string()), // Different tab_id
        });

        // Should NOT add to pending_connects since this wasn't user-initiated
        assert!(
            app.pending_connects.is_empty(),
            "pending_connects should be empty for non-matching tab_id"
        );
    }

    #[test]
    fn refresh_without_selection_queues_connect() {
        let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
        let mut app = MuxApp::new("http://localhost".to_string(), tx, PathBuf::from("."));
        let sandbox = sample_sandbox("demo");

        app.handle_event(MuxEvent::SandboxesRefreshed(vec![sandbox.clone()]));

        assert_eq!(app.pending_connects.back(), Some(&sandbox.id.to_string()));
        assert_eq!(
            app.sidebar.selected_sandbox().map(|s| s.id),
            Some(sandbox.id)
        );
        assert_eq!(
            app.selected_sandbox_id_string(),
            Some(sandbox.id.to_string())
        );
    }

    #[test]
    fn notifications_track_read_state() {
        let mut notifications = NotificationsState::new();
        let entry = NotificationEntry {
            id: Uuid::new_v4(),
            message: "hello".to_string(),
            level: NotificationLevel::Info,
            sandbox_id: None,
            tab_id: None,
            pane_id: None,
            sent_at: Utc::now(),
            read_at: None,
        };
        notifications.add_notification(entry);
        assert_eq!(notifications.unread_count(), 1);

        notifications.mark_read();
        assert_eq!(notifications.unread_count(), 0);
        assert!(notifications
            .selected_item()
            .and_then(|item| item.read_at)
            .is_some());

        notifications.mark_unread();
        assert_eq!(notifications.unread_count(), 1);
        assert!(notifications
            .selected_item()
            .and_then(|item| item.read_at)
            .is_none());
    }

    fn sample_sandbox(name: &str) -> SandboxSummary {
        SandboxSummary {
            id: Uuid::new_v4(),
            index: 0,
            name: name.to_string(),
            created_at: Utc::now(),
            workspace: "/workspace".to_string(),
            status: SandboxStatus::Running,
            network: SandboxNetwork {
                host_interface: "veth0".to_string(),
                sandbox_interface: "eth0".to_string(),
                host_ip: "10.0.0.1".to_string(),
                sandbox_ip: "10.0.0.2".to_string(),
                cidr: 24,
            },
            correlation_id: None,
        }
    }
}
