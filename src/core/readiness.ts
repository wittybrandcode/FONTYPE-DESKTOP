/**
 * Professional readiness gate — derived only from data already in `.afsp`.
 * No new fields, no new engine command: it reads imports, metrics, anchors,
 * validation results, shaping options and build history.
 */

import type { GlyphSlot, ProjectHandle, ValidationFinding } from "./types";

export type ReadinessLevel = "ready" | "attention" | "blocked";
export type ReadinessTarget = "inventory" | "workspace" | "build";

export interface ReadinessCheck {
  id: string;
  label: string;
  ok: boolean;
  severity: "blocker" | "warning";
  detail: string;
  target: ReadinessTarget;
  slotId?: string;
}

export interface ReadinessReport {
  level: ReadinessLevel;
  canBuild: boolean;
  checks: ReadinessCheck[];
  blockers: number;
  warnings: number;
  summary: string;
}

/** Anchor classes a slot needs before it can carry its joining role into OTL. */
export function requiredAnchorClasses(slot: GlyphSlot): string[] {
  const byForm: Record<string, string[]> = {
    isolated: [],
    initial: ["cursive-exit"],
    final: ["cursive-entry"],
    medial: ["cursive-entry", "cursive-exit"],
  };
  const names = [...(byForm[slot.form] ?? [])];
  if (slot.markClass === "top") names.push("top");
  if (slot.markClass === "bottom") names.push("bottom");
  return [...new Set(names)];
}

function firstError(findings: ValidationFinding[]): ValidationFinding | undefined {
  return findings.find((item) => item.severity === "error");
}

function check(
  id: string,
  label: string,
  ok: boolean,
  detail: string,
  target: ReadinessTarget,
  severity: "blocker" | "warning" = "blocker",
  slotId?: string,
): ReadinessCheck {
  return { id, label, ok, detail, target, severity, slotId };
}

/** Build a deterministic report for the open project. */
export function buildReadiness(handle: ProjectHandle | null): ReadinessReport {
  if (!handle) {
    const checks = [
      check("project", "المشروع", false, "لا يوجد مشروع مفتوح.", "inventory"),
    ];
    return finalize(checks);
  }

  const data = handle.project;
  const slots = data.glyphSlots;
  const imported = slots.filter((slot) => slot.import !== null);

  const required = slots.filter((slot) => slot.required);
  const unimported = required.filter((slot) => !slot.import || slot.status === "empty");
  const coverage = check(
    "coverage",
    "اكتمال الرسوم",
    unimported.length === 0,
    unimported.length === 0
      ? `${required.length} خانة مطلوبة لها رسوم.`
      : `${unimported.length} خانة مطلوبة بلا رسم: ${unimported.slice(0, 2).map((slot) => slot.characterName).join("، ")}`,
    "inventory",
    "blocker",
    unimported[0]?.slotId,
  );

  const geometryErrors = imported.flatMap((slot) => {
    const info = slot.import!;
    const error = firstError(info.findings);
    if (error) return [`${slot.characterName}: ${error.code}`];
    if (!info.previewPath.trim() || info.bounds[2] <= info.bounds[0]) {
      return [`${slot.characterName}: مسار فارغ أو حدود غير صالحة`];
    }
    return [];
  });
  const geometry = check(
    "geometry",
    "سلامة المسارات",
    geometryErrors.length === 0,
    geometryErrors.length === 0 ? "كل المسارات المستوردة صالحة." : geometryErrors.slice(0, 2).join("؛ "),
    "workspace",
  );

  const anchorProblems: string[] = [];
  for (const slot of imported) {
    if (slot.anchors.some((anchor) => anchor.needsReview)) {
      anchorProblems.push(`${slot.characterName}: مرساة تحتاج مراجعة`);
      continue;
    }
    const seen = new Set<string>();
    let duplicated = false;
    for (const anchor of slot.anchors) {
      if (seen.has(anchor.name)) duplicated = true;
      seen.add(anchor.name);
    }
    if (duplicated) anchorProblems.push(`${slot.characterName}: اسم مرساة مكرّر`);
    const missing = requiredAnchorClasses(slot).filter(
      (name) => !slot.anchors.some((anchor) => anchor.class === name),
    );
    if (missing.length > 0) {
      anchorProblems.push(`${slot.characterName}: ينقص ${missing.join("، ")}`);
    }
  }
  const anchors = check(
    "anchors",
    "مراسي الوصل والحركات",
    anchorProblems.length === 0,
    anchorProblems.length === 0 ? "مراسي الأشكال مكتملة." : anchorProblems.slice(0, 2).join("؛ "),
    "workspace",
  );

  const metrics = data.metrics;
  const metricsOk =
    [metrics.baseline, metrics.ascender, metrics.descender].every((value) => Number.isFinite(value)) &&
    metrics.ascender > metrics.baseline &&
    metrics.baseline > metrics.descender &&
    imported.every((slot) => slot.metrics.advanceWidth > 0);
  const metricsCheck = check(
    "metrics",
    "القياسات الأساسية",
    metricsOk,
    metricsOk ? "المحارف والصعود والهبوط والعروض صالحة." : "راجع المحارف/الصعود/الهبوط أو عرض تقدّم سالب.",
    "workspace",
  );

  const flagged = slots.filter((slot) => slot.status === "error" || slot.status === "needs-review");
  const validationErrors = slots.flatMap((slot) =>
    slot.validation.filter((item) => item.severity === "error").map((item) => `${slot.characterName}: ${item.code}`),
  );
  const validationOk = flagged.length === 0 && validationErrors.length === 0;
  const validation = check(
    "validation",
    "حالة الخانات",
    validationOk,
    validationOk ? "لا أخطاء ولا خانات تحتاج مراجعة." : validationErrors[0] ?? `${flagged[0]?.characterName}: تحتاج مراجعة`,
    "inventory",
    "blocker",
    flagged[0]?.slotId,
  );

  const shapingOk = data.shaping.markPositioning && data.shaping.cursivePositioning;
  const shaping = check(
    "shaping",
    "تشكيل العربية",
    shapingOk,
    shapingOk ? "تموضع الحركات والوصل الحركي مفعّلان." : "فعّل تموضع الحركات والوصل الحركي قبل البناء النهائي.",
    "build",
    "warning",
  );

  const verified = data.builds.length > 0;
  const verifiedCheck = check(
    "verified",
    "التحقق بالتشكيل",
    verified,
    verified ? "يوجد بناء سابق لمراجعة ناتج التشكيل." : "أنشئ بناءً أولاً لمراجعة ناتج التشكيل.",
    "build",
    "warning",
  );

  return finalize([coverage, geometry, anchors, metricsCheck, validation, shaping, verifiedCheck]);
}

function finalize(checks: ReadinessCheck[]): ReadinessReport {
  const blockers = checks.filter((item) => !item.ok && item.severity === "blocker").length;
  const warnings = checks.filter((item) => !item.ok && item.severity === "warning").length;
  const level: ReadinessLevel = blockers > 0 ? "blocked" : warnings > 0 ? "attention" : "ready";
  return {
    level,
    canBuild: blockers === 0,
    checks,
    blockers,
    warnings,
    summary:
      blockers > 0
        ? `${blockers} عائقاً قبل البناء`
        : warnings > 0
          ? `جاهز مع ${warnings} ملاحظة`
          : "جاهز للبناء",
  };
}
