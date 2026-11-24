import type { ReactNode } from "react";
import { AccordionSection } from "./components";
import { Icon, type IconName } from "./icons";

/** Right-hand inspector dock: one heading, a predictable section order, compact controls. */
export function Inspector({
  title = "المفتش",
  subtitle,
  actions,
  children,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside className="ws-properties inspector" aria-label={title}>
      <header className="inspector-head">
        <span className="inspector-title">
          <Icon name="sliders" size={14} />
          <span>{title}</span>
        </span>
        {subtitle ? <span className="inspector-subtitle">{subtitle}</span> : null}
        {actions ? <span className="inspector-actions">{actions}</span> : null}
      </header>
      <div className="inspector-body">{children}</div>
    </aside>
  );
}

/** A single inspector fold. Keeps AccordionSection semantics and adds a stable hook. */
export function InspectorSection({
  title,
  icon,
  open,
  onToggle,
  badge,
  tone = "neutral",
  children,
}: {
  title: string;
  icon: IconName;
  open: boolean;
  onToggle: () => void;
  badge?: ReactNode;
  tone?: "neutral" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <div className="inspector-section">
      <AccordionSection
        title={title}
        icon={icon}
        open={open}
        onToggle={onToggle}
        badge={badge}
        tone={tone}
      >
        {children}
      </AccordionSection>
    </div>
  );
}
