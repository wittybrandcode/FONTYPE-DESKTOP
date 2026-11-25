import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { GlyphSlot } from "../core/types";
import { Icon } from "./icons";

const FORM_LABELS: Record<string, string> = {
  isolated: "مفرد",
  initial: "بدائي",
  medial: "وسيط",
  final: "نهائي",
};

const STATUS_LABELS: Record<string, string> = {
  empty: "فارغة",
  imported: "مُستوردة",
  ready: "معتمدة",
  "needs-review": "تحتاج مراجعة",
  error: "خطأ",
};

const STATUS_ICONS: Record<string, "info" | "check" | "checkCircle" | "warning" | "error"> = {
  empty: "info",
  imported: "check",
  ready: "checkCircle",
  "needs-review": "warning",
  error: "error",
};

interface Props {
  slots: GlyphSlot[];
  selectedId?: string | null;
  onSelect: (slotId: string) => void;
}

/** Dense glyph tree for the left dock: search, group filter, keyboard navigation. */
export default function GlyphDock({ slots, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [active, setActive] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const groups = useMemo(
    () => Array.from(new Set(slots.map((slot) => slot.group))).sort((a, b) => a.localeCompare(b, "ar")),
    [slots],
  );
  const readyCount = useMemo(() => slots.filter((slot) => slot.status === "ready").length, [slots]);
  const hasFilters = query.trim().length > 0 || group !== "all";

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return slots.filter((slot) => {
      if (group !== "all" && slot.group !== group) return false;
      if (!needle) return true;
      return `${slot.characterName} ${slot.glyphName} ${slot.unicode} ${slot.form}`
        .toLowerCase()
        .includes(needle);
    });
  }, [slots, query, group]);

  function move(next: number) {
    if (filtered.length === 0) return;
    const index = (next + filtered.length) % filtered.length;
    setActive(index);
    itemRefs.current[index]?.focus();
  }

  function onKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      move(0);
    } else if (event.key === "End") {
      event.preventDefault();
      move(filtered.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(filtered[index].slotId);
    }
  }

  return (
    <section className="glyph-dock" aria-label="شجرة الحروف">
      <div className="glyph-dock-filters">
        <input
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          placeholder="بحث بالحرف أو الاسم…"
          aria-label="بحث في الخانات"
        />
        <select value={group} onChange={(event) => { setGroup(event.target.value); setActive(0); }} aria-label="فلتر المجموعة">
          <option value="all">كل المجموعات</option>
          {groups.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>

      <div className="glyph-dock-summary" aria-label="ملخص الخانات">
        <span>معروض <strong>{filtered.length}/{slots.length}</strong></span>
        <span className="summary-grow" />
        <span>جاهزة <strong>{readyCount}</strong></span>
      </div>

      {filtered.length === 0 ? (
        <div className="glyph-dock-empty">
          <Icon name={hasFilters ? "search" : "grid"} size={18} />
          <p>{hasFilters ? "لا توجد خانات مطابقة." : "لا توجد خانات في هذا المشروع."}</p>
          {hasFilters ? (
            <button
              type="button"
              onClick={() => { setQuery(""); setGroup("all"); setActive(0); }}
            >
              إزالة الفلاتر
            </button>
          ) : null}
        </div>
      ) : (
        <div className="glyph-dock-list" role="listbox" aria-label="خانات الخط">
          {filtered.map((slot, index) => {
            const char = String.fromCodePoint(parseInt(slot.unicode, 16) || 0x25a1);
            const selected = slot.slotId === selectedId;
            const status = STATUS_LABELS[slot.status] ?? slot.status;
            return (
              <button
                key={slot.slotId}
                ref={(node) => { itemRefs.current[index] = node; }}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={index === active ? 0 : -1}
                className={`glyph-dock-item ${selected ? "is-selected" : ""} ${slot.required ? "is-required" : ""}`}
                onClick={() => { setActive(index); onSelect(slot.slotId); }}
                onFocus={() => setActive(index)}
                onKeyDown={(event) => onKey(event, index)}
              >
                <span className="dock-glyph" aria-hidden="true">{char}</span>
                <span className="dock-copy">
                  <strong>{slot.characterName}</strong>
                  <small>{FORM_LABELS[slot.form] ?? slot.form} · {slot.glyphName}</small>
                </span>
                <span className={`dock-status dock-status--${slot.status}`}>
                  <Icon name={STATUS_ICONS[slot.status] ?? "info"} size={12} />
                  <span>{status}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
