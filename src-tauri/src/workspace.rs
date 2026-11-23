use std::path::PathBuf;

use tauri::command;

use crate::contracts::{GlobalMetrics, GlyphSlot, Guide, WorkspacePrefs};
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

#[command]
pub fn set_placement(
    path: String,
    slot_id: String,
    x: f64,
    y: f64,
    scale_x: f64,
    scale_y: f64,
    rotation: f64,
) -> Result<GlyphSlot, String> {
    if !scale_x.is_finite() || !scale_y.is_finite() || scale_x <= 0.0 || scale_y <= 0.0 {
        return Err("مقياس غير صالح.".into());
    }
    let root = normalize_root(path)?;
    let (mut project, _) = read_project(&root)?;
    let result = {
        let slot = project
            .glyph_slots
            .iter_mut()
            .find(|slot| slot.slot_id == slot_id)
            .ok_or_else(|| "الخانة المطلوبة غير موجودة.".to_string())?;
        slot.placement.x = x;
        slot.placement.y = y;
        slot.placement.scale_x = scale_x;
        slot.placement.scale_y = scale_y;
        slot.placement.rotation = rotation;
        slot.clone()
    };
    write_project(&root, &project)?;
    Ok(result)
}

#[command]
pub fn set_metrics(path: String, metrics: GlobalMetrics) -> Result<GlobalMetrics, String> {
    let root = normalize_root(path)?;
    let (mut project, _) = read_project(&root)?;
    project.metrics = metrics.clone();
    write_project(&root, &project)?;
    Ok(metrics)
}

#[command]
pub fn set_workspace_prefs(path: String, prefs: WorkspacePrefs) -> Result<WorkspacePrefs, String> {
    let root = normalize_root(path)?;
    let (mut project, _) = read_project(&root)?;
    project.workspace = prefs.clone();
    write_project(&root, &project)?;
    Ok(prefs)
}

#[command]
pub fn set_guides(path: String, guides: Vec<Guide>) -> Result<Vec<Guide>, String> {
    let root = normalize_root(path)?;
    let (mut project, _) = read_project(&root)?;
    project.workspace.guides = guides.clone();
    write_project(&root, &project)?;
    Ok(guides)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{create_project, open_project};

    fn temp_parent(name: &str) -> PathBuf {
        let parent =
            std::env::temp_dir().join(format!("fontype-workspace-{}-{name}", std::process::id()));
        fs::create_dir_all(&parent).unwrap();
        parent
    }

    use std::fs;

    #[test]
    fn workspace_edits_survive_reopen() {
        let parent = temp_parent("roundtrip");
        let handle = create_project(
            parent.to_string_lossy().into_owned(),
            "WorkspaceTest".into(),
            "Family".into(),
            "Regular".into(),
            1000,
        )
        .unwrap();

        let slot_id = handle.project.glyph_slots[0].slot_id.clone();
        let placed = set_placement(
            handle.path.clone(),
            slot_id.clone(),
            42.0,
            -18.0,
            1.1,
            0.9,
            3.0,
        )
        .unwrap();
        assert_eq!(placed.placement.x, 42.0);
        assert_eq!(placed.placement.scale_y, 0.9);

        let mut metrics = handle.project.metrics.clone();
        metrics.arabic_body_height = Some(620);
        set_metrics(handle.path.clone(), metrics).unwrap();

        let mut prefs = handle.project.workspace.clone();
        prefs.grid_visible = true;
        prefs.snap_tolerance_px = 12;
        prefs.snap_targets.insert("grid".into(), true);
        set_workspace_prefs(handle.path.clone(), prefs).unwrap();

        let guide = Guide {
            guide_id: "guide-test".into(),
            orientation: "vertical".into(),
            position_fu: 250.0,
            scope: "project".into(),
            locked: false,
            visible: true,
            name: "حد اختبار".into(),
        };
        set_guides(handle.path.clone(), vec![guide]).unwrap();

        let reopened = open_project(handle.path.clone()).unwrap();
        let saved_slot = reopened
            .project
            .glyph_slots
            .iter()
            .find(|slot| slot.slot_id == slot_id)
            .unwrap();
        assert_eq!(saved_slot.placement.y, -18.0);
        assert_eq!(reopened.project.metrics.arabic_body_height, Some(620));
        assert_eq!(reopened.project.workspace.grid_visible, true);
        assert_eq!(reopened.project.workspace.snap_tolerance_px, 12);
        assert_eq!(reopened.project.workspace.guides.len(), 1);
        assert_eq!(reopened.project.workspace.guides[0].position_fu, 250.0);

        fs::remove_dir_all(&parent).unwrap();
    }

    #[test]
    fn invalid_scale_is_rejected() {
        let parent = temp_parent("invalid");
        let handle = create_project(
            parent.to_string_lossy().into_owned(),
            "BadScale".into(),
            "Family".into(),
            "Regular".into(),
            1000,
        )
        .unwrap();
        let result = set_placement(
            handle.path.clone(),
            handle.project.glyph_slots[0].slot_id.clone(),
            0.0,
            0.0,
            -1.0,
            1.0,
            0.0,
        );
        assert!(result.is_err());
        fs::remove_dir_all(&parent).unwrap();
    }
}
