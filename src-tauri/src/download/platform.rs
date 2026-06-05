//! Heuristics to pick the right file when a host folder has multiple builds.
//!
//! Two steps: (1) infer which OS a filename targets; (2) map the F95 section
//! label ("Win/Linux", "Mac", "Android", …) to the OS(es) the user asked for.

use super::types::ResolvedFileOption;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum OsKind {
    Windows,
    Mac,
    Android,
    Linux,
}

/// Display label for the file-choice modal.
pub fn infer_platform_label(file_name: &str) -> Option<&'static str> {
    let scores = file_os_scores(file_name);
    let mut best: Option<(OsKind, i32)> = None;
    for (os, score) in scores {
        if score <= 0 {
            continue;
        }
        if best.map(|(_, s)| score > s).unwrap_or(true) {
            best = Some((os, score));
        }
    }
    best.map(|(os, _)| match os {
        OsKind::Windows => "Windows",
        OsKind::Mac => "macOS",
        OsKind::Android => "Android",
        OsKind::Linux => "Linux",
    })
}

/// F95 section → OS builds the user expects (e.g. "Win/Linux" → Windows + Linux).
fn target_os_from_group(group: &str) -> Vec<OsKind> {
    let g = group.to_lowercase();
    let mut targets = Vec::new();

    let mentions_win = g.contains("win") || g.contains("windows");
    let mentions_linux = g.contains("linux");
    let mentions_mac = g.contains("mac") || g.contains("osx") || g.contains("apple");
    let mentions_android = g.contains("android") || g.contains("apk") || g.contains("mobile");

    if mentions_win {
        targets.push(OsKind::Windows);
    }
    if mentions_linux {
        targets.push(OsKind::Linux);
    }
    if mentions_mac {
        targets.push(OsKind::Mac);
    }
    if mentions_android {
        targets.push(OsKind::Android);
    }

    // Bare "pc" / "computer" without other OS words → Windows desktop.
    if targets.is_empty() && (g.contains("pc") || g.contains("computer")) {
        targets.push(OsKind::Windows);
    }

    targets.dedup();
    targets
}

/// Positive score = filename looks like `os`; negative = looks like another OS.
fn file_os_scores(file_name: &str) -> [(OsKind, i32); 4] {
    let n = file_name.to_lowercase();
    let mut s = [
        (OsKind::Windows, 0i32),
        (OsKind::Mac, 0),
        (OsKind::Android, 0),
        (OsKind::Linux, 0),
    ];

    fn bump(scores: &mut [(OsKind, i32)], os: OsKind, pts: i32) {
        if let Some(slot) = scores.iter_mut().find(|(k, _)| *k == os) {
            slot.1 += pts;
        }
    }
    fn penalize(scores: &mut [(OsKind, i32)], os: OsKind, pts: i32) {
        for (k, v) in scores.iter_mut() {
            if *k != os {
                *v -= pts;
            }
        }
    }

    // ── Android ─────────────────────────────────────────────────────────────
    if n.ends_with(".apk")
        || n.ends_with(".aab")
        || n.ends_with(".xapk")
        || n.contains(".apk.")
        || contains_token(&n, "android")
        || contains_token(&n, "arm64-v8a")
        || contains_token(&n, "armv7")
    {
        bump(&mut s, OsKind::Android, 140);
        penalize(&mut s, OsKind::Android, 40);
    }

    // ── macOS ───────────────────────────────────────────────────────────────
    if n.ends_with(".dmg")
        || n.ends_with(".pkg")
        || contains_token(&n, "macos")
        || contains_token(&n, "osx")
        || contains_token(&n, "darwin")
        || contains_token(&n, "apple-silicon")
        || contains_token(&n, "universal-mac")
        || segment_has(&n, "mac")
        || n.contains("-mac.")
        || n.contains("_mac.")
        || n.contains(".mac.")
        || n.ends_with("-mac.zip")
        || n.ends_with("-mac.7z")
    {
        bump(&mut s, OsKind::Mac, 130);
        penalize(&mut s, OsKind::Mac, 35);
    }

    // ── Linux ───────────────────────────────────────────────────────────────
    if n.ends_with(".appimage")
        || n.ends_with(".deb")
        || n.ends_with(".rpm")
        || n.ends_with(".run")
        || contains_token(&n, "linux")
        || contains_token(&n, "ubuntu")
        || contains_token(&n, "debian")
        || contains_token(&n, "fedora")
        || contains_token(&n, "steamdeck")
        || segment_has(&n, "linux")
        || n.contains("-linux.")
        || n.contains("_linux.")
    {
        bump(&mut s, OsKind::Linux, 120);
        penalize(&mut s, OsKind::Linux, 30);
    }

    // ── Windows ─────────────────────────────────────────────────────────────
    if n.ends_with(".exe")
        || n.ends_with(".msi")
        || contains_token(&n, "windows")
        || contains_token(&n, "win64")
        || contains_token(&n, "win32")
        || contains_token(&n, "win10")
        || contains_token(&n, "win11")
        || (contains_token(&n, "x64")
            && (contains_token(&n, "win")
                || contains_token(&n, "windows")
                || segment_has(&n, "pc")))
        || segment_has(&n, "pc")
        || segment_has(&n, "win")
        || n.contains("-pc.")
        || n.contains("_pc.")
        || n.contains(".pc.")
        || n.ends_with("-pc.zip")
        || n.ends_with("-pc.7z")
        || n.ends_with("-pc.rar")
    {
        bump(&mut s, OsKind::Windows, 130);
        penalize(&mut s, OsKind::Windows, 35);
    }

    s
}

/// `token` as a whole word-ish segment (bounded by non-alphanumerics).
fn contains_token(hay: &str, token: &str) -> bool {
    hay.split(|c: char| !c.is_alphanumeric())
        .any(|part| part == token)
}

/// Segment between `.`, `-`, `_` equals `seg` (e.g. `game-pc-v1` → "pc").
fn segment_has(hay: &str, seg: &str) -> bool {
    hay.split(['.', '-', '_']).any(|part| part == seg)
}

/// How well `file_name` matches the F95 section the user clicked.
pub fn score_for_platform_group(file_name: &str, platform_group: Option<&str>) -> i32 {
    let Some(group) = platform_group.map(str::trim).filter(|s| !s.is_empty()) else {
        return 0;
    };
    let targets = target_os_from_group(group);
    if targets.is_empty() {
        return 0;
    }

    let scores = file_os_scores(file_name);
    let mut best = i32::MIN;
    for target in &targets {
        if let Some((_, score)) = scores.iter().find(|(k, _)| k == target) {
            best = best.max(*score);
        }
    }
    best
}

pub fn recommended_file_id(
    files: &[ResolvedFileOption],
    platform_group: Option<&str>,
) -> Option<String> {
    auto_select_index(files, platform_group).and_then(|idx| files.get(idx).map(|f| f.id.clone()))
}

/// When one file clearly matches the section, return its index.
pub fn auto_select_index(
    files: &[ResolvedFileOption],
    platform_group: Option<&str>,
) -> Option<usize> {
    if files.len() <= 1 {
        return if files.is_empty() { None } else { Some(0) };
    }
    let group = platform_group.map(str::trim).filter(|s| !s.is_empty())?;
    if target_os_from_group(group).is_empty() {
        return None;
    }

    let mut scored: Vec<(usize, i32)> = files
        .iter()
        .enumerate()
        .map(|(i, f)| (i, score_for_platform_group(&f.file_name, Some(group))))
        .collect();
    scored.sort_by(|a, b| b.1.cmp(&a.1));

    let (best_idx, best_score) = scored[0];
    let second_score = scored.get(1).map(|(_, s)| *s).unwrap_or(i32::MIN);

    // Must look like the requested OS and beat alternatives clearly.
    if best_score >= 70 && best_score - second_score >= 20 {
        Some(best_idx)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opt(name: &str) -> ResolvedFileOption {
        ResolvedFileOption {
            id: name.into(),
            file_name: name.into(),
            direct_url: "http://x".into(),
            file_size: None,
            platform_label: infer_platform_label(name).map(str::to_string),
        }
    }

    #[test]
    fn picks_pc_for_win_linux_group() {
        let files = vec![
            opt("com.game-0.97-release.apk"),
            opt("MyGame-0.97-mac.zip"),
            opt("MyStateSponsoredCatgirl-0.97-pc.zip"),
        ];
        assert_eq!(auto_select_index(&files, Some("Win/Linux")), Some(2));
    }

    #[test]
    fn picks_mac_for_mac_section() {
        let files = vec![
            opt("game.apk"),
            opt("MyGame-0.97-mac.zip"),
            opt("MyGame-0.97-pc.zip"),
        ];
        assert_eq!(auto_select_index(&files, Some("Mac")), Some(1));
    }

    #[test]
    fn picks_apk_for_android_section() {
        let files = vec![
            opt("com.studio.game-release.apk"),
            opt("game-mac.zip"),
            opt("game-pc.zip"),
        ];
        assert_eq!(auto_select_index(&files, Some("Android")), Some(0));
    }

    #[test]
    fn windows_by_win_in_name() {
        let files = vec![opt("game.apk"), opt("MyGame_v1_Windows_x64.zip")];
        assert_eq!(auto_select_index(&files, Some("Win")), Some(1));
    }

    #[test]
    fn ambiguous_without_group() {
        let files = vec![opt("a.apk"), opt("b-pc.zip")];
        assert_eq!(auto_select_index(&files, None), None);
    }
}
