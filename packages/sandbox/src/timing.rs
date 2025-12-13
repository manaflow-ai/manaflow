//! Timing instrumentation for sandbox creation performance analysis.
//!
//! Enable timing with the `CMUX_TIMING=1` environment variable or `--timing` flag.
//! Timing results are logged to `/var/log/cmux/timing.log`.

use std::collections::BTreeMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use chrono::Utc;

/// Global flag for whether timing is enabled.
static TIMING_ENABLED: AtomicBool = AtomicBool::new(false);

/// Log file path.
static LOG_PATH: OnceLock<String> = OnceLock::new();

/// Enable timing instrumentation.
pub fn enable_timing() {
    TIMING_ENABLED.store(true, Ordering::SeqCst);
}

/// Check if timing is enabled.
pub fn is_timing_enabled() -> bool {
    TIMING_ENABLED.load(Ordering::SeqCst)
}

/// Set the timing log file path.
pub fn set_log_path(path: &str) {
    let _ = LOG_PATH.set(path.to_string());
}

/// Get the timing log file path.
fn get_log_path() -> &'static str {
    LOG_PATH.get_or_init(|| "/var/log/cmux/timing.log".to_string())
}

/// A scope-based timer that measures elapsed time.
pub struct Timer {
    #[allow(dead_code)]
    name: &'static str,
    start: Instant,
    enabled: bool,
}

impl Timer {
    /// Create a new timer with the given name.
    /// Does nothing if timing is disabled.
    pub fn new(name: &'static str) -> Self {
        Self {
            name,
            start: Instant::now(),
            enabled: is_timing_enabled(),
        }
    }

    /// Get the elapsed time since the timer was created.
    pub fn elapsed(&self) -> Duration {
        self.start.elapsed()
    }

    /// Get the elapsed time in milliseconds.
    pub fn elapsed_ms(&self) -> f64 {
        self.elapsed().as_secs_f64() * 1000.0
    }

    /// Finish the timer and return the elapsed duration.
    pub fn finish(self) -> Duration {
        self.elapsed()
    }

    /// Check if timing is enabled for this timer.
    pub fn is_enabled(&self) -> bool {
        self.enabled
    }
}

/// A report collecting multiple timing measurements.
pub struct TimingReport {
    operation: String,
    sandbox_id: String,
    start: Instant,
    phases: BTreeMap<String, Duration>,
    enabled: bool,
}

impl TimingReport {
    /// Create a new timing report for an operation.
    pub fn new(operation: &str, sandbox_id: &str) -> Self {
        Self {
            operation: operation.to_string(),
            sandbox_id: sandbox_id.to_string(),
            start: Instant::now(),
            phases: BTreeMap::new(),
            enabled: is_timing_enabled(),
        }
    }

    /// Record a phase timing.
    pub fn record(&mut self, phase: &str, duration: Duration) {
        if self.enabled {
            self.phases.insert(phase.to_string(), duration);
        }
    }

    /// Record a phase from a Timer.
    pub fn record_timer(&mut self, phase: &str, timer: Timer) {
        self.record(phase, timer.finish());
    }

    /// Get total elapsed time.
    pub fn total_elapsed(&self) -> Duration {
        self.start.elapsed()
    }

    /// Finish and write the report to the log file.
    pub fn finish(mut self) {
        if !self.enabled {
            return;
        }

        let total = self.start.elapsed();
        self.phases.insert("total".to_string(), total);

        // Format the report
        let timestamp = Utc::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let mut output = format!(
            "[{}] {} sandbox={} total={:.2}ms\n",
            timestamp,
            self.operation,
            self.sandbox_id,
            total.as_secs_f64() * 1000.0
        );

        // Sort phases by duration (descending) for easy identification of slow phases
        let mut phases: Vec<_> = self.phases.iter().collect();
        phases.sort_by(|a, b| b.1.cmp(a.1));

        for (phase, duration) in phases {
            if phase != "total" {
                let pct = if total.as_nanos() > 0 {
                    (duration.as_nanos() as f64 / total.as_nanos() as f64) * 100.0
                } else {
                    0.0
                };
                output.push_str(&format!(
                    "  {:40} {:>8.2}ms ({:>5.1}%)\n",
                    phase,
                    duration.as_secs_f64() * 1000.0,
                    pct
                ));
            }
        }
        output.push('\n');

        // Write to log file
        if let Err(e) = write_to_log(&output) {
            eprintln!("Failed to write timing log: {e}");
        }

        // Also log to tracing at debug level
        tracing::debug!("{}", output.trim());
    }
}

/// Write content to the timing log file.
fn write_to_log(content: &str) -> std::io::Result<()> {
    let log_path = get_log_path();

    // Ensure parent directory exists
    if let Some(parent) = Path::new(log_path).parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)?;

    file.write_all(content.as_bytes())?;
    Ok(())
}

/// Macro to time a block of code and record it in a timing report.
#[macro_export]
macro_rules! time_phase {
    ($report:expr, $name:expr, $block:expr) => {{
        let timer = $crate::timing::Timer::new($name);
        let result = $block;
        $report.record_timer($name, timer);
        result
    }};
}

/// Macro to time an async block of code and record it in a timing report.
#[macro_export]
macro_rules! time_phase_async {
    ($report:expr, $name:expr, $block:expr) => {{
        let timer = $crate::timing::Timer::new($name);
        let result = $block.await;
        $report.record_timer($name, timer);
        result
    }};
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;

    #[test]
    fn timer_measures_elapsed_time() {
        let timer = Timer::new("test");
        sleep(Duration::from_millis(10));
        let elapsed = timer.finish();
        assert!(elapsed >= Duration::from_millis(10));
    }

    #[test]
    fn timing_report_collects_phases() {
        enable_timing();
        let mut report = TimingReport::new("test_op", "test-id");

        let timer1 = Timer::new("phase1");
        sleep(Duration::from_millis(5));
        report.record_timer("phase1", timer1);

        let timer2 = Timer::new("phase2");
        sleep(Duration::from_millis(5));
        report.record_timer("phase2", timer2);

        assert_eq!(report.phases.len(), 2);
        assert!(report.phases.contains_key("phase1"));
        assert!(report.phases.contains_key("phase2"));
    }
}
