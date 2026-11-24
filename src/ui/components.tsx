import { useEffect, useId, useRef, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
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

/* -------------------------------------------------------------------------- */
/* Accessibility primitives                                                   */
/* -------------------------------------------------------------------------- */

/** Traps Tab focus inside an open overlay and restores focus on close. */
export function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    const node = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const selector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const items = () =>
      Array.from(node.querySelectorAll<HTMLElement>(selector)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
    items()[0]?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const focusables = items();
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [active]);
  return ref;
}

/** Status with an icon and a word — color is never the only signal. */
export function StatusBadge({
  tone,
  children,
}: {
  tone: "ready" | "imported" | "review" | "error" | "empty" | "idle";
  children: ReactNode;
}) {
  const cls =
    tone === "review"
      ? "needs-review"
      : tone === "ready" || tone === "imported" || tone === "error"
        ? tone
        : "";
  const icon: IconName =
    tone === "ready" ? "checkCircle" : tone === "imported" ? "check" : tone === "review" ? "warning" : tone === "error" ? "error" : "info";
  return (
    <span className={`status-badge ${cls}`.trim()}>
      <Icon name={icon} size={11} /> {children}
    </span>
  );
}

/** Numeric control with an accessible label, unit, step and optional lock. */
export function NumericField({
  label,
  value,
  onChange,
  unit,
  step = 1,
  min,
  max,
  precision = 1,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  precision?: number;
  disabled?: boolean;
}) {
  const id = useId();
  const factor = 10 ** precision;
  const shown = Math.round(value * factor) / factor;
  return (
    <div className="numeric-field">
      <label htmlFor={id}>{label}</label>
      <div className="numeric-field-control">
        <input
          id={id}
          type="number"
          value={shown}
          step={step}
          min={min}
          max={max}
          disabled={disabled}
          aria-describedby={unit ? `${id}-unit` : undefined}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {unit ? <span id={`${id}-unit`} className="numeric-field-unit">{unit}</span> : null}
      </div>
    </div>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
}

/** Adjacent 2–4 choice control with radiogroup semantics. */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, options.findIndex((option) => option.value === value));

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
    if (!horizontal && !vertical && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    let next = index;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else {
      const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
      next = (index + (backward ? -1 : 1) + options.length) % options.length;
    }
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(node) => { refs.current[index] = node; }}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={index === current ? 0 : -1}
          className={value === option.value ? "is-selected" : ""}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {option.icon ? <Icon name={option.icon} size={13} /> : null}
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
