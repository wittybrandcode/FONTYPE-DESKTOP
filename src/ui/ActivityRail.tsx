import { Icon, type IconName } from "./icons";

export interface RailItem {
  id: string;
  label: string;
  icon: IconName;
  badge?: number;
}

interface Props {
  items: RailItem[];
  activeId: string;
  onSelect: (id: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onCommand: () => void;
  onShortcuts: () => void;
  healthLabel: string;
  healthTone: "ok" | "warn" | "error" | "idle";
}

/** Fixed activity bar — the primary navigation spine of the studio. */
export default function ActivityRail({
  items,
  activeId,
  onSelect,
  sidebarOpen,
  onToggleSidebar,
  onCommand,
  onShortcuts,
  healthLabel,
  healthTone,
}: Props) {
  return (
    <nav className="activity-rail" aria-label="التنقل الرئيسي">
      <button
        type="button"
        className="rail-brand has-tip"
        data-tip="لوحة الأوامر (Ctrl+K)"
        aria-label="فتح لوحة الأوامر"
        onClick={onCommand}
      >
        <span>ف</span>
      </button>

      <div className="rail-group" role="group" aria-label="أقسام العمل">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rail-btn has-tip ${activeId === item.id ? "is-active" : ""}`}
            data-tip={item.label}
            aria-label={item.label}
            aria-current={activeId === item.id ? "page" : undefined}
            onClick={() => onSelect(item.id)}
          >
            <Icon name={item.icon} size={20} weight={activeId === item.id ? "fill" : "regular"} />
            {item.badge ? <span className="rail-badge">{item.badge}</span> : null}
          </button>
        ))}
      </div>

      <div className="rail-spacer" />

      <div className="rail-group rail-group--footer">
        <button
          type="button"
          className={`rail-btn has-tip ${sidebarOpen ? "is-active" : ""}`}
          data-tip={sidebarOpen ? "إخفاء لوحة المشروع" : "إظهار لوحة المشروع"}
          aria-label={sidebarOpen ? "إخفاء لوحة المشروع" : "إظهار لوحة المشروع"}
          aria-pressed={sidebarOpen}
          onClick={onToggleSidebar}
        >
          <Icon name="sidebar" size={19} />
        </button>
        <button type="button" className="rail-btn has-tip" data-tip="اختصارات لوحة المفاتيح" aria-label="اختصارات لوحة المفاتيح" onClick={onShortcuts}>
          <Icon name="keyboard" size={19} />
        </button>
        <button type="button" className={`rail-health rail-health--${healthTone}`} title={healthLabel} aria-label={healthLabel}>
          <span className="rail-health-dot" />
          <span className="rail-health-text">محلي</span>
        </button>
      </div>
    </nav>
  );
}
