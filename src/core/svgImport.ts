import { open } from "@tauri-apps/plugin-dialog";
import { runEngineJob } from "./api";
import type { SvgInspection } from "./types";

export interface SvgImportOptions {
  upm: number;
  advanceWidth: number;
  fitRatio?: number;
  referenceHeight?: number | null;
  manualScale?: number | null;
}

export interface SvgImportSelection {
  inspection: SvgInspection;
  mode: string;
  fileCount: number;
}

/**
 * Multiple files are normalized into a single composite SVG by the engine, so
 * the project keeps its existing one-source-per-slot schema. Preserve-size is
 * the only mode that reproduces the composite coordinates on re-inspection.
 */
export function inspectionModeFor(fileCount: number, requested?: string): string {
  return fileCount > 1 ? "preserve_size" : requested ?? "fit_to_em";
}

export function buildSvgInspectionParams(
  files: string[],
  options: SvgImportOptions,
  requestedMode?: string,
): { params: Record<string, unknown>; mode: string } {
  if (files.length === 0) throw new Error("لم يتم اختيار ملف SVG.");
  const mode = inspectionModeFor(files.length, requestedMode);
  const params: Record<string, unknown> = {
    upm: options.upm,
    mode,
    advanceWidth: options.advanceWidth,
    fitRatio: options.fitRatio ?? 0.7,
    referenceHeight: options.referenceHeight ?? null,
    manualScale: options.manualScale ?? null,
  };
  if (files.length === 1) params.svgPath = files[0];
  else params.svgPaths = files;
  return { params, mode };
}

export async function pickSvgFiles(): Promise<string[]> {
  const picked = await open({
    multiple: true,
    filters: [{ name: "SVG", extensions: ["svg"] }],
    title: "اختر رسم أو رسوم الخانة الحالية",
  });
  if (Array.isArray(picked)) return picked.filter((path) => /\.svg$/i.test(path));
  if (typeof picked === "string") return [picked];
  return [];
}

export async function inspectSvgSources(
  files: string[],
  options: SvgImportOptions,
  requestedMode?: string,
): Promise<SvgImportSelection> {
  const { params, mode } = buildSvgInspectionParams(files, options, requestedMode);
  const inspection = (await runEngineJob("inspect_svg", params)) as unknown as SvgInspection;
  return { inspection, mode, fileCount: files.length };
}
