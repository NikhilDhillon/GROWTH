import { describe, expect, it } from "vitest";

import type { ExerciseScorePoint } from "@/types";
import { annotateSessionProgress, groupSetsForDisplay, sessionVolume } from "@/utils/sessionDisplay";

const format = (weight: number) => `${weight} lb`;
const point = (sessionId: number, date: string, estimated1RM: number, extra: Partial<ExerciseScorePoint> = {}) =>
  ({ exerciseId: 1, sessionId, date, estimated1RM, comparisonKey: "external", ...extra }) as ExerciseScorePoint;

describe("groupSetsForDisplay", () => {
  it("collapses consecutive sets at one load and keeps warm-ups separate", () => {
    expect(groupSetsForDisplay([
      { weight: 95, reps: 5, isWarmup: true },
      { weight: 160, reps: 7, isWarmup: false },
      { weight: 160, reps: 6, isWarmup: false },
      { weight: 165, reps: 4, isWarmup: false },
      { weight: 160, reps: 5, isWarmup: false }
    ], format)).toEqual([
      { load: "95 lb", reps: [5], warmup: true },
      { load: "160 lb", reps: [7, 6], warmup: false },
      { load: "165 lb", reps: [4], warmup: false },
      { load: "160 lb", reps: [5], warmup: false }
    ]);
  });
});

describe("annotateSessionProgress", () => {
  it("reports change from the previous session and flags only new bests", () => {
    const progress = annotateSessionProgress([point(3, "2026-10-08", 205), point(1, "2026-10-01", 200), point(2, "2026-10-04", 198)]);
    expect(progress.get(1)).toEqual({ e1RMDelta: null, isPR: false });
    expect(progress.get(2)).toEqual({ e1RMDelta: -2, isPR: false });
    expect(progress.get(3)).toEqual({ e1RMDelta: 7, isPR: true });
  });

  it("never compares across equipment contexts or untagged entries", () => {
    const progress = annotateSessionProgress([
      point(1, "2026-10-01", 100, { comparisonKey: "machine:a" }),
      point(2, "2026-10-02", 150, { comparisonKey: "machine:b" }),
      point(3, "2026-10-03", 300, { comparability: "self_context" })
    ]);
    expect(progress.get(2)).toEqual({ e1RMDelta: null, isPR: false });
    expect(progress.has(3)).toBe(false);
  });
});

it("counts working volume only", () => {
  expect(sessionVolume([{ weight: 45, reps: 10, isWarmup: true }, { weight: 100, reps: 5, isWarmup: false }])).toBe(500);
});
