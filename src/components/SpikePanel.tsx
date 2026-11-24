import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { runEngineJob } from "../core/api";
import type { EngineEvent } from "../core/protocol";
import type { ProjectHandle } from "../core/types";
import { PanelHeader, SectionLabel, StatusChip } from "../ui/components";
import { Icon } from "../ui/icons";

interface Props {
  project: ProjectHandle | null;
  onNotice: (text: string, kind?: "ok" | "error") => void;
}

const CHECK_LABELS: Record<string, string> = {
  tablesPresent: "جداول الخط الأساسية موجودة",
  codepointMapped: "رمز U+0628 مرتبط بخانة",
  unitsPerEmMatches: "UPM مطابق للمشروع",
  shapingReturnsGlyph: "HarfBuzz أعاد الشكل المتوقع",
};

function linesOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export default function SpikePanel({ project, onNotice }: Props) {
  const [svgPath, setSvgPath] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");

  async function pickSvg() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "SVG", extensions: ["svg"] }],
      title: "اختر SVG لحرف واحد",
    });
    if (typeof selected === "string") setSvgPath(selected);
  }

  async function run() {
    if (!svgPath) return;
    setRunning(true);
    setProgress(0);
    setMessage("بدء الاختبار الرأسي");
    setLogs([]);
    setResult(null);
    setError("");

    const params: Record<string, unknown> = {
      svgPath,
      outputDir: project ? `${project.path}/reports/spike-${Date.now()}` : `fontype-spike-${Date.now()}`,
      upm: project?.project.font.unitsPerEm ?? 1000,
      ascender: project?.project.metrics.ascender,
      descender: project?.project.metrics.descender,
      familyName: project?.project.font.familyName || "FONTYPE Test",
      styleName: project?.project.font.styleName || "Regular",
      advanceWidth: 600,
      unicode: "U+0628",
      glyphName: "beh.isol",
      importMode: "fit_to_em",
    };

    function onEvent(event: EngineEvent) {
      if (event.type === "progress") {
        setProgress(Number(event.data.value ?? 0));
        setMessage(String(event.data.message ?? ""));
      } else if (event.type === "log") {
        const fresh = linesOf(event.data.lines);
        if (fresh.length) setLogs((current) => [...current, ...fresh].slice(-60));
      }
    }

    try {
      const data = await runEngineJob("spike", params, onEvent);
      setResult(data);
      setProgress(1);
      if (data.success) {
        onNotice("نجح الاختبار الرأسي: OTF و TTF جاهزان للفحص", "ok");
      } else {
        onNotice("اكتمل البناء لكن بعض الفحوص لم تنجح", "error");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      onNotice("فشل الاختبار الرأسي", "error");
    } finally {
      setRunning(false);
    }
  }

  const checks = (result?.checks ?? {}) as Record<string, boolean>;
  const findings = (result?.findings ?? []) as Array<{ severity: string; message: string }>;
  const artifacts = (result?.artifacts ?? {}) as Record<string, string>;
  const shaping = (result?.shaping ?? {}) as { glyphs?: string[] };

  return (
    <section className="panel diagnostic-panel">
      <PanelHeader
        icon="lightning"
        title="الاختبار الرأسي للمحرك"
        subtitle="من SVG واحد إلى خط مُجمّع وفحص تشكيل"
        actions={<StatusChip tone="info" icon="shield">محلي</StatusChip>}
      />

      <div className="panel-body diagnostic-layout">
        <div className="diagnostic-input">
          <SectionLabel icon="upload">المدخل</SectionLabel>
          <label>ملف SVG لحرف الباء</label>
          <div className="file-picker">
            <button type="button" onClick={() => void pickSvg()}>
              <Icon name="folderOpen" size={15} /> اختيار ملف
            </button>
            <input className="path-input" readOnly value={svgPath} placeholder="لم يتم اختيار ملف" />
          </div>

          <div className="hint-card">
            <Icon name="info" size={15} />
            <span>يستخدم الاختبار إعدادات المشروع الحالي إن كان مفتوحاً، وإلا قيماً افتراضية.</span>
          </div>

          <button className="primary wide" onClick={() => void run()} disabled={running || !svgPath}>
            {running ? <Icon name="spinner" size={16} /> : <Icon name="play" size={16} />}
            {running ? "جارٍ التنفيذ…" : "تشغيل الاختبار الرأسي"}
          </button>

          {(running || result || error) && (
            <div className="progress-block">
              <div className="progress-track"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
              <div className="progress-label">{message}</div>
            </div>
          )}
          {error ? <div className="alert error">{error}</div> : null}
        </div>

        <div className="diagnostic-output">
          <SectionLabel icon="listChecks">النتيجة</SectionLabel>
          {result ? (
            <>
              <div className={`result-banner ${result.success ? "is-success" : "is-failure"}`}>
                <Icon name={result.success ? "checkCircle" : "warning"} size={20} />
                <div>
                  <strong>{result.success ? "كل الفحوص نجحت" : "بعض الفحوص فشلت"}</strong>
                  <small>{Object.values(checks).filter(Boolean).length} من {Object.keys(checks).length} فحوص</small>
                </div>
              </div>

              <ul className="check-list">
                {Object.entries(checks).map(([key, value]) => (
                  <li key={key} className={value ? "pass" : "fail"}>
                    <span className="check-mark"><Icon name={value ? "check" : "close"} size={12} /></span>
                    {CHECK_LABELS[key] ?? key}
                  </li>
                ))}
              </ul>

              {shaping.glyphs ? (
                <div className="code-line">نتيجة التشكيل: <code>{shaping.glyphs.join(" ")}</code></div>
              ) : null}

              <SectionLabel icon="fileText">الملفات الناتجة</SectionLabel>
              <ul className="tool-list">
                {Object.entries(artifacts).map(([format, path]) => (
                  <li key={format}><span>{format.toUpperCase()}</span><code className="path">{path}</code></li>
                ))}
              </ul>

              {findings.length > 0 ? (
                <>
                  <SectionLabel icon="warning">ملاحظات الاستيراد</SectionLabel>
                  <ul className="finding-list">
                    {findings.map((finding, index) => (
                      <li key={index} className={finding.severity}>{finding.message}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              {logs.length > 0 ? (
                <details>
                  <summary>سجل المترجم ({logs.length} سطر)</summary>
                  <pre>{logs.join("\n")}</pre>
                </details>
              ) : null}
            </>
          ) : (
            <div className="result-placeholder">
              <Icon name="target" size={24} />
              <p>شغّل الاختبار لعرض الفحوص والملفات الناتجة هنا.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
