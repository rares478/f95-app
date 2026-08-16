mod buzzheavier;
mod datanodes;
mod gdrive;
mod gofile;
mod mediafire;
mod mixdrop;
mod pixeldrain;
mod uploadhaven;
mod vikingfile;
mod workupload;

pub(crate) use buzzheavier::resolve_buzzheavier;
pub(crate) use datanodes::resolve_datanodes;
pub(crate) use gdrive::resolve_gdrive;
pub(crate) use gofile::resolve_gofile;
pub(crate) use mediafire::resolve_mediafire;
pub(crate) use mixdrop::{
    resolve_mixdrop, resolve_mixdrop_interactive, resolve_mixdrop_with_cookies,
};
pub(crate) use pixeldrain::resolve_pixeldrain;
pub(crate) use uploadhaven::{normalize_uploadhaven_url, resolve_uploadhaven};
pub(crate) use vikingfile::resolve_vikingfile;
pub(crate) use workupload::resolve_workupload;
