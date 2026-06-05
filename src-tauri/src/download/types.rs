#[derive(Clone)]
pub(crate) struct ResolvedFileOption {
    /// Stable id for `download_continue_choice` (GoFile child id or synthetic).
    pub id: String,
    pub file_name: String,
    pub direct_url: String,
    pub file_size: Option<u64>,
    /// e.g. "PC", "Android" — shown in the file-choice modal.
    pub platform_label: Option<String>,
}

pub(crate) enum ResolveResult {
    Direct {
        url: String,
        file_name: String,
        file_size: Option<u64>,
        /// Hex-encoded lowercase SHA-256, if the host advertises one.
        expected_sha256: Option<String>,
        /// Extra headers the resolver wants attached to the GET (e.g. GoFile's
        /// `Cookie: accountToken=...`).
        extra_headers: Vec<(String, String)>,
    },
    /// Folder / multi-build link — user must pick (or we auto-picked via platform hint).
    ChooseFile {
        host: String,
        source_url: String,
        platform_group: Option<String>,
        files: Vec<ResolvedFileOption>,
        extra_headers: Vec<(String, String)>,
    },
    NeedsBrowser {
        url: String,
        host: String,
    },
}
