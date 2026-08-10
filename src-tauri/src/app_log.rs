use chrono::{DateTime, Duration, NaiveDateTime, Utc};

pub const RETAIN_DAYS: i64 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Info,
    Warn,
    Error,
}

impl Level {
    pub fn as_str(self) -> &'static str {
        match self {
            Level::Info => "INFO",
            Level::Warn => "WARN",
            Level::Error => "ERROR",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "INFO" | "info" => Some(Level::Info),
            "WARN" | "warn" => Some(Level::Warn),
            "ERROR" | "error" => Some(Level::Error),
            _ => None,
        }
    }
}

pub fn sanitize_message(msg: &str) -> String {
    let collapsed: String = msg
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if collapsed.len() <= 500 {
        collapsed
    } else {
        collapsed.chars().take(500).collect()
    }
}

pub fn format_line(now: DateTime<Utc>, level: Level, tag: &str, message: &str) -> String {
    let ts = now.format("%Y-%m-%dT%H:%M:%S%.3fZ");
    let msg = sanitize_message(message);
    let tag = sanitize_message(tag);
    format!("{ts} {:<5} [{tag}] {msg}", level.as_str())
}

fn parse_line_time(line: &str) -> Option<DateTime<Utc>> {
    let ts = line.split_whitespace().next()?;
    // Accept "2026-08-09T20:15:03.421Z"
    let naive = NaiveDateTime::parse_from_str(ts.trim_end_matches('Z'), "%Y-%m-%dT%H:%M:%S%.3f")
        .or_else(|_| NaiveDateTime::parse_from_str(ts.trim_end_matches('Z'), "%Y-%m-%dT%H:%M:%S"))
        .ok()?;
    Some(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
}

pub fn prune_log_text(content: &str, now: DateTime<Utc>, retain: Duration) -> String {
    let cutoff = now - retain;
    let mut out = String::new();
    for line in content.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            continue;
        }
        match parse_line_time(line) {
            Some(t) if t >= cutoff => {
                out.push_str(line);
                out.push('\n');
            }
            Some(_) => {}
            None => {} // drop unparseable
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Duration, TimeZone, Utc};

    #[test]
    fn sanitize_collapses_newlines_and_truncates() {
        let long = "x".repeat(600);
        let out = sanitize_message(&format!("a\nb\r\nc  {long}"));
        assert!(!out.contains('\n'));
        assert!(!out.contains('\r'));
        assert!(out.len() <= 500);
        assert!(out.starts_with("a b c"));
    }

    #[test]
    fn prune_keeps_only_last_three_days() {
        let now = Utc.with_ymd_and_hms(2026, 8, 10, 12, 0, 0).unwrap();
        let old = (now - Duration::days(4))
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();
        let recent = (now - Duration::days(1))
            .format("%Y-%m-%dT%H:%M:%S%.3fZ")
            .to_string();
        let content = format!(
            "{old} INFO  [auth] old line\n{recent} INFO  [auth] recent line\nnot-a-log-line\n"
        );
        let pruned = prune_log_text(&content, now, Duration::days(RETAIN_DAYS));
        assert!(!pruned.contains("old line"));
        assert!(pruned.contains("recent line"));
        // Unparseable lines are dropped
        assert!(!pruned.contains("not-a-log-line"));
    }

    #[test]
    fn format_line_shape() {
        let now = Utc.with_ymd_and_hms(2026, 8, 9, 20, 15, 3).unwrap()
            + Duration::milliseconds(421);
        let line = format_line(now, Level::Info, "auth", "login ok");
        assert_eq!(line, "2026-08-09T20:15:03.421Z INFO  [auth] login ok");
    }
}
