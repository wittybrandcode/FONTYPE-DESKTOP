interface Props {
  info: Record<string, unknown> | null;
  health: Record<string, unknown> | null;
  status: "idle" | "checking" | "ok" | "error";
  onCheck: () => void;
}

export default function EnginePanel({ info, health, status, onCheck }: Props) {
  const toolchain = (health?.toolchain ?? {}) as Record<string, string | null>;

  return (
    <div className="panel">
      <h2>محرك الخطوط</h2>
      <p className="hint">عملية Python محلية معزولة؛ لا تُرفع أي رسوم إلى الإنترنت.</p>

      <div className={`status-badge ${status}`}>
        {status === "ok" ? "جاهز" : status === "error" ? "خطأ" : status === "checking" ? "جارٍ الفحص" : "لم يُفحص"}
      </div>

      <button className="primary wide" onClick={onCheck} disabled={status === "checking"}>
        فحص صحة المحرك
      </button>

      {info ? (
        <div className="kv">
          <div><span>Python</span><code>{String(info.python)}</code></div>
          <div><span>المجلد</span><code>{String(info.engineDir)}</code></div>
        </div>
      ) : (
        <p className="hint">جارٍ قراءة إعدادات المحرك…</p>
      )}

      {health ? (
        <>
          <h3>أدوات مثبّتة</h3>
          <ul className="tool-list">
            {Object.entries(toolchain).map(([name, version]) => (
              <li key={name}>
                <span>{name}</span>
                <code>{version ?? "غير مثبّت"}</code>
              </li>
            ))}
          </ul>
          <p className="hint">{String(health.message ?? "")}</p>
        </>
      ) : null}
    </div>
  );
}
