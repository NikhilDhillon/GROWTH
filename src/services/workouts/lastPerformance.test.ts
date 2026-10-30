import { describe, expect, it } from "vitest";

import { latestSession, shortAgo, timeAgo } from "@/services/workouts/lastPerformance";
import type { WorkoutSession, WorkoutSet } from "@/types";

const session = (id: number, workout_date: string) => ({ id, workout_date, notes: "", created_at: `${workout_date}T12:00:00Z` }) as WorkoutSession;
const set = (session_id: number, set_number: number, weight: number, reps: number, exercise_id = 1, is_warmup = 0) =>
  ({ id: session_id * 10 + set_number, session_id, exercise_id, set_number, weight, reps, is_warmup, created_at: "" }) as unknown as WorkoutSet;

describe("last performance", () => {
  it("finds the latest earlier session's working sets in order", () => {
    const sessions = [session(1, "2026-10-01"), session(2, "2026-10-20"), session(3, "2026-10-26")];
    const sets = [set(1, 1, 90, 10), set(2, 2, 100, 8), set(2, 1, 100, 9), set(2, 0, 45, 10, 1, 1), set(3, 1, 105, 8), set(2, 1, 50, 12, 2)];
    expect(latestSession({ exerciseId: 1, sessions, sets, before: "2026-10-26" })).toEqual({ date: "2026-10-20", sets: [{ weight: 100, reps: 9 }, { weight: 100, reps: 8 }] });
    expect(latestSession({ exerciseId: 3, sessions, sets, before: "2026-10-26" })).toBeNull();
  });

  it("says how long ago, in words and in short", () => {
    expect([timeAgo("2026-10-26", "2026-10-26"), timeAgo("2026-10-25", "2026-10-26"), timeAgo("2026-10-22", "2026-10-26"), timeAgo("2026-10-01", "2026-10-26")])
      .toEqual(["today", "yesterday", "4 days ago", "3 weeks ago"]);
    expect([shortAgo("2026-10-23", "2026-10-26"), shortAgo("2026-10-05", "2026-10-26"), shortAgo("2026-06-01", "2026-10-26")]).toEqual(["3d", "3w", "4mo"]);
  });
});
