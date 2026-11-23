import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AccordionSection, IconButton, StatusChip } from "./components";
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
});
