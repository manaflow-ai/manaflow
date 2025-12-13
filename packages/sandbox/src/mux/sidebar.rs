use crate::models::{SandboxStatus, SandboxSummary};
use uuid::Uuid;

/// State for the sidebar showing sandbox list.
///
/// ARCHITECTURE: Selection is tracked by ID, not index.
/// This means when the server sends a new sandbox list, the selection
/// automatically "follows" the selected sandbox even if its position changes.
#[derive(Debug)]
pub struct Sidebar {
    /// Server-authoritative list of sandboxes (plus local placeholders)
    pub sandboxes: Vec<SandboxSummary>,
    /// ID of the currently selected sandbox (None = nothing selected)
    pub selected_id: Option<Uuid>,
    pub scroll_offset: usize,
    pub is_loading: bool,
    pub last_error: Option<String>,
    pub visible: bool,
    pub width: u16,
}

impl Default for Sidebar {
    fn default() -> Self {
        Self::new()
    }
}

impl Sidebar {
    pub fn new() -> Self {
        Self {
            sandboxes: Vec::new(),
            selected_id: None,
            scroll_offset: 0,
            is_loading: false,
            last_error: None,
            visible: true,
            width: 30,
        }
    }

    /// Get the visual index of the selected sandbox (for rendering).
    /// Returns 0 if nothing selected or selection not found.
    pub fn selected_index(&self) -> usize {
        self.selected_id
            .and_then(|id| self.sandboxes.iter().position(|s| s.id == id))
            .unwrap_or(0)
    }

    /// Set the list of sandboxes from server.
    /// Selection is preserved by ID - if the selected sandbox is still in the list,
    /// it stays selected regardless of position changes.
    pub fn set_sandboxes(&mut self, sandboxes: Vec<SandboxSummary>) {
        self.sandboxes = sandboxes;
        self.is_loading = false;
        self.last_error = None;

        // If selection no longer exists in list, clear it or select first
        if let Some(id) = self.selected_id {
            if !self.sandboxes.iter().any(|s| s.id == id) {
                self.selected_id = self.sandboxes.first().map(|s| s.id);
            }
        } else if !self.sandboxes.is_empty() {
            // Nothing was selected, select first
            self.selected_id = self.sandboxes.first().map(|s| s.id);
        }
    }

    /// Set an error state.
    pub fn set_error(&mut self, error: String) {
        self.is_loading = false;
        self.last_error = Some(error);
    }

    /// Get the currently selected sandbox.
    pub fn selected_sandbox(&self) -> Option<&SandboxSummary> {
        self.selected_id
            .and_then(|id| self.sandboxes.iter().find(|s| s.id == id))
    }

    /// Select the next sandbox in the list.
    pub fn select_next(&mut self) {
        if self.sandboxes.is_empty() {
            return;
        }
        let current_idx = self.selected_index();
        let next_idx = (current_idx + 1) % self.sandboxes.len();
        self.selected_id = self.sandboxes.get(next_idx).map(|s| s.id);
        self.ensure_visible();
    }

    /// Select the previous sandbox in the list.
    pub fn select_previous(&mut self) {
        if self.sandboxes.is_empty() {
            return;
        }
        let current_idx = self.selected_index();
        let prev_idx = if current_idx == 0 {
            self.sandboxes.len() - 1
        } else {
            current_idx - 1
        };
        self.selected_id = self.sandboxes.get(prev_idx).map(|s| s.id);
        self.ensure_visible();
    }

    /// Ensure the selected item is visible.
    fn ensure_visible(&mut self) {
        // This will be adjusted based on visible height during rendering
    }

    /// Toggle sidebar visibility.
    pub fn toggle(&mut self) {
        self.visible = !self.visible;
    }

    /// Select a sandbox by its ID.
    pub fn select_by_id(&mut self, id: Uuid) {
        // Only select if the sandbox exists in the list
        if self.sandboxes.iter().any(|s| s.id == id) {
            self.selected_id = Some(id);
            self.ensure_visible();
        }
    }

    /// Select a sandbox by its ID string (convenience method).
    pub fn select_by_id_str(&mut self, id_str: &str) {
        if let Ok(id) = Uuid::parse_str(id_str) {
            self.select_by_id(id);
        }
    }

    /// Get status icon for a sandbox.
    pub fn status_icon(status: &SandboxStatus) -> &'static str {
        match status {
            SandboxStatus::Creating => "◌",
            SandboxStatus::Running => "●",
            SandboxStatus::Exited => "○",
            SandboxStatus::Failed => "✗",
            SandboxStatus::Unknown => "?",
        }
    }

    /// Get status color for a sandbox.
    pub fn status_color(status: &SandboxStatus) -> ratatui::style::Color {
        match status {
            SandboxStatus::Creating => ratatui::style::Color::Cyan,
            SandboxStatus::Running => ratatui::style::Color::Green,
            SandboxStatus::Exited => ratatui::style::Color::DarkGray,
            SandboxStatus::Failed => ratatui::style::Color::Red,
            SandboxStatus::Unknown => ratatui::style::Color::Yellow,
        }
    }

    /// Check if this sandbox is a placeholder (creation in progress).
    pub fn is_placeholder(sandbox: &SandboxSummary) -> bool {
        sandbox.status == SandboxStatus::Creating
    }

    /// Format the sandbox name for display, truncating if needed.
    pub fn format_name(sandbox: &SandboxSummary, max_width: usize) -> String {
        let name = &sandbox.name;
        if name.len() <= max_width {
            name.clone()
        } else if max_width > 3 {
            format!("{}...", &name[..max_width - 3])
        } else {
            name.chars().take(max_width).collect()
        }
    }

    /// Format sandbox index for display.
    pub fn format_index(index: usize) -> String {
        format!("#{}", index + 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;

    fn create_test_sandbox(name: &str, status: SandboxStatus) -> SandboxSummary {
        SandboxSummary {
            id: Uuid::new_v4(),
            index: 0,
            name: name.to_string(),
            created_at: Utc::now(),
            workspace: "/workspace".to_string(),
            status,
            network: crate::models::SandboxNetwork {
                host_interface: "veth0".to_string(),
                sandbox_interface: "eth0".to_string(),
                host_ip: "10.0.0.1".to_string(),
                sandbox_ip: "10.0.0.2".to_string(),
                cidr: 24,
            },
            correlation_id: None,
        }
    }

    #[test]
    fn sidebar_selection_works() {
        let mut sidebar = Sidebar::new();
        let sandboxes = vec![
            create_test_sandbox("sandbox1", SandboxStatus::Running),
            create_test_sandbox("sandbox2", SandboxStatus::Running),
            create_test_sandbox("sandbox3", SandboxStatus::Running),
        ];
        let id0 = sandboxes[0].id;
        let id2 = sandboxes[2].id;
        sidebar.set_sandboxes(sandboxes);

        assert_eq!(sidebar.selected_index(), 0);
        assert_eq!(sidebar.selected_id, Some(id0));

        sidebar.select_next();
        assert_eq!(sidebar.selected_index(), 1);

        sidebar.select_next();
        assert_eq!(sidebar.selected_index(), 2);
        assert_eq!(sidebar.selected_id, Some(id2));

        sidebar.select_next();
        assert_eq!(sidebar.selected_index(), 0); // Wrap around
        assert_eq!(sidebar.selected_id, Some(id0));

        sidebar.select_previous();
        assert_eq!(sidebar.selected_index(), 2); // Wrap around backwards
    }

    #[test]
    fn selection_preserved_on_reorder() {
        let mut sidebar = Sidebar::new();
        let s1 = create_test_sandbox("sandbox1", SandboxStatus::Running);
        let s2 = create_test_sandbox("sandbox2", SandboxStatus::Running);
        let s3 = create_test_sandbox("sandbox3", SandboxStatus::Running);
        let id2 = s2.id;

        sidebar.set_sandboxes(vec![s1.clone(), s2.clone(), s3.clone()]);
        sidebar.select_by_id(id2);
        assert_eq!(sidebar.selected_index(), 1);

        // Server sends list in different order
        sidebar.set_sandboxes(vec![s3.clone(), s2.clone(), s1.clone()]);

        // Selection should follow the ID, not the index
        assert_eq!(sidebar.selected_id, Some(id2));
        assert_eq!(sidebar.selected_index(), 1); // s2 is now at index 1
    }

    #[test]
    fn status_icons_are_correct() {
        assert_eq!(Sidebar::status_icon(&SandboxStatus::Creating), "◌");
        assert_eq!(Sidebar::status_icon(&SandboxStatus::Running), "●");
        assert_eq!(Sidebar::status_icon(&SandboxStatus::Exited), "○");
        assert_eq!(Sidebar::status_icon(&SandboxStatus::Failed), "✗");
        assert_eq!(Sidebar::status_icon(&SandboxStatus::Unknown), "?");
    }

    #[test]
    fn name_truncation_works() {
        let sandbox = create_test_sandbox("very-long-sandbox-name", SandboxStatus::Running);
        let truncated = Sidebar::format_name(&sandbox, 10);
        assert!(truncated.len() <= 10);
        assert!(truncated.ends_with("..."));
    }
}
