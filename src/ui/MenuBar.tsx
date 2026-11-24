import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon, type IconName } from "./icons";
import { Kbd } from "./components";

export interface MenuAction {
  id: string;
  label: string;
  shortcut?: string;
  icon?: IconName;
  disabled?: boolean;
  separatorBefore?: boolean;
  run: () => void;
}

export interface MenuGroup {
  id: string;
  label: string;
  items: MenuAction[];
}

interface Props {
  groups: MenuGroup[];
  version: string;
  onCommand: () => void;
  onShortcuts: () => void;
}

/** Native-style menu bar with roving tabindex, arrow navigation and Escape. */
export default function MenuBar({ groups, version, onCommand, onShortcuts }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [activeTrigger, setActiveTrigger] = useState(0);
  const [activeItem, setActiveItem] = useState(0);
  const triggerRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const openGroup = groups.find((group) => group.id === openId) ?? null;

  useEffect(() => {
    if (!openId) return;
    function onPointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (document.querySelector(".menu-popup")?.contains(target)) return;
      if (target instanceof Element && target.closest(".menu-trigger")) return;
      setOpenId(null);
    }
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [openId]);

  useEffect(() => {
    if (!openId) return;
    const frame = window.requestAnimationFrame(() => itemRefs.current[activeItem]?.focus());
    return () => window.cancelAnimationFrame(frame);
    // Only move focus when the menu opens, not on every arrow key (we focus there).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  function openMenu(index: number) {
    setActiveTrigger(index);
    setActiveItem(0);
    setOpenId(groups[index]?.id ?? null);
  }

  function closeMenu(returnFocus = true) {
    setOpenId(null);
    if (returnFocus) {
      const frame = window.requestAnimationFrame(() => triggerRefs.current[activeTrigger]?.focus());
      window.setTimeout(() => window.cancelAnimationFrame(frame), 0);
    }
  }

  function onTriggerKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const next = (index + 1) % groups.length;
      setActiveTrigger(next);
      triggerRefs.current[next]?.focus();
      if (openId) setOpenId(groups[next]?.id ?? null);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      const next = (index - 1 + groups.length) % groups.length;
      setActiveTrigger(next);
      triggerRefs.current[next]?.focus();
      if (openId) setOpenId(groups[next]?.id ?? null);
    } else if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu(index);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    }
  }

  function onItemKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const items = openGroup?.items ?? [];
    const enabled = items.map((item, i) => ({ item, i })).filter(({ item }) => !item.disabled);
    const currentPos = enabled.findIndex(({ i }) => i === index);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (enabled.length === 0) return;
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextPos = (currentPos + delta + enabled.length) % enabled.length;
      const next = enabled[nextPos].i;
      setActiveItem(next);
      itemRefs.current[next]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    } else if (event.key === "Home" && enabled.length > 0) {
      event.preventDefault();
      setActiveItem(enabled[0].i);
      itemRefs.current[enabled[0].i]?.focus();
    } else if (event.key === "End" && enabled.length > 0) {
      event.preventDefault();
      setActiveItem(enabled[enabled.length - 1].i);
      itemRefs.current[enabled[enabled.length - 1].i]?.focus();
    }
  }

  return (
    <div className="menu-bar" role="banner" aria-label="قائمة التطبيق">
      <h1 className="sr-only">FONTYPE — استوديو الخطوط العربية</h1>
      <div className="menu-bar-brand" aria-label="FONTYPE">
        <span className="brand-mark" aria-hidden="true">ف</span>
        <span>FONTYPE</span>
      </div>

      <nav className="menu-list" role="menubar" aria-label="قائمة التطبيق">
        {groups.map((group, index) => (
          <div className="menu-group-wrap" key={group.id}>
            <button
              ref={(node) => { triggerRefs.current[index] = node; }}
              type="button"
              role="menuitem"
              className={`menu-trigger ${openId === group.id ? "is-open" : ""}`}
              aria-haspopup="menu"
              aria-expanded={openId === group.id}
              tabIndex={activeTrigger === index ? 0 : -1}
              onFocus={() => setActiveTrigger(index)}
              onClick={() => (openId === group.id ? closeMenu() : openMenu(index))}
              onKeyDown={(event) => onTriggerKey(event, index)}
              onMouseEnter={() => { if (openId) { setOpenId(group.id); setActiveItem(0); } }}
            >
              {group.label}
            </button>
            {openId === group.id && openGroup ? (
              <div className="menu-popup" role="menu" aria-label={group.label}>
                {openGroup.items.map((item, itemIndex) => (
                  <div key={item.id}>
                    {item.separatorBefore ? <div className="menu-popup-sep" role="separator" /> : null}
                    <button
                      ref={(node) => { itemRefs.current[itemIndex] = node; }}
                      type="button"
                      role="menuitem"
                      className="menu-popup-item"
                      disabled={item.disabled}
                      tabIndex={activeItem === itemIndex ? 0 : -1}
                      onClick={() => { item.run(); closeMenu(); }}
                      onKeyDown={(event) => onItemKey(event, itemIndex)}
                      onMouseEnter={() => setActiveItem(itemIndex)}
                    >
                      {item.icon ? <Icon name={item.icon} size={14} /> : <span className="menu-item-spacer" aria-hidden="true" />}
                      <span className="menu-item-label">{item.label}</span>
                      {item.shortcut ? <span className="menu-item-shortcut">{item.shortcut}</span> : null}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </nav>

      <div className="menu-bar-spacer" />
      <div className="menu-bar-meta">
        <span className="local-chip">محلي بالكامل</span>
        <button type="button" className="menu-meta-button" onClick={onCommand} aria-label="لوحة الأوامر">
          <Icon name="command" size={12} />
        </button>
        <button type="button" className="menu-meta-button" onClick={onShortcuts} aria-label="اختصارات لوحة المفاتيح">
          <Icon name="keyboard" size={12} />
        </button>
        <Kbd>Ctrl K</Kbd>
        <span className="version-chip" dir="ltr">{version}</span>
      </div>
    </div>
  );
}
