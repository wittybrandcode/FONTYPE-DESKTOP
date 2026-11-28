import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { parseEngineEvent, type EngineEvent } from "./protocol";
import type {
  Anchor,
  AnchorSpec,
  BuildRecord,
  GlyphSlot,
  GlobalMetrics,
  Guide,
  PresetInfo,
  Project,
  ProjectHandle,
  ShapingOptions,
  SvgInspection,
  WorkspacePrefs,
} from "./types";

export type CreateProjectArgs = {
  parent: string;
  name: string;
  family: string;
  style: string;
  upm: number;
};

export const api = {
  createProject: (args: CreateProjectArgs) =>
    invoke<ProjectHandle>("create_project", args),
  openProject: (path: string) => invoke<ProjectHandle>("open_project", { path }),
  saveProject: (path: string, project: Project) =>
    invoke<void>("save_project", { path, project }),
  presetInfo: () => invoke<PresetInfo>("preset_info"),
  generateInventory: (path: string) => invoke<GlyphSlot[]>("generate_inventory", { path }),
  importSvg: (
    path: string,
    slotId: string,
    inspection: SvgInspection,
    advanceWidth: number | null,
    mode: string,
  ) =>
    invoke<GlyphSlot>("import_svg", {
      path,
      slotId,
      inspection,
      advanceWidth,
      mode,
    }),
  /** M3ب — writes only the existing previewPath/bounds/count fields. */
  setPreviewPath: (
    path: string,
    slotId: string,
    previewPath: string,
    bounds: [number, number, number, number],
    contours: number,
    segments: number,
  ) =>
    invoke<GlyphSlot>("set_preview_path", {
      path,
      slotId,
      previewPath,
      bounds,
      contours,
      segments,
    }),
  removeArtwork: (path: string, slotId: string) =>
    invoke<GlyphSlot>("remove_artwork", { path, slotId }),
  approveSlot: (path: string, slotId: string) =>
    invoke<GlyphSlot>("approve_slot", { path, slotId }),
  setSlotMetrics: (
    path: string,
    slotId: string,
    advanceWidth: number,
    leftSideBearing: number,
    rightSideBearing: number,
  ) =>
    invoke<GlyphSlot>("set_slot_metrics", {
      path,
      slotId,
      advanceWidth,
      leftSideBearing,
      rightSideBearing,
    }),
  setPlacement: (
    path: string,
    slotId: string,
    x: number,
    y: number,
    scaleX: number,
    scaleY: number,
    rotation: number,
  ) =>
    invoke<GlyphSlot>("set_placement", {
      path,
      slotId,
      x,
      y,
      scaleX,
      scaleY,
      rotation,
    }),
  setMetrics: (path: string, metrics: GlobalMetrics) =>
    invoke<GlobalMetrics>("set_metrics", { path, metrics }),
  setWorkspacePrefs: (path: string, prefs: WorkspacePrefs) =>
    invoke<WorkspacePrefs>("set_workspace_prefs", { path, prefs }),
  setGuides: (path: string, guides: Guide[]) =>
    invoke<Guide[]>("set_guides", { path, guides }),
  anchorSuggestions: (path: string, slotId: string) =>
    invoke<AnchorSpec[]>("anchor_suggestions", { path, slotId }),
  applyAnchorPreset: (path: string, slotId: string) =>
    invoke<GlyphSlot>("apply_anchor_preset", { path, slotId }),
  setAnchors: (path: string, slotId: string, anchors: Anchor[]) =>
    invoke<GlyphSlot>("set_anchors", { path, slotId, anchors }),
  setShapingOptions: (path: string, shaping: ShapingOptions) =>
    invoke<ShapingOptions>("set_shaping_options", { path, options: shaping }),
  recordBuild: (path: string, record: BuildRecord) =>
    invoke<BuildRecord[]>("record_build", { path, record }),
  backupProject: (path: string) => invoke<string>("backup_project", { path }),
  restoreProject: (path: string, backup: string) =>
    invoke<ProjectHandle>("restore_project", { path, backup }),
  engineInfo: () => invoke<Record<string, unknown>>("engine_info"),
  engineCancel: (jobId: string) => invoke<boolean>("engine_cancel", { jobId }),
};

export async function runEngineJob(
  cmd: string,
  params: Record<string, unknown>,
  onEvent?: (event: EngineEvent) => void,
  timeoutMs = 180_000,
  onJob?: (jobId: string) => void,
): Promise<Record<string, unknown>> {
  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  onJob?.(jobId);
  let resolveJob!: (value: Record<string, unknown>) => void;
  let rejectJob!: (reason: Error) => void;
  const finished = new Promise<Record<string, unknown>>((resolve, reject) => {
    resolveJob = resolve;
    rejectJob = reject;
  });

  let unlisten: UnlistenFn | null = null;
  const timer = setTimeout(() => {
    cleanup();
    rejectJob(new Error("انتهت مهلة انتظار المحرك."));
  }, timeoutMs);

  function cleanup() {
    clearTimeout(timer);
    unlisten?.();
    unlisten = null;
  }

  unlisten = await listen<unknown>("engine-event", (event) => {
    const parsed = parseEngineEvent(event.payload);
    if (!parsed || parsed.jobId !== jobId) return;
    onEvent?.(parsed);
    if (parsed.type === "result") {
      cleanup();
      resolveJob(parsed.data);
    } else if (parsed.type === "error") {
      cleanup();
      rejectJob(new Error(String(parsed.data.message ?? "خطأ غير معروف في المحرك.")));
    }
  });

  try {
    await invoke("engine_request", { jobId, cmd, params });
  } catch (error) {
    cleanup();
    rejectJob(error instanceof Error ? error : new Error(String(error)));
  }

  return finished;
}

/** Engine-ready glyph records shared by source generation, builds and preview. */
export function projectGlyphParams(handle: ProjectHandle): Record<string, unknown>[] {
  return handle.project.glyphSlots
    .filter((slot) => slot.import?.previewPath)
    .map((slot) => ({
      slotId: slot.slotId,
      glyphName: slot.glyphName,
      unicode: slot.unicode,
      form: slot.form,
      joiningType: slot.joiningType,
      group: slot.group,
      markClass: slot.markClass,
      characterName: slot.characterName,
      previewPath: slot.import?.previewPath ?? "",
      placement: slot.placement,
      advanceWidth: slot.metrics.advanceWidth,
      anchors: slot.anchors,
    }));
}

function projectBaseParams(handle: ProjectHandle): Record<string, unknown> {
  const { project } = handle;
  return {
    upm: project.font.unitsPerEm,
    familyName: project.font.familyName,
    styleName: project.font.styleName,
    designer: project.font.designer,
    version: project.font.version,
    copyright: project.font.copyright,
    license: project.font.license,
    projectId: project.projectId,
    schemaVersion: project.schemaVersion,
    presetId: project.font.characterSetPreset,
    metrics: {
      ascender: project.metrics.ascender,
      descender: project.metrics.descender,
      capHeight: project.metrics.capHeight,
    },
    glyphs: projectGlyphParams(handle),
    shaping: project.shaping,
  };
}

/** Builds the intermediate UFO from the persisted project glyph model. */
export function buildFontSource(handle: ProjectHandle): Promise<Record<string, unknown>> {
  return runEngineJob("build_source", {
    ...projectBaseParams(handle),
    outputPath: `${handle.path}/source/fontype.ufo`,
  });
}

export interface BuildJobOptions {
  onEvent?: (event: EngineEvent) => void;
  onJob?: (jobId: string) => void;
}

export function buildFont(
  handle: ProjectHandle,
  buildId: string,
  options: BuildJobOptions = {},
): Promise<Record<string, unknown>> {
  return runEngineJob(
    "build_font",
    {
      ...projectBaseParams(handle),
      projectPath: handle.path,
      buildId,
      outputDir: `${handle.path}/output/${buildId}`,
      reportPath: `${handle.path}/reports/${buildId}.json`,
      appVersion: "0.6.0",
    },
    options.onEvent,
    300_000,
    options.onJob,
  );
}

export function shapePreview(
  handle: ProjectHandle,
  fontPath: string,
  text: string,
  mode: string,
  onJob?: (jobId: string) => void,
): Promise<Record<string, unknown>> {
  return runEngineJob(
    "shape_preview",
    { fontPath, text, mode, glyphs: projectGlyphParams(handle) },
    undefined,
    180_000,
    onJob,
  );
}

export function runShapingCorpus(
  handle: ProjectHandle,
  fontPath: string,
): Promise<Record<string, unknown>> {
  return runEngineJob("run_corpus", {
    fontPath,
    glyphs: projectGlyphParams(handle),
  });
}
