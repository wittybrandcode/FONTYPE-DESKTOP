import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GlyphSlot } from "../core/types";
import {
  AccordionSection,
  IconButton,
  InfoTip,
  NumericField,
  PanelHeader,
  SegmentedControl,
  SectionLabel,
  StatusBadge,
  StatusChip,
} from "./components";
import CommandPalette from "./CommandPalette";
import GlyphDock from "./GlyphDock";
import { Inspector, InspectorSection } from "./Inspector";
import MenuBar from "./MenuBar";
import ShortcutsDialog from "./ShortcutsDialog";

function slot(overrides: Partial<GlyphSlot> = {}): GlyphSlot {
  return {
    slotId: "alef-isolated",
    characterName: "ألف",
    unicode: "0627",
    glyphName: "alef-isolated",
    form: "isolated",
    joiningType: "R",
    group: "مفردات",
    markClass: null,
    required: true,
    originalSvg: null,
    sourceRevisions: [],
    import: null,
    placement: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    metrics: { advanceWidth: 300, leftSideBearing: 0, rightSideBearing: 0 },
    anchors: [],
    status: "empty",
    approvedAt: null,
    validation: [],
    ...overrides,
  };
}

describe("shared UI components", () => {
  it("gives icon-only buttons an accessible name and shortcut tooltip", () => {
    const html = renderToStaticMarkup(
      <IconButton icon="zoomIn" label="تكبير" shortcut="+" active onClick={() => {}} />,
    );
    expect(html).toContain('aria-label="تكبير"');
    expect(html).toContain('data-tip="تكبير (+)"');
    expect(html).toContain("is-active");
    expect(html).toContain('aria-pressed="true"');
  });

  it("keeps non-critical guidance in an accessible tooltip", () => {
    const html = renderToStaticMarkup(<InfoTip tip="إرشاد مساعد" />);
    expect(html).toContain('data-tip="إرشاد مساعد"');
    expect(html).toContain('aria-label="إرشاد مساعد"');
    expect(html).toContain("info-tip");
  });

  it("renders accordion content only when expanded", () => {
    const closed = renderToStaticMarkup(
      <AccordionSection title="المراسي" icon="anchor" open={false} onToggle={() => {}}>
        <p>محتوى المراسي</p>
      </AccordionSection>,
    );
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("محتوى المراسي");

    const open = renderToStaticMarkup(
      <AccordionSection title="المراسي" icon="anchor" open onToggle={() => {}} badge={3}>
        <p>محتوى المراسي</p>
      </AccordionSection>,
    );
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain("محتوى المراسي");
    expect(open).toContain("accordion-badge");
  });

  it("exposes semantic tone in status chips", () => {
    const html = renderToStaticMarkup(<StatusChip tone="warning">تحتاج مراجعة</StatusChip>);
    expect(html).toContain("status-chip--warning");
    expect(html).toContain("تحتاج مراجعة");
  });

  it("keeps the shortcuts dialog hidden until requested", () => {
    expect(renderToStaticMarkup(<ShortcutsDialog open={false} onClose={() => {}} />)).toBe("");
    const html = renderToStaticMarkup(<ShortcutsDialog open onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("اختصارات لوحة المفاتيح");
  });

  it("renders dense panel headers and section labels", () => {
    const header = renderToStaticMarkup(
      <PanelHeader icon="grid" title="مخزون الخانات" subtitle="هوية الخانة من المشروع" />,
    );
    expect(header).toContain("panel-header");
    expect(header).toContain("مخزون الخانات");
    expect(header).toContain("هوية الخانة من المشروع");

    const section = renderToStaticMarkup(<SectionLabel icon="sliders">إعدادات التشكيل</SectionLabel>);
    expect(section).toContain("section-label");
    expect(section).toContain("إعدادات التشكيل");
  });

  it("exposes a keyboard-navigable native menu bar", () => {
    const html = renderToStaticMarkup(
      <MenuBar
        version="v0.6.0"
        onCommand={() => {}}
        onShortcuts={() => {}}
        groups={[
          {
            id: "file",
            label: "ملف",
            items: [
              { id: "open", label: "فتح مشروع", shortcut: "Ctrl+O", icon: "folderOpen", run: () => {} },
            ],
          },
          {
            id: "view",
            label: "عرض",
            items: [{ id: "palette", label: "لوحة الأوامر", run: () => {} }],
          },
        ]}
      />,
    );
    expect(html).toContain('role="banner"');
    expect(html).toContain('role="menubar"');
    expect(html).toContain('aria-label="قائمة التطبيق"');
    expect(html).toContain("FONTYPE — استوديو الخطوط العربية");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain(">ملف<");
    expect(html).toContain(">عرض<");
    expect(html).toContain("v0.6.0");
    expect(html).toContain('aria-label="لوحة الأوامر"');
    expect(html).toContain('aria-label="اختصارات لوحة المفاتيح"');
  });

  it("labels numeric fields and segmented controls for assistive technology", () => {
    const numeric = renderToStaticMarkup(
      <NumericField label="ارتفاع الصاعد" value={800} unit="UPM" onChange={() => {}} />,
    );
    expect(numeric).toContain("<label");
    expect(numeric).toContain("ارتفاع الصاعد");
    expect(numeric).toContain('type="number"');
    expect(numeric).toContain("UPM");

    const segmented = renderToStaticMarkup(
      <SegmentedControl
        label="نمط العرض"
        value="outline"
        options={[
          { value: "outline", label: "حدود", icon: "square" },
          { value: "filled", label: "مملوء", icon: "check" },
        ]}
        onChange={() => {}}
      />,
    );
    expect(segmented).toContain('role="radiogroup"');
    expect(segmented).toContain('aria-label="نمط العرض"');
    expect(segmented).toContain('role="radio"');
    expect(segmented).toContain('aria-checked="true"');
  });

  it("communicates slot status with an icon and a word", () => {
    const html = renderToStaticMarkup(<StatusBadge tone="review">تحتاج مراجعة</StatusBadge>);
    expect(html).toContain("needs-review");
    expect(html).toContain("تحتاج مراجعة");
    expect(html).not.toContain(">تحتاج مراجعة<"); // icon precedes the text
  });

  it("renders the command palette only when open", () => {
    const actions = [
      {
        id: "build",
        label: "بناء الخط",
        description: "توليد OTF و TTF",
        group: "المشروع",
        icon: "pulse" as const,
        run: () => {},
      },
    ];
    expect(renderToStaticMarkup(<CommandPalette open={false} actions={actions} onClose={() => {}} />)).toBe("");
    const html = renderToStaticMarkup(<CommandPalette open actions={actions} onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("لوحة الأوامر");
    expect(html).toContain("ابحث عن أمر أو لوحة…");
    expect(html).toContain("بناء الخط");
    expect(html).toContain("المشروع");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Enter");
  });

  it("renders a dense glyph dock with search, filter and roving tabindex", () => {
    const html = renderToStaticMarkup(
      <GlyphDock
        slots={[slot(), slot({ slotId: "beh-initial", characterName: "باء", glyphName: "beh-initial", unicode: "0628", form: "initial", group: "بدايات" })]}
        selectedId="alef-isolated"
        onSelect={() => {}}
      />,
    );
    expect(html).toContain('aria-label="شجرة الحروف"');
    expect(html).toContain('aria-label="بحث في الخانات"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("مجموعة");
  });

  it("keeps the inspector heading and folds accessible", () => {
    const html = renderToStaticMarkup(
      <Inspector subtitle="alef-isolated">
        <InspectorSection title="خصائص الخانة" icon="sliders" open onToggle={() => {}} badge="مُستوردة">
          <p>محتوى الخصائص</p>
        </InspectorSection>
      </Inspector>,
    );
    expect(html).toContain('aria-label="المفتش"');
    expect(html).toContain("inspector-head");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("محتوى الخصائص");
    expect(html).toContain("accordion-badge");
    expect(html).toContain("alef-isolated");
  });

  it("uses a roving tabindex for segmented controls", () => {
    const html = renderToStaticMarkup(
      <SegmentedControl
        label="عرض لوحة المستند"
        value="glyphs"
        options={[
          { value: "glyphs", label: "الحروف" },
          { value: "project", label: "المشروع" },
          { value: "engine", label: "المحرك" },
        ]}
        onChange={() => {}}
      />,
    );
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  });

  it("documents every workspace tool shortcut", () => {
    const html = renderToStaticMarkup(<ShortcutsDialog open onClose={() => {}} />);
    for (const key of ["V", "H", "A", "G", "R", "D", "S"]) {
      expect(html).toContain(`>${key}<`);
    }
  });
});
