use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::Serialize;

use crate::contracts::{
    now_iso, BuildRecord, Project, ProjectHandle, ShapingOptions, SCHEMA_VERSION,
};
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

fn normalize_root(path: String) -> Result<PathBuf, String> {
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
    Ok(root)
}

fn copy_tree(source: &Path, destination: &Path) -> io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name();
        if name == "backups" {
            continue;
        }
        let target = destination.join(name);
        if entry.file_type()?.is_dir() {
            copy_tree(&entry.path(), &target)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
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

/// Compact, read-only metadata used by the Home screen's local project registry.
/// It never writes to the project and adds no field to the .afsp schema.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub path: String,
    pub project_id: String,
    pub name: String,
    pub family: String,
    pub style: String,
    pub upm: u32,
    pub updated_at: String,
    pub slots: usize,
    pub ready: usize,
    pub review: usize,
    pub imported: usize,
    pub builds: usize,
    pub available: bool,
}

fn unavailable_summary(path: String) -> ProjectSummary {
    ProjectSummary {
        path,
        project_id: String::new(),
        name: String::new(),
        family: String::new(),
        style: String::new(),
        upm: 1000,
        updated_at: String::new(),
        slots: 0,
        ready: 0,
        review: 0,
        imported: 0,
        builds: 0,
        available: false,
    }
}

/// Reads each requested project once to refresh the Home registry. Missing or
/// unreadable folders are returned as unavailable so the UI can offer removal
/// without touching files on disk.
#[tauri::command]
pub fn project_summaries(paths: Vec<String>) -> Vec<ProjectSummary> {
    paths
        .into_iter()
        .map(|raw| {
            let root = match normalize_root(raw.clone()) {
                Ok(root) => root,
                Err(_) => return unavailable_summary(raw),
            };
            let (project, _) = match read_project(&root) {
                Ok(value) => value,
                Err(_) => return unavailable_summary(raw),
            };
            let folder = root
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| raw.clone());
            let name = folder.strip_suffix(".afsp").unwrap_or(&folder).to_string();
            let ready = project
                .glyph_slots
                .iter()
                .filter(|slot| slot.status == "ready")
                .count();
            let review = project
                .glyph_slots
                .iter()
                .filter(|slot| slot.status == "needs-review")
                .count();
            let imported = project
                .glyph_slots
                .iter()
                .filter(|slot| slot.import.is_some())
                .count();
            ProjectSummary {
                path: raw,
                project_id: project.project_id,
                name,
                family: project.font.family_name,
                style: project.font.style_name,
                upm: project.font.units_per_em,
                updated_at: project.updated_at,
                slots: project.glyph_slots.len(),
                ready,
                review,
                imported,
                builds: project.builds.len(),
                available: true,
            }
        })
        .collect()
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

#[tauri::command]
pub fn set_shaping_options(
    path: String,
    options: ShapingOptions,
) -> Result<ShapingOptions, String> {
    let root = normalize_root(path)?;
    let (mut project, _) = read_project(&root)?;
    project.shaping = options.clone();
    write_project(&root, &project)?;
    Ok(options)
}

#[tauri::command]
pub fn record_build(path: String, record: BuildRecord) -> Result<Vec<BuildRecord>, String> {
    if record.build_id.trim().is_empty() {
        return Err("معرّف البناء فارغ.".into());
    }
    let root = normalize_root(path)?;
    let (mut project, _) = read_project(&root)?;
    project
        .builds
        .retain(|existing| existing.build_id != record.build_id);
    project.builds.insert(0, record);
    project.builds.truncate(20);
    write_project(&root, &project)?;
    Ok(project.builds)
}

#[tauri::command]
pub fn backup_project(path: String) -> Result<String, String> {
    let root = normalize_root(path)?;
    let stamp = Utc::now().format("%Y%m%dT%H%M%S").to_string();
    let destination = root.join("backups").join(format!("backup-{stamp}"));
    if destination.exists() {
        return Err("توجد نسخة احتياطية بهذا الوقت مسبقاً.".into());
    }
    copy_tree(&root, &destination).map_err(|e| format!("تعذّر إنشاء النسخة الاحتياطية: {e}"))?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn restore_project(path: String, backup: String) -> Result<ProjectHandle, String> {
    let root = normalize_root(path)?;
    let source = PathBuf::from(backup);
    if !source.join("project.json").is_file() {
        return Err("المجلد المحدد ليس نسخة احتياطية صالحة.".into());
    }
    copy_tree(&source, &root).map_err(|e| format!("تعذّر استعادة النسخة الاحتياطية: {e}"))?;
    open_project(root.to_string_lossy().into_owned())
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
    fn bundled_sample_project_loads() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("samples")
            .join("sample-alef.afsp");
        let (project, notes) = read_project(&root).unwrap();
        assert!(notes.is_empty());
        assert_eq!(project.schema_version, SCHEMA_VERSION);
        assert_eq!(project.glyph_slots.len(), 1);
        let slot = &project.glyph_slots[0];
        assert_eq!(slot.slot_id, "alef.isolated");
        assert_eq!(slot.status, "ready");
        let import = slot.import.as_ref().unwrap();
        assert_eq!(import.contours, 1);
        assert!(import.preview_path.starts_with("M273.75"));
        assert!(root.join(slot.original_svg.clone().unwrap()).is_file());
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

    #[test]
    fn shaping_options_build_records_and_backup_roundtrip() {
        let parent = temp_parent();
        let handle = create_project(
            parent.to_string_lossy().into_owned(),
            "BuildTest".into(),
            "Build Family".into(),
            "Regular".into(),
            1000,
        )
        .unwrap();

        let options = set_shaping_options(
            handle.path.clone(),
            ShapingOptions {
                lam_alef_ligatures: true,
                mark_positioning: true,
                cursive_positioning: true,
            },
        )
        .unwrap();
        assert!(options.lam_alef_ligatures);
        assert_eq!(
            open_project(handle.path.clone())
                .unwrap()
                .project
                .shaping
                .lam_alef_ligatures,
            true
        );

        let record = BuildRecord {
            build_id: "build-test-1".into(),
            timestamp: now_iso(),
            app_version: "0.5.0".into(),
            result: "success".into(),
            project_hash: "sha256:test".into(),
            ..BuildRecord::default()
        };
        let builds = record_build(handle.path.clone(), record).unwrap();
        assert_eq!(builds.len(), 1);
        assert_eq!(builds[0].build_id, "build-test-1");

        let backup = backup_project(handle.path.clone()).unwrap();
        assert!(Path::new(&backup).join("project.json").is_file());

        let mut project = open_project(handle.path.clone()).unwrap().project;
        project.font.designer = "changed".into();
        save_project(handle.path.clone(), project).unwrap();
        let restored = restore_project(handle.path.clone(), backup).unwrap();
        assert_ne!(restored.project.font.designer, "changed");
        assert_eq!(restored.project.builds.len(), 1);

        fs::remove_dir_all(&parent).unwrap();
    }

    #[test]
    fn project_summaries_refresh_metadata_and_flag_missing_projects() {
        let parent = temp_parent();
        let handle = create_project(
            parent.to_string_lossy().into_owned(),
            "خط الملخص".into(),
            "Summary Family".into(),
            "Regular".into(),
            1000,
        )
        .unwrap();
        let missing = parent.join("missing.afsp").to_string_lossy().into_owned();

        let summaries = project_summaries(vec![handle.path.clone(), missing.clone()]);
        assert_eq!(summaries.len(), 2);
        assert!(summaries[0].available);
        assert_eq!(summaries[0].name, "خط الملخص");
        assert_eq!(summaries[0].family, "Summary Family");
        assert_eq!(summaries[0].upm, 1000);
        assert!(summaries[0].slots > 0);
        assert!(!summaries[1].available);

        let mut project = handle.project.clone();
        if let Some(slot) = project.glyph_slots.first_mut() {
            slot.status = "ready".into();
        }
        save_project(handle.path.clone(), project).unwrap();
        let refreshed = project_summaries(vec![handle.path.clone()]);
        assert_eq!(refreshed[0].ready, 1);

        fs::remove_dir_all(&parent).unwrap();
    }
}
