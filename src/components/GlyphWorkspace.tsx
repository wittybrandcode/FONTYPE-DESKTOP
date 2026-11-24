import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { api, buildFontSource } from "../core/api";
import {
  ANCHOR_CLASSES,
  anchorClassInfo,
  anchorReviewLabel,
  collectAnchorSnapTargets,
  compatiblePairs,
  compatibilityCount,
} from "../core/anchors";
import type { Anchor, AnchorSpec, GlyphSlot, GlobalMetrics, Guide, Project, ProjectHandle } from "../core/types";
import { Icon } from "../ui/icons";
import {
  AccordionSection,
  IconButton,
  StatusChip,
  ToolbarDivider,
} from "../ui/components";
import {
  collectSnapTargets,
  findSnap,
  fitViewport,
  majorStepFor,
  rulerTicks,
  screenToWorld,
  worldToScreen,
  zoomAt,
  type Point,
  type SnapResult,
  type Viewport,
} from "../core/workspace";

interface Props {
  project: ProjectHandle;
  onProject: (handle: ProjectHandle) => void;
  onNotice: (text: string, kind?: "ok" | "error") => void;
  initialSlotId?: string | null;
}

type Tool = "select" | "pan";

type DragState =
  | { kind: "pan"; startScreen: Point; startViewport: Viewport }
  | { kind: "artwork"; startWorld: Point; start: GlyphSlot["placement"] }
  | { kind: "anchor"; anchorId: string }
  | { kind: "guide"; guideId: string }
  | { kind: "metric"; key: string };

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

export default function GlyphWorkspace({ project, onProject, onNotice, initialSlotId }: Props) {
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
    slot: true,
    anchors: true,
    guides: false,
    metrics: false,
    snap: false,
  });
  function toggleSection(key: string) {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }));
  }
  const [pointer, setPointer] = useState<Point | null>(null);
  const [snap, setSnap] = useState<SnapResult | null>(null);
  const [bypassed, setBypassed] = useState(false);
  const [past, setPast] = useState<Project[]>([]);
  const [future, setFuture] = useState<Project[]>([]);
  const [anchorSuggestions, setAnchorSuggestions] = useState<AnchorSpec[]>([]);
  const [sourceBusy, setSourceBusy] = useState(false);

  const spacePanRef = useRef(false);
  const spacePrevToolRef = useRef<Tool>("select");
  const dragRef = useRef<DragState | null>(null);
  const dragOriginRef = useRef<Project | null>(null);
  const currentSnapRef = useRef<string | null>(null);
  const latestRef = useRef({ project, viewport, size, selected });
  latestRef.current = { project, viewport, size, selected };

  useEffect(() => {
    setAnchorSuggestions([]);
  }, [selectedId]);

  useEffect(() => {
    if (!initialSlotId) return;
    if (slots.some((slot) => slot.slotId === initialSlotId)) {
      setSelectedId(initialSlotId);
    }
  }, [initialSlotId, slots]);

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

  const visibleRange = useMemo(() => {
    const topLeft = screenToWorld({ x: 0, y: 0 }, viewport);
    const bottomRight = screenToWorld({ x: size.w, y: size.h }, viewport);
    return {
      xMin: topLeft.x,
      xMax: bottomRight.x,
      yMin: bottomRight.y,
      yMax: topLeft.y,
    };
  }, [viewport, size]);

  const snapTargets = useMemo(
    () =>
      collectSnapTargets({
        upm,
        advanceWidth: selected?.metrics.advanceWidth ?? upm * 0.6,
        leftSideBearing: selected?.metrics.leftSideBearing ?? 0,
        rightSideBearing: selected?.metrics.rightSideBearing ?? 0,
        bounds,
        scaleX: selected?.placement.scaleX ?? 1,
        scaleY: selected?.placement.scaleY ?? 1,
        metricValues: Object.fromEntries(
          METRIC_ROWS.map((row) => [row.key, metricValue(metrics, row.key)]),
        ),
        metricLocks: metrics.metricLocks,
        guides: prefs.guides,
        scope: selected?.slotId ?? "",
        visibleRange,
        majorStep: prefs.gridMajorStep,
        divisions: prefs.gridMinorDivisions,
      }),
    [upm, selected, bounds, metrics, prefs.guides, prefs.gridMajorStep, prefs.gridMinorDivisions, visibleRange],
  );

  function patchProject(mutator: (current: Project) => Project) {
    const next = mutator(latestRef.current.project.project);
    onProject({ ...latestRef.current.project, project: next });
    return next;
  }

  function commitEdit(persist: () => Promise<unknown>) {
    // `patchProject` has already applied the optimistic update via `onProject`.
    setPast((items) => [...items, latestRef.current.project.project].slice(-60));
    setFuture([]);
    void persist().catch((error) => onNotice(String(error), "error"));
  }

  async function persistAll(snapshot: Project) {
    const slot = snapshot.glyphSlots.find((item) => item.slotId === selectedId);
    const tasks: Array<Promise<unknown>> = [
      api.setMetrics(project.path, snapshot.metrics),
      api.setWorkspacePrefs(project.path, snapshot.workspace),
      api.setGuides(project.path, snapshot.workspace.guides),
    ];
    if (slot) {
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
    const previous = past[past.length - 1];
    setPast((items) => items.slice(0, -1));
    setFuture((items) => [...items, latestRef.current.project.project]);
    onProject({ ...latestRef.current.project, project: previous });
    void persistAll(previous).catch((error) => onNotice(String(error), "error"));
  }

  function redo() {
    if (future.length === 0) return;
    const next = future[future.length - 1];
    setFuture((items) => items.slice(0, -1));
    setPast((items) => [...items, latestRef.current.project.project]);
    onProject({ ...latestRef.current.project, project: next });
    void persistAll(next).catch((error) => onNotice(String(error), "error"));
  }

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
      const key = event.key.toLowerCase();
      if (key === "v" || key === "h") {
        setTool(key === "v" ? "select" : "pan");
      } else if (key === "0") {
        setViewport(fitViewport(upm, size.w, size.h, outlineRect));
      } else if (event.key === "+" || event.key === "=") {
        setViewport((current) => zoomAt(current, 1.2, { x: size.w / 2, y: size.h / 2 }));
      } else if (event.key === "-" || event.key === "_") {
        setViewport((current) => zoomAt(current, 1 / 1.2, { x: size.w / 2, y: size.h / 2 }));
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

  function beginDrag(state: DragState, event: ReactPointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOriginRef.current = latestRef.current.project.project;
    dragRef.current = state;
    setBypassed(event.altKey);
  }

  function onPointerMove(event: ReactPointerEvent) {
    const screen = localPoint(event);
    const world = screenToWorld(screen, latestRef.current.viewport);
    setPointer(world);
    const drag = dragRef.current;
    if (!drag) return;
    setBypassed(event.altKey);

    if (drag.kind === "pan") {
      setViewport({
        ...drag.startViewport,
        x: drag.startViewport.x + (screen.x - drag.startScreen.x),
        y: drag.startViewport.y + (screen.y - drag.startScreen.y),
      });
      return;
    }

    if (drag.kind === "artwork") {
      if (!selected) return;
      let dx = world.x - drag.startWorld.x;
      let dy = world.y - drag.startWorld.y;
      if (event.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      let target = { x: drag.start.x + dx, y: drag.start.y + dy };
      if (event.altKey || !prefs.snapEnabled) {
        setSnap(null);
        currentSnapRef.current = null;
      } else {
        const result = findSnap(target, snapTargets, {
          enabled: prefs.snapTargets,
          tolerancePx: prefs.snapTolerancePx,
          hysteresisPx: 3,
          zoom: latestRef.current.viewport.zoom,
          currentId: currentSnapRef.current,
        });
        target = result.point;
        currentSnapRef.current = result.winnerId;
        setSnap(result.snapped ? result : null);
      }
      const x = round(target.x);
      const y = round(target.y);
      patchProject((current) => ({
        ...current,
        glyphSlots: current.glyphSlots.map((slot) =>
          slot.slotId === selected.slotId ? { ...slot, placement: { ...slot.placement, x, y } } : slot,
        ),
      }));
      return;
    }

    if (drag.kind === "anchor") {
      if (!selected) return;
      let target = { x: world.x, y: world.y };
      if (!event.altKey && prefs.snapEnabled) {
        const result = findSnap(target, [...snapTargets, ...collectAnchorSnapTargets(selected.anchors, drag.anchorId)], {
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
      const guide = latestRef.current.project.project.workspace.guides.find(
        (item) => item.guideId === drag.guideId,
      );
      const position = round(guide?.orientation === "vertical" ? world.x : world.y);
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
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.kind !== "pan" && dragOriginRef.current) {
      setPast((items) => [...items, dragOriginRef.current as Project].slice(-60));
      setFuture([]);
      const snapshot = latestRef.current.project.project;
      const placed = latestRef.current.selected;
      if (drag.kind === "artwork" && placed) {
        void api
          .setPlacement(
            project.path,
            placed.slotId,
            placed.placement.x,
            placed.placement.y,
            placed.placement.scaleX,
            placed.placement.scaleY,
            placed.placement.rotation,
          )
          .catch((error) => onNotice(String(error), "error"));
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
    currentSnapRef.current = null;
    setSnap(null);
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
    commitEdit(() => api.setGuides(project.path, [...prefs.guides, guide]));
    onNotice("أُضيف دليل جديد؛ يمكن سحبه من القائمة أو من المسطرة", "ok");
  }

  function updateGuide(id: string, patch: Partial<Guide>) {
    const guides = prefs.guides.map((guide) => (guide.guideId === id ? { ...guide, ...patch } : guide));
    patchProject((current) => ({ ...current, workspace: { ...current.workspace, guides } }));
    commitEdit(() => api.setGuides(project.path, guides));
  }

  function removeGuide(id: string) {
    const guides = prefs.guides.filter((guide) => guide.guideId !== id);
    patchProject((current) => ({ ...current, workspace: { ...current.workspace, guides } }));
    commitEdit(() => api.setGuides(project.path, guides));
  }

  function updatePrefs(patch: Partial<typeof prefs>) {
    const next = { ...prefs, ...patch };
    patchProject((current) => ({ ...current, workspace: next }));
    commitEdit(() => api.setWorkspacePrefs(project.path, next));
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
      ),
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
      ),
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

  const major = majorStepFor(viewport.zoom);
  const xTicks = rulerTicks(visibleRange.xMin, visibleRange.xMax, major, prefs.gridMinorDivisions);
  const yMajor = majorStepFor(viewport.zoom);
  const yTicks = rulerTicks(visibleRange.yMin, visibleRange.yMax, yMajor, prefs.gridMinorDivisions);
  const minor = major / Math.max(1, prefs.gridMinorDivisions);
  const showMinor = minor * viewport.zoom >= 6;

  const metricLines = METRIC_ROWS.map((row) => ({
    ...row,
    value: metricValue(metrics, row.key),
    visible: metrics.metricVisibility[row.key] !== false,
    locked: metrics.metricLocks[row.key] === true,
  })).filter((row) => row.visible && row.value !== null && row.value !== undefined);

  const placedPath = selected?.import?.previewPath ?? "";
  const artworkTransform = selected
    ? `translate(${viewport.x + selected.placement.x * viewport.zoom} ${viewport.y - selected.placement.y * viewport.zoom}) rotate(${-selected.placement.rotation}) scale(${viewport.zoom * selected.placement.scaleX} ${-viewport.zoom * selected.placement.scaleY})`
    : "";
  const slotAnchors = anchorsVisible ? (selected?.anchors ?? []) : [];
  const anchorPairs = useMemo(() => compatiblePairs(slotAnchors), [slotAnchors]);
  const projectAnchors = useMemo(
    () => slots.flatMap((slot) => slot.anchors),
    [slots],
  );

  return (
    <div className="panel workspace-editor">
      <div className="ws-header">
        <span className="ws-header-tag">محرر الحروف</span>
        <Icon name="target" size={17} />
        <span className="ws-field-label">الخانة</span>
        <select
          value={selected?.slotId ?? ""}
          onChange={(event) => setSelectedId(event.target.value)}
          aria-label="اختر الخانة"
          className="ws-slot-select"
        >
          {slots.map((slot) => (
            <option key={slot.slotId} value={slot.slotId}>
              {slot.characterName} — {FORM_LABELS[slot.form] ?? slot.form} {slot.originalSvg ? "●" : ""}
            </option>
          ))}
        </select>
        <StatusChip tone={selected?.originalSvg ? "accent" : "neutral"} icon={selected?.originalSvg ? "check" : "info"}>
          {selected ? (FORM_LABELS[selected.form] ?? selected.form) : "لا توجد خانة"}
        </StatusChip>
        <span className="ws-header-context" dir="ltr">{upm} UPM</span>
        <span className="ws-header-spacer" />
        <IconButton icon="undo" label="تراجع" shortcut="Ctrl+Z" disabled={past.length === 0} onClick={undo} />
        <IconButton icon="redo" label="إعادة" shortcut="Ctrl+Shift+Z" disabled={future.length === 0} onClick={redo} />
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
          <IconButton icon="cursor" label="أداة التحديد" shortcut="V" active={tool === "select"} onClick={() => setTool("select")} />
          <IconButton icon="hand" label="أداة التحريك" shortcut="H" active={tool === "pan"} onClick={() => setTool("pan")} />
          <ToolbarDivider />
          <IconButton icon="anchor" label="إظهار المراسي" active={anchorsVisible} onClick={() => setAnchorsVisible((value) => !value)} />
          <IconButton icon="guide" label="إظهار الأدلة" active={guidesVisible} onClick={() => setGuidesVisible((value) => !value)} />
          <IconButton icon="ruler" label="المساطر" active={prefs.rulersVisible} onClick={() => updatePrefs({ rulersVisible: !prefs.rulersVisible })} />
          <IconButton icon="grid" label="الشبكة" active={prefs.gridVisible} onClick={() => updatePrefs({ gridVisible: !prefs.gridVisible })} />
          <IconButton icon="magnet" label="الالتقاط الذكي" active={prefs.snapEnabled} onClick={() => updatePrefs({ snapEnabled: !prefs.snapEnabled })} />
          <span className="ws-rail-spacer" />
          <span className="ws-rail-label">FU</span>
        </div>

        <div className="ws-canvas-area">
          <div className="ws-canvas-toolbar" role="toolbar" aria-label="أدوات العرض">
            <IconButton
              icon="zoomOut"
              label="تصغير"
              shortcut="−"
              onClick={() => setViewport((current) => zoomAt(current, 1 / 1.2, { x: size.w / 2, y: size.h / 2 }))}
            />
            <span className="zoom-readout">{Math.round(viewport.zoom * 100)}%</span>
            <IconButton
              icon="zoomIn"
              label="تكبير"
              shortcut="+"
              onClick={() => setViewport((current) => zoomAt(current, 1.2, { x: size.w / 2, y: size.h / 2 }))}
            />
            <ToolbarDivider />
            <IconButton icon="fit" label="احتواء الرسم" shortcut="0" onClick={() => setViewport(fitViewport(upm, size.w, size.h, outlineRect))} />
            <IconButton icon="square" label="احتواء الـ Em" onClick={() => setViewport(fitViewport(upm, size.w, size.h))} />
          </div>

          <div className="canvas-view-label" aria-hidden="true">
            <span>لوحة الرسم</span>
            <strong>{selected?.glyphName ?? "—"}</strong>
            <small>EM {upm}</small>
          </div>

          <div className="ws-canvas-wrap" ref={wrapRef}>
          {prefs.rulersVisible ? (
            <div className="ruler-corner" title="مسطرة القياس">FU</div>
          ) : null}
          {prefs.rulersVisible ? (
            <svg
              className="ruler ruler-h"
              width={size.w}
              height={24}
              onPointerDown={(event) => {
                const world = screenToWorld(localPoint(event), viewport);
                const id = `guide-x-${Date.now()}`;
                const guide: Guide = {
                  guideId: id,
                  orientation: "vertical",
                  positionFU: round(world.x),
                  scope: "project",
                  locked: false,
                  visible: true,
                  name: `دليل عمودي ${prefs.guides.length + 1}`,
                };
                beginDrag({ kind: "guide", guideId: id }, event);
                patchProject((current) => ({
                  ...current,
                  workspace: { ...current.workspace, guides: [...current.workspace.guides, guide] },
                }));
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {xTicks.map((tick) => {
                const x = worldToScreen({ x: tick.value, y: 0 }, viewport).x;
                return (
                  <g key={`x-${tick.value}`}>
                    <line x1={x} y1={tick.major ? 8 : 16} x2={x} y2={24} className={tick.major ? "tick major" : "tick"} />
                    {tick.label ? <text x={x + 3} y={11} className="tick-label">{tick.label}</text> : null}
                  </g>
                );
              })}
            </svg>
          ) : null}
          {prefs.rulersVisible ? (
            <svg
              className="ruler ruler-v"
              width={24}
              height={size.h}
              onPointerDown={(event) => {
                const world = screenToWorld(localPoint(event), viewport);
                const id = `guide-y-${Date.now()}`;
                const guide: Guide = {
                  guideId: id,
                  orientation: "horizontal",
                  positionFU: round(world.y),
                  scope: "project",
                  locked: false,
                  visible: true,
                  name: `دليل أفقي ${prefs.guides.length + 1}`,
                };
                beginDrag({ kind: "guide", guideId: id }, event);
                patchProject((current) => ({
                  ...current,
                  workspace: { ...current.workspace, guides: [...current.workspace.guides, guide] },
                }));
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {yTicks.map((tick) => {
                const y = worldToScreen({ x: 0, y: tick.value }, viewport).y;
                return (
                  <g key={`y-${tick.value}`}>
                    <line x1={tick.major ? 8 : 16} y1={y} x2={24} y2={y} className={tick.major ? "tick major" : "tick"} />
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
            onWheel={(event) => {
              event.preventDefault();
              setViewport((current) => zoomAt(current, Math.exp(-event.deltaY * 0.0015), localPoint(event)));
            }}
            onPointerDown={(event) => {
              if (event.button === 0 && !panMode) return;
              beginDrag({ kind: "pan", startScreen: localPoint(event), startViewport: viewport }, event);
            }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onContextMenu={(event) => event.preventDefault()}
          >
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
                    x1={0} y1={y} x2={size.w} y2={y}
                    className={`metric-line ${line.key} ${line.locked ? "locked" : ""}`}
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

            {prefs.guides.map((guide) => {
              if (!guidesVisible || !guide.visible || (guide.scope !== "project" && guide.scope !== selected?.slotId)) return null;
              if (guide.orientation === "vertical") {
                const x = worldToScreen({ x: guide.positionFU, y: 0 }, viewport).x;
                return (
                  <g key={guide.guideId}>
                    <line
                      x1={x} y1={0} x2={x} y2={size.h}
                      className={`workspace-guide ${guide.locked ? "locked" : ""}`}
                      onPointerDown={(event) => {
                        if (guide.locked) return;
                        event.stopPropagation();
                        beginDrag({ kind: "guide", guideId: guide.guideId }, event);
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
                    x1={0} y1={y} x2={size.w} y2={y}
                    className={`workspace-guide ${guide.locked ? "locked" : ""}`}
                    onPointerDown={(event) => {
                      if (guide.locked) return;
                      event.stopPropagation();
                      beginDrag({ kind: "guide", guideId: guide.guideId }, event);
                    }}
                  />
                  <text x={8} y={y - 5} className="guide-label">{guide.name} · {round(guide.positionFU)}</text>
                </g>
              );
            })}

            {placedPath && selected ? (
              <path
                d={placedPath}
                transform={artworkTransform}
                className="workspace-artwork"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  beginDrag(
                    { kind: "artwork", startWorld: screenToWorld(localPoint(event), viewport), start: selected.placement },
                    event,
                  );
                }}
              />
            ) : (
              <text x={size.w / 2} y={size.h / 2} className="canvas-empty" textAnchor="middle">
                استورد رسم SVG لهذه الخانة لعرضه على مساحة العمل
              </text>
            )}

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
                    {snap.active[0].label} · {round(snap.distancePx)}px
                  </text>
                ) : null}
              </g>
            ) : null}

            {bypassed && dragRef.current ? <text className="snap-bypass" x={12} y={20}>التقاط متوقف (Alt)</text> : null}
          </svg>
          </div>

          <div className="ws-status-strip">
            <span className={`status-dot ${snap ? "" : "muted"}`} />
            <span>{pointer ? `X ${round(pointer.x)} · Y ${round(pointer.y)} FU` : "X — · Y — FU"}</span>
            <ToolbarDivider />
            <span>{Math.round(viewport.zoom * 100)}%</span>
            <ToolbarDivider />
            <span>{snap?.active[0] ? `التقاط: ${snap.active[0].label}` : prefs.snapEnabled ? "الالتقاط مفعّل" : "الالتقاط متوقف"}</span>
            <span style={{ flex: 1 }} />
            <span>{selected ? `${selected.characterName} — ${FORM_LABELS[selected.form] ?? selected.form}` : "لا يوجد رسم"}</span>
          </div>
        </div>

        <aside className="ws-properties">
          <AccordionSection
            title="خصائص الخانة"
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
                <label>X (FU)<input type="number" step={1} value={round(selected.placement.x)} onChange={(event) => updatePlacement({ x: Number(event.target.value) })} /></label>
                <label>Y (FU)<input type="number" step={1} value={round(selected.placement.y)} onChange={(event) => updatePlacement({ y: Number(event.target.value) })} /></label>
                <label>Scale X<input type="number" step={0.05} min={0.05} value={round(selected.placement.scaleX, 3)} onChange={(event) => updatePlacement({ scaleX: Math.max(0.05, Number(event.target.value)) })} /></label>
                <label>Scale Y<input type="number" step={0.05} min={0.05} value={round(selected.placement.scaleY, 3)} onChange={(event) => updatePlacement({ scaleY: Math.max(0.05, Number(event.target.value)) })} /></label>
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
          </AccordionSection>

          <AccordionSection
            title="المراسي"
            icon="anchor"
            open={openSections.anchors}
            onToggle={() => toggleSection("anchors")}
            badge={selected?.anchors.length ?? 0}
            tone={selected?.anchors.some((anchor) => anchor.needsReview) ? "warning" : "neutral"}
          >
          <p className="hint">
            المراسي نقاط وصل مُسمّاة بوحدات الخط. اسحب المقبض على اللوحة أو اضبط الإحداثيات رقمياً؛
            يظهر رمز متوافق للحركات ووصل الحروف.
          </p>
          <div className="button-row wrap">
            <button onClick={() => void loadAnchorSuggestions()}>إظهار المقترحات</button>
            <button onClick={() => void applyAnchorSuggestions()}>تطبيق المقترحات</button>
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
                  <li key={anchor.anchorId} className={anchor.needsReview ? "review" : ""}>
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
          </AccordionSection>

          <AccordionSection
            title="الأدلة"
            icon="guide"
            open={openSections.guides}
            onToggle={() => toggleSection("guides")}
            badge={prefs.guides.length}
          >
          <div className="button-row wrap">
            <button onClick={() => addGuide("vertical", 0)}><Icon name="add" size={13} /> دليل عمودي</button>
            <button onClick={() => addGuide("horizontal", 0)}><Icon name="add" size={13} /> دليل أفقي</button>
          </div>
          {prefs.guides.length === 0 ? (
            <p className="hint">اسحب من المسطرة أو أضف دليلاً رقمياً.</p>
          ) : (
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
                  <IconButton icon={guide.locked ? "lock" : "unlock"} label={guide.locked ? "فتح القفل" : "قفل"} onClick={() => updateGuide(guide.guideId, { locked: !guide.locked })} />
                  <IconButton icon={guide.visible ? "eye" : "eyeOff"} label={guide.visible ? "إخفاء" : "إظهار"} onClick={() => updateGuide(guide.guideId, { visible: !guide.visible })} />
                  <IconButton icon="trash" label="حذف" tone="danger" onClick={() => removeGuide(guide.guideId)} />
                </li>
              ))}
            </ul>
          )}
          </AccordionSection>

          <AccordionSection
            title="خطوط القياس"
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
                    type="number"
                    value={value ?? ""}
                    placeholder="—"
                    onChange={(event) => {
                      const raw = event.target.value;
                      const value = raw === "" ? null : Number(raw);
                      patchProject((current) => ({ ...current, metrics: setMetricValue(current.metrics, row.key, value) }));
                      commitEdit(() => api.setMetrics(project.path, setMetricValue(metrics, row.key, value)));
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
                      commitEdit(() => api.setMetrics(project.path, { ...metrics, metricLocks: { ...metrics.metricLocks, [row.key]: locked } }));
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
                      commitEdit(() => api.setMetrics(project.path, { ...metrics, metricVisibility: { ...metrics.metricVisibility, [row.key]: visible } }));
                    }}
                  />
                </li>
              );
            })}
          </ul>
          </AccordionSection>

          <AccordionSection
            title="الشبكة والالتقاط"
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
          <p className="hint">Alt لتعطيل الالتقاط مؤقتاً · Shift لتقييد الحركة على محور واحد.</p>
          </AccordionSection>
        </aside>
      </div>
    </div>
  );
}
