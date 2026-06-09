import { describe, expect, it } from "vitest";

import { parseEvotownTimestamp } from "./datetime";

describe("parseEvotownTimestamp", () => {
  it("parses unix seconds and milliseconds", () => {
    expect(parseEvotownTimestamp(1_700_000_000)?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
    expect(parseEvotownTimestamp(1_700_000_000_000)?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });

  it("treats SQLite timestamps without timezone as UTC", () => {
    expect(parseEvotownTimestamp("2026-06-09 12:00:00")?.toISOString()).toBe("2026-06-09T12:00:00.000Z");
  });

  it("returns null for empty or invalid values", () => {
    expect(parseEvotownTimestamp("")).toBeNull();
    expect(parseEvotownTimestamp("not-a-date")).toBeNull();
  });
});
