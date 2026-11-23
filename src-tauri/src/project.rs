use std::fs;
use std::path::{Path, PathBuf};

use crate::contracts::{now_iso, Project, ProjectHandle, SCHEMA_VERSION};
use crate::inventory::generate_slots;

fn safe_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("اسم المشروع لا يمكن أن يكون فارغاً.".into());
    }
    if trimmed.chars().any(|c| "\\/:*?\"<>|".contains(c)) {
        return Err("اسم المشروع يحتوي على حرف غير مسموح في اسم المجلد.".into());
    }
    Ok(trimmed.to_string())
}

fn project_file(root: &Path) -> PathBuf {
    root.join("project.json")
}

pub(crate) fn write_project(root: &Path, project: &Project) -> Result<(), String> {
    let destination = project_file(root);
    let temporary = root.join("project.json.tmp");
    let serialized =
        serde_json::to_string_pretty(project).map_err(|e| format!("تعذّر تسلسل المشروع: {e}"))?;
    fs::write(&temporary, serialized).map_err(|e| format!("تعذّر كتابة الملف المؤقت: {e}"))?;
    if destination.exists() {
        fs::remove_file(&destination).map_err(|e| format!("تعذّر استبدال الملف السابق: {e}"))?;
    }
    fs::rename(&temporary, &destination).map_err(|e| format!("تعذّر حفظ المشروع: {e}"))?;
    Ok(())
}

pub(crate) fn read_project(root: &Path) -> Result<(Project, Vec<String>), String> {
    let file = project_file(root);
    let raw = fs::read_to_string(&file).map_err(|e| format!("تعذّر قراءة المشروع: {e}"))?;
    let project: Project =
        serde_json::from_str(&raw).map_err(|e| format!("ملف المشروع غير صالح: {e}"))?;
    let family = project
        .schema_version
        .split('.')
        .take(2)
        .collect::<Vec<_>>()
        .join(".");
    if family != "0.1" {
        return Err(format!(
            "إصدار المشروع {} غير مدعوم في هذه النسخة.",
            project.schema_version
        ));
    }
    let notes = if project.schema_version == SCHEMA_VERSION {
        Vec::new()
    } else {
        vec![format!(
            "سيتم ترقية مخطط المشروع من {} إلى {} عند الحفظ.",
            project.schema_version, SCHEMA_VERSION
        )]
    };
    Ok((project, notes))
}

#[tauri::command]
pub fn create_project(
    parent: String,
    name: String,
    family: String,
    style: String,
    upm: u32,
) -> Result<ProjectHandle, String> {
    let parent = PathBuf::from(parent);
    if !parent.is_dir() {
        return Err("المجلد المحدد غير موجود.".into());
    }
    let root = parent.join(format!("{}.afsp", safe_name(&name)?));
    if root.exists() {
        return Err("يوجد مشروع بهذا الاسم في المجلد المحدد.".into());
    }
    for folder in ["glyphs", "normalized", "previews", "reports", "output"] {
        fs::create_dir_all(root.join(folder))
            .map_err(|e| format!("تعذّر إنشاء بنية المشروع: {e}"))?;
    }
    let mut project = Project::new(&name, &family, &style, upm);
    project.glyph_slots = generate_slots(project.font.units_per_em)?;
    write_project(&root, &project)?;
    Ok(ProjectHandle {
        path: root.to_string_lossy().into_owned(),
        project,
        migration_notes: Vec::new(),
    })
}

#[tauri::command]
pub fn open_project(path: String) -> Result<ProjectHandle, String> {
    let mut root = PathBuf::from(path);
    if root.is_file() {
        root = root
            .parent()
            .ok_or_else(|| "مسار المشروع غير صالح.".to_string())?
            .to_path_buf();
    }
    if !root.is_dir() {
        return Err("مجلد المشروع غير موجود.".into());
    }
    let (mut project, migration_notes) = read_project(&root)?;
    if !migration_notes.is_empty() {
        project.schema_version = SCHEMA_VERSION.into();
        project.updated_at = now_iso();
        write_project(&root, &project)?;
    }
    Ok(ProjectHandle {
        path: root.to_string_lossy().into_owned(),
        project,
        migration_notes,
    })
}

#[tauri::command]
pub fn save_project(path: String, project: Project) -> Result<(), String> {
    let mut root = PathBuf::from(path);
    if root.is_file() {
        root = root
            .parent()
            .ok_or_else(|| "مسار المشروع غير صالح.".to_string())?
            .to_path_buf();
    }
    if !root.is_dir() {
        return Err("مجلد المشروع غير موجود.".into());
    }
    let mut project = project;
    project.schema_version = SCHEMA_VERSION.into();
    project.updated_at = now_iso();
    write_project(&root, &project)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_parent() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "fontype-project-test-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn create_save_and_reopen_roundtrip() {
        let parent = temp_parent();
        let handle = create_project(
            parent.to_string_lossy().into_owned(),
            "خط الاختبار".into(),
            "Test Family".into(),
            "Regular".into(),
            1000,
        )
        .unwrap();
        assert!(project_file(Path::new(&handle.path)).is_file());
        assert_eq!(handle.project.font.units_per_em, 1000);

        let mut project = handle.project.clone();
        project.font.designer = "مصمم الاختبار".into();
        save_project(handle.path.clone(), project).unwrap();

        let reopened = open_project(handle.path.clone()).unwrap();
        assert_eq!(reopened.project.font.designer, "مصمم الاختبار");
        assert_eq!(reopened.project.schema_version, SCHEMA_VERSION);
        fs::remove_dir_all(&parent).unwrap();
    }

    #[test]
    fn invalid_project_name_is_rejected() {
        let parent = temp_parent();
        let result = create_project(
            parent.to_string_lossy().into_owned(),
            "invalid/name".into(),
            String::new(),
            String::new(),
            1000,
        );
        assert!(result.is_err());
        fs::remove_dir_all(&parent).unwrap();
    }
}
