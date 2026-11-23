export type EngineEventType = "progress" | "result" | "error" | "log";

export interface EngineEvent {
  jobId: string;
  type: EngineEventType;
  data: Record<string, unknown>;
}

const TYPES: EngineEventType[] = ["progress", "result", "error", "log"];

export function parseEngineEvent(payload: unknown): EngineEvent | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.jobId !== "string") return null;
  if (typeof value.type !== "string" || !TYPES.includes(value.type as EngineEventType)) {
    return null;
  }
  if (typeof value.data !== "object" || value.data === null) return null;
  return {
    jobId: value.jobId,
    type: value.type as EngineEventType,
    data: value.data as Record<string, unknown>,
  };
}

export function eventMessage(event: EngineEvent): string {
  if (typeof event.data.message === "string") return event.data.message;
  if (typeof event.data.error === "string") return event.data.error;
  return "";
}
