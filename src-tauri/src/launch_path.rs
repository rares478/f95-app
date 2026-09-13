//! Windows launch helpers for paths that exceed CreateProcess limits.
//!
//! `CreateProcessW` fails with ERROR_DIRECTORY (267) / "filename too long" when the
//! executable or working directory exceeds ~260 characters — even when
//! LongPathsEnabled is on and even with a `\\?\` prefix. A directory junction under
//! a short temp path keeps CreateProcess happy while the game still loads assets
//! from the real install folder.

use std::path::{Path, PathBuf};

/// Leave headroom under classic MAX_PATH (260) for CreateProcess.
pub const MAX_SAFE_LAUNCH_CHARS: usize = 240;

/// Strip a Windows verbatim (`\\?\`) prefix when present.
pub fn strip_verbatim_prefix(path: &str) -> String {
    path.strip_prefix(r"\\?\UNC\")
        .map(|rest| format!(r"\\{rest}"))
        .or_else(|| path.strip_prefix(r"\\?\").map(|s| s.to_string()))
        .unwrap_or_else(|| path.to_string())
}

fn path_char_len(path: &Path) -> usize {
    strip_verbatim_prefix(&path.to_string_lossy()).chars().count()
}

/// True when CreateProcess is likely to reject this exe / its parent directory.
pub fn needs_short_launch_path(exe: &Path) -> bool {
    let cwd = exe.parent().unwrap_or(exe);
    path_char_len(exe) > MAX_SAFE_LAUNCH_CHARS || path_char_len(cwd) > MAX_SAFE_LAUNCH_CHARS
}

/// Holds a temporary directory junction; removes it on drop.
pub struct JunctionGuard {
    link: PathBuf,
}

impl Drop for JunctionGuard {
    fn drop(&mut self) {
        let _ = remove_dir_junction(&self.link);
    }
}

pub struct PreparedLaunch {
    /// Path to pass to CreateProcess / LEProc.
    pub exe: PathBuf,
    /// Working directory for CreateProcess.
    pub cwd: PathBuf,
    /// Real install directory (for process/window matching) — never the junction.
    pub real_cwd: PathBuf,
    /// Kept alive until the game session ends.
    pub junction: Option<JunctionGuard>,
}

/// Prepare exe + cwd for launching. On non-Windows, or when paths are short enough,
/// returns the original paths unchanged.
pub fn prepare_launch(exe: &Path) -> Result<PreparedLaunch, String> {
    let real_cwd = exe
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    #[cfg(not(windows))]
    {
        return Ok(PreparedLaunch {
            exe: exe.to_path_buf(),
            cwd: real_cwd.clone(),
            real_cwd,
            junction: None,
        });
    }

    #[cfg(windows)]
    {
        if !needs_short_launch_path(exe) {
            return Ok(PreparedLaunch {
                exe: PathBuf::from(strip_verbatim_prefix(&exe.to_string_lossy())),
                cwd: PathBuf::from(strip_verbatim_prefix(&real_cwd.to_string_lossy())),
                real_cwd,
                junction: None,
            });
        }

        let file_name = exe
            .file_name()
            .ok_or_else(|| "executable path has no file name".to_string())?;

        let target = PathBuf::from(strip_verbatim_prefix(&real_cwd.to_string_lossy()));
        if !target.is_dir() {
            return Err(format!("install directory missing: {}", target.display()));
        }

        let link_root = std::env::temp_dir().join("f95-launch");
        std::fs::create_dir_all(&link_root)
            .map_err(|e| format!("create launch link root: {e}"))?;

        let key = short_key(&target);
        let link = link_root.join(key);

        // Replace a stale junction from a previous crash.
        let _ = remove_dir_junction(&link);
        create_dir_junction(&link, &target)?;

        let short_exe = link.join(file_name);
        if !short_exe.is_file() {
            let _ = remove_dir_junction(&link);
            return Err(format!(
                "junction launch path missing exe: {}",
                short_exe.display()
            ));
        }

        crate::app_log::info(
            "launch_path",
            format!(
                "using junction {} -> {} for long path",
                link.display(),
                target.display()
            ),
        );

        Ok(PreparedLaunch {
            exe: short_exe,
            cwd: link.clone(),
            real_cwd,
            junction: Some(JunctionGuard { link }),
        })
    }
}

fn short_key(target: &Path) -> String {
    use sha2::{Digest, Sha256};
    let normalized = strip_verbatim_prefix(&target.to_string_lossy()).to_lowercase();
    let digest = Sha256::digest(normalized.as_bytes());
    hex::encode(&digest[..8])
}

#[cfg(windows)]
fn create_dir_junction(link: &Path, target: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    // Junctions do not require admin (unlike directory symlinks).
    let output = std::process::Command::new("cmd")
        .args([
            "/C",
            "mklink",
            "/J",
            &link.to_string_lossy(),
            &target.to_string_lossy(),
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("mklink failed to start: {e}"))?;

    if output.status.success() && link.is_dir() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(format!(
        "mklink /J failed: {} {}",
        stdout.trim(),
        stderr.trim()
    ))
}

#[cfg(windows)]
fn remove_dir_junction(link: &Path) -> std::io::Result<()> {
    if !link.exists() {
        return Ok(());
    }
    // Junctions must be removed with rmdir, not remove_dir_all (would walk target).
    std::fs::remove_dir(link)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_verbatim_prefix_normalizes() {
        assert_eq!(
            strip_verbatim_prefix(r"\\?\E:\Games\Title\Game.exe"),
            r"E:\Games\Title\Game.exe"
        );
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share\a.exe"),
            r"\\server\share\a.exe"
        );
        assert_eq!(
            strip_verbatim_prefix(r"E:\Games\Title\Game.exe"),
            r"E:\Games\Title\Game.exe"
        );
    }

    #[test]
    fn needs_short_launch_path_by_length() {
        let short = PathBuf::from(r"E:\g\Game.exe");
        assert!(!needs_short_launch_path(&short));

        let long_dir = "x".repeat(MAX_SAFE_LAUNCH_CHARS);
        let long = PathBuf::from(format!(r"E:\{long_dir}\Game.exe"));
        assert!(needs_short_launch_path(&long));
    }

    #[test]
    fn short_key_is_stable_and_compact() {
        let a = short_key(Path::new(r"E:\Games\My Title"));
        let b = short_key(Path::new(r"E:\Games\My Title"));
        let c = short_key(Path::new(r"E:\Games\Other"));
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 16);
    }
}
