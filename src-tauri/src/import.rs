use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use serde_json::Value;
use tauri::command;

use crate::contracts::{now_iso, GlyphSlot, ImportInfo, SourceRevision, ValidationFinding};
use crate::project::{read_project, write_project};

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

fn numbers(value: &Value, key: &str, expected: usize) -> Result<Vec<f64>, String> {
    let array = value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| format!("حقل {key} مفقود من نتيجة الفحص."))?;
    if array.len() != expected {
        return Err(format!("حقل {key} يجب أن يحتوي على {expected} قيماً."));
    }
    array
        .iter()
        .map(|item| {
            item.as_f64()
                .ok_or_else(|| format!("قيمة غير رقمية في حقل {key}."))
        })
        .collect()
}

fn snapshot_previous(
    root: &PathBuf,
    relative: &str,
    old_hash: &str,
) -> Result<SourceRevision, String> {
    let current = root.join(relative);
    let revision_relative = relative.replace(
        ".svg",
        &format!(".rev-{}.svg", Utc::now().format("%Y%m%d%H%M%S%3f")),
    );
    let revision_path = root.join(&revision_relative);
    fs::copy(&current, &revision_path).map_err(|e| format!("تعذّر الاحتفاظ بالنسخة السابقة: {e}"))?;
    Ok(SourceRevision {
        path: revision_relative,
        content_hash: old_hash.into(),
        replaced_at: now_iso(),
    })
}

/// Persists an inspected SVG into a slot. A second call acts as Replace SVG:
/// the previous source is kept as a recoverable revision and slot identity is untouched.
#[command]
pub fn import_svg(
    path: String,
    slot_id: String,
    inspection: Value,
    advance_width: Option<f64>,
    mode: Option<String>,
) -> Result<GlyphSlot, String> {
    let root = normalize_root(path)?;
    let (mut project, _) = read_project(&root)?;
    let index = project
        .glyph_slots
        .iter()
        .position(|slot| slot.slot_id == slot_id)
        .ok_or_else(|| "الخانة المطلوبة غير موجودة في المشروع.".to_string())?;

    let source_file_name = inspection
        .get("sourceFileName")
        .and_then(Value::as_str)
        .ok_or("اسم الملف المصدري مفقود.")?
        .to_string();
    let content_hash = inspection
        .get("contentHash")
        .and_then(Value::as_str)
        .ok_or("بصمة الملف مفقودة.")?
        .to_string();
    let source_path = PathBuf::from(
        inspection
            .get("sourcePath")
            .and_then(Value::as_str)
            .unwrap_or(&source_file_name),
    );
    if !source_path.is_file() {
        return Err("ملف SVG المصدري لم يعد موجوداً.".into());
    }

    let parts: Vec<&str> = slot_id.splitn(2, '.').collect();
    if parts.len() != 2 {
        return Err("معرّف الخانة غير صالح.".into());
    }
    let relative = format!("glyphs/{}/{}.svg", parts[0], parts[1]);
    let destination = root.join(&relative);
    fs::create_dir_all(destination.parent().unwrap())
        .map_err(|e| format!("تعذّر إنشاء مجلد الحرف: {e}"))?;

    let findings: Vec<ValidationFinding> = inspection
        .get("findings")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(|e| format!("نتائج الفحص غير صالحة: {e}"))?
        .unwrap_or_default();

    let old_import = project.glyph_slots[index].import.clone();
    if destination.exists() {
        let old_hash = project.glyph_slots[index]
            .import
            .as_ref()
            .map(|info| info.content_hash.clone())
            .unwrap_or_default();
        let revision = snapshot_previous(&root, &relative, &old_hash)?;
        project.glyph_slots[index].source_revisions.push(revision);
    }
    fs::copy(&source_path, &destination)
        .map_err(|e| format!("تعذّر نسخ ملف SVG إلى المشروع: {e}"))?;

    let matrix = numbers(&inspection, "matrix", 6)?;
    let bounds = numbers(&inspection, "bounds", 4)?;
    let view_box = numbers(&inspection, "viewBox", 4)?;

    let mut result = {
        let slot = &mut project.glyph_slots[index];
        slot.original_svg = Some(relative);
        slot.import = Some(ImportInfo {
            mode: mode.unwrap_or_else(|| "fit_to_em".into()),
            view_box: [view_box[0], view_box[1], view_box[2], view_box[3]],
            source_width: inspection
                .get("width")
                .and_then(Value::as_f64)
                .unwrap_or(view_box[2]),
            source_height: inspection
                .get("height")
                .and_then(Value::as_f64)
                .unwrap_or(view_box[3]),
            scale: matrix[0],
            matrix: [
                matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5],
            ],
            source_file_name,
            content_hash,
            imported_at: now_iso(),
            contours: inspection
                .get("contours")
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32,
            segments: inspection
                .get("segments")
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32,
            bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
            findings: findings.clone(),
            preview_path: inspection
                .get("previewPath")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        });
        if let Some(width) = advance_width {
            if width > 0.0 {
                slot.metrics.advance_width = width.round();
            }
        }
        // The inspection path is already in final font units. Placement starts
        // as an identity transform so workspace edits do not double-apply scale.
        slot.placement = crate::contracts::Placement::default();
        slot.validation = findings.clone();
        slot.approved_at = None;
        slot.clone()
    };

    let upm = project.font.units_per_em;
    let metrics = project.metrics.clone();
    if let (Some(old), Some(new)) = (
        old_import.as_ref(),
        project.glyph_slots[index].import.as_ref(),
    ) {
        if crate::anchors::geometry_changed_materially(old, new, upm) {
            crate::anchors::flag_anchors_for_review(&mut project.glyph_slots[index]);
        }
    }
    {
        let slot = &mut project.glyph_slots[index];
        crate::anchors::refresh_validation(slot, &metrics, upm);
        slot.status = crate::anchors::derive_status(slot).into();
        result.anchors = slot.anchors.clone();
        result.validation = slot.validation.clone();
        result.status = slot.status.clone();
    }

    write_project(&root, &project)?;
    Ok(result)
}

#[command]
pub fn remove_artwork(path: String, slot_id: String) -> Result<GlyphSlot, String> {
    let root = normalize_root(path)?;
    let (mut project, _) = read_project(&root)?;
    let index = project
        .glyph_slots
        .iter()
        .position(|slot| slot.slot_id == slot_id)
        .ok_or_else(|| "الخانة المطلوبة غير موجودة.".to_string())?;
    let relative = project.glyph_slots[index].original_svg.clone();

    if let Some(relative) = relative {
        let old_hash = project.glyph_slots[index]
            .import
            .as_ref()
            .map(|info| info.content_hash.clone())
            .unwrap_or_default();
        if root.join(&relative).is_file() {
            let revision = snapshot_previous(&root, &relative, &old_hash)?;
            project.glyph_slots[index].source_revisions.push(revision);
            fs::remove_file(root.join(&relative))
                .map_err(|e| format!("تعذّر حذف الرسم الحالي: {e}"))?;
        }
    }

    let result = {
        let slot = &mut project.glyph_slots[index];
        slot.original_svg = None;
        slot.import = None;
        slot.validation.clear();
        slot.status = "empty".into();
        slot.approved_at = None;
        slot.clone()
    };
    write_project(&root, &project)?;
    Ok(result)
}

#[command]
pub fn approve_slot(path: String, slot_id: String) -> Result<GlyphSlot, String> {
    let root = normalize_root(path)?;
    let (mut project, _) = read_project(&root)?;
    let result = {
        let slot = project
            .glyph_slots
            .iter_mut()
            .find(|slot| slot.slot_id == slot_id)
            .ok_or_else(|| "الخانة المطلوبة غير موجودة.".to_string())?;
        if slot.original_svg.is_none() {
            return Err("لا يمكن اعتماد خانة فارغة.".into());
        }
        if slot.status == "error" {
            return Err("لا يمكن اعتماد خانة بها خطأ.".into());
        }
        slot.approved_at = Some(now_iso());
        slot.status = "ready".into();
        slot.clone()
    };
    write_project(&root, &project)?;
    Ok(result)
}

#[command]
pub fn set_slot_metrics(
    path: String,
    slot_id: String,
    advance_width: f64,
    left_side_bearing: f64,
    right_side_bearing: f64,
) -> Result<GlyphSlot, String> {
    let root = normalize_root(path)?;
    let (mut project, _) = read_project(&root)?;
    let result = {
        let slot = project
            .glyph_slots
            .iter_mut()
            .find(|slot| slot.slot_id == slot_id)
            .ok_or_else(|| "الخانة المطلوبة غير موجودة.".to_string())?;
        slot.metrics.advance_width = advance_width.round();
        slot.metrics.left_side_bearing = left_side_bearing.round();
        slot.metrics.right_side_bearing = right_side_bearing.round();
        slot.clone()
    };
    write_project(&root, &project)?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::create_project;

    fn inspection(source: &str) -> Value {
        inspection_with(source, [10.0, 0.0, 200.0, 420.0], "sha256:abc")
    }

    fn inspection_with(source: &str, bounds: [f64; 4], hash: &str) -> Value {
        serde_json::json!({
            "sourceFileName": source,
            "contentHash": hash,
            "viewBox": [0.0, 0.0, 300.0, 500.0],
            "width": 300.0,
            "height": 500.0,
            "bounds": bounds,
            "matrix": [1.4, 0.0, 0.0, -1.4, 90.0, 644.0],
            "findings": [],
            "contours": 1,
            "segments": 3,
        })
    }

    #[test]
    fn import_replace_preserves_slot_identity_and_keeps_revision() {
        let parent =
            std::env::temp_dir().join(format!("fontype-import-test-{}", std::process::id()));
        fs::create_dir_all(&parent).unwrap();
        let svg = parent.join("random-name.svg");
        fs::write(&svg, "<svg viewBox='0 0 10 10'/>").unwrap();

        let handle = create_project(
            parent.to_string_lossy().into_owned(),
            "ImportTest".into(),
            "Family".into(),
            "Regular".into(),
            1000,
        )
        .unwrap();
        let slot_id = "beh.initial".to_string();
        let before = handle
            .project
            .glyph_slots
            .iter()
            .find(|slot| slot.slot_id == slot_id)
            .unwrap()
            .clone();

        let first = import_svg(
            handle.path.clone(),
            slot_id.clone(),
            inspection(&svg.to_string_lossy()),
            Some(620.0),
            Some("fit_to_em".into()),
        )
        .unwrap();
        assert_eq!(first.slot_id, before.slot_id);
        assert_eq!(first.glyph_name, before.glyph_name);
        assert_eq!(first.unicode, before.unicode);
        assert_eq!(first.status, "needs-review");
        assert!(first
            .validation
            .iter()
            .any(|item| item.code == "ANCHOR_MISSING_REQUIRED"));
        assert!(first.source_revisions.is_empty());

        let second = import_svg(
            handle.path.clone(),
            slot_id.clone(),
            inspection(&svg.to_string_lossy()),
            None,
            None,
        )
        .unwrap();
        assert_eq!(second.slot_id, before.slot_id);
        assert_eq!(second.source_revisions.len(), 1);
        assert!(PathBuf::from(&handle.path)
            .join(&second.source_revisions[0].path)
            .is_file());

        let approved = approve_slot(handle.path.clone(), slot_id.clone()).unwrap();
        assert_eq!(approved.status, "ready");
        assert!(approved.approved_at.is_some());

        let removed = remove_artwork(handle.path.clone(), slot_id).unwrap();
        assert_eq!(removed.status, "empty");
        assert_eq!(removed.source_revisions.len(), 2);

        fs::remove_dir_all(&parent).unwrap();
    }

    #[test]
    fn replace_preserves_anchors_metrics_and_flags_geometry_review() {
        let parent =
            std::env::temp_dir().join(format!("fontype-replace-anchors-{}", std::process::id()));
        fs::create_dir_all(&parent).unwrap();
        let svg = parent.join("outline.svg");
        fs::write(&svg, "<svg viewBox='0 0 300 500'/>").unwrap();

        let handle = create_project(
            parent.to_string_lossy().into_owned(),
            "ReplaceAnchors".into(),
            "Family".into(),
            "Regular".into(),
            1000,
        )
        .unwrap();
        let slot_id = "beh.initial".to_string();
        crate::anchors::apply_anchor_preset(handle.path.clone(), slot_id.clone()).unwrap();
        let first = import_svg(
            handle.path.clone(),
            slot_id.clone(),
            inspection(&svg.to_string_lossy()),
            Some(620.0),
            Some("fit_to_em".into()),
        )
        .unwrap();
        assert_eq!(first.anchors.len(), 4);
        assert!(first.anchors.iter().all(|anchor| !anchor.needs_review));

        let replaced = import_svg(
            handle.path.clone(),
            slot_id.clone(),
            inspection_with(
                &svg.to_string_lossy(),
                [10.0, 0.0, 200.0, 90.0],
                "sha256:changed",
            ),
            None,
            None,
        )
        .unwrap();
        assert_eq!(replaced.slot_id, first.slot_id);
        assert_eq!(replaced.glyph_name, first.glyph_name);
        assert_eq!(replaced.metrics.advance_width, 620.0);
        assert_eq!(
            replaced.metrics.left_side_bearing,
            first.metrics.left_side_bearing
        );
        assert_eq!(
            replaced.metrics.right_side_bearing,
            first.metrics.right_side_bearing
        );
        assert_eq!(replaced.anchors.len(), first.anchors.len());
        assert_eq!(
            replaced
                .anchors
                .iter()
                .map(|a| a.name.clone())
                .collect::<Vec<_>>(),
            first
                .anchors
                .iter()
                .map(|a| a.name.clone())
                .collect::<Vec<_>>(),
        );
        for anchor in &first.anchors {
            let saved = replaced
                .anchors
                .iter()
                .find(|a| a.anchor_id == anchor.anchor_id)
                .unwrap();
            assert_eq!(saved.x, anchor.x);
            assert_eq!(saved.y, anchor.y);
        }
        assert!(replaced.anchors.iter().all(|anchor| anchor.needs_review));
        assert!(replaced.status == "needs-review");

        fs::remove_dir_all(&parent).unwrap();
    }
}
