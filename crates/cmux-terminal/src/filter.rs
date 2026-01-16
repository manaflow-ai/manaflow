//! DA (Device Attributes) query filter.
//!
//! This module provides filtering for DA1 and DA2 query/response sequences
//! to prevent feedback loops when terminal applications query capabilities.

/// Stateful filter for DA (Device Attributes) queries.
///
/// This filter removes DA1 and DA2 query/response sequences from terminal output
/// before forwarding to clients. It handles sequences that may be split across
/// multiple chunks by buffering incomplete escape sequences.
///
/// Filtered sequences:
/// - DA1 query: ESC [ c or ESC [ 0 c
/// - DA2 query: ESC [ > c or ESC [ > 0 c
/// - DA1 response: ESC [ ? params c
/// - DA2 response: ESC [ > params c
#[derive(Default)]
pub struct DaFilter {
    /// Buffer for incomplete escape sequences
    buffer: Vec<u8>,
    /// Current parsing state
    state: DaFilterState,
}

#[derive(Default, Clone, Copy, PartialEq)]
enum DaFilterState {
    #[default]
    Normal,
    /// Saw ESC (0x1b)
    Escape,
    /// Saw ESC [
    Csi,
    /// Saw ESC [ ? (DA1 response)
    CsiQuestion,
    /// Saw ESC [ > (DA2 query/response)
    CsiGreater,
    /// In DA1/DA2 params (digits and semicolons)
    InParams,
}

impl DaFilter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Process a chunk of data, returning filtered output.
    /// Call this for each chunk of PTY output.
    pub fn filter(&mut self, data: &[u8]) -> Vec<u8> {
        let mut result = Vec::with_capacity(data.len());

        for &byte in data {
            match self.state {
                DaFilterState::Normal => {
                    if byte == 0x1b {
                        // Start of potential escape sequence
                        self.buffer.clear();
                        self.buffer.push(byte);
                        self.state = DaFilterState::Escape;
                    } else {
                        result.push(byte);
                    }
                }

                DaFilterState::Escape => {
                    self.buffer.push(byte);
                    if byte == b'[' {
                        self.state = DaFilterState::Csi;
                    } else {
                        // Not a CSI sequence, flush buffer
                        result.extend(&self.buffer);
                        self.buffer.clear();
                        self.state = DaFilterState::Normal;
                    }
                }

                DaFilterState::Csi => {
                    self.buffer.push(byte);
                    match byte {
                        b'?' => self.state = DaFilterState::CsiQuestion,
                        b'>' => self.state = DaFilterState::CsiGreater,
                        b'0' => self.state = DaFilterState::InParams,
                        b'c' => {
                            // DA1 query: ESC [ c - filter it out
                            self.buffer.clear();
                            self.state = DaFilterState::Normal;
                        }
                        // Any other character means it's not a DA sequence
                        _ => {
                            result.extend(&self.buffer);
                            self.buffer.clear();
                            self.state = DaFilterState::Normal;
                        }
                    }
                }

                DaFilterState::CsiQuestion => {
                    if byte == b'c' {
                        // DA1 response: ESC [ ? params c - filter it out
                        self.buffer.clear();
                        self.state = DaFilterState::Normal;
                    } else if byte.is_ascii_digit() || byte == b';' {
                        // Continue accumulating params
                        self.buffer.push(byte);
                    } else {
                        // Not a DA1 response (e.g., ESC[?25h for cursor)
                        // Flush buffer INCLUDING the current byte
                        result.extend(&self.buffer);
                        result.push(byte);
                        self.buffer.clear();
                        self.state = DaFilterState::Normal;
                    }
                }

                DaFilterState::CsiGreater => {
                    if byte == b'c' {
                        // DA2 query/response: ESC [ > c or ESC [ > params c - filter it out
                        self.buffer.clear();
                        self.state = DaFilterState::Normal;
                    } else if byte.is_ascii_digit() || byte == b';' {
                        // Continue accumulating params (DA2 response)
                        self.buffer.push(byte);
                    } else {
                        // Not a DA2 sequence, flush buffer INCLUDING the current byte
                        result.extend(&self.buffer);
                        result.push(byte);
                        self.buffer.clear();
                        self.state = DaFilterState::Normal;
                    }
                }

                DaFilterState::InParams => {
                    if byte == b'c' {
                        // DA1 query with param: ESC [ 0 c - filter it out
                        self.buffer.clear();
                        self.state = DaFilterState::Normal;
                    } else if byte.is_ascii_digit() || byte == b';' {
                        // Continue accumulating params
                        self.buffer.push(byte);
                    } else {
                        // Not a DA sequence, flush buffer INCLUDING the current byte
                        result.extend(&self.buffer);
                        result.push(byte);
                        self.buffer.clear();
                        self.state = DaFilterState::Normal;
                    }
                }
            }
        }

        result
    }

    /// Flush any remaining buffered data.
    /// Call this when the stream ends to ensure no data is lost.
    pub fn flush(&mut self) -> Vec<u8> {
        let result = std::mem::take(&mut self.buffer);
        self.state = DaFilterState::Normal;
        result
    }
}

/// Stateless filter for DA queries (for simple cases where sequences won't be split).
/// For streaming use cases, prefer `DaFilter` which handles split sequences.
pub fn filter_da_queries(data: &[u8]) -> Vec<u8> {
    let mut filter = DaFilter::new();
    let mut result = filter.filter(data);
    result.extend(filter.flush());
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_filter_da1_query() {
        let mut filter = DaFilter::new();
        let result = filter.filter(b"\x1b[c");
        assert!(result.is_empty(), "DA1 query should be filtered");
    }

    #[test]
    fn test_filter_da1_query_with_param() {
        let mut filter = DaFilter::new();
        let result = filter.filter(b"\x1b[0c");
        assert!(
            result.is_empty(),
            "DA1 query with 0 param should be filtered"
        );
    }

    #[test]
    fn test_filter_da2_query() {
        let mut filter = DaFilter::new();
        let result = filter.filter(b"\x1b[>c");
        assert!(result.is_empty(), "DA2 query should be filtered");
    }

    #[test]
    fn test_filter_da1_response() {
        let mut filter = DaFilter::new();
        let result = filter.filter(b"\x1b[?64;1;2;6;9;15;18;21;22c");
        assert!(result.is_empty(), "DA1 response should be filtered");
    }

    #[test]
    fn test_filter_da2_response() {
        let mut filter = DaFilter::new();
        let result = filter.filter(b"\x1b[>1;123;0c");
        assert!(result.is_empty(), "DA2 response should be filtered");
    }

    #[test]
    fn test_preserve_cursor_visibility() {
        let mut filter = DaFilter::new();
        let result = filter.filter(b"\x1b[?25h");
        assert_eq!(
            result, b"\x1b[?25h",
            "Cursor visibility should be preserved"
        );
    }

    #[test]
    fn test_preserve_normal_text() {
        let mut filter = DaFilter::new();
        let result = filter.filter(b"Hello, World!");
        assert_eq!(result, b"Hello, World!", "Normal text should be preserved");
    }

    #[test]
    fn test_mixed_content() {
        let mut filter = DaFilter::new();
        let result = filter.filter(b"Before\x1b[cAfter");
        assert_eq!(
            result, b"BeforeAfter",
            "Content around DA query should be preserved"
        );
    }

    #[test]
    fn test_split_sequence() {
        let mut filter = DaFilter::new();

        // First chunk ends mid-sequence
        let r1 = filter.filter(b"Hello\x1b[");
        assert_eq!(r1, b"Hello");

        // Second chunk completes the DA query
        let r2 = filter.filter(b"c more text");
        assert_eq!(r2, b" more text");
    }

    #[test]
    fn test_flush_incomplete() {
        let mut filter = DaFilter::new();
        let _ = filter.filter(b"\x1b[");
        let flushed = filter.flush();
        assert_eq!(flushed, b"\x1b[", "Incomplete sequence should be flushed");
    }

    #[test]
    fn test_stateless_helper() {
        let result = filter_da_queries(b"Before\x1b[cAfter");
        assert_eq!(result, b"BeforeAfter");
    }
}
