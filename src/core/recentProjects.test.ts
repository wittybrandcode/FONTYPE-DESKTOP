import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectHandle, ProjectSummary } from "./types";
import {
  filterRecents,
  loadHomePrefs,
  loadRecents,
  mergeSummaries,
  pathKey,
  projectNameFromPath,
  recentFromHandle,
  relativeTime,
  removeRecent,
  saveHomePrefs,
  saveRecents,
  togglePin,
  upsertRecent,
  type RecentProject,
} from "./recentProjects";

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  };
}

function handle(path: string, ready = 1, review = 0): ProjectHandle {
  const total = Math.max(1, ready + review);
  return {
    path,
    migrationNotes: [],
    project: {
      projectId: "project-1",
      font: { familyName: "ربيع", styleName: "Bold", unitsPerEm: 1000 },
      updatedAt: "2026-01-02T00:00:00Z",
      glyphSlots: Array.from({ length: total }, (_, index) => ({
        status: index < ready ? "ready" : index < ready + review ? "needs-review" : "empty",
        import: index < ready ? {} : null,
      })),
      builds: [],
    } as unknown as ProjectHandle["project"],
  };
}

function summary(path: string, overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    path,
    projectId: "project-1",
    name: projectNameFromPath(path),
    family: "ربيع",
    style: "Bold",
    upm: 1000,
    updatedAt: "2026-02-03T00:00:00Z",
    slots: 2,
    ready: 1,
    review: 0,
    imported: 1,
    builds: 0,
    available: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local project registry", () => {
  it("roundtrips through localStorage and ignores corrupt data", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    const entry = recentFromHandle(handle("D:/fonts/rabi.afsp"), Date.parse("2026-01-05T00:00:00Z"));
    saveRecents([entry]);
    expect(loadRecents()).toEqual([entry]);

    localStorage.setItem("fontype:recent-projects", "{not json");
    expect(loadRecents()).toEqual([]);

    const prefs = { view: "list" as const, scope: "ready" as const, sort: "name" as const };
    saveHomePrefs(prefs);
    expect(loadHomePrefs()).toEqual(prefs);
  });

  it("derives the display name from the folder, never from an SVG file", () => {
    expect(projectNameFromPath("D:\\fonts\\خط الربيع.afsp")).toBe("خط الربيع");
    expect(pathKey("D:\\Fonts\\A.afsp")).toBe(pathKey("d:/fonts/A.afsp/"));
  });

  it("upserts by normalized path and preserves pinned state", () => {
    const first = recentFromHandle(handle("D:/fonts/a.afsp"));
    const pinned = { ...first, pinned: true };
    const next = upsertRecent([pinned], handle("d:\\fonts\\a.afsp\\", 2));
    expect(next).toHaveLength(1);
    expect(next[0].path).toBe("d:\\fonts\\a.afsp\\");
    expect(next[0].pinned).toBe(true);
    expect(next[0].ready).toBe(2);
    expect(removeRecent(next, "D:/fonts/a.afsp")).toEqual([]);
    expect(togglePin(next, "D:/fonts/a.afsp")[0].pinned).toBe(false);
  });

  it("refreshes metadata from disk without losing local pin or usage time", () => {
    const local: RecentProject = {
      ...recentFromHandle(handle("D:/fonts/a.afsp")),
      pinned: true,
      lastOpenedAt: "2026-01-10T00:00:00Z",
    };
    const [refreshed] = mergeSummaries([local], [summary("d:/fonts/a.afsp", { ready: 3, review: 2 })]);
    expect(refreshed.ready).toBe(3);
    expect(refreshed.review).toBe(2);
    expect(refreshed.updatedAt).toBe("2026-02-03T00:00:00Z");
    expect(refreshed.pinned).toBe(true);
    expect(refreshed.lastOpenedAt).toBe("2026-01-10T00:00:00Z");

    const [missing] = mergeSummaries([local], [summary("d:/fonts/a.afsp", { available: false })]);
    expect(missing.available).toBe(false);
    expect(missing.family).toBe("ربيع");
  });

  it("filters by scope and query, and always shows pinned projects first", () => {
    const a = recentFromHandle(handle("D:/fonts/a.afsp"));
    const b = {
      ...recentFromHandle(handle("D:/fonts/b.afsp", 0, 2)),
      lastOpenedAt: "2026-03-01T00:00:00Z",
      pinned: true,
    };
    expect(filterRecents([a, b], "", "all", "opened").map((item) => item.path)).toEqual([b.path, a.path]);
    expect(filterRecents([a, b], "", "review", "opened")).toEqual([b]);
    expect(filterRecents([a, b], "b.afsp", "all", "opened")).toEqual([b]);
    expect(filterRecents([a, b], "", "all", "name")).toHaveLength(2);
  });

  it("formats relative timestamps in Arabic", () => {
    const now = Date.parse("2026-01-05T12:00:00Z");
    expect(relativeTime("2026-01-05T11:59:30Z", now)).toBe("الآن");
    expect(relativeTime("2026-01-05T11:58:00Z", now)).toBe("منذ دقيقتين");
    expect(relativeTime("2026-01-05T10:00:00Z", now)).toBe("منذ ساعتين");
    expect(relativeTime("2026-01-04T11:00:00Z", now)).toBe("أمس");
    expect(relativeTime("2026-01-02T12:00:00Z", now)).toBe("منذ 3 أيام");
  });
});
