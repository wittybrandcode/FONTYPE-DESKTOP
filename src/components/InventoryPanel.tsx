import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api } from "../core/api";
import { inspectSvgSources, pickSvgFiles } from "../core/svgImport";
import type {
  GlyphSlot,
  PresetInfo,
  ProjectHandle,
  SvgInspection,
  ValidationFinding,
} from "../core/types";
import { PanelHeader, SectionLabel } from "../ui/components";

interface Props {
  project: ProjectHandle;
  onProject: (handle: ProjectHandle) => void;
  onNotice: (text: string, kind?: "ok" | "error") => void;
}

const FORM_LABELS: Record<string, string> = {
  isolated: "مفرد",
  initial: "بدائي",
  medial: "وسيط",
  final: "نهائي",
};

const JOINING_LABELS: Record<string, string> = {
  D: "واصل من الجانبين",
  R: "واصل من اليمين",
  L: "واصل من اليسار",
  U: "غير واصل",
  T: "واصل طرفي",
};

const STATUS_LABELS: Record<string, string> = {
  empty: "فارغة",
  imported: "مُستوردة",
  "needs-review": "تحتاج مراجعة",
  error: "خطأ",
  ready: "معتمدة",
};

const MODE_LABELS: Record<string, string> = {
  fit_to_em: "ملاءمة داخل الـ Em",
  fit_to_reference_height: "ارتفاع مرجعي",
  manual_scale: "مقياس يدوي",
  preserve_size: "الحفاظ على الحجم",
};

const SEVERITY_LABELS: Record<string, string> = {
  info: "معلومة",
  warning: "تحذير",
  error: "خطأ",
};

function codePointOf(unicode: string): string {
  const match = /U\+([0-9A-Fa-f]+)/.exec(unicode);
  if (!match) return "؟";
  try {
    return String.fromCodePoint(parseInt(match[1], 16));
  } catch {
    return "؟";
  }
}

function previewViewBox(upm: number): string {
  return `${-Math.round(upm * 0.15)} ${-Math.round(upm * 1.02)} ${Math.round(upm * 1.3)} ${Math.round(upm * 1.4)}`;
}

export default function InventoryPanel({ project, onProject, onNotice }: Props) {
  const [preset, setPreset] = useState<PresetInfo | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourcePaths, setSourcePaths] = useState<string[]>([]);
  const [inspection, setInspection] = useState<SvgInspection | null>(null);
  const [inspectedSlotId, setInspectedSlotId] = useState<string | null>(null);
  const [mode, setMode] = useState("fit_to_em");
  const [fitRatio, setFitRatio] = useState(0.7);
  const [referenceHeight, setReferenceHeight] = useState(700);
  const [manualScale, setManualScale] = useState(1.4);
  const [advanceWidth, setAdvanceWidth] = useState(600);
  const [inspecting, setInspecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);

  const slots = project.project.glyphSlots;
  const upm = project.project.font.unitsPerEm;

  useEffect(() => {
    api
      .presetInfo()
      .then(setPreset)
      .catch((error) => onNotice(String(error), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return slots.filter((slot) => {
      if (groupFilter !== "all" && !slot.slotId.startsWith(`${groupFilter}.`)) return false;
      if (statusFilter !== "all" && slot.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        slot.characterName.toLowerCase().includes(needle) ||
        slot.slotId.toLowerCase().includes(needle) ||
        slot.glyphName.toLowerCase().includes(needle) ||
        slot.unicode.toLowerCase().includes(needle)
      );
    });
  }, [slots, query, groupFilter, statusFilter]);

  const selected = useMemo(
    () => slots.find((slot) => slot.slotId === selectedId) ?? filtered[0] ?? slots[0] ?? null,
    [slots, selectedId, filtered],
  );

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const slot of slots) result[slot.status] = (result[slot.status] ?? 0) + 1;
    return result;
  }, [slots]);

  function patchSlot(updated: GlyphSlot) {
    onProject({
      ...project,
      project: {
        ...project.project,
        glyphSlots: slots.map((slot) => (slot.slotId === updated.slotId ? updated : slot)),
      },
    });
  }

  async function refreshInventory() {
    try {
      const refreshed = await api.generateInventory(project.path);
      onProject({ ...project, project: { ...project.project, glyphSlots: refreshed } });
      onNotice(`المخزون جاهز: ${refreshed.length} خانة`, "ok");
    } catch (error) {
      onNotice(String(error), "error");
    }
  }

  async function inspectSources(
    paths: string[],
    slotId: string,
    overrideMode?: string,
    widthOverride?: number,
  ) {
    if (paths.length === 0) return;
    setInspecting(true);
    setPreviewError("");
    try {
      const result = await inspectSvgSources(
        paths,
        {
          upm,
          advanceWidth: widthOverride ?? advanceWidth,
          fitRatio,
          referenceHeight,
          manualScale,
        },
        overrideMode ?? mode,
      );
      setInspection(result.inspection);
      setInspectedSlotId(slotId);
      setMode(result.mode);
    } catch (error) {
      setInspection(null);
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setInspecting(false);
    }
  }

  // Load a preview automatically when selecting a slot that already has artwork.
  useEffect(() => {
    if (!selected) return;
    setAdvanceWidth(selected.metrics.advanceWidth);
    if (!selected.originalSvg) {
      setInspection(null);
      setInspectedSlotId(null);
      setSourcePaths([]);
      return;
    }
    const stored = `${project.path.replace(/\\/g, "/")}/${selected.originalSvg}`;
    if (
      inspectedSlotId === selected.slotId &&
      sourcePaths.length === 1 &&
      sourcePaths[0] === stored
    ) return;
    setSourcePaths([stored]);
    void inspectSources(
      [stored],
      selected.slotId,
      selected.import?.mode ?? "fit_to_em",
      selected.metrics.advanceWidth,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.slotId]);

  // Tauri reports dropped files in physical pixels; map them back to the element
  // under the cursor so the drop lands on the intended slot card.
  const dropHandlerRef = useRef<(paths: string[], x: number, y: number) => void>(() => {});
  dropHandlerRef.current = (paths, x, y) => {
    const svg = paths.find((path) => /\.svg$/i.test(path));
    if (!svg) {
      onNotice("أفلِت ملف SVG فقط.", "error");
      return;
    }
    const element = document.elementFromPoint(
      x / window.devicePixelRatio,
      y / window.devicePixelRatio,
    );
    const targetId =
      element?.closest<HTMLElement>("[data-slot-id]")?.dataset.slotId ??
      element?.closest<HTMLElement>("[data-slot-drop]")?.dataset.slotDrop ??
      selected?.slotId;
    if (!targetId) return;
    const targetSlot = slots.find((slot) => slot.slotId === targetId);
    setSelectedId(targetId);
    setAdvanceWidth(targetSlot?.metrics.advanceWidth ?? 600);
    setSourcePaths([svg]);
    void inspectSources([svg], targetId, undefined, targetSlot?.metrics.advanceWidth ?? 600);
  };

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | void;
    const locate = (x: number, y: number) => {
      const element = document.elementFromPoint(
        x / window.devicePixelRatio,
        y / window.devicePixelRatio,
      );
      return (
        element?.closest<HTMLElement>("[data-slot-id]")?.dataset.slotId ??
        element?.closest<HTMLElement>("[data-slot-drop]")?.dataset.slotDrop ??
        null
      );
    };
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (!alive) return;
        const payload = event.payload;
        if (payload.type === "drop") {
          setDragTargetId(null);
          dropHandlerRef.current(payload.paths, payload.position.x, payload.position.y);
        } else if (payload.type === "leave") {
          setDragTargetId(null);
        } else if (payload.type === "enter" || payload.type === "over") {
          setDragTargetId(locate(payload.position.x, payload.position.y));
        }
      })
      .then((cleanup) => {
        if (alive) unlisten = cleanup;
        else cleanup();
      })
      .catch((error) => onNotice(String(error), "error"));
    return () => {
      alive = false;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickSvg() {
    const picked = await pickSvgFiles();
    if (picked.length === 0) return;
    setSourcePaths(picked);
    await inspectSources(picked, selected?.slotId ?? "");
  }

  async function commitImport() {
    if (!selected || !inspection) return;
    setSaving(true);
    try {
      const updated = await api.importSvg(
        project.path,
        selected.slotId,
        inspection,
        advanceWidth,
        mode,
      );
      patchSlot(updated);
      onNotice(
        sourcePaths.length > 1
          ? `تم استيراد ${sourcePaths.length} أشكال في الخانة ${selected.glyphName}`
          : `تم استيراد الخانة ${selected.glyphName}`,
        "ok",
      );
    } catch (error) {
      onNotice(String(error), "error");
    } finally {
      setSaving(false);
    }
  }

  async function approve() {
    if (!selected) return;
    try {
      patchSlot(await api.approveSlot(project.path, selected.slotId));
      onNotice("تم اعتماد الخانة", "ok");
    } catch (error) {
      onNotice(String(error), "error");
    }
  }

  async function removeArtwork() {
    if (!selected) return;
    try {
      patchSlot(await api.removeArtwork(project.path, selected.slotId));
      setInspection(null);
      setInspectedSlotId(null);
      onNotice("تمت إزالة الرسم؛ احتُفظ بالنسخة السابقة قابلة للاسترداد", "ok");
    } catch (error) {
      onNotice(String(error), "error");
    }
  }

  async function saveMetrics() {
    if (!selected) return;
    try {
      patchSlot(
        await api.setSlotMetrics(
          project.path,
          selected.slotId,
          advanceWidth,
          selected.metrics.leftSideBearing,
          selected.metrics.rightSideBearing,
        ),
      );
      onNotice("تم تحديث قياس الخانة", "ok");
    } catch (error) {
      onNotice(String(error), "error");
    }
  }

  const findings: ValidationFinding[] = inspection?.findings ?? selected?.validation ?? [];
  const canCommit = Boolean(selected && inspection && inspection.ok);

  return (
    <div className="panel inventory-panel">
      <PanelHeader
        icon="grid"
        title="مخزون الخانات واستيراد SVG"
        subtitle="هوية الخانة من المشروع · اسم الملف لا يغيّر الحرف"
        actions={<button onClick={refreshInventory}>تحديث المخزون</button>}
      />

      <div className="panel-body inventory-layout">
        <div className="inventory-browser">

      {preset ? (
        <div className="preset-bar">
          <span className="phase-chip">{preset.label}</span>
          <span>Unicode {preset.unicodeVersion}</span>
          <span>{preset.totalSlots} خانة متوقعة</span>
          {preset.groups.map((group) => (
            <span key={group.id} className={group.required ? "required-chip" : ""}>
              {group.label}: {group.characterCount}
            </span>
          ))}
        </div>
      ) : null}

      <div className="count-bar">
        <span>المجموع <b>{slots.length}</b></span>
        {Object.entries(counts).map(([status, count]) => (
          <span key={status} className={`count-${status}`}>
            {STATUS_LABELS[status] ?? status}: <b>{count}</b>
          </span>
        ))}
      </div>

      <div className="filter-row">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ابحث بالحرف أو الاسم أو الرمز…"
          aria-label="بحث في الخانات"
        />
        <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} aria-label="تصفية حسب المجموعة">
          <option value="all">كل المجموعات</option>
          {preset?.groups.map((group) => (
            <option key={group.id} value={group.id}>{group.label}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="تصفية حسب الحالة">
          <option value="all">كل الحالات</option>
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {slots.length === 0 ? (
        <div className="empty-card">لا توجد خانات بعد. أنشئ مشروعاً جديداً أو حدّث المخزون.</div>
      ) : (
        <div className="inventory-grid">
          {filtered.map((slot) => (
            <button
              key={slot.slotId}
              data-slot-id={slot.slotId}
              className={`slot-card ${selected?.slotId === slot.slotId ? "selected" : ""} ${dragTargetId === slot.slotId ? "drag-target" : ""}`}
              onClick={() => setSelectedId(slot.slotId)}
            >
              <span className="slot-char">{codePointOf(slot.unicode)}</span>
              <span className="slot-names">
                <span className="slot-name">{slot.characterName}</span>
                <code className="slot-glyph">{slot.glyphName}</code>
              </span>
              <span className="slot-tags">
                <span className="form-tag">{FORM_LABELS[slot.form] ?? slot.form}</span>
                <span className={`status-badge ${slot.status}`}>{STATUS_LABELS[slot.status] ?? slot.status}</span>
              </span>
              {slot.required ? <span className="required-dot" title="خانة مطلوبة" /> : null}
            </button>
          ))}
          {filtered.length === 0 ? <p className="hint">لا توجد خانات مطابقة للبحث.</p> : null}
        </div>
      )}

        </div>

        <div className="inventory-detail-pane">
          {selected ? (
        <div
          className={`slot-detail ${dragTargetId === selected.slotId ? "drag-target" : ""}`}
          data-slot-drop={selected.slotId}
        >
          <div className="detail-head">
            <div>
              <h3>
                <span className="detail-char">{codePointOf(selected.unicode)}</span>
                {selected.characterName} — {FORM_LABELS[selected.form] ?? selected.form}
              </h3>
              <p className="hint">
                <code>{selected.slotId}</code> · <code>{selected.unicode}</code> ·{" "}
                {JOINING_LABELS[selected.joiningType] ?? selected.joiningType} ·{" "}
                {selected.required ? "مطلوبة" : "اختيارية"}
              </p>
            </div>
            <div className="button-row">
              <button onClick={pickSvg} disabled={inspecting}>
                {inspecting ? "جارٍ الفحص…" : selected.originalSvg ? "استبدال SVG" : "استيراد SVG"}
              </button>
              <button onClick={approve} disabled={!selected.originalSvg || selected.status === "ready"}>
                اعتماد
              </button>
              <button onClick={removeArtwork} disabled={!selected.originalSvg}>
                إزالة الرسم
              </button>
            </div>
          </div>

          <div className="detail-columns">
            <div className="preview-column">
              <svg
                className="glyph-preview"
                viewBox={previewViewBox(upm)}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label={`معاينة ${selected.glyphName}`}
              >
                <line className="preview-baseline" x1={-upm} y1={0} x2={upm * 1.2} y2={0} />
                <g transform="scale(1,-1)">
                  {inspection ? (
                    <path d={inspection.previewPath} fill="currentColor" />
                  ) : null}
                </g>
              </svg>
              <p className="hint preview-caption">
                {inspection
                  ? `${inspection.contours} كونتور · ${inspection.segments} مقطع · المقياس ${inspection.scale.toFixed(3)}`
                  : "لا توجد معاينة بعد."}
              </p>
            </div>

            <div className="control-column">
              <label>طريقة الاستيراد</label>
              <select
                value={mode}
                disabled={sourcePaths.length > 1}
                onChange={(event) => {
                  const next = event.target.value;
                  if (sourcePaths.length > 0) void inspectSources(sourcePaths, selected.slotId, next);
                }}
              >
                {Object.entries(MODE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              {sourcePaths.length > 1 ? (
                <p className="hint">تم دمج الملفات في رسم واحد داخل الخانة؛ تُحفظ هوية الخانة من المشروع.</p>
              ) : null}

              {mode === "fit_to_em" ? (
                <>
                  <label>نسبة الملاءمة من الـ Em: {fitRatio.toFixed(2)}</label>
                  <input
                    type="range"
                    min={0.2}
                    max={1}
                    step={0.05}
                    value={fitRatio}
                    onChange={(event) => setFitRatio(Number(event.target.value))}
                  />
                </>
              ) : null}
              {mode === "fit_to_reference_height" ? (
                <>
                  <label>الارتفاع المرجعي (FU)</label>
                  <input type="number" value={referenceHeight} onChange={(event) => setReferenceHeight(Number(event.target.value))} />
                </>
              ) : null}
              {mode === "manual_scale" ? (
                <>
                  <label>مقياس يدوي</label>
                  <input type="number" step={0.05} value={manualScale} onChange={(event) => setManualScale(Number(event.target.value))} />
                </>
              ) : null}

              <label>عرض التقدّم (Advance Width)</label>
              <input type="number" value={advanceWidth} onChange={(event) => setAdvanceWidth(Number(event.target.value))} />

              <div className="button-row">
                <button onClick={() => sourcePaths.length > 0 && void inspectSources(sourcePaths, selected.slotId)} disabled={sourcePaths.length === 0 || inspecting}>
                  إعادة الفحص
                </button>
                <button className="primary" onClick={commitImport} disabled={!canCommit || saving}>
                  {saving ? "جارٍ الحفظ…" : "حفظ في الخانة"}
                </button>
                <button onClick={saveMetrics} disabled={!selected.originalSvg}>تطبيق القياس</button>
              </div>

              {previewError ? <div className="alert error">{previewError}</div> : null}
              {sourcePaths.length > 0 ? (
                <p className="hint path">
                  المصدر: {sourcePaths.length > 1 ? `${sourcePaths.length} ملفات SVG` : sourcePaths[0]}
                </p>
              ) : null}
              {selected.sourceRevisions.length > 0 ? (
                <p className="hint">{selected.sourceRevisions.length} نسخة سابقة محفوظة قابلة للاسترداد.</p>
              ) : null}
            </div>
          </div>

          {findings.length > 0 ? (
            <div className="findings-block">
              <SectionLabel icon="warning">ملاحظات الفحص</SectionLabel>
              <ul className="finding-list">
                {findings.map((finding, index) => (
                  <li key={`${finding.code}-${index}`} className={finding.severity}>
                    <b>{SEVERITY_LABELS[finding.severity] ?? finding.severity}</b> — {finding.message}
                    {finding.hint ? <span className="hint"> {finding.hint}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
          ) : (
            <div className="result-placeholder">
              <strong>لا توجد خانة محددة</strong>
              <p>اختر خانة من المخزون لعرض المعاينة وخيارات الاستيراد.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
