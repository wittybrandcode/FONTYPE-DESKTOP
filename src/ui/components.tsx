import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./icons";

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icon: IconName;
  label: string;
  shortcut?: string;
  active?: boolean;
  tone?: "default" | "accent" | "danger";
  size?: number;
  variant?: "ghost" | "filled";
}

/** Icon-only control with a native tooltip, an accessible name and a shortcut hint. */
export function IconButton({
  icon,
  label,
  shortcut,
  active = false,
  tone = "default",
  size = 18,
  variant = "ghost",
  className = "",
  ...rest
}: IconButtonProps) {
  const tip = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button
      type="button"
      {...rest}
      className={`icon-btn icon-btn--${variant} icon-btn--${tone} ${active ? "is-active" : ""} has-tip ${className}`.trim()}
      data-tip={tip}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon name={icon} size={size} weight={active ? "fill" : "regular"} />
    </button>
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: IconName;
  children: ReactNode;
  variant?: "primary" | "secondary" | "quiet" | "danger";
}

export function Button({ icon, children, variant = "secondary", className = "", ...rest }: ButtonProps) {
  return (
    <button type="button" {...rest} className={`ui-button ui-button--${variant} ${className}`.trim()}>
      {icon ? <Icon name={icon} size={16} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function ToolbarDivider() {
  return <span className="toolbar-divider" aria-hidden="true" />;
}

interface PanelHeaderProps {
  icon: IconName;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  tone?: "default" | "accent" | "warning" | "danger";
}

/** Dense docked-panel header used across every module of the studio. */
export function PanelHeader({ icon, title, subtitle, actions, tone = "default" }: PanelHeaderProps) {
  return (
    <header className={`panel-header panel-header--${tone}`}>
      <span className="panel-header-icon"><Icon name={icon} size={16} /></span>
      <div className="panel-header-copy">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="panel-header-actions">{actions}</div> : null}
    </header>
  );
}

export function SectionLabel({ children, icon, action }: { children: ReactNode; icon?: IconName; action?: ReactNode }) {
  return (
    <div className="section-label">
      <span className="section-label-text">
        {icon ? <Icon name={icon} size={13} /> : null}
        {children}
      </span>
      {action}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

interface StatusChipProps {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warning" | "danger" | "info";
  icon?: IconName;
  title?: string;
}

export function StatusChip({ children, tone = "neutral", icon, title }: StatusChipProps) {
  return (
    <span className={`status-chip status-chip--${tone}`} title={title}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  );
}

interface AccordionSectionProps {
  title: string;
  icon: IconName;
  open: boolean;
  onToggle: () => void;
  badge?: ReactNode;
  tone?: "neutral" | "warning" | "danger";
  children: ReactNode;
}

export function AccordionSection({
  title,
  icon,
  open,
  onToggle,
  badge,
  tone = "neutral",
  children,
}: AccordionSectionProps) {
  return (
    <section className={`accordion ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="accordion-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <Icon name={icon} size={16} />
        <span className="accordion-title">{title}</span>
        {badge !== undefined && badge !== null && badge !== "" ? (
          <span className={`accordion-badge accordion-badge--${tone}`}>{badge}</span>
        ) : null}
        <Icon name={open ? "chevronDown" : "chevronLeft"} size={14} className="accordion-caret" />
      </button>
      {open ? <div className="accordion-body">{children}</div> : null}
    </section>
  );
}

interface EmptyStateProps {
  icon: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon"><Icon name={icon} size={26} /></span>
      <h2>{title}</h2>
      {description ? <p className="hint">{description}</p> : null}
      {action ? <div className="button-row">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-spinner" role="status" aria-label={label}>
      <Icon name="spinner" size={15} />
    </span>
  );
}
