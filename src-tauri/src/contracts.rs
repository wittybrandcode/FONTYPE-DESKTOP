use std::collections::BTreeMap;

use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: &str = "0.1.0";

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FontMeta {
    pub family_name: String,
    pub style_name: String,
    pub version: String,
    pub designer: String,
    pub copyright: String,
    pub license: String,
    pub units_per_em: u32,
    pub character_set_preset: String,
}

impl Default for FontMeta {
    fn default() -> Self {
        Self {
            family_name: String::new(),
            style_name: "Regular".into(),
            version: "0.1.0".into(),
            designer: String::new(),
            copyright: String::new(),
            license: String::new(),
            units_per_em: 1000,
            character_set_preset: "arabic-core".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GlobalMetrics {
    pub baseline: i32,
    pub ascender: i32,
    pub descender: i32,
    pub cap_height: Option<i32>,
    pub arabic_body_height: Option<i32>,
    pub mark_top_zone: i32,
    pub mark_bottom_zone: i32,
    pub metric_locks: BTreeMap<String, bool>,
    pub metric_visibility: BTreeMap<String, bool>,
}

impl Default for GlobalMetrics {
    fn default() -> Self {
        let mut metric_locks = BTreeMap::new();
        metric_locks.insert("baseline".into(), true);
        for key in [
            "ascender",
            "descender",
            "capHeight",
            "arabicBodyHeight",
            "markTopZone",
            "markBottomZone",
        ] {
            metric_locks.insert(key.into(), false);
        }
        let mut metric_visibility = BTreeMap::new();
        for key in ["baseline", "ascender", "descender"] {
            metric_visibility.insert(key.into(), true);
        }
        for key in [
            "capHeight",
            "arabicBodyHeight",
            "markTopZone",
            "markBottomZone",
        ] {
            metric_visibility.insert(key.into(), false);
        }
        Self {
            baseline: 0,
            ascender: 800,
            descender: -250,
            cap_height: Some(700),
            arabic_body_height: None,
            mark_top_zone: 850,
            mark_bottom_zone: -350,
            metric_locks,
            metric_visibility,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WorkspacePrefs {
    pub rulers_visible: bool,
    pub grid_visible: bool,
    pub grid_major_step: u32,
    pub grid_minor_divisions: u32,
    pub snap_enabled: bool,
    pub snap_tolerance_px: u32,
    pub snap_targets: BTreeMap<String, bool>,
    pub guides: Vec<Guide>,
    pub ui_language: String,
}

impl Default for WorkspacePrefs {
    fn default() -> Self {
        let mut snap_targets = BTreeMap::new();
        for target in [
            "grid",
            "metricLines",
            "guides",
            "glyphBounds",
            "advanceBoundaries",
            "outlineNodes",
            "anchors",
        ] {
            snap_targets.insert(target.into(), target != "grid");
        }
        Self {
            rulers_visible: true,
            grid_visible: false,
            grid_major_step: 100,
            grid_minor_divisions: 5,
            snap_enabled: true,
            snap_tolerance_px: 8,
            snap_targets,
            guides: Vec::new(),
            ui_language: "ar".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Guide {
    pub guide_id: String,
    pub orientation: String,
    pub position_fu: f64,
    pub scope: String,
    pub locked: bool,
    pub visible: bool,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Anchor {
    pub anchor_id: String,
    pub name: String,
    pub class: String,
    pub x: f64,
    pub y: f64,
    pub scope: String,
    pub locked: bool,
    /// Fingerprint of the outline this anchor was last reviewed against.
    pub geometry_key: Option<String>,
    /// Set when source artwork changed materially and the position needs checking.
    pub needs_review: bool,
    pub review_note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ImportInfo {
    pub mode: String,
    pub view_box: [f64; 4],
    pub source_width: f64,
    pub source_height: f64,
    pub scale: f64,
    pub matrix: [f64; 6],
    pub source_file_name: String,
    pub content_hash: String,
    pub imported_at: String,
    pub contours: u32,
    pub segments: u32,
    pub bounds: [f64; 4],
    pub findings: Vec<ValidationFinding>,
    pub preview_path: String,
}

impl Default for ImportInfo {
    fn default() -> Self {
        Self {
            mode: "fit_to_em".into(),
            view_box: [0.0, 0.0, 1000.0, 1000.0],
            source_width: 0.0,
            source_height: 0.0,
            scale: 1.0,
            matrix: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            source_file_name: String::new(),
            content_hash: String::new(),
            imported_at: String::new(),
            contours: 0,
            segments: 0,
            bounds: [0.0, 0.0, 0.0, 0.0],
            findings: Vec::new(),
            preview_path: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct SourceRevision {
    pub path: String,
    pub content_hash: String,
    pub replaced_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Placement {
    pub x: f64,
    pub y: f64,
    pub scale_x: f64,
    pub scale_y: f64,
    pub rotation: f64,
}

impl Default for Placement {
    fn default() -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            scale_x: 1.0,
            scale_y: 1.0,
            rotation: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SlotMetrics {
    pub advance_width: f64,
    pub left_side_bearing: f64,
    pub right_side_bearing: f64,
}

impl Default for SlotMetrics {
    fn default() -> Self {
        Self {
            advance_width: 600.0,
            left_side_bearing: 0.0,
            right_side_bearing: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct ValidationFinding {
    pub severity: String,
    pub code: String,
    pub slot_id: String,
    pub message: String,
    pub hint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct GlyphSlot {
    pub slot_id: String,
    pub character_name: String,
    pub unicode: String,
    pub glyph_name: String,
    pub form: String,
    pub joining_type: String,
    /// Preset character group (letters, hamza, marks, punctuation, digits).
    pub group: String,
    /// Mark attachment class from the pinned preset, when applicable.
    pub mark_class: Option<String>,
    pub required: bool,
    pub original_svg: Option<String>,
    pub source_revisions: Vec<SourceRevision>,
    pub import: Option<ImportInfo>,
    pub placement: Placement,
    pub metrics: SlotMetrics,
    pub anchors: Vec<Anchor>,
    pub status: String,
    pub approved_at: Option<String>,
    pub validation: Vec<ValidationFinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct BuildRecord {
    pub build_id: String,
    pub timestamp: String,
    pub app_version: String,
    pub toolchain_versions: BTreeMap<String, String>,
    pub requested_formats: Vec<String>,
    pub result: String,
    pub compiler_log_path: String,
    pub validation_report_path: String,
    pub output_paths: BTreeMap<String, String>,
    pub project_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Project {
    pub schema_version: String,
    pub project_id: String,
    pub font: FontMeta,
    pub metrics: GlobalMetrics,
    pub workspace: WorkspacePrefs,
    pub glyph_slots: Vec<GlyphSlot>,
    pub builds: Vec<BuildRecord>,
    pub created_at: String,
    pub updated_at: String,
}

impl Project {
    pub fn new(name: &str, family: &str, style: &str, upm: u32) -> Self {
        let timestamp = now_iso();
        let mut font = FontMeta::default();
        font.family_name = if family.trim().is_empty() {
            name.trim().to_string()
        } else {
            family.trim().to_string()
        };
        font.style_name = if style.trim().is_empty() {
            "Regular".into()
        } else {
            style.trim().to_string()
        };
        font.units_per_em = if upm == 2048 { 2048 } else { 1000 };
        let mut metrics = GlobalMetrics::default();
        metrics.ascender = (font.units_per_em as f64 * 0.8).round() as i32;
        metrics.descender = -(font.units_per_em as f64 * 0.25).round() as i32;
        metrics.mark_top_zone = (font.units_per_em as f64 * 0.85).round() as i32;
        metrics.mark_bottom_zone = -(font.units_per_em as f64 * 0.35).round() as i32;
        let nanos = Utc::now().timestamp_nanos_opt().unwrap_or_default();
        Self {
            schema_version: SCHEMA_VERSION.into(),
            project_id: format!("project-{nanos}"),
            font,
            metrics,
            workspace: WorkspacePrefs::default(),
            glyph_slots: Vec::new(),
            builds: Vec::new(),
            created_at: timestamp.clone(),
            updated_at: timestamp,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHandle {
    pub path: String,
    pub project: Project,
    pub migration_notes: Vec<String>,
}
