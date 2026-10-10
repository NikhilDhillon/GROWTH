import { describe, expect, it } from "vitest";
import { buildCanonicalLeaderboard } from "./leaderboardService";
import type { Exercise, WorkoutSession, WorkoutSet } from "@/types";
const exercises = ["Barbell Bench Press", "Machine Chest Press", "Pull-Up", "Unknown historical exercise"].map((name, index) => ({ id: index + 1, name, primary_muscle: "Chest", is_strength_exercise: 1, created_at: "2026-01-01" })) as Exercise[];
function entry(id: number, owner: string, exercise = 1, date = "2026-01-01", weight = 100) {
  return { session: { id, user_id: owner, workout_date: date, created_at: date } as WorkoutSession & { user_id: string },
    sets: [1, 2].map((set_number) => ({ id: id * 10 + set_number, user_id: owner, session_id: id, exercise_id: exercise, set_number, weight, reps: 20, created_at: date })) as Array<WorkoutSet & { user_id: string }> };
}
function ranking(entries: ReturnType<typeof entry>[], allowed = ["a", "b"]) { return buildCanonicalLeaderboard({ exercises, sessions: entries.map((e) => e.session), sets: entries.flatMap((e) => e.sets), names: new Map([["a", "Alice"], ["b", "Bob"]]), allowedUserIds: new Set(allowed), asOfDate: "2026-01-31" }); }

describe("friend rankings derive from authorized canonical observations", () => {
  it("uses the shared rep cap and absolute e1RM, independent of personal growth baselines", () => { expect(ranking([entry(1, "a")])[0].best_estimated_1rm).toBeCloseTo(100 * (1 + 10 / 30)); });
  it("reflects historical edits and deletions without a separate score snapshot", () => {
    const first = entry(1, "a"); expect(ranking([first])[0].best_estimated_1rm).toBeGreaterThan(100);
    first.sets.forEach((s) => s.weight = 50); expect(ranking([first])[0].best_estimated_1rm).toBeCloseTo(50 * (1 + 10 / 30));
    expect(ranking([])).toEqual([]);
  });
  it("excludes machine, bodyweight-dependent, and unknown load semantics from cross-user equivalence", () => { expect(ranking([entry(1, "a", 2), entry(2, "a", 3), entry(3, "a", 4)])).toEqual([]); });
  it("withholds shorter, warmup-only and mixed-exercise entries", () => {
    const short = entry(1, "a"); short.sets.pop(); const warm = entry(2, "a"); warm.sets.forEach((s) => s.is_warmup = 1); const mixed = entry(3, "a"); mixed.sets[1].exercise_id = 2;
    expect(ranking([short, warm, mixed])).toEqual([]);
  });
  it("drops revoked/unauthorized friends, future sessions, orphans and conflicting ownership", () => {
    const bad = entry(1, "a"); bad.sets.forEach((s) => s.user_id = "b");
    expect(ranking([entry(2, "b"), entry(3, "a", 1, "2026-02-01"), bad], ["a"])).toEqual([]);
  });
  it("withholds ambiguous recorded identities rather than ranking duplicated evidence", () => {
    const duplicate = entry(1, "a"); duplicate.sets[1].id = duplicate.sets[0].id;
    expect(ranking([duplicate])).toEqual([]);
    expect(ranking([entry(2, "a"), entry(2, "b")])).toEqual([]);
  });
});
