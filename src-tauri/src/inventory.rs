use std::collections::BTreeMap;
use std::fs;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::contracts::{GlyphSlot, Placement, SlotMetrics};
use crate::paths;
use crate::project::{read_project, write_project};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresetChar {
    u: String,
    name: String,
    joining_type: String,
    #[serde(rename = "markClass", default)]
    mark_class: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresetGroup {
    id: String,
    label: String,
    required: bool,
    characters: Vec<PresetChar>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Preset {
    schema_version: String,
    preset_id: String,
    label: String,
    unicode_version: String,
    groups: Vec<PresetGroup>,
    forms_by_joining_type: BTreeMap<String, Vec<String>>,
}

fn load_preset() -> Result<Preset, String> {
    let path = paths::preset_path()?;
    let raw = fs::read_to_string(&path).map_err(|e| format!("تعذّر قراءة المجموعة: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("مجموعة الحروف غير صالحة: {e}"))
}

fn slug(name: &str) -> String {
    let value: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if value.is_empty() {
        "glyph".into()
    } else {
        value
    }
}

fn form_code(form: &str) -> &'static str {
    match form {
        "initial" => "init",
        "medial" => "medi",
        "final" => "fina",
        _ => "isol",
    }
}

pub fn generate_slots(upm: u32) -> Result<Vec<GlyphSlot>, String> {
    let preset = load_preset()?;
    let mut slots = Vec::new();
    let default_advance = (upm as f64 * 0.6).round();

    for group in &preset.groups {
        for character in &group.characters {
            let forms = preset
                .forms_by_joining_type
                .get(&character.joining_type)
                .cloned()
                .unwrap_or_else(|| vec!["isolated".into()]);
            let base = slug(&character.name);
            for form in forms {
                slots.push(GlyphSlot {
                    slot_id: format!("{base}.{form}"),
                    character_name: character.name.clone(),
                    unicode: character.u.clone(),
                    glyph_name: format!("{base}.{}", form_code(&form)),
                    form: form.clone(),
                    joining_type: character.joining_type.clone(),
                    group: group.id.clone(),
                    mark_class: character.mark_class.clone(),
                    required: group.required,
                    original_svg: None,
                    source_revisions: Vec::new(),
                    import: None,
                    placement: Placement::default(),
                    metrics: SlotMetrics {
                        advance_width: default_advance,
                        left_side_bearing: 0.0,
                        right_side_bearing: 0.0,
                    },
                    anchors: Vec::new(),
                    status: "empty".into(),
                    approved_at: None,
                    validation: Vec::new(),
                });
            }
        }
    }
    Ok(slots)
}

#[tauri::command]
pub fn preset_info() -> Result<Value, String> {
    let preset = load_preset()?;
    let groups: Vec<Value> = preset
        .groups
        .iter()
        .map(|group| {
            json!({
                "id": group.id,
                "label": group.label,
                "required": group.required,
                "characterCount": group.characters.len(),
            })
        })
        .collect();
    let total = generate_slots(1000).map(|slots| slots.len()).unwrap_or(0);
    Ok(json!({
        "schemaVersion": preset.schema_version,
        "presetId": preset.preset_id,
        "label": preset.label,
        "unicodeVersion": preset.unicode_version,
        "groups": groups,
        "formsByJoiningType": preset.forms_by_joining_type,
        "totalSlots": total,
    }))
}

/// Adds slots that are missing from an older project without touching imported slots.
#[tauri::command]
pub fn generate_inventory(path: String) -> Result<Vec<GlyphSlot>, String> {
    let mut root = std::path::PathBuf::from(path);
    if root.is_file() {
        root = root
            .parent()
            .ok_or_else(|| "مسار المشروع غير صالح.".to_string())?
            .to_path_buf();
    }
    let (mut project, _) = read_project(&root)?;
    let fresh = generate_slots(project.font.units_per_em)?;
    let existing: std::collections::HashSet<String> = project
        .glyph_slots
        .iter()
        .map(|slot| slot.slot_id.clone())
        .collect();
    for slot in fresh {
        if !existing.contains(&slot.slot_id) {
            project.glyph_slots.push(slot);
        }
    }
    write_project(&root, &project)?;
    Ok(project.glyph_slots)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joining_types_produce_the_expected_form_counts() {
        let slots = generate_slots(1000).unwrap();
        let find = |id: &str| {
            slots
                .iter()
                .find(|slot| slot.slot_id == id)
                .cloned()
                .unwrap()
        };
        assert_eq!(find("beh.isolated").glyph_name, "beh.isol");
        assert_eq!(find("beh.initial").glyph_name, "beh.init");
        assert_eq!(find("beh.medial").glyph_name, "beh.medi");
        assert_eq!(find("beh.final").glyph_name, "beh.fina");
        assert_eq!(
            slots
                .iter()
                .filter(|slot| slot.slot_id.starts_with("alef."))
                .count(),
            2
        );
        assert_eq!(
            slots
                .iter()
                .filter(|slot| slot.slot_id.starts_with("hamza."))
                .count(),
            1
        );
        assert!(slots.len() > 100);
        assert!(slots.iter().all(|slot| slot.status == "empty"));
    }
}
