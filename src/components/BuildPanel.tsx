import { useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  api,
  buildFont,
  runShapingCorpus,
  shapePreview,
  type BuildJobOptions,
} from "../core/api";
import { buildReadiness } from "../core/readiness";
import type { EngineEvent } from "../core/protocol";
import type { BuildRecord, ProjectHandle, ValidationFinding } from "../core/types";
import { EmptyState, InfoTip, PanelHeader, SectionLabel, StatusChip } from "../ui/components";
import { Icon } from "../ui/icons";

interface Props {
  project: ProjectHandle | null;
  onProject: (handle: ProjectHandle) => void;
  onNotice: (text: string, kind?: "ok" | "error") => void;
  onOpenSlot: (slotId: string) => void;
}

const CHECK_LABELS: Record<string, string> = {
  artifactsPresent: "ملفا OTF و TTF موجودان",
  tablesPresent: "جداول الخط الإلزامية موجودة",
  outlinesPresent: "المخططات و cmap صالحان",
  unitsPerEmMatches: "UPM مطابق للمشروع",
  allCodepointsMapped: "كل الرموز المستوردة مرتبطة",
  formFeaturesPresent: "ميزات الأشكال init/medi/fina مولّدة",
  positioningTablesPresent: "جداول GPOS و GDEF مولّدة",
  shapingReturnsGlyphs: "HarfBuzz أعاد حروفاً صالحة",
};

const MODE_LABELS: Record<string, string> = {
  character: "حرفاً بحرف",
  word: "كلمة بكلمة",
  paragraph: "فقرة كاملة",
};

interface PreviewGlyph {
  name: string;
  slotId: string | null;
  xAdvance: number;
}

interface PreviewSegment {
  text: string;
  names: string[];
  glyphs: PreviewGlyph[];
}

interface PreviewMode {
  mode: string;
  segments: PreviewSegment[];
  glyphs: PreviewGlyph[];
}

function linesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function findingsOf(value: unknown): ValidationFinding[] {
  if (!Array.isArray(value)) return [];
  return value as ValidationFinding[];
}

export default function BuildPanel({ project, onProject, onNotice, onOpenSlot }: Props) {
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const jobRef = useRef<string | null>(null);

  const [previewText, setPreviewText] = useState("بسب");
  const [previewMode, setPreviewMode] = useState("paragraph");
  const [preview, setPreview] = useState<PreviewMode[]>([]);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [corpus, setCorpus] = useState<Record<string, unknown> | null>(null);
  const [corpusBusy, setCorpusBusy] = useState(false);

  const readiness = useMemo(() => buildReadiness(project), [project]);
  const blockers = readiness.checks.filter((item) => !item.ok && item.severity === "blocker");

  const fontPath =
    result && typeof result.artifacts === "object" && result.artifacts !== null
      ? String((result.artifacts as Record<string, unknown>).ttf ?? "")
      : "";

  function engineEvents(): BuildJobOptions {
    return {
      onEvent: (event: EngineEvent) => {
        if (event.type === "progress") {
          setProgress(Number(event.data.value ?? 0));
          setMessage(String(event.data.message ?? ""));
        } else if (event.type === "log") {
          const fresh = linesOf(event.data.lines);
          if (fresh.length) setLogs((current) => [...current, ...fresh].slice(-80));
        }
      },
      onJob: (jobId) => {
        jobRef.current = jobId;
      },
    };
  }

  async function updateShaping(patch: Partial<ProjectHandle["project"]["shaping"]>) {
    if (!project) return;
    try {
      const shaping = await api.setShapingOptions(project.path, {
        ...project.project.shaping,
        ...patch,
      });
      onProject({
        ...project,
        project: { ...project.project, shaping },
      });
    } catch (caught) {
      onNotice(String(caught), "error");
    }
  }

  async function runBuild() {
    if (!project) return;
    setBuilding(true);
    setProgress(0);
    setMessage("بدء البناء");
    setLogs([]);
    setResult(null);
    setError("");
    setCorpus(null);
    setPreview([]);
    const buildId = `build-${Date.now()}`;
    try {
      const data = await buildFont(project, buildId, engineEvents());
      setResult(data);
      setProgress(1);
      const record: BuildRecord = {
        buildId: String(data.buildId ?? buildId),
        timestamp: new Date().toISOString(),
        appVersion: "0.6.0",
        toolchainVersions:
          (data.toolchainVersions as Record<string, string>) ?? {},
        requestedFormats: ["otf", "ttf"],
        result: data.success ? "success" : "failed",
        compilerLogPath: String(data.compilerLogPath ?? ""),
        validationReportPath: String(data.reportPath ?? ""),
        outputPaths: (data.artifacts as Record<string, string>) ?? {},
        projectHash: String(data.projectHash ?? ""),
      };
      const builds = await api.recordBuild(project.path, record);
      onProject({
        ...project,
        project: { ...project.project, builds },
      });
      onNotice(
        data.success ? "تم بناء OTF و TTF بنجاح" : "اكتمل البناء مع ملاحظات تحتاج مراجعة",
        data.success ? "ok" : "error",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      onNotice("فشل بناء الخط", "error");
    } finally {
      jobRef.current = null;
      setBuilding(false);
    }
  }

  async function cancelBuild() {
    const jobId = jobRef.current;
    if (!jobId) return;
    await api.engineCancel(jobId);
    setMessage("تم إلغاء المهمة");
  }

  async function runPreview() {
    if (!project || !fontPath) return;
    setPreviewBusy(true);
    try {
      const data = await shapePreview(project, fontPath, previewText, previewMode);
      setPreview((data.modes as PreviewMode[]) ?? []);
    } catch (caught) {
      onNotice(String(caught), "error");
    } finally {
      setPreviewBusy(false);
    }
  }

  async function runCorpus() {
    if (!project || !fontPath) return;
    setCorpusBusy(true);
    try {
      const data = await runShapingCorpus(project, fontPath);
      setCorpus(data);
    } catch (caught) {
      onNotice(String(caught), "error");
    } finally {
      setCorpusBusy(false);
    }
  }

  async function backup() {
    if (!project) return;
    try {
      const path = await api.backupProject(project.path);
      onNotice(`تم إنشاء نسخة احتياطية: ${path}`, "ok");
    } catch (caught) {
      onNotice(String(caught), "error");
    }
  }

  async function restore() {
    if (!project) return;
    try {
      const path = await open({
        directory: true,
        multiple: false,
        title: "اختر مجلد النسخة الاحتياطية",
      });
      if (typeof path !== "string") return;
      const handle = await api.restoreProject(project.path, path);
      onProject(handle);
      onNotice("تمت استعادة المشروع من النسخة المختارة", "ok");
    } catch (caught) {
      onNotice(String(caught), "error");
    }
  }

  if (!project) {
    return (
      <div className="panel build-panel">
        <PanelHeader icon="pulse" title="البناء والمعاينة" subtitle="توليد الخط وفحص التشكيل" />
        <EmptyState
          icon="pulse"
          title="لا يوجد مشروع مفتوح"
          description="افتح مشروعاً أو أنشئه لبناء OTF وTTF وتشغيل اختبارات التشكيل محلياً."
        />
      </div>
    );
  }

  const checks = (result?.checks ?? {}) as Record<string, boolean>;
  const findings = findingsOf(result?.findings);
  const artifacts = (result?.artifacts ?? {}) as Record<string, string>;
  const features = (result?.features ?? {}) as Record<string, unknown>;
  const totals = (corpus?.totals ?? {}) as Record<string, number>;
  const corpusResults = Array.isArray(corpus?.results)
    ? (corpus.results as Array<Record<string, unknown>>)
    : [];

  return (
    <div className="panel build-panel">
      <PanelHeader
        icon="pulse"
        title="البناء والمعاينة"
        subtitle="UFOmaker Arabic ← OTF/TTF ← فحص الجداول والتشكيل"
        actions={<StatusChip tone="info" icon="shield">محلي</StatusChip>}
      />

      <div className="panel-body build-layout">
        <div className="build-controls">
          <SectionLabel icon="sliders">إعدادات التشكيل</SectionLabel>
      <div className="toggle-list">
        <label>
          <input
            type="checkbox"
            checked={project.project.shaping.lamAlefLigatures}
            onChange={(event) => void updateShaping({ lamAlefLigatures: event.target.checked })}
          />
          وصلات لام ألف عند توفر رسومها
        </label>
        <label>
          <input
            type="checkbox"
            checked={project.project.shaping.markPositioning}
            onChange={(event) => void updateShaping({ markPositioning: event.target.checked })}
          />
          تموضع الحركات من المراسي
        </label>
        <label>
          <input
            type="checkbox"
            checked={project.project.shaping.cursivePositioning}
            onChange={(event) => void updateShaping({ cursivePositioning: event.target.checked })}
          />
          الوصل الحركي من مراسي الدخول والخروج
        </label>
      </div>

      {blockers.length > 0 ? (
        <div className="readiness-gate" role="status">
          <div className="readiness-gate-head">
            <Icon name="warning" size={14} />
            <strong>{readiness.summary}</strong>
            <InfoTip tip="بوابة الجاهزية تمنع بناءً ينتج خطاً ناقصاً. الفحوص مشتقة من بيانات المشروع الحالية فقط، بلا حقول جديدة." />
          </div>
          <ul>
            {blockers.slice(0, 4).map((item) => {
              const targetSlot = item.slotId ?? project?.project.glyphSlots[0]?.slotId;
              return (
                <li key={item.id}>
                  {targetSlot ? (
                    <button type="button" className="has-tip" data-tip={item.detail} aria-describedby={`blocker-${item.id}`} onClick={() => onOpenSlot(targetSlot)}>
                      <span id={`blocker-${item.id}`} className="sr-only">{item.detail}</span>
                      {item.label}
                    </button>
                  ) : (
                    <span className="has-tip" data-tip={item.detail} aria-describedby={`blocker-${item.id}`}>
                      <span id={`blocker-${item.id}`} className="sr-only">{item.detail}</span>
                      {item.label}
                    </span>
                  )}
                </li>
              );
            })}
            {blockers.length > 4 ? <li><span>و{blockers.length - 4} عوائق أخرى</span></li> : null}
          </ul>
        </div>
      ) : null}

      <div className="button-row wrap">
        <button className="primary" onClick={() => void runBuild()} disabled={building || !readiness.canBuild}>
          {building ? "جارٍ البناء…" : "بناء OTF + TTF"}
        </button>
        <button onClick={() => void cancelBuild()} disabled={!building}>
          إلغاء
        </button>
        <button onClick={() => void backup()}>نسخة احتياطية</button>
        <button onClick={() => void restore()}>استعادة نسخة</button>
      </div>

      {(building || result || error) && (
        <div className="progress-block">
          <div className="progress-track"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div className="progress-label">{message}</div>
        </div>
      )}
      {error ? <div className="alert error">{error}</div> : null}

      {result ? (
        <div className="result-block">
          <div className={`status-badge ${result.success ? "ok" : "error"}`}>
            {result.success ? "البناء ناجح" : "البناء يحتاج مراجعة"}
          </div>

          <h3>الفحوص</h3>
          <ul className="check-list">
            {Object.entries(checks).map(([key, value]) => (
              <li key={key} className={value ? "pass" : "fail"}>
                <span>{value ? "✓" : "✕"}</span>
                {CHECK_LABELS[key] ?? key}
              </li>
            ))}
          </ul>

          {Array.isArray(features.features) ? (
            <p className="hint">ميزات مولّدة: <code>{(features.features as string[]).join(" ")}</code></p>
          ) : null}

          {findings.length > 0 ? (
            <>
              <h3>التقرير</h3>
              <ul className="finding-list">
                {findings.map((finding, index) => (
                  <li key={`${finding.code}-${index}`} className={finding.severity}>
                    <span>{finding.message}</span>
                    {finding.hint ? <small>{finding.hint}</small> : null}
                    {finding.slotId ? (
                      <button
                        className="link-button"
                        onClick={() => onOpenSlot(finding.slotId)}
                      >
                        اذهب للخانة
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <h3>الملفات الناتجة</h3>
          <ul className="tool-list">
            {Object.entries(artifacts).map(([format, path]) => (
              <li key={format}><span>{format.toUpperCase()}</span><code className="path">{path}</code></li>
            ))}
            <li><span>تقرير</span><code className="path">{String(result.reportPath ?? "")}</code></li>
          </ul>
          <button
            className="link-button"
            onClick={() => void navigator.clipboard.writeText(fontPath)}
          >
            نسخ مسار ملف TTF
          </button>

          {logs.length > 0 ? (
            <details>
              <summary>سجل المترجم ({logs.length} سطر)</summary>
              <pre>{logs.join("\n")}</pre>
            </details>
          ) : null}
        </div>
      ) : null}

        </div>

        <div className="build-output">
          <SectionLabel icon="pulse">معاينة HarfBuzz</SectionLabel>
          {fontPath ? (
            <>
          <p className="hint">الحروف تظهر بترتيبها البصري من اليمين لليسار كما يخرجها محرك التشكيل.</p>
          <div className="button-row">
            <input
              value={previewText}
              onChange={(event) => setPreviewText(event.target.value)}
              placeholder="اكتب نصاً عربياً"
              dir="rtl"
            />
            <select value={previewMode} onChange={(event) => setPreviewMode(event.target.value)}>
              <option value="paragraph">فقرة</option>
              <option value="word">كلمات</option>
              <option value="character">حروف</option>
              <option value="all">كل الأوضاع</option>
            </select>
            <button onClick={() => void runPreview()} disabled={previewBusy}>
              {previewBusy ? "جارٍ التشكيل…" : "شكّل"}
            </button>
            <button onClick={() => void runCorpus()} disabled={corpusBusy}>
              {corpusBusy ? "جارٍ الاختبار…" : "اختبار المجموعة"}
            </button>
          </div>

          {preview.map((mode) => (
            <div key={mode.mode} className="preview-mode">
              <h4>{MODE_LABELS[mode.mode] ?? mode.mode}</h4>
              {mode.segments.length === 0 ? (
                <p className="hint">لا يوجد نص.</p>
              ) : (
                <ul className="preview-segments">
                  {mode.segments.map((segment, index) => (
                    <li key={index}>
                      <span className="preview-text">{segment.text}</span>
                      <span className="preview-glyphs">
                        {segment.glyphs.map((glyph, glyphIndex) => {
                          const slotId = glyph.slotId;
                          return (
                            <span key={`${glyph.name}-${glyphIndex}`} className="glyph-chip">
                              {slotId ? (
                                <button
                                  className="link-button"
                                  onClick={() => onOpenSlot(slotId)}
                                  title={slotId}
                                >
                                  {glyph.name}
                                </button>
                              ) : (
                                <code>{glyph.name}</code>
                              )}
                            </span>
                          );
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {corpus ? (
            <div className="corpus-block">
              <h4>مجموعة الاختبار</h4>
              <p className="hint">
                نجح {totals.pass ?? 0} · فشل {totals.fail ?? 0} · تم تخطي {totals.skipped ?? 0}
              </p>
              <ul className="check-list">
                {corpusResults.map((item) => (
                  <li key={String(item.id)} className={String(item.status)}>
                    <span>{item.status === "pass" ? "✓" : item.status === "fail" ? "✕" : "–"}</span>
                    {String(item.label ?? item.id)}
                    <small dir="ltr">{String(item.text ?? "")}</small>
                    {item.status === "fail" ? (
                      <small dir="ltr">
                        المتوقع: {linesOf(item.expected).join(" ") || "—"} · الناتج:{" "}
                        {linesOf(item.actual).join(" ") || "—"}
                      </small>
                    ) : null}
                    {item.status === "skipped" && item.reason ? (
                      <small>{String(item.reason)}</small>
                    ) : null}
                  </li>
                ))}
              </ul>
              {findingsOf(corpus?.findings).length > 0 ? (
                <ul className="finding-list">
                  {findingsOf(corpus?.findings).map((finding, index) => (
                    <li key={`${finding.code}-${index}`} className={finding.severity}>
                      <span>{finding.message}</span>
                      {finding.hint ? <small dir="ltr">{finding.hint}</small> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          </>
        ) : (
          <div className="result-placeholder">
            <Icon name="pulse" size={24} />
            <p>ابنِ الخط أولاً لتظهر هنا معاينة التشكيل.</p>
          </div>
        )}

        {project.project.builds.length > 0 ? (
        <>
          <h3>سجل البناء</h3>
          <ul className="build-history">
            {project.project.builds.map((build) => (
              <li key={build.buildId}>
                <code>{build.buildId}</code>
                <span className={`status-badge ${build.result === "success" ? "ok" : "error"}`}>
                  {build.result === "success" ? "نجح" : "فشل"}
                </span>
                <small>{build.timestamp}</small>
              </li>
            ))}
          </ul>
        </>
      ) : null}
        </div>
      </div>
    </div>
  );
}
