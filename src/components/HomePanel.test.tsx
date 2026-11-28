import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HomePanel from "./HomePanel";
import { DEFAULT_HOME_PREFS, recentFromHandle, type RecentProject } from "../core/recentProjects";
import type { ProjectHandle } from "../core/types";

function project(path: string): RecentProject {
  const handle = {
    path,
    migrationNotes: [],
    project: {
      projectId: "id-1",
      font: { familyName: "ربيع", styleName: "Regular", unitsPerEm: 1000 },
      updatedAt: "2026-01-02T00:00:00Z",
      glyphSlots: [{ status: "ready", import: {} }],
      builds: [],
    },
  } as unknown as ProjectHandle;
  return { ...recentFromHandle(handle), pinned: true };
}

function render(recents: RecentProject[], view: "grid" | "list" = "grid") {
  return renderToStaticMarkup(
    <HomePanel
      recents={recents}
      activePath={recents[0]?.path ?? null}
      prefs={{ ...DEFAULT_HOME_PREFS, view }}
      onPrefs={() => {}}
      onNew={() => {}}
      onBrowse={() => {}}
      onOpen={() => {}}
      onTogglePin={() => {}}
      onRemove={() => {}}
      onRefresh={() => {}}
      refreshing={false}
    />,
  );
}

describe("HomePanel", () => {
  it("shows an accessible local-only empty state", () => {
    const html = render([]);
    expect(html).toContain("لا توجد مشاريع في السجل بعد");
    expect(html).toContain("لا تحذف ملفاته");
    expect(html).toContain("مشروع جديد");
  });

  it("renders recent projects with open, pin and registry-remove actions", () => {
    const html = render([project("D:/fonts/rabi.afsp"), project("D:/fonts/other.afsp")]);
    expect(html).toContain("المشاريع الأخيرة");
    expect(html).toContain("فتح المشروع:");
    expect(html).toContain("D:/fonts/rabi.afsp");
    expect(html).toContain("إلغاء تثبيت المشروع");
    expect(html).toContain("إزالة المشروع من السجل المحلي");
    expect(html).toContain("is-current");
    expect(html).toContain("home-cards--grid");
    expect(render([project("D:/fonts/rabi.afsp")], "list")).toContain("home-cards--list");
  });
});
