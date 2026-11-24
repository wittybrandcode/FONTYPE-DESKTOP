import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccordionSection, IconButton, PanelHeader, SectionLabel, StatusChip } from "./components";
import ActivityRail from "./ActivityRail";
import CommandPalette from "./CommandPalette";
import ShortcutsDialog from "./ShortcutsDialog";

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

  it("describes the active section and review badge in the activity rail", () => {
    const html = renderToStaticMarkup(
      <ActivityRail
        items={[
          { id: "workspace", label: "مساحة العمل", icon: "cursor" },
          { id: "inventory", label: "مخزون الخانات", icon: "grid", badge: 3 },
        ]}
        activeId="inventory"
        onSelect={() => {}}
        sidebarOpen
        onToggleSidebar={() => {}}
        onCommand={() => {}}
        onShortcuts={() => {}}
        healthLabel="المحرك جاهز"
        healthTone="ok"
      />,
    );
    expect(html).toContain('aria-label="التنقل الرئيسي"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("rail-badge");
    expect(html).toContain(">3</span>");
    expect(html).toContain("rail-health--ok");
    expect(html).toContain("المحرك جاهز");
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
});
