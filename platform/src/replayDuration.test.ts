import { describe, expect, it } from "vitest";
import { formatReplayDuration } from "./replayDuration";

describe("formatReplayDuration", () => {
  it.each([
    [0, "0 ms"],
    [678, "678 ms"],
    [999, "999 ms"],
    [1000, "1 s"],
    [1234, "1.234 s"],
    [61_234, "1m 01s"],
  ])("formats %d milliseconds as %s", (milliseconds, expected) => {
    expect(formatReplayDuration(milliseconds)).toBe(expected);
  });

  it("normalizes invalid and negative values", () => {
    expect(formatReplayDuration(-10)).toBe("0 ms");
    expect(formatReplayDuration(Number.NaN)).toBe("0 ms");
  });
});
