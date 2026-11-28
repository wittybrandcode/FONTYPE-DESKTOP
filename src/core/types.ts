export interface FontMeta {
  familyName: string;
  styleName: string;
  version: string;
  designer: string;
  copyright: string;
  license: string;
  unitsPerEm: number;
  characterSetPreset: string;
}

export interface GlobalMetrics {
  baseline: number;
  ascender: number;
  descender: number;
  capHeight: number | null;
  arabicBodyHeight: number | null;
  markTopZone: number;
  markBottomZone: number;
  metricLocks: Record<string, boolean>;
  metricVisibility: Record<string, boolean>;
}

export interface WorkspacePrefs {
  rulersVisible: boolean;
  gridVisible: boolean;
  gridMajorStep: number;
  gridMinorDivisions: number;
  snapEnabled: boolean;
  snapTolerancePx: number;
  snapTargets: Record<string, boolean>;
  guides: Guide[];
  uiLanguage: string;
}

export interface ShapingOptions {
  lamAlefLigatures: boolean;
  markPositioning: boolean;
  cursivePositioning: boolean;
}

export interface ValidationFinding {
  severity: "info" | "warning" | "error";
  code: string;
  slotId: string;
  message: string;
  hint: string;
}

export interface SourceRevision {
  path: string;
  contentHash: string;
  replacedAt: string;
}

export interface ImportInfo {
  mode: string;
  viewBox: [number, number, number, number];
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  matrix: [number, number, number, number, number, number];
  sourceFileName: string;
  contentHash: string;
  importedAt: string;
  contours: number;
  segments: number;
  bounds: [number, number, number, number];
  findings: ValidationFinding[];
  previewPath: string;
}

export interface Guide {
  guideId: string;
  orientation: "vertical" | "horizontal";
  positionFU: number;
  scope: string;
  locked: boolean;
  visible: boolean;
  name: string;
}

export interface Anchor {
  anchorId: string;
  name: string;
  class: string;
  x: number;
  y: number;
  scope: string;
  locked: boolean;
  geometryKey: string | null;
  needsReview: boolean;
  reviewNote: string;
}

export interface AnchorSpec {
  name: string;
  class: string;
  x: number;
  y: number;
  required: boolean;
  reason: string;
}

export interface GlyphSlot {
  slotId: string;
  characterName: string;
  unicode: string;
  glyphName: string;
  form: string;
  joiningType: string;
  group: string;
  markClass: string | null;
  required: boolean;
  originalSvg: string | null;
  sourceRevisions: SourceRevision[];
  import: ImportInfo | null;
  placement: { x: number; y: number; scaleX: number; scaleY: number; rotation: number };
  metrics: { advanceWidth: number; leftSideBearing: number; rightSideBearing: number };
  anchors: Anchor[];
  status: "empty" | "imported" | "needs-review" | "error" | "ready";
  approvedAt: string | null;
  validation: ValidationFinding[];
}

export interface BuildRecord {
  buildId: string;
  timestamp: string;
  appVersion: string;
  toolchainVersions: Record<string, string>;
  requestedFormats: string[];
  result: string;
  compilerLogPath: string;
  validationReportPath: string;
  outputPaths: Record<string, string>;
  projectHash: string;
}

export interface Project {
  schemaVersion: string;
  projectId: string;
  font: FontMeta;
  metrics: GlobalMetrics;
  workspace: WorkspacePrefs;
  shaping: ShapingOptions;
  glyphSlots: GlyphSlot[];
  builds: BuildRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectHandle {
  path: string;
  project: Project;
  migrationNotes: string[];
}

/** Read-only Home-screen metadata returned by Rust; never written to .afsp. */
export interface ProjectSummary {
  path: string;
  projectId: string;
  name: string;
  family: string;
  style: string;
  upm: number;
  updatedAt: string;
  slots: number;
  ready: number;
  review: number;
  imported: number;
  builds: number;
  available: boolean;
}

export interface PresetGroupInfo {
  id: string;
  label: string;
  required: boolean;
  characterCount: number;
}

export interface PresetInfo {
  schemaVersion: string;
  presetId: string;
  label: string;
  unicodeVersion: string;
  groups: PresetGroupInfo[];
  formsByJoiningType: Record<string, string[]>;
  totalSlots: number;
}

export interface SvgInspection {
  ok: boolean;
  sourceFileName: string;
  sourcePath: string;
  contentHash: string;
  byteSize: number;
  viewBox: [number, number, number, number];
  width: number;
  height: number;
  bounds: [number, number, number, number];
  contours: number;
  segments: number;
  matrix: [number, number, number, number, number, number];
  scale: number;
  findings: ValidationFinding[];
  previewPath: string;
  requiresManualReview: boolean;
}
