use std::env;
use std::path::PathBuf;

/// Locates the repository root in development (the folder containing PLAN/ and engine/).
/// A packaged build can override it with FONTYPE_ROOT.
pub fn project_root() -> Option<PathBuf> {
    if let Some(root) = env::var_os("FONTYPE_ROOT") {
        return Some(PathBuf::from(root));
    }
    let executable = env::current_exe().ok()?;
    let mut directory = executable.parent()?;
    for _ in 0..8 {
        if directory.join("PLAN").is_dir() && directory.join("engine").is_dir() {
            return Some(directory.to_path_buf());
        }
        directory = directory.parent()?;
    }
    None
}

pub fn preset_path() -> Result<PathBuf, String> {
    let root = project_root().ok_or("تعذّر العثور على مجلد المشروع.")?;
    let path = root.join("engine/data/arabic-core.json");
    if !path.is_file() {
        return Err("ملف مجموعة arabic-core غير موجود.".into());
    }
    Ok(path)
}
