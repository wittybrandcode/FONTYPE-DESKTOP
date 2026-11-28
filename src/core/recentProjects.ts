/**
 * Local project registry for the Home screen.
 *
 * The registry lives in localStorage only: it never changes the .afsp schema
 * and never deletes or renames project folders. Rust `project_summaries`
 * refreshes the stored metadata from disk whenever Home is displayed.
 */
import type { ProjectHandle, ProjectSummary } from "./types";

export interface RecentProject {
  path: string;
  projectId: string;
  name: string;
  family: string;
  style: string;
  upm: number;
  updatedAt: string;
  lastOpenedAt: string;
  pinned: boolean;
  slots: number;
  ready: number;
  review: number;
  imported: number;
  builds: number;
  available: boolean;
}

export type RecentScope = "all" | "pinned" | "ready" | "review";
export type RecentSort = "opened" | "modified" | "name";
export type HomeView = "grid" | "list";

export interface HomePrefs {
  view: HomeView;
  scope: RecentScope;
  sort: RecentSort;
}

export const RECENT_KEY = "fontype:recent-projects";
export const HOME_PREFS_KEY = "fontype:home-prefs";
export const MAX_RECENTS = 24;

export const DEFAULT_HOME_PREFS: HomePrefs = {
  view: "grid",
  scope: "all",
  sort: "opened",
};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function pathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function projectNameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const folder = parts[parts.length - 1] ?? path;
  return folder.replace(/\.afsp$/i, "") || folder;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function normalizeRecent(value: unknown): RecentProject | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.path !== "string" || item.path.trim().length === 0) return null;
  return {
    path: item.path,
    projectId: text(item.projectId),
    name: text(item.name, projectNameFromPath(item.path)),
    family: text(item.family),
    style: text(item.style, "Regular"),
    upm: count(item.upm) || 1000,
    updatedAt: text(item.updatedAt),
    lastOpenedAt: text(item.lastOpenedAt),
    pinned: item.pinned === true,
    slots: count(item.slots),
    ready: count(item.ready),
    review: count(item.review),
    imported: count(item.imported),
    builds: count(item.builds),
    available: item.available !== false,
  };
}

export function loadRecents(): RecentProject[] {
  try {
    const raw = storage()?.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeRecent)
      .filter((item): item is RecentProject => item !== null)
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

export function saveRecents(list: RecentProject[]): void {
  try {
    storage()?.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENTS)));
  } catch {
    // A full or unavailable store must never block opening a project.
  }
}

export function loadHomePrefs(): HomePrefs {
  try {
    const raw = storage()?.getItem(HOME_PREFS_KEY);
    if (!raw) return { ...DEFAULT_HOME_PREFS };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_HOME_PREFS };
    const item = parsed as Record<string, unknown>;
    return {
      view: item.view === "list" ? "list" : "grid",
      scope:
        item.scope === "pinned" || item.scope === "ready" || item.scope === "review"
          ? item.scope
          : "all",
      sort: item.sort === "modified" || item.sort === "name" ? item.sort : "opened",
    };
  } catch {
    return { ...DEFAULT_HOME_PREFS };
  }
}

export function saveHomePrefs(prefs: HomePrefs): void {
  try {
    storage()?.setItem(HOME_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are optional; ignore storage failures.
  }
}

export function recentFromHandle(handle: ProjectHandle, now = Date.now()): RecentProject {
  const { project } = handle;
  const slots = project.glyphSlots;
  return {
    path: handle.path,
    projectId: project.projectId,
    name: projectNameFromPath(handle.path),
    family: project.font.familyName,
    style: project.font.styleName,
    upm: project.font.unitsPerEm,
    updatedAt: project.updatedAt,
    lastOpenedAt: new Date(now).toISOString(),
    pinned: false,
    slots: slots.length,
    ready: slots.filter((slot) => slot.status === "ready").length,
    review: slots.filter((slot) => slot.status === "needs-review").length,
    imported: slots.filter((slot) => slot.import !== null).length,
    builds: project.builds.length,
    available: true,
  };
}

export function upsertRecent(
  list: RecentProject[],
  handle: ProjectHandle,
  now = Date.now(),
): RecentProject[] {
  const entry = recentFromHandle(handle, now);
  const key = pathKey(entry.path);
  const existing = list.find((item) => pathKey(item.path) === key);
  const merged: RecentProject = existing ? { ...entry, pinned: existing.pinned } : entry;
  return [merged, ...list.filter((item) => pathKey(item.path) !== key)].slice(0, MAX_RECENTS);
}

export function mergeSummaries(
  list: RecentProject[],
  summaries: ProjectSummary[],
): RecentProject[] {
  const byPath = new Map(summaries.map((item) => [pathKey(item.path), item]));
  return list.map((item) => {
    const summary = byPath.get(pathKey(item.path));
    if (!summary) return { ...item, available: false };
    return {
      ...item,
      projectId: summary.projectId || item.projectId,
      name: summary.name || item.name,
      family: summary.family || item.family,
      style: summary.style || item.style,
      upm: summary.upm || item.upm,
      updatedAt: summary.updatedAt || item.updatedAt,
      slots: summary.slots,
      ready: summary.ready,
      review: summary.review,
      imported: summary.imported,
      builds: summary.builds,
      available: summary.available,
    };
  });
}

export function togglePin(list: RecentProject[], path: string): RecentProject[] {
  const key = pathKey(path);
  return list.map((item) =>
    pathKey(item.path) === key ? { ...item, pinned: !item.pinned } : item,
  );
}

export function removeRecent(list: RecentProject[], path: string): RecentProject[] {
  const key = pathKey(path);
  return list.filter((item) => pathKey(item.path) !== key);
}

export function filterRecents(
  list: RecentProject[],
  query: string,
  scope: RecentScope,
  sort: RecentSort,
): RecentProject[] {
  const needle = query.trim().toLocaleLowerCase("ar");
  const matches = list.filter((item) => {
    if (scope === "pinned" && !item.pinned) return false;
    if (scope === "ready" && !(item.available && item.ready > 0)) return false;
    if (scope === "review" && !(item.available && item.review > 0)) return false;
    if (!needle) return true;
    return [item.name, item.family, item.style, item.path, item.projectId]
      .some((value) => value.toLocaleLowerCase("ar").includes(needle));
  });
  return matches.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (sort === "name") return a.name.localeCompare(b.name, "ar");
    if (sort === "modified") return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    return Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt);
  });
}

export function relativeTime(iso: string, now = Date.now()): string {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) return "—";
  const diff = Math.max(0, now - value);
  const minute = 60_000;
  if (diff < minute) return "الآن";
  if (diff < 60 * minute) {
    const count = Math.floor(diff / minute);
    if (count === 1) return "منذ دقيقة";
    if (count === 2) return "منذ دقيقتين";
    return `منذ ${count} دقائق`;
  }
  if (diff < 24 * 60 * minute) {
    const count = Math.floor(diff / (60 * minute));
    if (count === 1) return "منذ ساعة";
    if (count === 2) return "منذ ساعتين";
    return `منذ ${count} ساعات`;
  }
  if (diff < 48 * 60 * minute) return "أمس";
  const days = Math.floor(diff / (24 * 60 * minute));
  if (days < 30) {
    if (days === 1) return "منذ يوم";
    if (days === 2) return "منذ يومين";
    return `منذ ${days} أيام`;
  }
  try {
    return new Intl.DateTimeFormat("ar", { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleDateString("ar");
  }
}
