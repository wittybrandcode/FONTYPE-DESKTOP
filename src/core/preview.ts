/** M5 — form comparison and live-preview helpers, free of React and Tauri. */

import type { GlyphSlot } from "./types";

export const FORM_ORDER = ["isolated", "initial", "medial", "final"] as const;
export type FormName = (typeof FORM_ORDER)[number];

export const FORM_LABELS: Record<string, string> = {
  isolated: "مفرد",
  initial: "بدائي",
  medial: "وسيط",
  final: "نهائي",
};

export interface FormEntry {
  form: FormName;
  label: string;
  slot: GlyphSlot | null;
}

/** Four fixed cells for one letter: gaps stay visible instead of shifting columns. */
export function formSequence(slots: GlyphSlot[], selected: GlyphSlot | null): FormEntry[] {
  return FORM_ORDER.map((form) => ({
    form,
    label: FORM_LABELS[form],
    slot:
      selected && selected.group
        ? slots.find((slot) => slot.group === selected.group && slot.form === form) ?? null
        : null,
  }));
}

/** Previous and next drawn forms give the onion skin its two neighbours. */
export function onionForms(
  slots: GlyphSlot[],
  selected: GlyphSlot | null,
): { previous: GlyphSlot | null; next: GlyphSlot | null } {
  const entries = formSequence(slots, selected).filter((entry): entry is FormEntry & { slot: GlyphSlot } => entry.slot !== null && entry.slot.import !== null);
  const index = entries.findIndex((entry) => entry.slot.slotId === selected?.slotId);
  if (index < 0) return { previous: null, next: null };
  return {
    previous: entries[index - 1]?.slot ?? null,
    next: entries[index + 1]?.slot ?? null,
  };
}

export interface ShapedGlyph {
  name: string;
  slotId: string | null;
  cluster?: number;
}

export interface ShapedMode {
  mode: string;
  glyphs: ShapedGlyph[];
}

/** Glyphs shaped from the edited slot, used to highlight it inside the word. */
export function highlightSlotGlyphs(modes: unknown, slotId: string | null): ShapedGlyph[] {
  if (!slotId || !Array.isArray(modes)) return [];
  const found: ShapedGlyph[] = [];
  for (const entry of modes) {
    if (!entry || typeof entry !== "object") continue;
    const glyphs = (entry as ShapedMode).glyphs;
    if (!Array.isArray(glyphs)) continue;
    for (const glyph of glyphs) {
      if (glyph && glyph.slotId === slotId) found.push(glyph);
    }
  }
  return found;
}

/** A short readable result line; no engine jargon in the designer-facing UI. */
export function previewSummary(modes: unknown): string {
  if (!Array.isArray(modes)) return "لا نتيجة بعد";
  const names = new Set<string>();
  for (const entry of modes) {
    if (!entry || typeof entry !== "object") continue;
    const glyphs = (entry as ShapedMode).glyphs;
    if (!Array.isArray(glyphs)) continue;
    for (const glyph of glyphs) if (glyph?.name) names.add(String(glyph.name));
  }
  return names.size === 0 ? "لم يُعد المحرك حروفاً" : `${names.size} حرف من التشكيل`;
}
