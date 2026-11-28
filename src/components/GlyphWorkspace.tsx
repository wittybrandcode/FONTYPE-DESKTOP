import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { api, buildFontSource, shapePreview } from "../core/api";
import {
  ANCHOR_CLASSES,
  anchorClassInfo,
  anchorReviewLabel,
  collectAnchorSnapTargets,
  compatiblePairs,
  compatibilityCount,
} from "../core/anchors";
import type { Anchor, AnchorSpec, GlyphSlot, GlobalMetrics, Guide, Project, ProjectHandle, ValidationFinding } from "../core/types";
import { Icon } from "../ui/icons";
import {
  DockResizer,
  IconButton,
  InfoTip,
  StatusBadge,
  ToolbarDivider,
} from "../ui/components";
import { Inspector, InspectorSection } from "../ui/Inspector";
import {
  alignPlacedRects,
  collectSnapTargets,
  distributePlacedRects,
  fitViewport,
  flipPlacement,
  movePlacement,
  rectFromPoints,
  rectsIntersect,
  rotatePlacementAround,
  scalePlacementAxisAround,
  scalePlacementAround,
  screenToWorld,
  selectionBounds,
  stepZoom,
  transformRect,
  worldToScreen,
  zoomAt,
  type AlignMode,
  type Placement,
  type PlacedRect,
  type Point,
  type Rect,
  type SnapResult,
  type Viewport,
} from "../core/workspace";
import { inspectSvgSources, pickSvgFiles } from "../core/svgImport";
import { RULER_THICKNESS, crispPixel, rulerView } from "../core/rulers";
import {
  cullSnapTargets,
  guideDragTargets,
  resolveSnap,
  smartGuides,
  snapDistanceFU,
  snapGuidePosition,
} from "../core/snapping";
import { metricLayers, sideBearingLayers } from "../core/metricLayers";
import { formSequence, highlightSlotGlyphs, onionForms, previewSummary } from "../core/preview";
import {
  findNode,
  parsePathModel,
  pathModelBounds,
  pathModelCounts,
  reverseContour,
  serializePathModel,
  simplifyPath,
  splitSubpaths,
  subpathTransform,
  translateHandle,
  translateNode,
  type PathModel,
} from "../core/pathGeometry";

/** Edit actions exposed to the application menu/tool bar while this editor is mounted. */
export interface EditorCommand {
  id: string;
  label: string;
  description: string;
  group: string;
  icon: string;
  shortcut?: string;
  run: () => void;
}

export interface EditorActions {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  commands?: EditorCommand[];
}

type InspectorContext = "slot" | "preview" | "path" | "anchor";

interface LayoutSnapshot {
  inspectorWidth: number;
  inspectorOpen: boolean;
  minimapVisible: boolean;
  anchorsVisible: boolean;
  guidesVisible: boolean;
  compareVisible: boolean;
  onionVisible: boolean;
  openSections: Record<string, boolean>;
}

interface Props {
  project: ProjectHandle;
  onProject: (handle: ProjectHandle) => void;
  onNotice: (text: string, kind?: "ok" | "error") => void;
  initialSlotId?: string | null;
  registerEditor?: (actions: EditorActions | null) => void;
  onOpenInventory?: () => void;
  /** TTF from the latest local build; enables real HarfBuzz preview in the canvas. */
  previewFontPath?: string;
}

type Tool = "select" | "pan" | "path";
type SelectionMode = "replace" | "add" | "toggle";
type TransformField = "x" | "y" | "scaleX" | "scaleY" | "rotation";

type DragState =
  | { kind: "pan"; startScreen: Point; startViewport: Viewport }
  | { kind: "marquee"; startWorld: Point; mode: SelectionMode; baseIds: string[] }
  | { kind: "move"; startWorld: Point; placements: Record<string, Placement>; primaryId: string }
  | { kind: "scale"; startWorld: Point; pivot: Point; placements: Record<string, Placement>; axis?: "x" | "y" }
  | { kind: "rotate"; center: Point; startAngle: number; placements: Record<string, Placement> }
  | { kind: "anchor"; anchorId: string }
  | { kind: "guide"; guideId: string; axis: "x" | "y" }
  | { kind: "metric"; key: string }
  | { kind: "subpath"; startWorld: Point; startOffset: Point }
  | { kind: "node"; nodeId: string; startWorld: Point; startPoint: Point };

interface HistoryEntry {
  project: Project;
  slotIds: string[];
  label: string;
}

interface PointerData {
  clientX: number;
  clientY: number;
  altKey: boolean;
  shiftKey: boolean;
}

interface TransformHandle {
  key: string;
  x: number;
  y: number;
  cursor: string;
  pivot: Point;
  axis?: "x" | "y";
}

const METRIC_ROWS: Array<{ key: string; label: string }> = [
  { key: "baseline", label: "خط الأساس" },
  { key: "ascender", label: "الصاعد" },
  { key: "descender", label: "الهابط" },
  { key: "capHeight", label: "ارتفاع الحرف الكبير" },
  { key: "arabicBodyHeight", label: "ارتفاع جسم العربي" },
  { key: "markTopZone", label: "منطقة العلامات العليا" },
  { key: "markBottomZone", label: "منطقة العلامات السفلى" },
];

const SNAP_GROUPS: Array<{ key: string; label: string }> = [
  { key: "anchors", label: "المراسي" },
  { key: "metricLines", label: "خطوط القياس" },
  { key: "guides", label: "الأدلة" },
  { key: "glyphBounds", label: "حدود الرسم" },
  { key: "advanceBoundaries", label: "حدود التقدّم" },
  { key: "grid", label: "الشبكة" },
];

const FORM_LABELS: Record<string, string> = {
  isolated: "مفرد",
  initial: "بدائي",
  medial: "وسيط",
  final: "نهائي",
};

const SLOT_STATUS_LABELS: Record<string, string> = {
  empty: "فارغة",
  imported: "مُستوردة",
  ready: "معتمدة",
  "needs-review": "تحتاج مراجعة",
  error: "خطأ",
};

function slotStatusTone(status?: string): "ready" | "imported" | "review" | "error" | "empty" | "idle" {
  if (status === "ready" || status === "imported" || status === "error") return status;
  if (status === "needs-review") return "review";
  if (status === "empty") return "empty";
  return "idle";
}

function metricValue(metrics: GlobalMetrics, key: string): number | null {
  switch (key) {
    case "baseline": return metrics.baseline;
    case "ascender": return metrics.ascender;
    case "descender": return metrics.descender;
    case "capHeight": return metrics.capHeight;
    case "arabicBodyHeight": return metrics.arabicBodyHeight;
    case "markTopZone": return metrics.markTopZone;
    case "markBottomZone": return metrics.markBottomZone;
    default: return null;
  }
}

function setMetricValue(metrics: GlobalMetrics, key: string, value: number | null): GlobalMetrics {
  const next = { ...metrics };
  switch (key) {
    case "baseline": next.baseline = value ?? 0; break;
    case "ascender": next.ascender = value ?? 0; break;
    case "descender": next.descender = value ?? 0; break;
    case "capHeight": next.capHeight = value; break;
    case "arabicBodyHeight": next.arabicBodyHeight = value; break;
    case "markTopZone": next.markTopZone = value ?? 0; break;
    case "markBottomZone": next.markBottomZone = value ?? 0; break;
  }
  return next;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizePlacement(placement: Placement): Placement {
  return {
    x: round(placement.x),
    y: round(placement.y),
    scaleX: round(placement.scaleX, 4),
    scaleY: round(placement.scaleY, 4),
    rotation: round(placement.rotation, 2),
  };
}

function snapshotPlacements(slots: GlyphSlot[], ids: string[]): Record<string, Placement> {
  return Object.fromEntries(
    slots.filter((slot) => ids.includes(slot.slotId)).map((slot) => [slot.slotId, { ...slot.placement }]),
  );
}

function applySelectionMode(base: string[], hits: string[], mode: SelectionMode): string[] {
  if (mode === "replace") return hits;
  if (mode === "add") return [...new Set([...base, ...hits])];
  return [...new Set([...base.filter((id) => !hits.includes(id)), ...hits.filter((id) => !base.includes(id))])];
}

function readFlag(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

export default function GlyphWorkspace({ project, onProject, onNotice, initialSlotId, registerEditor, onOpenInventory, previewFontPath = "" }: Props) {
  const slots = project.project.glyphSlots;
  const [selectedId, setSelectedId] = useState(() =>
    slots.find((slot) => slot.originalSvg)?.slotId ?? slots[0]?.slotId ?? "",
  );
  const selected = slots.find((slot) => slot.slotId === selectedId) ?? slots[0] ?? null;
  const upm = project.project.font.unitsPerEm;
  const prefs = project.project.workspace;
  const metrics = project.project.metrics;

  const canvasRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 900, h: 620 });
  const [viewport, setViewport] = useState<Viewport>(() => fitViewport(upm, 900, 620));
  const [tool, setTool] = useState<Tool>("select");
  const panMode = tool === "pan";
  const [anchorsVisible, setAnchorsVisible] = useState(true);
  const [guidesVisible, setGuidesVisible] = useState(true);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    import: true,
    slot: true,
    anchors: true,
    validation: true,
    guides: false,
    metrics: false,
    snap: false,
    history: false,
    path: true,
    preview: true,
    layout: false,
  });
  function toggleSection(key: string) {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  }
  const [pointer, setPointer] = useState<Point | null>(null);
  const [snap, setSnap] = useState<SnapResult | null>(null);
  const [bypassed, setBypassed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  const [selectionIds, setSelectionIds] = useState<string[]>(() => {
    const first = slots.find((slot) => slot.originalSvg)?.slotId ?? slots[0]?.slotId ?? "";
    return first ? [first] : [];
  });
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [minimapVisible, setMinimapVisible] = useState(() => readFlag("fontype:minimap", true));
  const [past, setPast] = useState<HistoryEntry[]>([]);
  const [future, setFuture] = useState<HistoryEntry[]>([]);
  const [anchorSuggestions, setAnchorSuggestions] = useState<AnchorSpec[]>([]);
  const [sourceBusy, setSourceBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(292);
  const [inspectorOpen, setInspectorOpen] = useState(
    () => typeof window === "undefined" || window.innerWidth >= 1120,
  );
  const [inspectorContext, setInspectorContext] = useState<InspectorContext>("slot");
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewText, setPreviewText] = useState("بسب");
  const [previewMode, setPreviewMode] = useState("word");
  const [previewData, setPreviewData] = useState<Record<string, unknown> | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [compareVisible, setCompareVisible] = useState(() => readFlag("fontype:compare", true));
  const [onionVisible, setOnionVisible] = useState(() => readFlag("fontype:onion", false));
  const [selectedSubpathId, setSelectedSubpathId] = useState<string | null>(null);
  const [subpathOffset, setSubpathOffset] = useState<Point>({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [pathDirty, setPathDirty] = useState(false);
  const [focusedAnchorName, setFocusedAnchorName] = useState<string | null>(null);

  const previewTimerRef = useRef<number | null>(null);
  const previewJobRef = useRef<string | null>(null);
  const spacePanRef = useRef(false);
  const spacePrevToolRef = useRef<Tool>("select");
  const dragRef = useRef<DragState | null>(null);
  const dragOriginRef = useRef<Project | null>(null);
  const pathOriginRef = useRef<Project | null>(null);
  const pathEditSlotRef = useRef<string | null>(null);
  const dragSlotIdsRef = useRef<string[]>([]);
  const currentSnapRef = useRef<string | null>(null);
  const guideSnapRef = useRef<string | null>(null);
  const marqueeRef = useRef<Rect | null>(null);
  const pendingPointerRef = useRef<PointerData | null>(null);
  const frameRef = useRef<number | null>(null);
  const minimapDragRef = useRef(false);
  const latestRef = useRef({ project, viewport, size, selected });
  latestRef.current = { project, viewport, size, selected };

  useEffect(() => {
    flushPathEdit("تحرير المسار", false);
    setAnchorSuggestions([]);
    setSelectedSubpathId(null);
    setSelectedNodeId(null);
    setPathDirty(false);
    setSubpathOffset({ x: 0, y: 0 });
    setFocusedAnchorName(null);
  }, [selectedId]);

  useEffect(() => {
    if (!initialSlotId) return;
    if (slots.some((slot) => slot.slotId === initialSlotId)) {
      setSelectedId(initialSlotId);
      setSelectionIds([initialSlotId]);
    }
  }, [initialSlotId, slots]);

  useEffect(() => {
    setSelectionIds((current) =>
      current.every((id) => slots.some((slot) => slot.slotId === id))
        ? current
        : current.filter((id) => slots.some((slot) => slot.slotId === id)),
    );
  }, [slots]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("fontype:minimap", minimapVisible ? "1" : "0");
    } catch {
      // Storage is optional; the in-memory toggle still works.
    }
  }, [minimapVisible]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("fontype:compare", compareVisible ? "1" : "0");
      window.localStorage.setItem("fontype:onion", onionVisible ? "1" : "0");
    } catch {
      // Optional preference storage.
    }
  }, [compareVisible, onionVisible]);

  useEffect(
    () => () => {
      if (frameRef.current !== null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frameRef.current);
      }
      if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
      const jobId = previewJobRef.current;
      if (jobId) void api.engineCancel(jobId);
    },
    [],
  );

  useEffect(() => {
    if (!wrapRef.current) return;
    const canvas = wrapRef.current.querySelector("svg.ws-canvas");
    if (!canvas) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setSize({ w: rect.width, h: rect.height });
        setViewport((current) =>
          current.zoom === fitViewport(upm, 900, 620).zoom
            ? fitViewport(upm, rect.width, rect.height)
            : current,
        );
      }
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [upm]);

  const bounds = selected?.import?.bounds ?? null;
  const outlineRect = useMemo(
    () =>
      bounds
        ? { xMin: bounds[0], yMin: bounds[1], xMax: bounds[2], yMax: bounds[3] }
        : null,
    [bounds],
  );

  const ruler = useMemo(
    () => rulerView(viewport, size.w, size.h),
    [viewport, size.w, size.h],
  );
  const visibleRange = ruler.range;
  const xTicks = ruler.xTicks;
  const yTicks = ruler.yTicks;

  const selectedSlots = useMemo(
    () => slots.filter((slot) => selectionIds.includes(slot.slotId) && slot.import?.previewPath),
    [slots, selectionIds],
  );
  const primarySelected = selectedSlots.find((slot) => slot.slotId === selectedId) ?? selectedSlots[0] ?? null;
  const placedRects = useMemo<PlacedRect[]>(
    () =>
      selectedSlots.flatMap((slot) =>
        slot.import?.bounds
          ? [{
              id: slot.slotId,
              bounds: {
                xMin: slot.import.bounds[0],
                yMin: slot.import.bounds[1],
                xMax: slot.import.bounds[2],
                yMax: slot.import.bounds[3],
              },
              placement: slot.placement,
            }]
          : [],
      ),
    [selectedSlots],
  );
  const selectionWorldBounds = useMemo(() => selectionBounds(placedRects), [placedRects]);
  const selectionCenter = useMemo<Point | null>(
    () =>
      selectionWorldBounds
        ? {
            x: (selectionWorldBounds.xMin + selectionWorldBounds.xMax) / 2,
            y: (selectionWorldBounds.yMin + selectionWorldBounds.yMax) / 2,
          }
        : null,
    [selectionWorldBounds],
  );
  const selectionScreenBounds = useMemo(() => {
    if (!selectionWorldBounds) return null;
    const topLeft = worldToScreen({ x: selectionWorldBounds.xMin, y: selectionWorldBounds.yMax }, viewport);
    const bottomRight = worldToScreen({ x: selectionWorldBounds.xMax, y: selectionWorldBounds.yMin }, viewport);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
      centerX: (topLeft.x + bottomRight.x) / 2,
      centerY: (topLeft.y + bottomRight.y) / 2,
    };
  }, [selectionWorldBounds, viewport]);
  const transformHandles = useMemo<TransformHandle[]>(() => {
    if (!selectionScreenBounds || !selectionWorldBounds) return [];
    const { x, y, width, height } = selectionScreenBounds;
    const world = selectionWorldBounds;
    return [
      { key: "nw", x, y, cursor: "nwse-resize", pivot: { x: world.xMax, y: world.yMax } },
      { key: "ne", x: x + width, y, cursor: "nesw-resize", pivot: { x: world.xMin, y: world.yMax } },
      { key: "se", x: x + width, y: y + height, cursor: "nwse-resize", pivot: { x: world.xMin, y: world.yMin } },
      { key: "sw", x, y: y + height, cursor: "nesw-resize", pivot: { x: world.xMax, y: world.yMin } },
      { key: "n", x: x + width / 2, y, cursor: "ns-resize", pivot: { x: world.xMin, y: world.yMin }, axis: "y" },
      { key: "e", x: x + width, y: y + height / 2, cursor: "ew-resize", pivot: { x: world.xMin, y: world.yMax }, axis: "x" },
      { key: "s", x: x + width / 2, y: y + height, cursor: "ns-resize", pivot: { x: world.xMin, y: world.yMax }, axis: "y" },
      { key: "w", x, y: y + height / 2, cursor: "ew-resize", pivot: { x: world.xMax, y: world.yMax }, axis: "x" },
    ];
  }, [selectionScreenBounds, selectionWorldBounds]);
  const renderedSlots = useMemo(() => {
    const ids = new Set(selectionIds);
    if (selected?.import?.previewPath) ids.add(selected.slotId);
    return slots.filter((slot) => ids.has(slot.slotId) && slot.import?.previewPath);
  }, [slots, selectionIds, selected]);

  const formEntries = useMemo(() => formSequence(slots, selected), [slots, selected]);
  const onion = useMemo(() => onionForms(slots, selected), [slots, selected]);
  const subpaths = useMemo(
    () => splitSubpaths(selected?.import?.previewPath ?? ""),
    [selected?.import?.previewPath],
  );
  const selectedSubpath = subpaths.find((part) => String(part.index) === selectedSubpathId) ?? null;
  const pathSource = selected?.import?.previewPath ?? "";
  const pathModel = useMemo<PathModel>(() => parsePathModel(pathSource), [pathSource]);
  const activeContourId = selectedSubpathId !== null ? `c${selectedSubpathId}` : null;
  const activeContour = pathModel.contours.find((contour) => contour.id === activeContourId) ?? null;
  const selectedNode = selectedNodeId ? findNode(pathModel, selectedNodeId) : null;

  /** M3ب — remembers the pre-edit snapshot once per path editing session. */
  function beginPathEdit() {
    if (!pathOriginRef.current) {
      pathOriginRef.current = latestRef.current.project.project;
      pathEditSlotRef.current = latestRef.current.selected?.slotId ?? null;
    }
  }

  interface PathEditSnapshot {
    slotId: string;
    d: string;
    bounds: [number, number, number, number];
    contours: number;
    segments: number;
  }

  /** M3ب — applies a pure model transform to the existing previewPath only. */
  function applyPathModel(transform: (model: PathModel) => PathModel): PathEditSnapshot | null {
    const activeSlot = latestRef.current.selected;
    if (!activeSlot?.import) return null;
    const source = activeSlot.import.previewPath;
    const updated = transform(parsePathModel(source));
    const d = serializePathModel(updated);
    if (d === source) return null;
    beginPathEdit();
    const bounds = pathModelBounds(updated);
    const counts = pathModelCounts(updated);
    patchProject((current) => ({
      ...current,
      glyphSlots: current.glyphSlots.map((entry) =>
        entry.slotId === activeSlot.slotId && entry.import
          ? {
              ...entry,
              import: {
                ...entry.import,
                previewPath: d,
                bounds,
                contours: counts.contours,
                segments: counts.segments,
              },
            }
          : entry,
      ),
    }));
    setPathDirty(true);
    return { slotId: activeSlot.slotId, d, bounds, contours: counts.contours, segments: counts.segments };
  }

  /** Commits the pending path edit with a true pre-edit undo snapshot. */
  function flushPathEdit(label = "تحرير المسار", notify = true, pending?: PathEditSnapshot) {
    const origin = pathOriginRef.current;
    const slotId = pending?.slotId ?? pathEditSlotRef.current;
    pathOriginRef.current = null;
    pathEditSlotRef.current = null;
    let snapshot = pending ?? null;
    if (!snapshot && slotId) {
      const slot = latestRef.current.project.project.glyphSlots.find(
        (item) => item.slotId === slotId,
      );
      if (slot?.import?.previewPath) {
        const updated = parsePathModel(slot.import.previewPath);
        const counts = pathModelCounts(updated);
        snapshot = {
          slotId,
          d: slot.import.previewPath,
          bounds: pathModelBounds(updated),
          contours: counts.contours,
          segments: counts.segments,
        };
      }
    }
    setPathDirty(false);
    if (!origin || !snapshot) return;
    setPast((items) => [...items, { project: origin, slotIds: [snapshot!.slotId], label }].slice(-60));
    setFuture([]);
    void api
      .setPreviewPath(
        project.path,
        snapshot.slotId,
        snapshot.d,
        snapshot.bounds,
        snapshot.contours,
        snapshot.segments,
      )
      .catch((error: unknown) => onNotice(String(error), "error"));
    if (notify) onNotice("تم حفظ المسار مع الحفاظ على الرسم الأصلي والبصمة.", "ok");
  }

  function savePathEdit() {
    flushPathEdit();
  }
  const geometryRevision = useMemo(
    () => JSON.stringify(slots.map((slot) => [slot.slotId, slot.placement, slot.import?.previewPath])),
    [slots],
  );
  const previewActive = previewVisible || inspectorContext === "preview";
  const shapedHighlights = useMemo(
    () => highlightSlotGlyphs(previewData?.modes, selected?.slotId ?? null),
    [previewData, selected?.slotId],
  );
  const previewFont = previewFontPath ||
    [...project.project.builds].reverse().find((build) => build.outputPaths.ttf)?.outputPaths.ttf || "";

  const snapTargets = useMemo(
    () =>
      cullSnapTargets(
        collectSnapTargets({
          upm,
          advanceWidth: selected?.metrics.advanceWidth ?? upm * 0.6,
          leftSideBearing: selected?.metrics.leftSideBearing ?? 0,
          rightSideBearing: selected?.metrics.rightSideBearing ?? 0,
          bounds,
          scaleX: selected?.placement.scaleX ?? 1,
          scaleY: selected?.placement.scaleY ?? 1,
          placement: selected?.placement,
          metricValues: Object.fromEntries(
            METRIC_ROWS.map((row) => [row.key, metricValue(metrics, row.key)]),
          ),
          metricLocks: metrics.metricLocks,
          guides: prefs.guides,
          scope: selected?.slotId ?? "",
          visibleRange,
          majorStep: ruler.scale.major,
          divisions: ruler.scale.divisions,
        }),
        visibleRange,
      ),
    [upm, selected, bounds, metrics, prefs.guides, ruler.scale, visibleRange],
  );

  const smartCueItems = useMemo<PlacedRect[]>(
    () =>
      slots.flatMap((slot) => {
        if (!slot.import?.bounds) return [];
        const rect = {
          xMin: slot.import.bounds[0],
          yMin: slot.import.bounds[1],
          xMax: slot.import.bounds[2],
          yMax: slot.import.bounds[3],
        };
        if (!rectsIntersect(rect, visibleRange)) return [];
        return [{ id: slot.slotId, bounds: rect, placement: slot.placement }];
      }),
    [slots, visibleRange],
  );
  const smartCues = useMemo(
    () =>
      dragging && prefs.snapEnabled && !bypassed && !panMode
        ? smartGuides(
            smartCueItems,
            (item) => transformRect(item.bounds, item.placement),
            prefs.snapTolerancePx / Math.max(viewport.zoom, 1e-6),
            selected?.metrics.advanceWidth,
          )
        : [],
    [dragging, prefs.snapEnabled, prefs.snapTolerancePx, bypassed, panMode, smartCueItems, viewport.zoom, selected?.metrics.advanceWidth],
  );

  /** 120ms debounce + cancellation keeps rapid edits from queueing stale shapes. */
  useEffect(() => {
    if (!previewActive || !previewText.trim() || !previewFont) {
      setPreviewBusy(false);
      setPreviewError(previewFont ? "" : "أنشئ بناءً محلياً لتفعيل التشكيل عبر المحرك.");
      return;
    }
    setPreviewBusy(true);
    setPreviewError("");
    const timer = window.setTimeout(() => {
      void shapePreview(project, previewFont, previewText, previewMode, (jobId) => {
        previewJobRef.current = jobId;
      })
        .then((data) => {
          setPreviewData(data);
          setPreviewBusy(false);
          previewJobRef.current = null;
        })
        .catch((error: unknown) => {
          setPreviewError(error instanceof Error ? error.message : String(error));
          setPreviewBusy(false);
          previewJobRef.current = null;
        });
    }, 120);
    previewTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      previewTimerRef.current = null;
      const jobId = previewJobRef.current;
      if (jobId) {
        void api.engineCancel(jobId);
        previewJobRef.current = null;
      }
    };
  }, [previewActive, previewText, previewMode, previewFont, geometryRevision, project]);

  function patchProject(mutator: (current: Project) => Project) {
    const next = mutator(latestRef.current.project.project);
    onProject({ ...latestRef.current.project, project: next });
    return next;
  }

  function commitEdit(persist: () => Promise<unknown>, slotIds: string[] = [], label = "تعديل") {
    // `patchProject` has already applied the optimistic update via `onProject`.
    setPast((items) => [...items, { project: latestRef.current.project.project, slotIds, label }].slice(-60));
    setFuture([]);
    void persist().catch((error) => onNotice(String(error), "error"));
  }

  async function persistAll(snapshot: Project, slotIds: string[]) {
    const tasks: Array<Promise<unknown>> = [
      api.setMetrics(project.path, snapshot.metrics),
      api.setWorkspacePrefs(project.path, snapshot.workspace),
      api.setGuides(project.path, snapshot.workspace.guides),
    ];
    for (const slotId of slotIds) {
      const slot = snapshot.glyphSlots.find((item) => item.slotId === slotId);
      if (!slot) continue;
      if (slot.import?.previewPath) {
        const counts = pathModelCounts(parsePathModel(slot.import.previewPath));
        tasks.push(
          api.setPreviewPath(
            project.path,
            slot.slotId,
            slot.import.previewPath,
            slot.import.bounds,
            counts.contours,
            counts.segments,
          ),
        );
      }
      tasks.push(
        api.setPlacement(
          project.path,
          slot.slotId,
          slot.placement.x,
          slot.placement.y,
          slot.placement.scaleX,
          slot.placement.scaleY,
          slot.placement.rotation,
        ),
      );
    }
    await Promise.all(tasks);
  }

  function undo() {
    if (past.length === 0) return;
    const entry = past[past.length - 1];
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [...items, { project: latestRef.current.project.project, slotIds: entry.slotIds, label: entry.label }]);
    onProject({ ...latestRef.current.project, project: entry.project });
    void persistAll(entry.project, entry.slotIds).catch((error) => onNotice(String(error), "error"));
  }

  function redo() {
    if (future.length === 0) return;
    const entry = future[future.length - 1];
    setFuture((items) => items.slice(0, -1));
    setPast((items) => [...items, { project: latestRef.current.project.project, slotIds: entry.slotIds, label: entry.label }]);
    onProject({ ...latestRef.current.project, project: entry.project });
    void persistAll(entry.project, entry.slotIds).catch((error) => onNotice(String(error), "error"));
  }

  /** M7 — jump to a labelled point in this session's history without replaying clicks. */
  function revertToHistory(index: number) {
    const entry = past[index];
    if (!entry) return;
    const removed = past.slice(index + 1);
    const current = latestRef.current.project.project;
    setPast(past.slice(0, index + 1));
    setFuture((items) => [...removed.slice().reverse(), { project: current, slotIds: [], label: "الحالة قبل الاستعادة" }, ...items]);
    onProject({ ...latestRef.current.project, project: entry.project });
    void persistAll(entry.project, entry.slotIds).catch((error) => onNotice(String(error), "error"));
    onNotice(`تمت العودة إلى: ${entry.label}`, "ok");
  }

  function applyPlacementUpdates(updates: Array<{ id: string; placement: Placement }>) {
    if (updates.length === 0) return;
    const ids = updates.map((update) => update.id);
    patchProject((current) => ({
      ...current,
      glyphSlots: current.glyphSlots.map((slot) => {
        const update = updates.find((item) => item.id === slot.slotId);
        return update ? { ...slot, placement: update.placement } : slot;
      }),
    }));
    commitEdit(
      () =>
        Promise.all(
          updates.map((update) =>
            api.setPlacement(
              project.path,
              update.id,
              update.placement.x,
              update.placement.y,
              update.placement.scaleX,
              update.placement.scaleY,
              update.placement.rotation,
            ),
          ),
        ),
      ids,
      "تحويل التحديد",
    );
  }

  function transformSelection(
    operation: (placement: Placement, id: string) => Placement,
    ids = selectionIds,
    base?: Record<string, Placement>,
  ) {
    const updates = slots
      .filter((slot) => ids.includes(slot.slotId))
      .map((slot) => ({
        id: slot.slotId,
        placement: normalizePlacement(operation(base?.[slot.slotId] ?? { ...slot.placement }, slot.slotId)),
      }));
    applyPlacementUpdates(updates);
  }

  function moveSelection(dx: number, dy: number, ids = selectionIds, base?: Record<string, Placement>) {
    transformSelection((placement) => movePlacement(placement, dx, dy), ids, base);
  }

  function scaleSelection(factor: number, pivot: Point | null = selectionCenter) {
    if (!pivot || factor <= 0) return;
    transformSelection((placement) => scalePlacementAround(placement, pivot, factor));
  }

  function scaleAxisSelection(axis: "scaleX" | "scaleY", ratio: number) {
    const pivot = selectionCenter ?? { x: 0, y: 0 };
    if (ratio <= 0 || ratio === 1) return;
    transformSelection((placement) =>
      scalePlacementAxisAround(placement, pivot, axis === "scaleX" ? "x" : "y", ratio),
    );
  }

  function rotateSelection(degrees: number, pivot: Point | null = selectionCenter) {
    if (!pivot || degrees === 0) return;
    transformSelection((placement) => rotatePlacementAround(placement, pivot, degrees));
  }

  function flipSelection(axis: "x" | "y") {
    if (!selectionCenter) return;
    transformSelection((placement) => flipPlacement(placement, axis, selectionCenter));
  }

  function alignSelection(mode: AlignMode) {
    if (!selectionWorldBounds) return;
    applyPlacementUpdates(
      alignPlacedRects(placedRects, mode, selectionWorldBounds).map((update) => ({
        id: update.id,
        placement: normalizePlacement(update.placement),
      })),
    );
  }

  function distributeSelection(axis: "x" | "y") {
    applyPlacementUpdates(
      distributePlacedRects(placedRects, axis).map((update) => ({
        id: update.id,
        placement: normalizePlacement(update.placement),
      })),
    );
  }

  function focusSlot(slotId: string) {
    setSelectedId(slotId);
    setSelectionIds([slotId]);
  }

  function setSelectionField(field: TransformField, raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value) || !primarySelected) return;
    const old = primarySelected.placement[field];
    if (value === old) return;
    if (field === "x" || field === "y") {
      moveSelection(field === "x" ? value - old : 0, field === "y" ? value - old : 0);
    } else if (field === "scaleX" || field === "scaleY") {
      const next = Math.max(0.05, value);
      scaleAxisSelection(field, next / Math.max(0.05, old));
    } else {
      rotateSelection(value - old);
    }
  }

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
  const editorCommands: EditorCommand[] = [
    { id: "fit-drawing", label: "احتواء الرسم", description: "ملاءمة حدود الرسم داخل الكانفاس", group: "مساحة العمل", icon: "fit", shortcut: "Home", run: () => setViewport(fitViewport(upm, size.w, size.h, outlineRect)) },
    { id: "fit-em", label: "احتواء الـ Em", description: "عرض مربع الـ Em بالكامل", group: "مساحة العمل", icon: "square", shortcut: "0", run: () => setViewport(fitViewport(upm, size.w, size.h)) },
    { id: "toggle-metrics", label: "إظهار خطوط القياس", description: "تبديل خطوط القياس على الكانفاس", group: "مساحة العمل", icon: "ruler", run: () => { focusMetric("baseline"); focusInspector("slot"); } },
    { id: "toggle-compare", label: "مقارنة الأشكال", description: "إظهار أو إخفاء شريط الأشكال الأربعة", group: "مساحة العمل", icon: "stack", shortcut: "C", run: () => setCompareVisible((value) => !value) },
    { id: "fix-anchors", label: "إصلاح المراسي", description: "عرض مقترحات المراسي للخانة الحالية", group: "مساحة العمل", icon: "anchor", run: () => { focusInspector("anchor"); void loadAnchorSuggestions(); } },
    { id: "live-preview", label: "المعاينة الحيّة", description: "فتح لوحة تشكيل النص داخل مساحة العمل", group: "مساحة العمل", icon: "play", shortcut: "P", run: () => { setPreviewVisible(true); focusInspector("preview"); } },
    { id: "save-layout", label: "حفظ تخطيط مساحة العمل", description: "حفظ مواضع اللوحات محلياً", group: "مساحة العمل", icon: "save", run: saveLayout },
    { id: "restore-layout", label: "استعادة التخطيط المحفوظ", description: "استعادة تخطيط اللوحات من هذا الجهاز", group: "مساحة العمل", icon: "history", run: restoreLayout },
  ];
  useEffect(() => {
    if (!registerEditor) return;
    registerEditor({ canUndo, canRedo, undo, redo, commands: editorCommands });
    return () => registerEditor(null);
    // undo/redo read only refs and stable setters; their identity changes each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerEditor, canUndo, canRedo]);

  useEffect(() => {
    function isTyping(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true
      );
    }
    function onKey(event: KeyboardEvent) {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (isTyping(event) || modifier || event.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      const key = event.key.toLowerCase();
      if (key === "escape") {
        flushPathEdit("تحرير المسار", false);
        setSelectionIds(selectedId ? [selectedId] : []);
        setSelectedSubpathId(null);
        setSelectedNodeId(null);
        setSubpathOffset({ x: 0, y: 0 });
        return;
      }
      if (tool === "path" && selectedNodeId && key.startsWith("arrow")) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? step : key === "arrowdown" ? -step : 0;
        const handleMatch = /^(.*)-(in|out)$/.exec(selectedNodeId);
        const snapshot = applyPathModel((model) =>
          handleMatch
            ? translateHandle(model, selectedNodeId, dx, dy)
            : translateNode(model, selectedNodeId, dx, dy),
        );
        flushPathEdit("تحريك عقدة", false, snapshot ?? undefined);
        return;
      }
      if (tool === "path" && selectedSubpathId && key.startsWith("arrow")) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? step : key === "arrowdown" ? -step : 0;
        setSubpathOffset((current) => ({ x: current.x + dx, y: current.y + dy }));
        return;
      }
      if (key.startsWith("arrow") && document.activeElement === canvasRef.current) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? step : key === "arrowdown" ? -step : 0;
        if (dx !== 0 || dy !== 0) moveSelection(dx, dy);
        return;
      }
      if (key === "v" || key === "h") {
        setTool(key === "v" ? "select" : "pan");
      } else if (key === "a") {
        setAnchorsVisible((value) => !value);
      } else if (key === "g") {
        setGuidesVisible((value) => !value);
      } else if (key === "r") {
        updatePrefs({ rulersVisible: !prefs.rulersVisible });
      } else if (key === "d") {
        updatePrefs({ gridVisible: !prefs.gridVisible });
      } else if (key === "s") {
        updatePrefs({ snapEnabled: !prefs.snapEnabled });
      } else if (key === "m") {
        setMinimapVisible((value) => !value);
      } else if (key === "i") {
        setInspectorOpen((value) => !value);
      } else if (key === "p") {
        setPreviewVisible((value) => !value);
        focusInspector("preview");
      } else if (key === "c") {
        setCompareVisible((value) => !value);
      } else if (key === "o") {
        setOnionVisible((value) => !value);
      } else if (key === "b") {
        setTool((current) => (current === "path" ? "select" : "path"));
        focusInspector("path");
      } else if (key === "home") {
        event.preventDefault();
        setViewport(fitViewport(upm, size.w, size.h, outlineRect));
      } else if (key === "0") {
        event.preventDefault();
        setViewport(fitViewport(upm, size.w, size.h));
      } else if (event.key === "+" || event.key === "=") {
        setViewport((current) => zoomAt(current, stepZoom(current.zoom, 1) / current.zoom, { x: size.w / 2, y: size.h / 2 }));
      } else if (event.key === "-" || event.key === "_") {
        setViewport((current) => zoomAt(current, stepZoom(current.zoom, -1) / current.zoom, { x: size.w / 2, y: size.h / 2 }));
      } else if (event.code === "Space") {
        event.preventDefault();
        if (!spacePanRef.current) {
          spacePanRef.current = true;
          spacePrevToolRef.current = tool;
          setTool("pan");
        }
      }
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.code === "Space" && spacePanRef.current) {
        spacePanRef.current = false;
        setTool(spacePrevToolRef.current);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  function localPoint(event: { clientX: number; clientY: number }): Point {
    const rect = canvasRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }

  /** A ruler guide snaps to sibling guides first, then to the nearest ruler tick. */
  function snapGuideAt(value: number, axis: "x" | "y", excludeId: string | null = null) {
    return snapGuidePosition(
      value,
      axis,
      guideDragTargets(prefs.guides, axis, selected?.slotId ?? "", ruler.scale, visibleRange, excludeId),
      {
        enabled: prefs.snapTargets,
        tolerancePx: prefs.snapTolerancePx,
        hysteresisPx: 3,
        zoom: viewport.zoom,
        currentId: guideSnapRef.current,
      },
    );
  }

  function screenRectFor(rect: Rect) {
    const topLeft = worldToScreen({ x: rect.xMin, y: rect.yMax }, latestRef.current.viewport);
    const bottomRight = worldToScreen({ x: rect.xMax, y: rect.yMin }, latestRef.current.viewport);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }

  function patchPlacementUpdates(updates: Array<{ id: string; placement: Placement }>) {
    patchProject((current) => ({
      ...current,
      glyphSlots: current.glyphSlots.map((slot) => {
        const update = updates.find((item) => item.id === slot.slotId);
        return update ? { ...slot, placement: update.placement } : slot;
      }),
    }));
  }

  function beginDrag(state: DragState, event: ReactPointerEvent, slotIds: string[] = []) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOriginRef.current = latestRef.current.project.project;
    dragSlotIdsRef.current = slotIds;
    dragRef.current = state;
    setBypassed(event.altKey);
    setDragging(true);
  }

  function beginNodeDrag(id: string, point: Point, event: ReactPointerEvent) {
    event.stopPropagation();
    canvasRef.current?.focus({ preventScroll: true });
    setSelectedNodeId(id);
    setSubpathOffset({ x: 0, y: 0 });
    beginDrag(
      {
        kind: "node",
        nodeId: id,
        startWorld: screenToWorld(localPoint(event), latestRef.current.viewport),
        startPoint: { x: point.x, y: point.y },
      },
      event,
      latestRef.current.selected ? [latestRef.current.selected.slotId] : [],
    );
  }

  /** Coalesces high-frequency pointer updates into one render per animation frame. */
  function onPointerMove(event: ReactPointerEvent) {
    const data: PointerData = {
      clientX: event.clientX,
      clientY: event.clientY,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    };
    pendingPointerRef.current = data;
    if (typeof requestAnimationFrame !== "function") {
      processPointer(data);
      return;
    }
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingPointerRef.current;
      if (pending) processPointer(pending);
    });
  }

  function processPointer(data: PointerData) {
    const screen = localPoint(data);
    const world = screenToWorld(screen, latestRef.current.viewport);
    setPointer(world);
    const drag = dragRef.current;
    if (!drag) return;
    setBypassed(data.altKey);

    if (drag.kind === "pan") {
      setViewport({
        ...drag.startViewport,
        x: drag.startViewport.x + (screen.x - drag.startScreen.x),
        y: drag.startViewport.y + (screen.y - drag.startScreen.y),
      });
      return;
    }

    if (drag.kind === "marquee") {
      const rect = rectFromPoints(drag.startWorld, world);
      marqueeRef.current = rect;
      setMarquee(rect);
      return;
    }

    if (drag.kind === "subpath") {
      setSubpathOffset({
        x: drag.startOffset.x + world.x - drag.startWorld.x,
        y: drag.startOffset.y + world.y - drag.startWorld.y,
      });
      return;
    }

    if (drag.kind === "node") {
      let dx = world.x - drag.startWorld.x;
      let dy = world.y - drag.startWorld.y;
      if (data.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const handleMatch = /^(.*)-(in|out)$/.exec(drag.nodeId);
      const baseId = handleMatch ? handleMatch[1] : drag.nodeId;
      const currentModel = parsePathModel(latestRef.current.selected?.import?.previewPath ?? "");
      const currentNode = findNode(currentModel, baseId);
      if (!currentNode) return;
      const currentPoint = handleMatch
        ? (handleMatch[2] === "in" ? currentNode.in : currentNode.out) ?? currentNode
        : currentNode;
      const stepX = drag.startPoint.x + dx - currentPoint.x;
      const stepY = drag.startPoint.y + dy - currentPoint.y;
      applyPathModel((model) =>
        handleMatch
          ? translateHandle(model, drag.nodeId, round(stepX), round(stepY))
          : translateNode(model, drag.nodeId, round(stepX), round(stepY)),
      );
      return;
    }

    if (drag.kind === "move") {
      let dx = world.x - drag.startWorld.x;
      let dy = world.y - drag.startWorld.y;
      if (data.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const primaryId = drag.placements[drag.primaryId] ? drag.primaryId : Object.keys(drag.placements)[0];
      const primary = primaryId ? drag.placements[primaryId] : null;
      if (primary && !data.altKey && prefs.snapEnabled) {
        const result = resolveSnap(
          { x: primary.x + dx, y: primary.y + dy },
          snapTargets,
          {
            enabled: prefs.snapTargets,
            tolerancePx: prefs.snapTolerancePx,
            hysteresisPx: 3,
            zoom: latestRef.current.viewport.zoom,
            currentId: currentSnapRef.current,
          },
        );
        dx = result.point.x - primary.x;
        dy = result.point.y - primary.y;
        currentSnapRef.current = result.winnerId;
        setSnap(result.snapped ? result : null);
      } else {
        setSnap(null);
        currentSnapRef.current = null;
      }
      patchPlacementUpdates(
        Object.entries(drag.placements).map(([id, placement]) => ({
          id,
          placement: normalizePlacement(movePlacement(placement, dx, dy)),
        })),
      );
      return;
    }

    if (drag.kind === "scale") {
      const startX = drag.startWorld.x - drag.pivot.x;
      const startY = drag.startWorld.y - drag.pivot.y;
      const factorX = Math.abs(startX) > 1e-6 ? (world.x - drag.pivot.x) / startX : 1;
      const factorY = Math.abs(startY) > 1e-6 ? (world.y - drag.pivot.y) / startY : 1;
      const factor = Math.max(0.05, (Math.abs(factorX) + Math.abs(factorY)) / 2);
      patchPlacementUpdates(
        Object.entries(drag.placements).map(([id, placement]) => ({
          id,
          placement: normalizePlacement(
            drag.axis
              ? scalePlacementAxisAround(placement, drag.pivot, drag.axis, Math.max(0.05, drag.axis === "x" ? factorX : factorY))
              : scalePlacementAround(placement, drag.pivot, factor),
          ),
        })),
      );
      return;
    }

    if (drag.kind === "rotate") {
      const angle = Math.atan2(world.y - drag.center.y, world.x - drag.center.x);
      let degrees = ((angle - drag.startAngle) * 180) / Math.PI;
      if (data.shiftKey) degrees = Math.round(degrees / 15) * 15;
      patchPlacementUpdates(
        Object.entries(drag.placements).map(([id, placement]) => ({
          id,
          placement: normalizePlacement(rotatePlacementAround(placement, drag.center, degrees)),
        })),
      );
      return;
    }

    if (drag.kind === "anchor") {
      if (!selected) return;
      let target = { x: world.x, y: world.y };
      if (!data.altKey && prefs.snapEnabled) {
        const result = resolveSnap(target, [...snapTargets, ...collectAnchorSnapTargets(selected.anchors, drag.anchorId)], {
          enabled: prefs.snapTargets,
          tolerancePx: prefs.snapTolerancePx,
          hysteresisPx: 3,
          zoom: latestRef.current.viewport.zoom,
          currentId: currentSnapRef.current,
        });
        target = result.point;
        currentSnapRef.current = result.winnerId;
        setSnap(result.snapped ? result : null);
      } else {
        setSnap(null);
        currentSnapRef.current = null;
      }
      const x = round(target.x);
      const y = round(target.y);
      patchProject((current) => ({
        ...current,
        glyphSlots: current.glyphSlots.map((slot) =>
          slot.slotId === selected.slotId
            ? {
                ...slot,
                anchors: slot.anchors.map((anchor) =>
                  anchor.anchorId === drag.anchorId ? { ...anchor, x, y } : anchor,
                ),
              }
            : slot,
        ),
      }));
      return;
    }

    if (drag.kind === "guide") {
      const axis = drag.axis;
      let position = round(axis === "x" ? world.x : world.y);
      if (!data.altKey && prefs.snapEnabled) {
        const snapped = snapGuideAt(position, axis, drag.guideId);
        position = round(snapped.position);
        guideSnapRef.current = snapped.result.winnerId;
        setSnap(snapped.result.snapped ? snapped.result : null);
      } else {
        guideSnapRef.current = null;
        setSnap(null);
      }
      patchProject((current) => ({
        ...current,
        workspace: {
          ...current.workspace,
          guides: current.workspace.guides.map((guide) =>
            guide.guideId === drag.guideId ? { ...guide, positionFU: position } : guide,
          ),
        },
      }));
      return;
    }

    if (drag.kind === "metric") {
      patchProject((current) => ({
        ...current,
        metrics: setMetricValue(current.metrics, drag.key, Math.round(world.y)),
      }));
    }
  }

  function onPointerUp(event: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    if (frameRef.current !== null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      if (pendingPointerRef.current) processPointer(pendingPointerRef.current);
    }
    pendingPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (drag.kind === "marquee") {
      const rect = marqueeRef.current;
      if (rect) {
        const hits = slots
          .filter((slot) => {
            if (!slot.import?.bounds) return false;
            const placed = transformRect(
              {
                xMin: slot.import.bounds[0],
                yMin: slot.import.bounds[1],
                xMax: slot.import.bounds[2],
                yMax: slot.import.bounds[3],
              },
              slot.placement,
            );
            return rectsIntersect(rect, placed);
          })
          .map((slot) => slot.slotId);
        const nextIds = applySelectionMode(drag.baseIds, hits, drag.mode);
        setSelectionIds(nextIds);
        if (nextIds.length > 0 && !nextIds.includes(selectedId)) setSelectedId(nextIds[0]);
      }
      setMarquee(null);
      marqueeRef.current = null;
    } else if (drag.kind !== "pan" && dragOriginRef.current) {
      setPast((items) => [
        ...items,
        { project: dragOriginRef.current as Project, slotIds: dragSlotIdsRef.current, label: "تحويل بالسحب" },
      ].slice(-60));
      setFuture([]);
      const snapshot = latestRef.current.project.project;
      if (drag.kind === "move" || drag.kind === "scale" || drag.kind === "rotate") {
        const ids =
          dragSlotIdsRef.current.length > 0
            ? dragSlotIdsRef.current
            : latestRef.current.selected
              ? [latestRef.current.selected.slotId]
              : [];
        void persistAll(snapshot, ids).catch((error) => onNotice(String(error), "error"));
      } else if (drag.kind === "anchor") {
        const placed = latestRef.current.selected;
        if (placed) void saveAnchors(placed.anchors);
      } else if (drag.kind === "guide") {
        void api.setGuides(project.path, snapshot.workspace.guides).catch((error) => onNotice(String(error), "error"));
      } else if (drag.kind === "metric") {
        void api.setMetrics(project.path, snapshot.metrics).catch((error) => onNotice(String(error), "error"));
      }
    }

    dragRef.current = null;
    dragOriginRef.current = null;
    dragSlotIdsRef.current = [];
    currentSnapRef.current = null;
    guideSnapRef.current = null;
    setSnap(null);
    setDragging(false);
  }

  function addGuide(orientation: "vertical" | "horizontal", position: number) {
    const id = `guide-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const guide: Guide = {
      guideId: id,
      orientation,
      positionFU: round(position),
      scope: "project",
      locked: false,
      visible: true,
      name: orientation === "vertical" ? `دليل عمودي ${prefs.guides.length + 1}` : `دليل أفقي ${prefs.guides.length + 1}`,
    };
    patchProject((current) => ({
      ...current,
      workspace: { ...current.workspace, guides: [...current.workspace.guides, guide] },
    }));
    commitEdit(() => api.setGuides(project.path, [...prefs.guides, guide]), [], "إضافة دليل");
    onNotice("أُضيف دليل جديد؛ يمكن سحبه من القائمة أو من المسطرة", "ok");
  }

  function updateGuide(id: string, patch: Partial<Guide>) {
    const guides = prefs.guides.map((guide) => (guide.guideId === id ? { ...guide, ...patch } : guide));
    patchProject((current) => ({ ...current, workspace: { ...current.workspace, guides } }));
    commitEdit(() => api.setGuides(project.path, guides), [], "ضبط دليل");
  }

  function removeGuide(id: string) {
    const guides = prefs.guides.filter((guide) => guide.guideId !== id);
    patchProject((current) => ({ ...current, workspace: { ...current.workspace, guides } }));
    commitEdit(() => api.setGuides(project.path, guides), [], "حذف دليل");
    if (selectedGuideId === id) setSelectedGuideId(null);
  }

  /** Keyboard equivalent of dragging a guide; 1 FU, or 10 FU with Shift. */
  function onGuideKeyDown(event: ReactKeyboardEvent<SVGLineElement>, guide: Guide) {
    if (guide.locked) return;
    const step = event.shiftKey ? 10 : 1;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const delta =
        guide.orientation === "vertical"
          ? event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0
          : event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
      if (delta !== 0) updateGuide(guide.guideId, { positionFU: round(guide.positionFU + delta) });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      event.stopPropagation();
      removeGuide(guide.guideId);
    }
  }

  /** Selects the numeric control for a canvas metric line so drag always has a keyboard path. */
  function focusMetric(key: string) {
    const input = document.querySelector<HTMLInputElement>(`[data-metric-input="${key}"]`);
    input?.focus();
    input?.select();
  }

  function onMetricKeyDown(event: ReactKeyboardEvent<SVGLineElement>, key: string, locked: boolean, value: number) {
    if (locked || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 10 : 1;
    const delta = event.key === "ArrowUp" || event.key === "ArrowRight" ? step : -step;
    patchProject((current) => ({ ...current, metrics: setMetricValue(current.metrics, key, value + delta) }));
    commitEdit(() => api.setMetrics(project.path, setMetricValue(metrics, key, value + delta)), [], `قياس: ${key}`);
  }

  function updatePrefs(patch: Partial<typeof prefs>) {
    const next = { ...prefs, ...patch };
    patchProject((current) => ({ ...current, workspace: next }));
    commitEdit(() => api.setWorkspacePrefs(project.path, next), [], "تغيير إعدادات العرض");
  }

  /** M5 — shaping switches stay in the workspace and are persisted locally. */
  function toggleShaping(key: keyof typeof project.project.shaping) {
    const shaping = { ...project.project.shaping, [key]: !project.project.shaping[key] };
    patchProject((current) => ({ ...current, shaping }));
    commitEdit(() => api.setShapingOptions(project.path, shaping), [], `تشكيل: ${key}`);
  }

  /** M7 — layout is a user preference in localStorage, never a project field. */
  function layoutKey(): string {
    return `fontype:layout:${project.project.projectId}`;
  }

  function saveLayout() {
    const snapshot: LayoutSnapshot = {
      inspectorWidth, inspectorOpen, minimapVisible, anchorsVisible, guidesVisible,
      compareVisible, onionVisible, openSections,
    };
    try {
      window.localStorage.setItem(layoutKey(), JSON.stringify(snapshot));
      onNotice("تم حفظ تخطيط مساحة العمل على هذا الجهاز", "ok");
    } catch {
      onNotice("تعذّر حفظ التخطيط محلياً", "error");
    }
  }

  function restoreLayout() {
    try {
      const raw = window.localStorage.getItem(layoutKey());
      if (!raw) {
        onNotice("لا يوجد تخطيط محفوظ لهذا المشروع", "error");
        return;
      }
      const snapshot = JSON.parse(raw) as Partial<LayoutSnapshot>;
      if (typeof snapshot.inspectorWidth === "number") setInspectorWidth(snapshot.inspectorWidth);
      if (typeof snapshot.inspectorOpen === "boolean") setInspectorOpen(snapshot.inspectorOpen);
      if (typeof snapshot.minimapVisible === "boolean") setMinimapVisible(snapshot.minimapVisible);
      if (typeof snapshot.anchorsVisible === "boolean") setAnchorsVisible(snapshot.anchorsVisible);
      if (typeof snapshot.guidesVisible === "boolean") setGuidesVisible(snapshot.guidesVisible);
      if (typeof snapshot.compareVisible === "boolean") setCompareVisible(snapshot.compareVisible);
      if (typeof snapshot.onionVisible === "boolean") setOnionVisible(snapshot.onionVisible);
      if (snapshot.openSections) setOpenSections({ ...openSections, ...snapshot.openSections });
      onNotice("تم استعادة التخطيط المحفوظ", "ok");
    } catch {
      onNotice("تعذّر قراءة التخطيط المحفوظ", "error");
    }
  }

  function focusInspector(context: InspectorContext) {
    setInspectorContext(context);
    setInspectorOpen(true);
  }

  /** M6 — each validation note becomes a one-click route to its owner. */
  function fixFinding(finding: ValidationFinding) {
    const anchorCode =
      finding.code === "DUPLICATE_NAME" ||
      finding.code === "INVALID_COORDINATE" ||
      finding.code === "WRONG_CLASS" ||
      finding.code === "ROLE_MISMATCH" ||
      finding.code === "NEEDS_REVIEW" ||
      finding.code === "OUT_OF_RANGE" ||
      finding.code === "MISSING_REQUIRED";
    const fromImport = selected?.import?.findings.some(
      (item) => item.code === finding.code && item.message === finding.message,
    );
    if (anchorCode) {
      setFocusedAnchorName(finding.message.match(/«([^»]+)»/)?.[1] ?? null);
      focusInspector("anchor");
      void loadAnchorSuggestions();
      onNotice(`تم فتح المراسي لإصلاح: ${finding.code}`, "ok");
      return;
    }
    if (fromImport) {
      void importSvgIntoSlot();
      return;
    }
    focusInspector("slot");
    setOpenSections((items) => ({ ...items, metrics: true, validation: true }));
    focusMetric("baseline");
    onNotice(`تم فتح القياسات المرتبطة بـ ${finding.code}`, "ok");
  }

  function updatePlacement(patch: Partial<GlyphSlot["placement"]>) {
    if (!selected) return;
    const placement = { ...selected.placement, ...patch };
    patchProject((current) => ({
      ...current,
      glyphSlots: current.glyphSlots.map((slot) =>
        slot.slotId === selected.slotId ? { ...slot, placement } : slot,
      ),
    }));
    commitEdit(() =>
      api.setPlacement(
        project.path,
        selected.slotId,
        placement.x,
        placement.y,
        placement.scaleX,
        placement.scaleY,
        placement.rotation,
      ), [], "ضبط الخانة",
    );
  }

  function updateSelectedMetrics(patch: Partial<GlyphSlot["metrics"]>) {
    if (!selected) return;
    const value = { ...selected.metrics, ...patch };
    patchProject((current) => ({
      ...current,
      glyphSlots: current.glyphSlots.map((slot) =>
        slot.slotId === selected.slotId ? { ...slot, metrics: value } : slot,
      ),
    }));
    commitEdit(() =>
      api.setSlotMetrics(
        project.path,
        selected.slotId,
        value.advanceWidth,
        value.leftSideBearing,
        value.rightSideBearing,
      ), [], "ضبط القياسات",
    );
  }

  async function saveAnchors(anchors: Anchor[]) {
    if (!selected) return;
    try {
      const updated = await api.setAnchors(project.path, selected.slotId, anchors);
      patchProject((current) => ({
        ...current,
        glyphSlots: current.glyphSlots.map((slot) =>
          slot.slotId === updated.slotId ? updated : slot,
        ),
      }));
      setAnchorSuggestions([]);
    } catch (error) {
      onNotice(String(error), "error");
    }
  }

  async function loadAnchorSuggestions() {
    if (!selected) return;
    try {
      setAnchorSuggestions(await api.anchorSuggestions(project.path, selected.slotId));
    } catch (error) {
      onNotice(String(error), "error");
    }
  }

  async function applyAnchorSuggestions() {
    if (!selected) return;
    try {
      const updated = await api.applyAnchorPreset(project.path, selected.slotId);
      patchProject((current) => ({
        ...current,
        glyphSlots: current.glyphSlots.map((slot) =>
          slot.slotId === updated.slotId ? updated : slot,
        ),
      }));
      setAnchorSuggestions([]);
      onNotice("طُبقت المراسي المقترحة لهذه الخانة", "ok");
    } catch (error) {
      onNotice(String(error), "error");
    }
  }

  function addAnchorFromSpec(spec: AnchorSpec) {
    if (!selected || selected.anchors.some((anchor) => anchor.name === spec.name)) return;
    const anchor: Anchor = {
      anchorId: `anchor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: spec.name,
      class: spec.class,
      x: round(spec.x),
      y: round(spec.y),
      scope: selected.slotId,
      locked: false,
      geometryKey: selected.import?.contentHash ?? null,
      needsReview: false,
      reviewNote: "",
    };
    void saveAnchors([...selected.anchors, anchor]);
  }

  function updateAnchor(anchorId: string, patch: Partial<Anchor>) {
    if (!selected) return;
    void saveAnchors(
      selected.anchors.map((anchor) =>
        anchor.anchorId === anchorId
          ? { ...anchor, ...patch, needsReview: false, reviewNote: "" }
          : anchor,
      ),
    );
  }

  function removeAnchor(anchorId: string) {
    if (!selected) return;
    void saveAnchors(selected.anchors.filter((anchor) => anchor.anchorId !== anchorId));
  }

  async function importSvgIntoSlot() {
    if (!selected) {
      onNotice("اختر خانة قبل استيراد SVG.", "error");
      return;
    }
    const files = await pickSvgFiles();
    if (files.length === 0) return;
    setImporting(true);
    try {
      if (selected.import) {
        const backup = await api.backupProject(project.path);
        onNotice(`نسخة احتياطية قبل الاستبدال: ${backup}`, "ok");
      }
      const advanceWidth = selected.metrics.advanceWidth;
      const { inspection, mode, fileCount } = await inspectSvgSources(files, {
        upm,
        advanceWidth,
      });
      const updated = await api.importSvg(
        project.path,
        selected.slotId,
        inspection,
        advanceWidth,
        mode,
      );
      const current = latestRef.current.project;
      onProject({
        ...current,
        project: {
          ...current.project,
          glyphSlots: current.project.glyphSlots.map((slot) =>
            slot.slotId === updated.slotId ? updated : slot,
          ),
        },
      });
      setSelectedId(updated.slotId);
      setSelectionIds([updated.slotId]);
      onNotice(
        fileCount > 1
          ? `تم استيراد ${fileCount} أشكال في الخانة ${updated.characterName}`
          : `تم استيراد الخانة ${updated.characterName}`,
        "ok",
      );
    } catch (error) {
      onNotice(String(error), "error");
    } finally {
      setImporting(false);
    }
  }

  async function generateSource() {
    if (!project) return;
    setSourceBusy(true);
    try {
      const result = await buildFontSource(project);
      onNotice(
        `أُنشئ مصدر UFO: ${result.glyphCount ?? 0} حرف · ${result.anchorCount ?? 0} مرساة · ${result.groupCount ?? 0} مجموعة`,
        "ok",
      );
    } catch (error) {
      onNotice(`فشل إنشاء مصدر UFO: ${String(error)}`, "error");
    } finally {
      setSourceBusy(false);
    }
  }

  function placementAction(kind: "center" | "baseline" | "reference" | "reset" | "identity") {
    if (!selected) return;
    if (kind === "reset") {
      setViewport(fitViewport(upm, size.w, size.h, outlineRect));
      return;
    }
    if (kind === "identity") {
      updatePlacement({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });
      return;
    }
    if (!bounds) return;
    const [xMin, yMin, xMax, yMax] = bounds;
    const width = xMax - xMin;
    const height = yMax - yMin;
    if (kind === "center") {
      const outlineWidth = width * selected.placement.scaleX;
      updatePlacement({ x: round((selected.metrics.advanceWidth - outlineWidth) / 2 - xMin * selected.placement.scaleX) });
    } else if (kind === "baseline") {
      updatePlacement({ y: round(-yMin * selected.placement.scaleY) });
    } else {
      const reference = metrics.arabicBodyHeight ?? metrics.ascender * 0.7;
      const scale = height > 0 ? reference / height : 1;
      updatePlacement({ scaleY: round(scale, 3), scaleX: round(scale, 3) });
    }
  }

  const minor = ruler.scale.minor;
  const showMinor = minor * viewport.zoom >= 6;

  const metricLines = metricLayers(metrics);
  const slotMetricLines = sideBearingLayers(selected);

  function artworkTransformFor(slot: GlyphSlot): string {
    const placement = slot.placement;
    return `translate(${viewport.x + placement.x * viewport.zoom} ${viewport.y - placement.y * viewport.zoom}) rotate(${-placement.rotation}) scale(${viewport.zoom * placement.scaleX} ${-viewport.zoom * placement.scaleY})`;
  }

  const MINI_W = 124;
  const MINI_H = 84;
  const miniRange = {
    xMin: -upm * 0.3,
    xMax: upm * 1.3,
    yMin: -upm * 0.6,
    yMax: upm * 1.2,
  };
  function miniPoint(point: Point): Point {
    return {
      x: ((point.x - miniRange.xMin) / (miniRange.xMax - miniRange.xMin)) * MINI_W,
      y: ((miniRange.yMax - point.y) / (miniRange.yMax - miniRange.yMin)) * MINI_H,
    };
  }
  function miniRect(rect: Rect) {
    const topLeft = miniPoint({ x: rect.xMin, y: rect.yMax });
    const bottomRight = miniPoint({ x: rect.xMax, y: rect.yMin });
    return { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
  }
  const miniViewportRect = (() => {
    const rect = miniRect(visibleRange);
    const x = Math.max(0, Math.min(MINI_W, rect.x));
    const y = Math.max(0, Math.min(MINI_H, rect.y));
    return {
      x,
      y,
      width: Math.max(1, Math.min(MINI_W - x, rect.width)),
      height: Math.max(1, Math.min(MINI_H - y, rect.height)),
    };
  })();
  function panFromMinimap(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const x = ((event.clientX - bounds.left) / bounds.width) * MINI_W;
    const y = ((event.clientY - bounds.top) / bounds.height) * MINI_H;
    const world = {
      x: miniRange.xMin + (x / MINI_W) * (miniRange.xMax - miniRange.xMin),
      y: miniRange.yMax - (y / MINI_H) * (miniRange.yMax - miniRange.yMin),
    };
    setViewport((current) => ({
      ...current,
      x: size.w / 2 - world.x * current.zoom,
      y: size.h / 2 + world.y * current.zoom,
    }));
  }

  function beginHandleDrag(handle: TransformHandle, event: ReactPointerEvent<SVGRectElement>) {
    event.stopPropagation();
    beginDrag(
      {
        kind: "scale",
        startWorld: screenToWorld(localPoint(event), latestRef.current.viewport),
        pivot: handle.pivot,
        placements: snapshotPlacements(slots, selectionIds),
        axis: handle.axis,
      },
      event,
      selectionIds,
    );
  }

  function beginRotateHandleDrag(event: ReactPointerEvent<SVGCircleElement>) {
    event.stopPropagation();
    if (!selectionCenter) return;
    const world = screenToWorld(localPoint(event), latestRef.current.viewport);
    beginDrag(
      {
        kind: "rotate",
        center: selectionCenter,
        startAngle: Math.atan2(world.y - selectionCenter.y, world.x - selectionCenter.x),
        placements: snapshotPlacements(slots, selectionIds),
      },
      event,
      selectionIds,
    );
  }

  const slotAnchors = anchorsVisible ? (selected?.anchors ?? []) : [];
  const anchorPairs = useMemo(() => compatiblePairs(slotAnchors), [slotAnchors]);
  const projectAnchors = useMemo(
    () => slots.flatMap((slot) => slot.anchors),
    [slots],
  );

  function renderPreviewControls() {
    return (
      <>
        <label className="preview-text">
          <span>نص الاختبار</span>
          <input
            value={previewText}
            dir="auto"
            onChange={(event) => setPreviewText(event.target.value)}
            aria-label="نص الاختبار للمعاينة العربية"
          />
        </label>
        <div className="button-row wrap" role="group" aria-label="نمط المعاينة">
          {[
            ["character", "حرفاً بحرفاً"],
            ["word", "كلمة بكلمة"],
            ["paragraph", "فقرة"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={previewMode === value}
              className={previewMode === value ? "is-active" : ""}
              onClick={() => setPreviewMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="button-row wrap" role="group" aria-label="خيارات التشكيل">
          {([
            ["lamAlefLigatures", "لام ألف"],
            ["markPositioning", "العلامات"],
            ["cursivePositioning", "الوصل"],
          ] as const).map(([key, label]) => (
            <label key={key} className="preview-toggle">
              <input
                type="checkbox"
                checked={project.project.shaping[key]}
                onChange={() => toggleShaping(key)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <div className="preview-result" role="status" aria-live="polite">
          {previewBusy ? "جارٍ تحديث التشكيل…" : previewError || previewSummary(previewData?.modes)}
        </div>
        {shapedHighlights.length > 0 ? (
          <p className="hint">
            الحرف المعدّل ظاهر في الكلمة:
            <code dir="ltr">{shapedHighlights.map((glyph) => glyph.name).slice(0, 4).join(" · ")}</code>
          </p>
        ) : null}
        {!previewFont ? (
          <p className="hint">المعاينة عبر المحرك تحتاج بناءً محلياً؛ أنشئ بناءً في لوحة البناء لتفعيلها.</p>
        ) : null}
      </>
    );
  }

  return (
    <div
      className={`panel workspace-editor ${inspectorOpen ? "" : "inspector-collapsed"}`}
      style={{ "--inspector-w": inspectorOpen ? `${inspectorWidth}px` : "0px" } as CSSProperties}
    >
      <div className="ws-header">
        <span className="ws-header-tag">محرر الحروف</span>
        <span className="ws-breadcrumb" aria-label="مسار الخانة">
          <strong>{project.project.font.familyName}</strong>
          <Icon name="chevronLeft" size={12} />
          <span>{selected ? `${selected.characterName} — ${FORM_LABELS[selected.form] ?? selected.form}` : "لا توجد خانة"}</span>
        </span>
        <span className="ws-field-label">الخانة</span>
        <select
          value={selected?.slotId ?? ""}
          onChange={(event) => focusSlot(event.target.value)}
          aria-label="اختر الخانة"
          className="ws-slot-select"
        >
          {slots.map((slot) => (
            <option key={slot.slotId} value={slot.slotId}>
              {slot.characterName} — {FORM_LABELS[slot.form] ?? slot.form} {slot.originalSvg ? "●" : ""}
            </option>
          ))}
        </select>
        <StatusBadge tone={slotStatusTone(selected?.status)}>
          {selected ? SLOT_STATUS_LABELS[selected.status] ?? "غير محددة" : "لا توجد خانة"}
        </StatusBadge>
        <span className="ws-header-context" dir="ltr">{upm} UPM</span>
        <span className="ws-header-spacer" />
        <IconButton icon="undo" label="تراجع" shortcut="Ctrl+Z" disabled={past.length === 0} onClick={undo} />
        <IconButton icon="redo" label="إعادة" shortcut="Ctrl+Shift+Z" disabled={future.length === 0} onClick={redo} />
        <IconButton
          icon="sidebar"
          label={inspectorOpen ? "إخفاء المفتش وتوسيع الكانفاس" : "إظهار المفتش"}
          shortcut="I"
          active={inspectorOpen}
          onClick={() => setInspectorOpen((value) => !value)}
        />
        <ToolbarDivider />
        <button
          className="ui-button ui-button--quiet"
          onClick={() => void generateSource()}
          disabled={sourceBusy}
          title="كتابة مصدر UFO للمشروع"
        >
          <Icon name={sourceBusy ? "spinner" : "ufo"} size={15} />
          <span>{sourceBusy ? "جارٍ الكتابة…" : "مصدر UFO"}</span>
        </button>
      </div>

      <div className="ws-stage">
        <div className="ws-tool-rail" role="toolbar" aria-label="أدوات مساحة العمل">
          <span className="ws-rail-section" aria-hidden="true">تحرير</span>
          <IconButton icon="cursor" label="أداة التحديد" shortcut="V" active={tool === "select"} onClick={() => setTool("select")} />
          <IconButton icon="hand" label="أداة التحريك" shortcut="H" active={tool === "pan"} onClick={() => setTool("pan")} />
          <IconButton icon="target" label="تحرير عُقد المسار" shortcut="B" active={tool === "path"} onClick={() => { setTool((current) => (current === "path" ? "select" : "path")); focusInspector("path"); }} />
          <ToolbarDivider />
          <span className="ws-rail-section" aria-hidden="true">عرض</span>
          <IconButton icon="anchor" label="إظهار المراسي" shortcut="A" active={anchorsVisible} onClick={() => setAnchorsVisible((value) => !value)} />
          <IconButton icon="guide" label="إظهار الأدلة" shortcut="G" active={guidesVisible} onClick={() => setGuidesVisible((value) => !value)} />
          <IconButton icon="ruler" label="المساطر" shortcut="R" active={prefs.rulersVisible} onClick={() => updatePrefs({ rulersVisible: !prefs.rulersVisible })} />
          <IconButton icon="grid" label="الشبكة" shortcut="D" active={prefs.gridVisible} onClick={() => updatePrefs({ gridVisible: !prefs.gridVisible })} />
          <IconButton icon="magnet" label="الالتقاط الذكي" shortcut="S" active={prefs.snapEnabled} onClick={() => updatePrefs({ snapEnabled: !prefs.snapEnabled })} />
          <span className="ws-rail-spacer" />
          <span className="ws-rail-label">FU</span>
        </div>

        <div className="ws-canvas-area">
          <div className="ws-canvas-toolbar" role="toolbar" aria-label="أدوات العرض">
            <button
              type="button"
              className="ui-button ws-import-button"
              data-svg-import
              aria-label="استيراد SVG إلى الخانة الحالية"
              disabled={!selected || importing}
              onClick={() => void importSvgIntoSlot()}
            >
              <Icon name={importing ? "spinner" : "upload"} size={13} />
              <span>{importing ? "جارٍ الاستيراد…" : "استيراد SVG"}</span>
            </button>
            <ToolbarDivider />
            <IconButton
              icon="zoomOut"
              label="تصغير"
              shortcut="−"
              onClick={() => setViewport((current) => zoomAt(current, stepZoom(current.zoom, -1) / current.zoom, { x: size.w / 2, y: size.h / 2 }))}
            />
            <span className="zoom-readout" dir="ltr">{Math.round(viewport.zoom * 100)}%</span>
            <IconButton
              icon="zoomIn"
              label="تكبير"
              shortcut="+"
              onClick={() => setViewport((current) => zoomAt(current, stepZoom(current.zoom, 1) / current.zoom, { x: size.w / 2, y: size.h / 2 }))}
            />
            <ToolbarDivider />
            <IconButton icon="fit" label="احتواء الرسم" shortcut="Home" onClick={() => setViewport(fitViewport(upm, size.w, size.h, outlineRect))} />
            <IconButton icon="square" label="احتواء الـ Em" shortcut="0" onClick={() => setViewport(fitViewport(upm, size.w, size.h))} />
            <ToolbarDivider />
            <IconButton icon="squares" label="الخريطة المصغّرة" shortcut="M" active={minimapVisible} onClick={() => setMinimapVisible((value) => !value)} />
            <ToolbarDivider />
            <IconButton icon="stack" label="مقارنة الأشكال الأربعة" shortcut="C" active={compareVisible} onClick={() => setCompareVisible((value) => !value)} />
            <IconButton icon="copy" label="الشكل الشبحي (onion skin)" shortcut="O" active={onionVisible} onClick={() => setOnionVisible((value) => !value)} />
            <IconButton icon="play" label="المعاينة الحيّة" shortcut="P" active={previewVisible} onClick={() => { setPreviewVisible((value) => !value); focusInspector("preview"); }} />
          </div>

          <div className="canvas-view-label" aria-label="قراءات مساحة الرسم">
            <span>الموضع</span>
            <strong dir="ltr">{pointer ? `X ${round(pointer.x)} · Y ${round(pointer.y)}` : "X — · Y —"}</strong>
            <small dir="ltr">{`${Math.round(viewport.zoom * 100)}% · ${upm} FU`}</small>
            <span>تحديد: {selectionIds.length}</span>
          </div>

          {previewVisible ? (
            <div className="ws-preview-panel" role="group" aria-label="المعاينة الحيّة داخل مساحة العمل">
              <div className="ws-preview-head">
                <strong>المعاينة الحيّة</strong>
                <IconButton icon="sliders" label="خيارات المعاينة في المفتش" onClick={() => focusInspector("preview")} />
                <IconButton icon="close" label="إغلاق المعاينة" onClick={() => setPreviewVisible(false)} />
              </div>
              {renderPreviewControls()}
            </div>
          ) : null}

          {compareVisible && selected ? (
            <div className="form-compare-strip" role="group" aria-label="مقارنة أشكال الحرف الأربعة" data-form-compare>
              {formEntries.map((entry) => {
                const boundsOf = entry.slot?.import?.bounds;
                const viewBox = boundsOf
                  ? `${boundsOf[0] - 20} ${boundsOf[1] - 20} ${Math.max(1, boundsOf[2] - boundsOf[0] + 40)} ${Math.max(1, boundsOf[3] - boundsOf[1] + 40)}`
                  : "0 0 400 400";
                const active = entry.slot?.slotId === selected.slotId;
                return (
                  <button
                    key={entry.form}
                    type="button"
                    className={`form-cell ${active ? "is-active" : ""}`}
                    aria-pressed={active}
                    disabled={!entry.slot}
                    onClick={() => entry.slot && focusSlot(entry.slot.slotId)}
                    title={entry.slot ? `${entry.label} — ${entry.slot.glyphName}` : `${entry.label} — غير مستورد`}
                  >
                    <span>{entry.label}</span>
                    <svg viewBox={viewBox} aria-hidden="true" width="34" height="34">
                      {entry.slot?.import?.previewPath ? (
                        <path d={entry.slot.import.previewPath} />
                      ) : (
                        <text x="0" y="0">—</text>
                      )}
                    </svg>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="ws-metric-legend" role="group" aria-label="خطوط القياس على الكانفاس">
            {["baseline", "ascender", "descender", "arabicBodyHeight"].map((key) => {
              const row = METRIC_ROWS.find((item) => item.key === key);
              const value = metricValue(metrics, key);
              return (
                <button
                  key={key}
                  type="button"
                  data-metric-focus={key}
                  onClick={() => focusMetric(key)}
                  title={`انتقل إلى ${row?.label ?? key} في المفتش`}
                >
                  <span>{row?.label ?? key}</span>
                  <code dir="ltr">{value ?? "—"}</code>
                </button>
              );
            })}
          </div>

          <div className="canvas-transform-bar" role="group" aria-label="أدوات تحويل التحديد">
            {primarySelected ? (
              <>
                <label>X<input dir="ltr" type="number" step={1} value={round(primarySelected.placement.x)} onChange={(event) => setSelectionField("x", event.target.value)} /></label>
                <label>Y<input dir="ltr" type="number" step={1} value={round(primarySelected.placement.y)} onChange={(event) => setSelectionField("y", event.target.value)} /></label>
                <label>مقياس X<input dir="ltr" type="number" step={0.05} min={0.05} value={round(primarySelected.placement.scaleX, 3)} onChange={(event) => setSelectionField("scaleX", event.target.value)} /></label>
                <label>مقياس Y<input dir="ltr" type="number" step={0.05} min={0.05} value={round(primarySelected.placement.scaleY, 3)} onChange={(event) => setSelectionField("scaleY", event.target.value)} /></label>
                <label>دوران<input dir="ltr" type="number" step={1} value={round(primarySelected.placement.rotation, 2)} onChange={(event) => setSelectionField("rotation", event.target.value)} /></label>
              </>
            ) : (
              <span>لا يوجد رسم محدد للتحويل</span>
            )}
            <ToolbarDivider />
            <button type="button" disabled={!primarySelected} onClick={() => scaleSelection(0.9)}>−10%</button>
            <button type="button" disabled={!primarySelected} onClick={() => scaleSelection(1 / 0.9)}>+10%</button>
            <button type="button" disabled={!primarySelected} onClick={() => rotateSelection(-15)}>−15°</button>
            <button type="button" disabled={!primarySelected} onClick={() => rotateSelection(15)}>+15°</button>
            <button type="button" disabled={!primarySelected} onClick={() => flipSelection("x")}>عكس أفقي</button>
            <button type="button" disabled={!primarySelected} onClick={() => flipSelection("y")}>عكس رأسي</button>
            <ToolbarDivider />
            <button type="button" disabled={!primarySelected} onClick={() => alignSelection("left")}>حافة يسرى</button>
            <button type="button" disabled={!primarySelected} onClick={() => alignSelection("right")}>حافة يمنى</button>
            <button type="button" disabled={!primarySelected} onClick={() => alignSelection("top")}>أعلى</button>
            <button type="button" disabled={!primarySelected} onClick={() => alignSelection("bottom")}>أسفل</button>
            <button type="button" disabled={!primarySelected} onClick={() => alignSelection("centerX")}>توسيط أفقي</button>
            <button type="button" disabled={!primarySelected} onClick={() => alignSelection("centerY")}>توسيط رأسي</button>
            <button type="button" disabled={!primarySelected} onClick={() => distributeSelection("x")}>توزيع أفقي</button>
            <button type="button" disabled={!primarySelected} onClick={() => distributeSelection("y")}>توزيع رأسي</button>
          </div>

          <div className="ws-canvas-wrap" ref={wrapRef}>
          {prefs.rulersVisible ? (
            <div className="ruler-corner" title="مسطرة القياس">FU</div>
          ) : null}
          {prefs.rulersVisible ? (
            <svg
              className="ruler ruler-h"
              width={size.w}
              height={RULER_THICKNESS}
              aria-hidden="true"
              onPointerDown={(event) => {
                const world = screenToWorld(localPoint(event), viewport);
                const snapped = !event.altKey && prefs.snapEnabled
                  ? snapGuideAt(world.x, "x")
                  : null;
                const position = round(snapped?.position ?? world.x);
                if (snapped) {
                  guideSnapRef.current = snapped.result.winnerId;
                  setSnap(snapped.result.snapped ? snapped.result : null);
                } else {
                  guideSnapRef.current = null;
                  setSnap(null);
                }
                const id = `guide-x-${Date.now()}`;
                const guide: Guide = {
                  guideId: id,
                  orientation: "vertical",
                  positionFU: position,
                  scope: "project",
                  locked: false,
                  visible: true,
                  name: `دليل عمودي ${prefs.guides.length + 1}`,
                };
                beginDrag({ kind: "guide", guideId: id, axis: "x" }, event);
                setSelectedGuideId(id);
                patchProject((current) => ({
                  ...current,
                  workspace: { ...current.workspace, guides: [...current.workspace.guides, guide] },
                }));
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {xTicks.map((tick) => {
                const x = crispPixel(worldToScreen({ x: tick.value, y: 0 }, viewport).x);
                return (
                  <g key={`x-${tick.value}`}>
                    <line x1={x} y1={tick.major ? 8 : 16} x2={x} y2={RULER_THICKNESS} className={tick.major ? "tick major" : "tick"} />
                    {tick.label ? <text x={x + 3} y={11} className="tick-label">{tick.label}</text> : null}
                  </g>
                );
              })}
            </svg>
          ) : null}
          {prefs.rulersVisible ? (
            <svg
              className="ruler ruler-v"
              width={RULER_THICKNESS}
              height={size.h}
              aria-hidden="true"
              onPointerDown={(event) => {
                const world = screenToWorld(localPoint(event), viewport);
                const snapped = !event.altKey && prefs.snapEnabled
                  ? snapGuideAt(world.y, "y")
                  : null;
                const position = round(snapped?.position ?? world.y);
                if (snapped) {
                  guideSnapRef.current = snapped.result.winnerId;
                  setSnap(snapped.result.snapped ? snapped.result : null);
                } else {
                  guideSnapRef.current = null;
                  setSnap(null);
                }
                const id = `guide-y-${Date.now()}`;
                const guide: Guide = {
                  guideId: id,
                  orientation: "horizontal",
                  positionFU: position,
                  scope: "project",
                  locked: false,
                  visible: true,
                  name: `دليل أفقي ${prefs.guides.length + 1}`,
                };
                beginDrag({ kind: "guide", guideId: id, axis: "y" }, event);
                setSelectedGuideId(id);
                patchProject((current) => ({
                  ...current,
                  workspace: { ...current.workspace, guides: [...current.workspace.guides, guide] },
                }));
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {yTicks.map((tick) => {
                const y = crispPixel(worldToScreen({ x: 0, y: tick.value }, viewport).y);
                return (
                  <g key={`y-${tick.value}`}>
                    <line x1={tick.major ? 8 : 16} y1={y} x2={RULER_THICKNESS} y2={y} className={tick.major ? "tick major" : "tick"} />
                    {tick.label ? <text x={2} y={y - 3} className="tick-label">{tick.label}</text> : null}
                  </g>
                );
              })}
            </svg>
          ) : null}

          <svg
            ref={canvasRef}
            className={`ws-canvas ${panMode ? "pan-mode" : ""}`}
            width={size.w}
            height={size.h}
            viewBox={`0 0 ${size.w} ${size.h}`}
            role="group"
            tabIndex={0}
            aria-label={`مساحة رسم الخانة ${selected?.characterName ?? "غير المحددة"}، ${FORM_LABELS[selected?.form ?? ""] ?? ""}، ${upm} وحدة لكل Em. استخدم شريط الأدوات أو لوحة الخصائص لتعديل القيم رقمياً.`}
            onWheel={(event) => {
              event.preventDefault();
              setViewport((current) => zoomAt(current, Math.exp(-event.deltaY * 0.0015), localPoint(event)));
            }}
            onPointerDown={(event) => {
              canvasRef.current?.focus({ preventScroll: true });
              if (panMode || event.button !== 0) {
                beginDrag({ kind: "pan", startScreen: localPoint(event), startViewport: viewport }, event);
                return;
              }
              const mode: SelectionMode = event.shiftKey ? "add" : event.ctrlKey || event.metaKey ? "toggle" : "replace";
              beginDrag(
                { kind: "marquee", startWorld: screenToWorld(localPoint(event), viewport), mode, baseIds: selectionIds },
                event,
              );
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(event) => event.preventDefault()}
          >
            <title>مساحة رسم الخانة</title>
            <desc>
              {selected
                ? `${selected.characterName}، ${FORM_LABELS[selected.form] ?? selected.form}، العرض التقدّمي ${selected.metrics.advanceWidth} وحدة، ${selected.anchors.length} مرساة.`
                : "لا توجد خانة محددة."}
            </desc>
            <defs>
              <pattern id="canvas-dots" width="24" height="24" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.8" className="canvas-dot" />
              </pattern>
            </defs>
            <rect className="ws-background" x={0} y={0} width={size.w} height={size.h} />
            <rect
              className="em-frame"
              x={worldToScreen({ x: 0, y: upm }, viewport).x}
              y={worldToScreen({ x: 0, y: upm }, viewport).y}
              width={upm * viewport.zoom}
              height={upm * viewport.zoom}
            />

            {prefs.gridVisible ? (
              <g className="ws-grid">
                {xTicks.map((tick) => {
                  const x = worldToScreen({ x: tick.value, y: 0 }, viewport).x;
                  return (
                    <line
                      key={`gx-${tick.value}`}
                      x1={x} y1={0} x2={x} y2={size.h}
                      className={tick.major ? "grid-major" : showMinor ? "grid-minor" : "grid-hidden"}
                    />
                  );
                })}
                {yTicks.map((tick) => {
                  const y = worldToScreen({ x: 0, y: tick.value }, viewport).y;
                  return (
                    <line
                      key={`gy-${tick.value}`}
                      x1={0} y1={y} x2={size.w} y2={y}
                      className={tick.major ? "grid-major" : showMinor ? "grid-minor" : "grid-hidden"}
                    />
                  );
                })}
              </g>
            ) : null}

            {metricLines.map((line) => {
              const y = worldToScreen({ x: 0, y: line.value as number }, viewport).y;
              return (
                <g key={line.key}>
                  <line
                    data-metric-line={line.key}
                    x1={0} y1={y} x2={size.w} y2={y}
                    className={`metric-line ${line.key} ${line.locked ? "locked" : ""}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`${line.label} ${line.value} وحدة؛ الأسهم للضبط، Enter لفتح الحقل الرقمي`}
                    onDoubleClick={() => focusMetric(line.key)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        focusMetric(line.key);
                      } else onMetricKeyDown(event, line.key, line.locked, line.value);
                    }}
                    onPointerDown={(event) => {
                      if (line.locked) return;
                      event.stopPropagation();
                      beginDrag({ kind: "metric", key: line.key }, event);
                    }}
                  />
                  <text x={size.w - 8} y={y - 5} className="metric-label" textAnchor="end">
                    {line.label} {line.value}
                  </text>
                </g>
              );
            })}

            {slotMetricLines.map((line) => {
              const x = worldToScreen({ x: line.value, y: 0 }, viewport).x;
              const special = line.key.startsWith("advance:");
              return (
                <g key={line.key}>
                  <line
                    data-metric-line={line.key}
                    x1={x} y1={0} x2={x} y2={size.h}
                    className={`advance-line ${special ? "advance-boundary" : "side-bearing"}`}
                    aria-hidden="true"
                  />
                  <text x={x + 4} y={size.h - 44} className={`advance-label ${special ? "boundary" : ""}`}>
                    {line.label} · {round(line.value)}
                  </text>
                </g>
              );
            })}

            {prefs.guides.map((guide) => {
              if (!guidesVisible || !guide.visible || (guide.scope !== "project" && guide.scope !== selected?.slotId)) return null;
              if (guide.orientation === "vertical") {
                const x = worldToScreen({ x: guide.positionFU, y: 0 }, viewport).x;
                return (
                  <g key={guide.guideId}>
                    <line
                      data-guide-id={guide.guideId}
                      x1={x} y1={0} x2={x} y2={size.h}
                      className={`workspace-guide ${guide.locked ? "locked" : ""} ${selectedGuideId === guide.guideId ? "is-selected" : ""}`}
                      tabIndex={0}
                      role="button"
                      aria-label={`الدليل ${guide.name} عند ${round(guide.positionFU)} وحدة؛ الأسهم للتحريك، Delete للحذف`}
                      onFocus={() => setSelectedGuideId(guide.guideId)}
                      onKeyDown={(event) => onGuideKeyDown(event, guide)}
                      onPointerDown={(event) => {
                        if (guide.locked) return;
                        event.stopPropagation();
                        setSelectedGuideId(guide.guideId);
                        beginDrag({ kind: "guide", guideId: guide.guideId, axis: "x" }, event);
                      }}
                    />
                    <text x={x + 4} y={14} className="guide-label">{guide.name} · {round(guide.positionFU)}</text>
                  </g>
                );
              }
              const y = worldToScreen({ x: 0, y: guide.positionFU }, viewport).y;
              return (
                <g key={guide.guideId}>
                  <line
                    data-guide-id={guide.guideId}
                    x1={0} y1={y} x2={size.w} y2={y}
                    className={`workspace-guide ${guide.locked ? "locked" : ""} ${selectedGuideId === guide.guideId ? "is-selected" : ""}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`الدليل ${guide.name} عند ${round(guide.positionFU)} وحدة؛ الأسهم للتحريك، Delete للحذف`}
                    onFocus={() => setSelectedGuideId(guide.guideId)}
                    onKeyDown={(event) => onGuideKeyDown(event, guide)}
                    onPointerDown={(event) => {
                      if (guide.locked) return;
                      event.stopPropagation();
                      setSelectedGuideId(guide.guideId);
                      beginDrag({ kind: "guide", guideId: guide.guideId, axis: "y" }, event);
                    }}
                  />
                  <text x={8} y={y - 5} className="guide-label">{guide.name} · {round(guide.positionFU)}</text>
                </g>
              );
            })}

            {onionVisible && !panMode ? (
              <g className="onion-layer" aria-hidden="true">
                {[onion.previous, onion.next].flatMap((neighbour, index) =>
                  neighbour?.import?.previewPath && neighbour.slotId !== selected?.slotId
                    ? [<path
                        key={`${neighbour.slotId}-${index}`}
                        className={`onion-skin ${index === 0 ? "previous" : "next"}`}
                        d={neighbour.import.previewPath}
                        transform={artworkTransformFor(neighbour)}
                      />]
                    : [],
                )}
              </g>
            ) : null}

            {renderedSlots.length > 0 ? (
              renderedSlots.map((slot) => {
                const isSelected = selectionIds.includes(slot.slotId);
                return (
                  <path
                    key={slot.slotId}
                    d={slot.import?.previewPath ?? ""}
                    transform={artworkTransformFor(slot)}
                    className={`workspace-artwork ${isSelected ? "is-selected" : ""} ${tool === "path" ? "is-parted" : ""}`}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      canvasRef.current?.focus({ preventScroll: true });
                      const id = slot.slotId;
                      const world = screenToWorld(localPoint(event), viewport);
                      if (event.shiftKey || event.ctrlKey || event.metaKey) {
                        setSelectionIds((current) =>
                          current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
                        );
                        setSelectedId(id);
                        return;
                      }
                      const ids = isSelected ? selectionIds : [id];
                      if (!isSelected) {
                        setSelectionIds(ids);
                        setSelectedId(id);
                      } else if (selectedId !== id) {
                        setSelectedId(id);
                      }
                      beginDrag(
                        { kind: "move", startWorld: world, placements: snapshotPlacements(slots, ids), primaryId: id },
                        event,
                        ids,
                      );
                    }}
                  />
                );
              })
            ) : (
              <text x={size.w / 2} y={size.h / 2} className="canvas-empty" textAnchor="middle">
                استورد رسم SVG لهذه الخانة لعرضه على مساحة العمل
              </text>
            )}

            {tool === "path" && selected?.import?.previewPath ? (
              <g className="subpath-layer" aria-label="أقسام المسار">
                {subpaths.map((part) => {
                  const active = String(part.index) === selectedSubpathId;
                  return (
                    <path
                      key={part.index}
                      d={part.d}
                      transform={`${artworkTransformFor(selected)}${active ? ` ${subpathTransform(subpathOffset.x, -subpathOffset.y)}` : ""}`}
                      className={`subpath-outline ${active ? "is-selected" : ""}`}
                      tabIndex={0}
                      role="button"
                      aria-label={`قسم المسار ${part.index + 1}: ${part.pointCount} نقطة، ${part.curveCount} منحنى؛ الأسهم تحريك عرضي فقط`}
                      onFocus={() => setSelectedSubpathId(String(part.index))}
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        canvasRef.current?.focus({ preventScroll: true });
                        setSelectedSubpathId(String(part.index));
                        beginDrag(
                          { kind: "subpath", startWorld: screenToWorld(localPoint(event), viewport), startOffset: active ? subpathOffset : { x: 0, y: 0 } },
                          event,
                        );
                      }}
                    />
                  );
                })}
              </g>
            ) : null}

            {tool === "path" && activeContour && selected ? (
              <g
                className="bezier-node-layer"
                aria-label="عُقد بيزييه — تحرير مباشر"
                transform={artworkTransformFor(selected)}
              >
                {activeContour.nodes.map((node) => (
                  <g key={node.id}>
                    {node.in ? (
                      <g>
                        <line
                          x1={node.x} y1={node.y} x2={node.in.x} y2={node.in.y}
                          className="bezier-handle-line" pointerEvents="none"
                        />
                        <circle
                          cx={node.in.x} cy={node.in.y} r={4 / viewport.zoom}
                          className={`bezier-handle ${selectedNodeId === `${node.id}-in` ? "is-selected" : ""}`}
                          data-node-id={`${node.id}-in`}
                          tabIndex={0} role="button"
                          aria-label={`مقبض الدخول للعقدة ${node.id}: ${round(node.in.x)}، ${round(node.in.y)} فونت يونيت`}
                          onFocus={() => setSelectedNodeId(`${node.id}-in`)}
                          onPointerDown={(event) => beginNodeDrag(`${node.id}-in`, node.in!, event)}
                        />
                      </g>
                    ) : null}
                    {node.out ? (
                      <g>
                        <line
                          x1={node.x} y1={node.y} x2={node.out.x} y2={node.out.y}
                          className="bezier-handle-line" pointerEvents="none"
                        />
                        <circle
                          cx={node.out.x} cy={node.out.y} r={4 / viewport.zoom}
                          className={`bezier-handle ${selectedNodeId === `${node.id}-out` ? "is-selected" : ""}`}
                          data-node-id={`${node.id}-out`}
                          tabIndex={0} role="button"
                          aria-label={`مقبض الخروج للعقدة ${node.id}: ${round(node.out.x)}، ${round(node.out.y)} فونت يونيت`}
                          onFocus={() => setSelectedNodeId(`${node.id}-out`)}
                          onPointerDown={(event) => beginNodeDrag(`${node.id}-out`, node.out!, event)}
                        />
                      </g>
                    ) : null}
                    <circle
                      cx={node.x} cy={node.y} r={5 / viewport.zoom}
                      className={`bezier-node ${selectedNodeId === node.id ? "is-selected" : ""}`}
                      data-node-id={node.id}
                      tabIndex={0} role="button"
                      aria-label={`عقدة ${node.id}: ${round(node.x)}، ${round(node.y)} فونت يونيت`}
                      onFocus={() => setSelectedNodeId(node.id)}
                      onPointerDown={(event) => beginNodeDrag(node.id, node, event)}
                    />
                  </g>
                ))}
              </g>
            ) : null}

            {marquee ? (
              <rect
                className="ws-marquee"
                {...screenRectFor(marquee)}
                pointerEvents="none"
              />
            ) : null}

            {selectionScreenBounds && selectionWorldBounds && renderedSlots.length > 0 && !panMode ? (
              <g className="ws-transform-box" aria-hidden="true">
                <rect
                  className="ws-transform-outline"
                  x={selectionScreenBounds.x}
                  y={selectionScreenBounds.y}
                  width={selectionScreenBounds.width}
                  height={selectionScreenBounds.height}
                  pointerEvents="none"
                />
                <line
                  className="ws-transform-stem"
                  x1={selectionScreenBounds.centerX}
                  y1={selectionScreenBounds.y}
                  x2={selectionScreenBounds.centerX}
                  y2={selectionScreenBounds.y - 24}
                  pointerEvents="none"
                />
                <circle
                  className="ws-transform-rotate"
                  cx={selectionScreenBounds.centerX}
                  cy={selectionScreenBounds.y - 24}
                  r={4}
                  onPointerDown={beginRotateHandleDrag}
                />
                {transformHandles.map((handle) => (
                  <rect
                    key={handle.key}
                    className="ws-transform-handle"
                    x={handle.x - 3}
                    y={handle.y - 3}
                    width={6}
                    height={6}
                    style={{ cursor: handle.cursor }}
                    onPointerDown={(event) => beginHandleDrag(handle, event)}
                  />
                ))}
                <text className="ws-transform-count" x={selectionScreenBounds.x} y={selectionScreenBounds.y - 8}>
                  {selectionIds.length}
                </text>
              </g>
            ) : null}

            {anchorPairs.map(([first, second]) => {
              const a = worldToScreen(first, viewport);
              const b = worldToScreen(second, viewport);
              return (
                <line
                  key={`pair-${first.anchorId}-${second.anchorId}`}
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  className="anchor-connection"
                />
              );
            })}

            {slotAnchors.map((anchor) => {
              const position = worldToScreen(anchor, viewport);
              const info = anchorClassInfo(anchor.class);
              return (
                <g
                  key={anchor.anchorId}
                  className={`anchor-marker ${anchor.locked ? "locked" : ""} ${anchor.needsReview ? "review" : ""}`}
                  style={{ "--anchor-color": info.color } as CSSProperties}
                  onPointerDown={(event) => {
                    if (anchor.locked) return;
                    event.stopPropagation();
                    beginDrag({ kind: "anchor", anchorId: anchor.anchorId }, event);
                  }}
                >
                  <circle cx={position.x} cy={position.y} r={9} />
                  <text x={position.x} y={position.y + 4} className="anchor-symbol" textAnchor="middle">
                    {info.symbol}
                  </text>
                  <text x={position.x + 13} y={position.y - 6} className="anchor-name">
                    {anchor.name}
                  </text>
                  {anchor.needsReview ? (
                    <text x={position.x - 13} y={position.y - 8} className="anchor-review">!</text>
                  ) : null}
                </g>
              );
            })}

            {smartCues.length > 0 ? (
              <g className="smart-guides" aria-hidden="true">
                {smartCues.map((guide) => {
                  if (guide.axis === "x") {
                    const x = worldToScreen({ x: guide.value, y: 0 }, viewport).x;
                    const from = worldToScreen({ x: 0, y: guide.to }, viewport).y;
                    const to = worldToScreen({ x: 0, y: guide.from }, viewport).y;
                    return <line key={guide.id} x1={x} y1={from} x2={x} y2={to} />;
                  }
                  const y = worldToScreen({ x: 0, y: guide.value }, viewport).y;
                  const from = worldToScreen({ x: guide.from, y: 0 }, viewport).x;
                  const to = worldToScreen({ x: guide.to, y: 0 }, viewport).x;
                  return <line key={guide.id} x1={from} y1={y} x2={to} y2={y} />;
                })}
                {smartCues[0] ? (
                  <text className="smart-guide-label" x={12} y={size.h - 26}>
                    {smartCues[0].label} · {round(smartCues[0].value)} FU
                  </text>
                ) : null}
              </g>
            ) : null}

            {snap ? (
              <g className="snap-cues">
                {snap.active.map((target) => {
                  const value = target.lineValue ?? target.value;
                  if (target.axis === "x") {
                    const x = worldToScreen({ x: value, y: 0 }, viewport).x;
                    return <line key={target.id} x1={x} y1={0} x2={x} y2={size.h} />;
                  }
                  const y = worldToScreen({ x: 0, y: value }, viewport).y;
                  return <line key={target.id} x1={0} y1={y} x2={size.w} y2={y} />;
                })}
                {snap.active[0] ? (
                  <text className="snap-label" x={12} y={size.h - 12}>
                    {snap.active[0].label} · Δ {round(snapDistanceFU(snap, viewport.zoom))} FU
                  </text>
                ) : null}
              </g>
            ) : null}

            {bypassed && dragRef.current ? <text className="snap-bypass" x={12} y={20}>التقاط متوقف (Alt)</text> : null}
          </svg>

          {minimapVisible ? (
            <svg
              className="ws-minimap"
              width={MINI_W}
              height={MINI_H}
              viewBox={`0 0 ${MINI_W} ${MINI_H}`}
              role="img"
              aria-label="خريطة مصغّرة لمساحة الرسم؛ انقر للتنقل"
              onPointerDown={(event) => {
                event.stopPropagation();
                minimapDragRef.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                panFromMinimap(event);
              }}
              onPointerMove={(event) => {
                if (minimapDragRef.current) panFromMinimap(event);
              }}
              onPointerUp={(event) => {
                minimapDragRef.current = false;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onPointerCancel={(event) => {
                minimapDragRef.current = false;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
            >
              <title>خريطة مساحة الرسم</title>
              <rect className="mini-bg" x={0} y={0} width={MINI_W} height={MINI_H} />
              <rect
                className="mini-em"
                {...miniRect({ xMin: 0, yMin: 0, xMax: upm, yMax: upm })}
              />
              <rect
                className="mini-advance"
                {...miniRect({
                  xMin: selected?.metrics.leftSideBearing ?? 0,
                  yMin: 0,
                  xMax: (selected?.metrics.advanceWidth ?? upm * 0.6) - (selected?.metrics.rightSideBearing ?? 0),
                  yMax: upm,
                })}
              />
              {slots.flatMap((slot) => {
                if (!slot.import?.bounds || !slot.import.previewPath) return [];
                return [
                  <rect
                    key={slot.slotId}
                    className={`mini-glyph ${selectionIds.includes(slot.slotId) ? "is-selected" : ""}`}
                    {...miniRect(
                      transformRect(
                        {
                          xMin: slot.import.bounds[0],
                          yMin: slot.import.bounds[1],
                          xMax: slot.import.bounds[2],
                          yMax: slot.import.bounds[3],
                        },
                        slot.placement,
                      ),
                    )}
                  />,
                ];
              })}
              <rect className="mini-viewport" {...miniViewportRect} />
            </svg>
          ) : null}
          </div>

          <div className="ws-status-strip" role="status" aria-live="polite" aria-label="حالة مساحة الرسم">
            <span className={`status-dot ${snap ? "" : "muted"}`} />
            <span>{pointer ? `X ${round(pointer.x)} · Y ${round(pointer.y)} FU` : "X — · Y — FU"}</span>
            <ToolbarDivider />
            <span>تكبير {Math.round(viewport.zoom * 100)}%</span>
            <ToolbarDivider />
            <span>
              {snap?.active[0]
                ? `التقاط: ${snap.active[0].label} · Δ ${round(snapDistanceFU(snap, viewport.zoom))} FU`
                : prefs.snapEnabled ? "الالتقاط مفعّل" : "الالتقاط متوقف"}
            </span>
            <ToolbarDivider />
            <span>حفظ آمن</span>
            <span style={{ flex: 1 }} />
            <span className="ws-status-slot">{selected ? `${selected.characterName} — ${FORM_LABELS[selected.form] ?? selected.form} · ${selected.anchors.length} مرساة` : "لا يوجد رسم"}</span>
            <StatusBadge tone={slotStatusTone(selected?.status)}>
              {selected ? SLOT_STATUS_LABELS[selected.status] ?? "غير محددة" : "فارغ"}
            </StatusBadge>
          </div>
        </div>

        <DockResizer
          className="inspector-resizer"
          label="تغيير عرض المفتش"
          value={inspectorWidth}
          min={240}
          max={420}
          onChange={setInspectorWidth}
          reverse
        />

        <Inspector subtitle={selected ? selected.glyphName : "لا توجد خانة"}>
          <div className="inspector-contexts" role="tablist" aria-label="سياق المفتش">
            {([
              ["slot", "الخانة"],
              ["anchor", "المراسي"],
              ["path", "المسار"],
              ["preview", "المعاينة"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={inspectorContext === value}
                className={inspectorContext === value ? "is-active" : ""}
                onClick={() => setInspectorContext(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <InspectorSection
            title="الاستيراد"
            hidden={inspectorContext !== "slot"}
            icon="upload"
            open={openSections.import}
            onToggle={() => toggleSection("import")}
            badge={selected?.sourceRevisions.length ?? 0}
          >
            {selected ? (
              <>
                <div className="kv">
                  <div><span>الملف</span><code dir="ltr">{selected.originalSvg ?? "—"}</code></div>
                  <div><span>المصدر</span><code dir="ltr">{selected.import?.sourceFileName ?? "—"}</code></div>
                  <div><span>الوضع</span><code dir="ltr">{selected.import?.mode ?? "—"}</code></div>
                  <div><span>المراجعات</span><code>{selected.sourceRevisions.length}</code></div>
                  <div><span>الحدود</span><code dir="ltr">{selected.import ? selected.import.contours : 0} / {selected.import ? selected.import.segments : 0}</code></div>
                </div>
                <div className="button-row wrap">
                  <button type="button" disabled={importing} onClick={() => void importSvgIntoSlot()}>
                    {importing ? "جارٍ الاستيراد…" : selected.originalSvg ? "استبدال SVG في مساحة العمل" : "استيراد SVG في مساحة العمل"}
                  </button>
                  {onOpenInventory ? (
                    <button type="button" onClick={onOpenInventory}>خيارات المخزون</button>
                  ) : null}
                  <InfoTip tip="هوية الخانة تأتي من المشروع؛ اسم ملف SVG لا يغيّرها. الاستبدال يحتفظ بالمراسي والقياسات ويعلّم الهندسة المتغيّرة للمراجعة." />
                </div>
              </>
            ) : (
              <p className="hint">لا توجد خانة محددة.</p>
            )}
          </InspectorSection>

          <InspectorSection
            title="خصائص الخانة"
            hidden={inspectorContext === "preview"}
            icon="sliders"
            open={openSections.slot}
            onToggle={() => toggleSection("slot")}
            badge={selected?.originalSvg ? "مُستوردة" : "فارغة"}
          >
          {selected ? (
            <>
              <p className="hint">
                {selected.characterName} — {FORM_LABELS[selected.form] ?? selected.form}
                <br /><code>{selected.glyphName}</code>
              </p>
              <div className="property-grid">
                <label>X (FU)<input type="number" step={1} value={round(primarySelected?.placement.x ?? selected.placement.x)} onChange={(event) => setSelectionField("x", event.target.value)} /></label>
                <label>Y (FU)<input type="number" step={1} value={round(primarySelected?.placement.y ?? selected.placement.y)} onChange={(event) => setSelectionField("y", event.target.value)} /></label>
                <label>Scale X<input type="number" step={0.05} min={0.05} value={round(primarySelected?.placement.scaleX ?? selected.placement.scaleX, 3)} onChange={(event) => setSelectionField("scaleX", event.target.value)} /></label>
                <label>Scale Y<input type="number" step={0.05} min={0.05} value={round(primarySelected?.placement.scaleY ?? selected.placement.scaleY, 3)} onChange={(event) => setSelectionField("scaleY", event.target.value)} /></label>
                <label>Rotation°<input type="number" step={1} value={round(primarySelected?.placement.rotation ?? selected.placement.rotation, 2)} onChange={(event) => setSelectionField("rotation", event.target.value)} /></label>
              </div>
              <div className="property-grid">
                <label>Advance<input type="number" value={selected.metrics.advanceWidth} onChange={(event) => updateSelectedMetrics({ advanceWidth: Number(event.target.value) })} /></label>
                <label>LSB<input type="number" value={selected.metrics.leftSideBearing} onChange={(event) => updateSelectedMetrics({ leftSideBearing: Number(event.target.value) })} /></label>
                <label>RSB<input type="number" value={selected.metrics.rightSideBearing} onChange={(event) => updateSelectedMetrics({ rightSideBearing: Number(event.target.value) })} /></label>
              </div>
              <div className="button-row wrap">
                <button onClick={() => placementAction("center")}>توسيط في التقدّم</button>
                <button onClick={() => placementAction("baseline")}>محاذاة خط الأساس</button>
                <button onClick={() => placementAction("reference")}>ملاءمة الارتفاع المرجعي</button>
                <button onClick={() => placementAction("identity")}>إعادة التحويل</button>
                <button onClick={() => placementAction("reset")}>إعادة العرض</button>
              </div>
            </>
          ) : (
            <p className="hint">لا توجد خانة محددة.</p>
          )}
          </InspectorSection>

          <InspectorSection
            title="خطوط القياس"
            hidden={inspectorContext !== "slot"}
            icon="ruler"
            open={openSections.metrics}
            onToggle={() => toggleSection("metrics")}
            badge={METRIC_ROWS.length}
          >
          <ul className="metric-list">
            {METRIC_ROWS.map((row) => {
              const value = metricValue(metrics, row.key);
              return (
                <li key={row.key}>
                  <span>{row.label}</span>
                  <input
                    data-metric-input={row.key}
                    type="number"
                    value={value ?? ""}
                    placeholder="—"
                    onChange={(event) => {
                      const raw = event.target.value;
                      const value = raw === "" ? null : Number(raw);
                      patchProject((current) => ({ ...current, metrics: setMetricValue(current.metrics, row.key, value) }));
                      commitEdit(() => api.setMetrics(project.path, setMetricValue(metrics, row.key, value)), [], `قياس: ${row.label}`);
                    }}
                  />
                  <IconButton
                    icon={metrics.metricLocks[row.key] ? "lock" : "unlock"}
                    label={metrics.metricLocks[row.key] ? "فتح القفل" : "قفل"}
                    onClick={() => {
                      const locked = !metrics.metricLocks[row.key];
                      patchProject((current) => ({
                        ...current,
                        metrics: { ...current.metrics, metricLocks: { ...current.metrics.metricLocks, [row.key]: locked } },
                      }));
                      commitEdit(() => api.setMetrics(project.path, { ...metrics, metricLocks: { ...metrics.metricLocks, [row.key]: locked } }), [], `${locked ? "قفل" : "فتح"} ${row.label}`);
                    }}
                  />
                  <IconButton
                    icon={metrics.metricVisibility[row.key] !== false ? "eye" : "eyeOff"}
                    label={metrics.metricVisibility[row.key] !== false ? "إخفاء" : "إظهار"}
                    onClick={() => {
                      const visible = metrics.metricVisibility[row.key] === false;
                      patchProject((current) => ({
                        ...current,
                        metrics: { ...current.metrics, metricVisibility: { ...current.metrics.metricVisibility, [row.key]: visible } },
                      }));
                      commitEdit(() => api.setMetrics(project.path, { ...metrics, metricVisibility: { ...metrics.metricVisibility, [row.key]: visible } }), [], `${visible ? "إظهار" : "إخفاء"} ${row.label}`);
                    }}
                  />
                </li>
              );
            })}
          </ul>
          </InspectorSection>

          <InspectorSection
            title="المراسي"
            hidden={inspectorContext === "preview" || inspectorContext === "path"}
            icon="anchor"
            open={openSections.anchors}
            onToggle={() => toggleSection("anchors")}
            badge={selected?.anchors.length ?? 0}
            tone={selected?.anchors.some((anchor) => anchor.needsReview) ? "warning" : "neutral"}
          >
          <div className="button-row wrap">
            <button onClick={() => void loadAnchorSuggestions()}>إظهار المقترحات</button>
            <button onClick={() => void applyAnchorSuggestions()}>تطبيق المقترحات</button>
            <InfoTip tip="المراسي نقاط وصل مسمّاة بوحدات الخط. اسحب المقبض على اللوحة أو اضبط الإحداثيات رقمياً؛ يظهر رمز متوافق للحركات ووصل الحروف." />
          </div>
          {anchorSuggestions.length > 0 ? (
            <ul className="anchor-suggestions">
              {anchorSuggestions.map((spec) => (
                <li key={spec.name}>
                  <span className="anchor-chip" title={spec.reason}>
                    {anchorClassInfo(spec.class).symbol} {spec.name}
                  </span>
                  <span className="hint">{spec.required ? "مطلوبة" : "اختيارية"}</span>
                  <IconButton
                    icon="add"
                    label={`إضافة ${spec.name}`}
                    disabled={slotAnchors.some((anchor) => anchor.name === spec.name)}
                    onClick={() => addAnchorFromSpec(spec)}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {slotAnchors.length === 0 ? (
            <p className="hint">لا توجد مراساة في هذه الخانة. طبّق المقترحات أو أضف مرساة يدوياً.</p>
          ) : (
            <ul className="anchor-list">
              {slotAnchors.map((anchor) => {
                const info = anchorClassInfo(anchor.class);
                const review = anchorReviewLabel(anchor);
                return (
                  <li key={anchor.anchorId} className={`${anchor.needsReview ? "review" : ""} ${anchor.name === focusedAnchorName ? "is-target" : ""}`}>
                    <div className="anchor-row">
                      <input
                        className="anchor-name-input"
                        value={anchor.name}
                        onChange={(event) => updateAnchor(anchor.anchorId, { name: event.target.value })}
                        aria-label="اسم المرساة"
                      />
                      <select
                        className="anchor-class"
                        value={anchor.class}
                        onChange={(event) => updateAnchor(anchor.anchorId, { class: event.target.value })}
                        aria-label="صنف المرساة"
                      >
                        {Object.entries(ANCHOR_CLASSES).map(([value, option]) => (
                          <option key={value} value={value}>{option.symbol} {option.label}</option>
                        ))}
                      </select>
                      <IconButton
                        icon={anchor.locked ? "lock" : "unlock"}
                        label={anchor.locked ? "فتح القفل" : "قفل"}
                        onClick={() => updateAnchor(anchor.anchorId, { locked: !anchor.locked })}
                      />
                      <IconButton icon="trash" label="حذف" tone="danger" onClick={() => removeAnchor(anchor.anchorId)} />
                    </div>
                    <div className="anchor-row numeric">
                      <label>X<input type="number" value={round(anchor.x)} onChange={(event) => updateAnchor(anchor.anchorId, { x: Number(event.target.value) })} /></label>
                      <label>Y<input type="number" value={round(anchor.y)} onChange={(event) => updateAnchor(anchor.anchorId, { y: Number(event.target.value) })} /></label>
                      <span className="anchor-symbol" style={{ color: info.color }}>{info.symbol}</span>
                      <span className="anchor-match" title="مراسات متوافقة في المشروع"><Icon name="stack" size={11} /> {compatibilityCount(anchor, projectAnchors)}</span>
                    </div>
                    {review ? (
                      <div className="anchor-review-note">
                        <span>{review}</span>
                        <button onClick={() => updateAnchor(anchor.anchorId, { needsReview: false, reviewNote: "" })}>تمت المراجعة</button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          </InspectorSection>

          <InspectorSection
            title="الأدلة"
            hidden={inspectorContext !== "slot"}
            icon="guide"
            open={openSections.guides}
            onToggle={() => toggleSection("guides")}
            badge={prefs.guides.length}
          >
          <div className="button-row wrap">
            <button onClick={() => addGuide("vertical", 0)}><Icon name="add" size={13} /> دليل عمودي</button>
            <button onClick={() => addGuide("horizontal", 0)}><Icon name="add" size={13} /> دليل أفقي</button>
            <InfoTip tip="اسحب من المسطرة أو أضف دليلاً رقمياً." />
          </div>
          {prefs.guides.length === 0 ? null : (
            <ul className="guide-list">
              {prefs.guides.map((guide) => (
                <li key={guide.guideId}>
                  <input
                    className="guide-name"
                    value={guide.name}
                    onChange={(event) => updateGuide(guide.guideId, { name: event.target.value })}
                    aria-label="اسم الدليل"
                  />
                  <input
                    className="guide-position"
                    type="number"
                    value={round(guide.positionFU)}
                    onChange={(event) => updateGuide(guide.guideId, { positionFU: Number(event.target.value) })}
                    aria-label="موضع الدليل"
                  />
                  <select
                    value={guide.scope}
                    onChange={(event) => updateGuide(guide.guideId, { scope: event.target.value })}
                    aria-label="نطاق الدليل"
                  >
                    <option value="project">كل المشروع</option>
                    {selected ? <option value={selected.slotId}>{selected.characterName}</option> : null}
                  </select>
                  <IconButton icon={guide.locked ? "lock" : "unlock"} label={guide.locked ? "فتح القفل" : "قفل"} onClick={() => updateGuide(guide.guideId, { locked: !guide.locked })} />
                  <IconButton icon={guide.visible ? "eye" : "eyeOff"} label={guide.visible ? "إخفاء" : "إظهار"} onClick={() => updateGuide(guide.guideId, { visible: !guide.visible })} />
                  <IconButton icon="trash" label="حذف" tone="danger" onClick={() => removeGuide(guide.guideId)} />
                </li>
              ))}
            </ul>
          )}
          </InspectorSection>

          <InspectorSection
            title="الشبكة والالتقاط"
            hidden={inspectorContext !== "slot"}
            icon="magnet"
            open={openSections.snap}
            onToggle={() => toggleSection("snap")}
          >
          <div className="property-grid">
            <label>الخطوة الكبرى<input type="number" min={10} value={prefs.gridMajorStep} onChange={(event) => updatePrefs({ gridMajorStep: Math.max(10, Number(event.target.value)) })} /></label>
            <label>التقسيمات<input type="number" min={1} max={10} value={prefs.gridMinorDivisions} onChange={(event) => updatePrefs({ gridMinorDivisions: Math.min(10, Math.max(1, Number(event.target.value))) })} /></label>
          </div>
          <label>تحمّل الالتقاط (بكسل): {prefs.snapTolerancePx}</label>
          <input
            type="range"
            min={2}
            max={24}
            value={prefs.snapTolerancePx}
            onChange={(event) => updatePrefs({ snapTolerancePx: Number(event.target.value) })}
          />
          <ul className="snap-options">
            {SNAP_GROUPS.map((group) => (
              <li key={group.key}>
                <label>
                  <input
                    type="checkbox"
                    checked={prefs.snapTargets[group.key] !== false}
                    onChange={() => updatePrefs({ snapTargets: { ...prefs.snapTargets, [group.key]: !(prefs.snapTargets[group.key] !== false) } })}
                  />
                  {group.label}
                </label>
              </li>
            ))}
          </ul>
          <InfoTip tip="Alt لتعطيل الالتقاط مؤقتاً · Shift لتقييد الحركة على محور واحد." />
          </InspectorSection>

          <InspectorSection
            title="التحقق"
            icon="listChecks"
            open={openSections.validation}
            onToggle={() => toggleSection("validation")}
            badge={(selected?.validation.length ?? 0) + (selected?.import?.findings.length ?? 0)}
            tone={selected?.validation.some((finding) => finding.severity === "error") ? "danger" : "neutral"}
          >
            {[
              ...(selected?.import?.findings ?? []),
              ...(selected?.validation ?? []),
            ].length === 0 ? (
              <p className="hint">لا توجد ملاحظات تحقق على هذه الخانة.</p>
            ) : (
              <ul className="finding-list">
                {[
                  ...(selected?.import?.findings ?? []),
                  ...(selected?.validation ?? []),
                ].map((finding, index) => (
                  <li key={`${finding.code}-${index}`} className={finding.severity}>
                    <strong>{finding.code}</strong>
                    <span>{finding.message}</span>
                    {finding.hint ? <small>{finding.hint}</small> : null}
                    <button type="button" className="fix-finding" onClick={() => fixFinding(finding)}>
                      إصلح الآن
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </InspectorSection>

          <InspectorSection
            title="المسار الفرعي"
            icon="target"
            open={openSections.path}
            onToggle={() => toggleSection("path")}
            hidden={inspectorContext !== "path"}
            badge={subpaths.length}
          >
            <p className="hint">
              تقسيم عرضي، وتحرير عُقد بيزييه مباشرة. يُكتب حقل `previewPath` الحالي فقط؛ الرسم الأصلي
              والبصمة والمراجعات تبقى كما هي.
            </p>
            {subpaths.length === 0 ? (
              <p className="hint">لا يوجد مسار مستورد لهذه الخانة.</p>
            ) : (
              <ul className="subpath-list">
                {subpaths.map((part) => (
                  <li key={part.index}>
                    <button
                      type="button"
                      className={String(part.index) === selectedSubpathId ? "is-active" : ""}
                      aria-pressed={String(part.index) === selectedSubpathId}
                      onClick={() => {
                        setSelectedSubpathId(String(part.index));
                        setTool("path");
                        setSubpathOffset({ x: 0, y: 0 });
                      }}
                    >
                      قسم {part.index + 1}
                    </button>
                    <span>{part.pointCount} نقطة · {part.curveCount} منحنى</span>
                    <code>{part.closed ? "مغلق" : "مفتوح"}</code>
                  </li>
                ))}
              </ul>
            )}
            {selectedSubpath ? (
              <div className="property-grid">
                <label>إزاحة X (FU)<input type="number" value={round(subpathOffset.x)} onChange={(event) => setSubpathOffset((offset) => ({ ...offset, x: Number(event.target.value) }))} /></label>
                <label>إزاحة Y (FU)<input type="number" value={round(subpathOffset.y)} onChange={(event) => setSubpathOffset((offset) => ({ ...offset, y: Number(event.target.value) }))} /></label>
              </div>
            ) : null}
            {activeContour ? (
              <div className="node-editor">
                <div className="node-editor-head">
                  <strong>عُقد القسم {Number(activeContour.id.slice(1)) + 1}</strong>
                  <span>{activeContour.nodes.length} عقدة</span>
                </div>
                <div className="node-chips" role="group" aria-label="اختيار العقدة">
                  {activeContour.nodes.map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      className={selectedNodeId === node.id ? "is-active" : ""}
                      aria-pressed={selectedNodeId === node.id}
                      onClick={() => {
                        setSelectedNodeId(node.id);
                        setSubpathOffset({ x: 0, y: 0 });
                      }}
                    >
                      {node.id.replace(/^c\d+-n/, "")}
                    </button>
                  ))}
                </div>
                {selectedNode ? (
                  <div className="property-grid">
                    <label>
                      X (FU)
                      <input
                        type="number"
                        value={round(selectedNode.x)}
                        onChange={(event) => {
                          const dx = Number(event.target.value) - selectedNode.x;
                          applyPathModel((model) => translateNode(model, selectedNode.id, dx, 0));
                          setPathDirty(true);
                        }}
                      />
                    </label>
                    <label>
                      Y (FU)
                      <input
                        type="number"
                        value={round(selectedNode.y)}
                        onChange={(event) => {
                          const dy = Number(event.target.value) - selectedNode.y;
                          applyPathModel((model) => translateNode(model, selectedNode.id, 0, dy));
                          setPathDirty(true);
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  <p className="hint">اختر عقدة من الكانفاس أو من القائمة لتحرير إحداثياتها ومقابضها.</p>
                )}
                <div className="button-row wrap">
                  <button
                    type="button"
                    disabled={activeContour.nodes.length < 2}
                    onClick={() => {
                      applyPathModel((model) => reverseContour(model, activeContour.id));
                      setPathDirty(true);
                    }}
                  >
                    عكس الاتجاه
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      applyPathModel((model) => simplifyPath(model, 0.5));
                      setPathDirty(true);
                    }}
                  >
                    تبسيط المسار
                  </button>
                  <button type="button" className="primary" disabled={!pathDirty} onClick={() => savePathEdit()}>
                    حفظ المسار
                  </button>
                </div>
                {pathDirty ? <p className="hint" role="status">هناك تعديلات غير محفوظة على المسار.</p> : null}
              </div>
            ) : null}
          </InspectorSection>

          <InspectorSection
            title="المعاينة الحيّة"
            icon="play"
            open={openSections.preview}
            onToggle={() => toggleSection("preview")}
            hidden={inspectorContext !== "preview"}
            badge={previewBusy ? "..." : "جاهزة"}
          >
            {renderPreviewControls()}
          </InspectorSection>

          <InspectorSection
            title="التخطيط"
            icon="squares"
            hidden={inspectorContext !== "slot"}
            open={openSections.layout}
            onToggle={() => toggleSection("layout")}
          >
            <div className="button-row wrap">
              <button type="button" onClick={saveLayout}>حفظ التخطيط</button>
              <button type="button" onClick={restoreLayout}>استعادة التخطيط</button>
              <InfoTip tip="يُحفظ التخطيط في متصفحك فقط، ولا يُضاف إلى ملف المشروع." />
            </div>
          </InspectorSection>

          <InspectorSection
            title="السجل"
            icon="history"
            open={openSections.history}
            onToggle={() => toggleSection("history")}
            badge={past.length}
          >
            <div className="button-row wrap">
              <button type="button" disabled={!canUndo} onClick={undo}>تراجع</button>
              <button type="button" disabled={!canRedo} onClick={redo}>إعادة</button>
            </div>
            {past.length > 0 ? (
              <ul className="history-list">
                {past.map((entry, index) => (
                  <li key={`${index}-${entry.label}`}>
                    <span>{index + 1}. {entry.label}</span>
                    <button type="button" onClick={() => revertToHistory(index)}>العودة إلى هنا</button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="hint">آخر الحفظ: {new Date(project.project.updatedAt).toLocaleString("ar")} · {past.length} خطوة قابلة للتراجع.</p>
          </InspectorSection>
        </Inspector>
      </div>
    </div>
  );
}
