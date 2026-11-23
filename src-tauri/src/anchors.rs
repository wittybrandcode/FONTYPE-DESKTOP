use std::path::PathBuf;

use chrono::Utc;
use serde::Serialize;
use tauri::command;

use crate::contracts::{Anchor, GlobalMetrics, GlyphSlot, ValidationFinding};
use crate::project::{read_project, write_project};

pub const ANCHOR_PREFIX: &str = "ANCHOR_";

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

fn finding(
    severity: &str,
    code: &str,
    message: &str,
    hint: &str,
    slot_id: &str,
) -> ValidationFinding {
    ValidationFinding {
        severity: severity.into(),
        code: format!("{ANCHOR_PREFIX}{code}"),
        slot_id: slot_id.into(),
        message: message.into(),
        hint: hint.into(),
    }
}

/// Fingerprint of the outline an anchor was positioned against.
pub fn geometry_key(slot: &GlyphSlot) -> Option<String> {
    slot.import.as_ref().map(|info| {
        let b = info.bounds;
        format!(
            "{}|{:.2}|{:.2}|{:.2}|{:.2}",
            info.content_hash, b[0], b[1], b[2], b[3]
        )
    })
}

/// True when a replacement changed outline bounds by more than 3% of the em.
pub fn geometry_changed_materially(
    old: &crate::contracts::ImportInfo,
    new: &crate::contracts::ImportInfo,
    upm: u32,
) -> bool {
    let threshold = (upm as f64) * 0.03;
    old.bounds
        .iter()
        .zip(new.bounds.iter())
        .any(|(a, b)| (a - b).abs() > threshold)
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Role {
    Mark(String),
    Base,
    NonMarking,
}

fn role(slot: &GlyphSlot) -> Role {
    if let Some(class) = &slot.mark_class {
        Role::Mark(class.clone())
    } else if matches!(slot.group.as_str(), "punctuation" | "digits" | "space") {
        Role::NonMarking
    } else {
        Role::Base
    }
}

fn expected_class(name: &str) -> Option<&'static str> {
    match name {
        "top" => Some("top"),
        "bottom" => Some("bottom"),
        "entry" => Some("cursive-entry"),
        "exit" => Some("cursive-exit"),
        "top-mark" => Some("top-mark"),
        "bottom-mark" => Some("bottom-mark"),
        _ => None,
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnchorSpec {
    pub name: String,
    pub class: String,
    pub x: f64,
    pub y: f64,
    pub required: bool,
    pub reason: String,
}

fn round(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

/// Derives role-appropriate anchors from the slot's outline and metrics.
pub fn anchor_specs(slot: &GlyphSlot, metrics: &GlobalMetrics) -> Vec<AnchorSpec> {
    let advance = slot.metrics.advance_width;
    let raw_bounds = slot.import.as_ref().map(|info| info.bounds).unwrap_or([
        0.0,
        0.0,
        advance,
        metrics.ascender as f64 * 0.7,
    ]);
    let [x_min, y_min, x_max, y_max] = raw_bounds;
    let scale_x = slot.placement.scale_x;
    let scale_y = slot.placement.scale_y;
    let tx = |x: f64| round(x * scale_x + slot.placement.x);
    let ty = |y: f64| round(y * scale_y + slot.placement.y);
    let center_x = tx((x_min + x_max) / 2.0);
    let center_y = ty((y_min + y_max) / 2.0);
    let mut specs = Vec::new();

    match role(slot) {
        Role::NonMarking => {}
        Role::Mark(class) => {
            let attach_name = format!("{class}-mark");
            let attach_y = if class == "bottom" {
                ty(y_max)
            } else {
                ty(y_min)
            };
            specs.push(AnchorSpec {
                name: attach_name.clone(),
                class: attach_name,
                x: center_x,
                y: attach_y,
                required: true,
                reason: "نقطة ارتباط الحركة بالحرف الأساسي".into(),
            });
            // The opposite anchor lets another mark stack on this mark.
            specs.push(AnchorSpec {
                name: class.clone(),
                class: class.clone(),
                x: center_x,
                y: if class == "bottom" {
                    ty(y_min)
                } else {
                    ty(y_max)
                },
                required: false,
                reason: "ارتباط حركة فوق حركة أخرى (Mark-to-mark)".into(),
            });
        }
        Role::Base => {
            specs.push(AnchorSpec {
                name: "top".into(),
                class: "top".into(),
                x: center_x,
                y: ty(y_max),
                required: true,
                reason: "موضع الحركات العلوية".into(),
            });
            specs.push(AnchorSpec {
                name: "bottom".into(),
                class: "bottom".into(),
                x: center_x,
                y: ty(y_min),
                required: true,
                reason: "موضع الحركات السفلية".into(),
            });
            if matches!(slot.joining_type.as_str(), "D" | "R") {
                specs.push(AnchorSpec {
                    name: "entry".into(),
                    class: "cursive-entry".into(),
                    x: tx(x_min),
                    y: center_y,
                    required: true,
                    reason: "نقطة دخول الوصل من الحرف السابق".into(),
                });
            }
            if slot.joining_type == "D" {
                specs.push(AnchorSpec {
                    name: "exit".into(),
                    class: "cursive-exit".into(),
                    x: tx(x_max),
                    y: center_y,
                    required: true,
                    reason: "نقطة خروج الوصل إلى الحرف التالي".into(),
                });
            }
        }
    }
    specs
}

/// Anchor-specific findings; import findings are kept in a separate module.
pub fn validate_anchors(
    slot: &GlyphSlot,
    metrics: &GlobalMetrics,
    upm: u32,
) -> Vec<ValidationFinding> {
    let mut findings = Vec::new();
    let mut names: Vec<&str> = Vec::new();
    let margin_x = upm as f64 * 0.15;
    let margin_y = upm as f64 * 0.15;
    let upper = metrics.ascender as f64 + margin_y;
    let lower = metrics.descender as f64 - margin_y;

    for anchor in &slot.anchors {
        if names.contains(&anchor.name.as_str()) {
            findings.push(finding(
                "error",
                "DUPLICATE_NAME",
                &format!("اسم المرساة «{}» مكرّر في الخانة.", anchor.name),
                "امنح كل مرساة اسماً فريداً.",
                &slot.slot_id,
            ));
        }
        names.push(&anchor.name);

        if !anchor.x.is_finite() || !anchor.y.is_finite() {
            findings.push(finding(
                "error",
                "INVALID_COORDINATE",
                &format!("إحداثيات المرساة «{}» غير صالحة.", anchor.name),
                "أدخل قيماً عددية بوحدات الخط.",
                &slot.slot_id,
            ));
        } else if anchor.x < -margin_x
            || anchor.x > slot.metrics.advance_width + margin_x
            || anchor.y < lower
            || anchor.y > upper
        {
            findings.push(finding(
                "info",
                "OUT_OF_RANGE",
                &format!("المرساة «{}» خارج النطاق المتوقع.", anchor.name),
                "تحقق من موضعها مقابل عرض التقدّم وخطوط القياس.",
                &slot.slot_id,
            ));
        }

        if let Some(expected) = expected_class(&anchor.name) {
            if anchor.class != expected {
                findings.push(finding(
                    "error",
                    "WRONG_CLASS",
                    &format!("صنف المرساة «{}» يجب أن يكون «{}».", anchor.name, expected),
                    "استخدم القائمة المنسدلة لتصحيح الصنف.",
                    &slot.slot_id,
                ));
            }
        }

        match role(slot) {
            Role::Base if anchor.class.ends_with("-mark") => findings.push(finding(
                "error",
                "ROLE_MISMATCH",
                "لا يمكن وضع مرساة حركة على حرف أساسي.",
                "استخدم الأصناف top/bottom أو cursive-entry/exit.",
                &slot.slot_id,
            )),
            Role::Mark(_) if anchor.class.starts_with("cursive-") => findings.push(finding(
                "error",
                "ROLE_MISMATCH",
                "مراسات الوصل تُستخدم مع الحروف فقط.",
                "استخدم صنف الحركة المناسب لهذه الخانة.",
                &slot.slot_id,
            )),
            _ => {}
        }

        if anchor.needs_review {
            findings.push(finding(
                "warning",
                "NEEDS_REVIEW",
                &format!("المرساة «{}» تحتاج مراجعة بعد تغيير الرسم.", anchor.name),
                "أعد ضبط موضعها ثم احفظها لإزالة علامة المراجعة.",
                &slot.slot_id,
            ));
        }
    }

    for spec in anchor_specs(slot, metrics)
        .into_iter()
        .filter(|spec| spec.required)
    {
        if !names.contains(&spec.name.as_str()) {
            findings.push(finding(
                "warning",
                "MISSING_REQUIRED",
                &format!("المرساة المطلوبة «{}» غير موجودة.", spec.name),
                &spec.reason,
                &slot.slot_id,
            ));
        }
    }
    findings
}

/// Combines import findings with fresh anchor findings for a slot.
pub fn refresh_validation(
    slot: &mut GlyphSlot,
    metrics: &GlobalMetrics,
    upm: u32,
) -> Vec<ValidationFinding> {
    let mut combined: Vec<ValidationFinding> = slot
        .validation
        .iter()
        .filter(|item| !item.code.starts_with(ANCHOR_PREFIX))
        .cloned()
        .collect();
    combined.extend(validate_anchors(slot, metrics, upm));
    slot.validation = combined.clone();
    combined
}

/// Workflow status derived from artwork, findings and explicit approval.
pub fn derive_status(slot: &GlyphSlot) -> &'static str {
    if slot.original_svg.is_none() {
        "empty"
    } else if slot.validation.iter().any(|item| item.severity == "error") {
        "error"
    } else if slot
        .validation
        .iter()
        .any(|item| item.severity == "warning")
    {
        "needs-review"
    } else if slot.approved_at.is_some() {
        "ready"
    } else {
        "imported"
    }
}

fn new_anchor_id(index: usize) -> String {
    let nanos = Utc::now().timestamp_nanos_opt().unwrap_or_default();
    format!("anchor-{nanos}-{index}")
}

#[command]
pub fn anchor_suggestions(path: String, slot_id: String) -> Result<Vec<AnchorSpec>, String> {
    let root = normalize_root(path)?;
    let (project, _) = read_project(&root)?;
    let slot = project
        .glyph_slots
        .iter()
        .find(|slot| slot.slot_id == slot_id)
        .ok_or_else(|| "الخانة المطلوبة غير موجودة.".to_string())?;
    Ok(anchor_specs(slot, &project.metrics))
}

#[command]
pub fn apply_anchor_preset(path: String, slot_id: String) -> Result<GlyphSlot, String> {
    let root = normalize_root(path)?;
    let (mut project, _) = read_project(&root)?;
    let upm = project.font.units_per_em;
    let metrics = project.metrics.clone();
    let result = {
        let slot = project
            .glyph_slots
            .iter_mut()
            .find(|slot| slot.slot_id == slot_id)
            .ok_or_else(|| "الخانة المطلوبة غير موجودة.".to_string())?;
        let key = geometry_key(slot);
        let specs = anchor_specs(slot, &metrics);
        for (index, spec) in specs.into_iter().enumerate() {
            if slot.anchors.iter().any(|anchor| anchor.name == spec.name) {
                continue;
            }
            slot.anchors.push(Anchor {
                anchor_id: new_anchor_id(index),
                name: spec.name,
                class: spec.class,
                x: spec.x,
                y: spec.y,
                scope: slot.slot_id.clone(),
                locked: false,
                geometry_key: key.clone(),
                needs_review: false,
                review_note: String::new(),
            });
        }
        slot.approved_at = None;
        refresh_validation(slot, &metrics, upm);
        slot.status = derive_status(slot).into();
        slot.clone()
    };
    write_project(&root, &project)?;
    Ok(result)
}

#[command]
pub fn set_anchors(
    path: String,
    slot_id: String,
    anchors: Vec<Anchor>,
) -> Result<GlyphSlot, String> {
    let root = normalize_root(path)?;
    let (mut project, _) = read_project(&root)?;
    let upm = project.font.units_per_em;
    let metrics = project.metrics.clone();
    let result = {
        let slot = project
            .glyph_slots
            .iter_mut()
            .find(|slot| slot.slot_id == slot_id)
            .ok_or_else(|| "الخانة المطلوبة غير موجودة.".to_string())?;
        let key = geometry_key(slot);
        slot.anchors = anchors
            .into_iter()
            .map(|mut anchor| {
                anchor.scope = slot.slot_id.clone();
                if anchor.geometry_key.is_none() {
                    anchor.geometry_key = key.clone();
                }
                anchor
            })
            .collect();
        slot.approved_at = None;
        refresh_validation(slot, &metrics, upm);
        slot.status = derive_status(slot).into();
        slot.clone()
    };
    write_project(&root, &project)?;
    Ok(result)
}

/// Flags anchors whose outline changed; called after SVG replacement.
pub fn flag_anchors_for_review(slot: &mut GlyphSlot) {
    if slot.anchors.is_empty() {
        return;
    }
    let key = geometry_key(slot);
    for anchor in &mut slot.anchors {
        if anchor.geometry_key.as_deref() != key.as_deref() {
            anchor.needs_review = true;
            anchor.review_note = "تغيّر حدود المخطط بعد استبدال الرسم؛ تحقق من الموضع.".into();
            anchor.geometry_key = key.clone();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::Placement;
    use crate::project::create_project;

    fn temp_parent(name: &str) -> PathBuf {
        let parent =
            std::env::temp_dir().join(format!("fontype-anchors-{}-{name}", std::process::id()));
        fs::create_dir_all(&parent).unwrap();
        parent
    }

    use std::fs;

    #[test]
    fn specs_follow_joining_role() {
        let mut slot = GlyphSlot {
            slot_id: "beh.initial".into(),
            joining_type: "D".into(),
            group: "letters".into(),
            form: "initial".into(),
            metrics: crate::contracts::SlotMetrics {
                advance_width: 600.0,
                ..Default::default()
            },
            import: Some(crate::contracts::ImportInfo {
                bounds: [50.0, 0.0, 350.0, 400.0],
                content_hash: "sha256:test".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        let metrics = GlobalMetrics::default();
        let specs = anchor_specs(&slot, &metrics);
        let names: Vec<&str> = specs.iter().map(|spec| spec.name.as_str()).collect();
        assert_eq!(names, vec!["top", "bottom", "entry", "exit"]);
        assert_eq!(specs[0].x, 200.0);
        assert_eq!(specs[0].y, 400.0);
        assert_eq!(specs[2].class, "cursive-entry");

        slot.joining_type = "T".into();
        slot.group = "marks".into();
        slot.mark_class = Some("top".into());
        let specs = anchor_specs(&slot, &metrics);
        let names: Vec<&str> = specs.iter().map(|spec| spec.name.as_str()).collect();
        assert_eq!(names, vec!["top-mark", "top"]);
        assert_eq!(specs[0].y, 0.0);
    }

    #[test]
    fn validation_rejects_duplicates_and_wrong_classes() {
        let slot = GlyphSlot {
            slot_id: "beh.initial".into(),
            group: "letters".into(),
            joining_type: "D".into(),
            anchors: vec![
                Anchor {
                    anchor_id: "a1".into(),
                    name: "top".into(),
                    class: "top-mark".into(),
                    ..Default::default()
                },
                Anchor {
                    anchor_id: "a2".into(),
                    name: "top".into(),
                    class: "top".into(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let findings = validate_anchors(&slot, &GlobalMetrics::default(), 1000);
        assert!(findings.iter().any(|f| f.code == "ANCHOR_DUPLICATE_NAME"));
        assert!(findings.iter().any(|f| f.code == "ANCHOR_WRONG_CLASS"));
    }

    #[test]
    fn preset_and_edits_persist_without_touching_metrics() {
        let parent = temp_parent("persist");
        let handle = create_project(
            parent.to_string_lossy().into_owned(),
            "AnchorTest".into(),
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

        let applied = apply_anchor_preset(handle.path.clone(), slot_id.clone()).unwrap();
        assert_eq!(applied.anchors.len(), 4);
        assert_eq!(applied.metrics.advance_width, before.metrics.advance_width);

        let mut anchors = applied.anchors.clone();
        anchors[0].x = 275.0;
        anchors[0].needs_review = false;
        let saved = set_anchors(handle.path.clone(), slot_id.clone(), anchors).unwrap();
        assert_eq!(saved.anchors[0].x, 275.0);

        let reopened = crate::project::open_project(handle.path.clone()).unwrap();
        let reloaded = reopened
            .project
            .glyph_slots
            .iter()
            .find(|slot| slot.slot_id == slot_id)
            .unwrap();
        assert_eq!(reloaded.anchors.len(), 4);
        assert_eq!(reloaded.anchors[0].x, 275.0);
        fs::remove_dir_all(&parent).unwrap();
    }

    #[test]
    fn geometry_change_marks_anchors_for_review() {
        let parent = temp_parent("review");
        let handle = create_project(
            parent.to_string_lossy().into_owned(),
            "ReviewTest".into(),
            "Family".into(),
            "Regular".into(),
            1000,
        )
        .unwrap();
        let slot_id = "beh.initial".to_string();
        let applied = apply_anchor_preset(handle.path.clone(), slot_id.clone()).unwrap();
        assert_eq!(applied.anchors.len(), 4); // fallback bounds still yield role specs

        let mut slot = GlyphSlot {
            slot_id: slot_id.clone(),
            group: "letters".into(),
            joining_type: "D".into(),
            placement: Placement::default(),
            import: Some(crate::contracts::ImportInfo {
                bounds: [0.0, 0.0, 400.0, 500.0],
                content_hash: "sha256:old".into(),
                ..Default::default()
            }),
            original_svg: Some("glyphs/beh/initial.svg".into()),
            ..Default::default()
        };
        slot.anchors = anchor_specs(&slot, &handle.project.metrics)
            .into_iter()
            .enumerate()
            .map(|(index, spec)| Anchor {
                anchor_id: format!("a{index}"),
                name: spec.name,
                class: spec.class,
                x: spec.x,
                y: spec.y,
                scope: slot_id.clone(),
                locked: false,
                geometry_key: geometry_key(&slot),
                needs_review: false,
                review_note: String::new(),
            })
            .collect();
        slot.validation = validate_anchors(&slot, &handle.project.metrics, 1000);
        assert!(!slot.anchors.iter().any(|anchor| anchor.needs_review));

        slot.import.as_mut().unwrap().bounds = [0.0, 0.0, 400.0, 200.0];
        slot.import.as_mut().unwrap().content_hash = "sha256:new".into();
        flag_anchors_for_review(&mut slot);
        refresh_validation(&mut slot, &handle.project.metrics, 1000);
        slot.status = derive_status(&slot).into();
        assert!(slot.anchors.iter().all(|anchor| anchor.needs_review));
        assert_eq!(slot.status, "needs-review");
        fs::remove_dir_all(&parent).unwrap();
    }
}
