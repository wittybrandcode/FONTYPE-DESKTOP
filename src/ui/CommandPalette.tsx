import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";
import { Kbd, useFocusTrap } from "./components";

export interface CommandAction {
  id: string;
  label: string;
  description?: string;
  group: string;
  icon: IconName;
  shortcut?: string;
  run: () => void;
}

interface Props {
  open: boolean;
  actions: CommandAction[];
  onClose: () => void;
}

/** Figma-style command palette for fast navigation and one-click actions. */
export default function CommandPalette({ open, actions, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const trapRef = useFocusTrap(open);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return actions;
    return actions.filter((action) =>
      `${action.label} ${action.description ?? ""} ${action.group}`.toLowerCase().includes(needle),
    );
  }, [actions, query]);

  const groups = useMemo(() => {
    const result: Array<{ name: string; items: CommandAction[] }> = [];
    for (const action of filtered) {
      const existing = result.find((group) => group.name === action.group);
      if (existing) existing.items.push(action);
      else result.push({ name: action.group, items: [action] });
    }
    return result;
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((value) => (filtered.length ? (value + 1) % filtered.length : 0));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((value) => (filtered.length ? (value - 1 + filtered.length) % filtered.length : 0));
      } else if (event.key === "Enter" && filtered[active]) {
        event.preventDefault();
        filtered[active].run();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, filtered, onClose, open]);

  if (!open) return null;

  return (
    <div className="command-backdrop" onPointerDown={onClose}>
      <div
        ref={trapRef}
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="لوحة الأوامر"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="command-search">
          <Icon name="command" size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ابحث عن أمر أو لوحة…"
            aria-label="البحث في الأوامر"
            spellCheck={false}
          />
          <Kbd>ESC</Kbd>
        </div>

        <div className="command-results" role="listbox" aria-label="نتائج الأوامر">
          {groups.length === 0 ? (
            <div className="command-empty">لا توجد أوامر مطابقة.</div>
          ) : (
            groups.map((group) => (
              <section key={group.name} className="command-group">
                <h3>{group.name}</h3>
                {group.items.map((action) => {
                  const index = filtered.indexOf(action);
                  return (
                    <button
                      key={action.id}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      className={`command-item ${index === active ? "is-active" : ""}`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => {
                        action.run();
                        onClose();
                      }}
                    >
                      <span className="command-item-icon"><Icon name={action.icon} size={16} /></span>
                      <span className="command-item-copy">
                        <strong>{action.label}</strong>
                        {action.description ? <small>{action.description}</small> : null}
                      </span>
                      {action.shortcut ? <Kbd>{action.shortcut}</Kbd> : null}
                    </button>
                  );
                })}
              </section>
            ))
          )}
        </div>

        <footer className="command-footer">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> تنقل</span>
          <span><Kbd>Enter</Kbd> تنفيذ</span>
          <span className="command-footer-brand">FONTYPE · أوامر محلية</span>
        </footer>
      </div>
    </div>
  );
}
