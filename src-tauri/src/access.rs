//! Session-local filesystem authorization for IPC commands.
//!
//! The webview may only operate on image files that a workspace-opening
//! command has validated, and may only export into a directory selected by
//! the user through the backend-owned folder picker.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Default)]
pub struct PathAccess {
    images: Mutex<HashSet<PathBuf>>,
    export_dir: Mutex<Option<PathBuf>>,
}

impl PathAccess {
    /// Replace the current workspace image set, returning canonical paths in
    /// the same order as the input. The replacement is atomic: if any path is
    /// invalid, the previous workspace remains authorized.
    pub fn replace_images(&self, paths: &[String]) -> Result<Vec<PathBuf>, String> {
        let canonical = paths
            .iter()
            .map(|path| canonical_image(path))
            .collect::<Result<Vec<_>, _>>()?;
        let next = canonical.iter().cloned().collect();
        *self
            .images
            .lock()
            .map_err(|_| "Image authorization state is unavailable".to_string())? = next;
        Ok(canonical)
    }

    pub fn require_image(&self, path: &str) -> Result<PathBuf, String> {
        let canonical = canonical_image(path)?;
        let allowed = self
            .images
            .lock()
            .map_err(|_| "Image authorization state is unavailable".to_string())?;
        if allowed.contains(&canonical) {
            Ok(canonical)
        } else {
            Err(format!(
                "Path is outside the currently opened workspace: {path}"
            ))
        }
    }

    /// Authorize a directory only after the native backend picker returns it.
    pub fn authorize_export_dir(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = std::fs::canonicalize(path)
            .map_err(|e| format!("Failed to resolve export directory: {e}"))?;
        if !canonical.is_dir() {
            return Err(format!(
                "Export destination is not a directory: {}",
                path.display()
            ));
        }
        *self
            .export_dir
            .lock()
            .map_err(|_| "Export authorization state is unavailable".to_string())? =
            Some(canonical.clone());
        Ok(canonical)
    }

    pub fn require_export_dir(&self, path: &str) -> Result<PathBuf, String> {
        let canonical = std::fs::canonicalize(path)
            .map_err(|e| format!("Failed to resolve export directory: {e}"))?;
        let allowed = self
            .export_dir
            .lock()
            .map_err(|_| "Export authorization state is unavailable".to_string())?;
        if canonical.is_dir() && allowed.as_ref() == Some(&canonical) {
            Ok(canonical)
        } else {
            Err(format!(
                "Export directory was not selected in this session: {path}"
            ))
        }
    }
}

fn canonical_image(path: &str) -> Result<PathBuf, String> {
    let canonical = std::fs::canonicalize(path)
        .map_err(|e| format!("Failed to resolve image path {path}: {e}"))?;
    if canonical.is_file() {
        Ok(canonical)
    } else {
        Err(format!("Image file does not exist: {path}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("oarlabel-access-{name}-{nonce}"));
        std::fs::create_dir_all(&dir).expect("create temp directory");
        dir
    }

    #[test]
    fn image_access_is_limited_to_current_workspace() {
        let dir = temp_dir("images");
        let first = dir.join("first.png");
        let second = dir.join("second.png");
        std::fs::write(&first, b"first").expect("write first");
        std::fs::write(&second, b"second").expect("write second");

        let access = PathAccess::default();
        access
            .replace_images(&[first.to_string_lossy().into_owned()])
            .expect("authorize first");
        assert!(access.require_image(&first.to_string_lossy()).is_ok());
        assert!(access.require_image(&second.to_string_lossy()).is_err());

        access
            .replace_images(&[second.to_string_lossy().into_owned()])
            .expect("replace workspace");
        assert!(access.require_image(&first.to_string_lossy()).is_err());
        assert!(access.require_image(&second.to_string_lossy()).is_ok());
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn export_directory_requires_explicit_authorization() {
        let dir = temp_dir("export");
        let access = PathAccess::default();
        assert!(access.require_export_dir(&dir.to_string_lossy()).is_err());
        access
            .authorize_export_dir(&dir)
            .expect("authorize export directory");
        assert!(access.require_export_dir(&dir.to_string_lossy()).is_ok());
        std::fs::remove_dir_all(dir).ok();
    }
}
