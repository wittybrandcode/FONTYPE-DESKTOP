import { describe, expect, it } from "vitest";
import { eventMessage, parseEngineEvent } from "./protocol";

describe("parseEngineEvent", () => {
  it("accepts a valid engine event", () => {
    const event = parseEngineEvent({
      jobId: "j1",
      type: "progress",
      data: { value: 0.5, message: "جارٍ العمل" },
    });
    expect(event?.type).toBe("progress");
    expect(eventMessage(event!)).toBe("جارٍ العمل");
  });

  it("rejects malformed payloads", () => {
    expect(parseEngineEvent(null)).toBeNull();
    expect(parseEngineEvent({ jobId: 1, type: "result", data: {} })).toBeNull();
    expect(parseEngineEvent({ jobId: "j", type: "unknown", data: {} })).toBeNull();
  });
});
