import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { runEngineJob } from "../core/api";
import type { EngineEvent } from "../core/protocol";
import type { ProjectHandle } from "../core/types";

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
      outputDir: project
        ? `${project.path}/reports/spike-${Date.now()}`
        : `fontype-spike-${Date.now()}`,
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
    <div className="panel">
      <h2>الاختبار الرأسي للمحرك</h2>
      <p className="hint">
        إثبات المسار كاملاً من ملف SVG واحد إلى خطين مُجمّعين وفحص التشكيل — بدون واجهة تحرير بعد.
      </p>

      <label>ملف SVG لحرف الباء</label>
      <div className="button-row">
        <button onClick={pickSvg}>اختيار ملف</button>
        <input
          className="path-input"
          readOnly
          value={svgPath}
          placeholder="لم يتم اختيار ملف"
        />
      </div>

      <button className="primary wide" onClick={run} disabled={running || !svgPath}>
        {running ? "جارٍ التنفيذ…" : "تشغيل الاختبار الرأسي"}
      </button>

      {(running || result || error) && (
        <div className="progress-block">
          <div className="progress-track"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <div className="progress-label">{message}</div>
        </div>
      )}

      {error ? <div className="alert error">{error}</div> : null}

      {result ? (
        <div className="result-block">
          <div className={`status-badge ${result.success ? "ok" : "error"}`}>
            {result.success ? "كل الفحوص نجحت" : "بعض الفحوص فشلت"}
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

          {shaping.glyphs ? (
            <p className="hint">نتيجة التشكيل: <code>{shaping.glyphs.join(" ")}</code></p>
          ) : null}

          <h3>الملفات الناتجة</h3>
          <ul className="tool-list">
            {Object.entries(artifacts).map(([format, path]) => (
              <li key={format}><span>{format.toUpperCase()}</span><code className="path">{path}</code></li>
            ))}
          </ul>

          {findings.length > 0 ? (
            <>
              <h3>ملاحظات الاستيراد</h3>
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
        </div>
      ) : null}
    </div>
  );
}
