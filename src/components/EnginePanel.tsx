import { PanelHeader, SectionLabel } from "../ui/components";
import { Icon, type IconName } from "../ui/icons";

interface Props {
  info: Record<string, unknown> | null;
  health: Record<string, unknown> | null;
  status: "idle" | "checking" | "ok" | "error";
  onCheck: () => void;
}

const STATE_META: Record<Props["status"], { label: string; note: string; icon: IconName }> = {
  idle: { label: "لم يُفحص", note: "ابدأ فحصاً سريعاً للتأكد من جاهزية الأدوات.", icon: "pulse" },
  checking: { label: "جارٍ الفحص", note: "يتم التحقق من البيئة المحلية…", icon: "spinner" },
  ok: { label: "المحرك جاهز", note: "جميع الأدوات المطلوبة متاحة محلياً.", icon: "checkCircle" },
  error: { label: "المحرك غير جاهز", note: "راجع تفاصيل الفحص أدناه.", icon: "warning" },
};

export default function EnginePanel({ info, health, status, onCheck }: Props) {
  const toolchain = (health?.toolchain ?? {}) as Record<string, string | null>;
  const meta = STATE_META[status];

  return (
    <section className="panel engine-panel">
      <PanelHeader
        icon="cube"
        title="محرك الخطوط"
        subtitle="عملية Python معزولة على جهازك"
        actions={<span className="panel-index">02</span>}
      />

      <div className="panel-body">
        <div className={`engine-state engine-state--${status}`}>
          <span className={`engine-state-icon ${status === "checking" ? "is-spinning" : ""}`}>
            <Icon name={meta.icon} size={19} />
          </span>
          <div className="engine-state-copy">
            <strong>{meta.label}</strong>
            <small>{meta.note}</small>
          </div>
          <button className="primary engine-check" onClick={onCheck} disabled={status === "checking"}>
            فحص
          </button>
        </div>

        <SectionLabel icon="gear">بيئة التشغيل</SectionLabel>
        {info ? (
          <div className="data-list">
            <div><span>Python</span><code>{String(info.python)}</code></div>
            <div><span>المجلد</span><code>{String(info.engineDir)}</code></div>
          </div>
        ) : (
          <p className="hint">جارٍ قراءة إعدادات المحرك…</p>
        )}

        {health ? (
          <>
            <SectionLabel icon="listChecks">الأدوات المثبّتة</SectionLabel>
            <ul className="tool-list">
              {Object.entries(toolchain).map(([name, version]) => (
                <li key={name}>
                  <span className={`tool-dot ${version ? "is-ready" : "is-missing"}`} />
                  <span>{name}</span>
                  <code>{version ?? "غير مثبّت"}</code>
                </li>
              ))}
            </ul>
            <p className="hint">{String(health.message ?? "")}</p>
          </>
        ) : null}

        <div className="local-note">
          <Icon name="shield" size={15} />
          <span>المعالجة محلية بالكامل؛ لا تُرفع أي رسوم إلى الإنترنت.</span>
        </div>
      </div>
    </section>
  );
}
