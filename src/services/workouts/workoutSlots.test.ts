import { describe, expect, it } from "vitest";

import { createActiveWorkout, emptyActiveExercise, normalizeActiveWorkout } from "@/constants/activeWorkout";
import { learnedTemplateExercises, normalizeTemplateExercises, templateExerciseKey, withTemplateExercises } from "@/services/workouts/templateExercises";
import { appendWorkoutSlot, moveWorkoutSlot, nextPendingSlot, pairWorkoutSlots, removeWorkoutSlot, slotForChosenExercise, slotsFromTemplate, supersetNext, supersetSlots, unlinkWorkoutSlot, workoutSlotProgress } from "@/services/workouts/workoutSlots";
import type { ActiveWorkout, CompletedWorkoutExercise, WorkoutSlot } from "@/types";

const bench = 1, dip = 2, fly = 3, pushdown = 4;
const slots: WorkoutSlot[] = [
  { id: "a", exerciseId: bench, machineProfileId: null },
  { id: "b", exerciseId: dip, machineProfileId: null },
  { id: "c", exerciseId: fly, machineProfileId: "cable-left" }
];

function done(exerciseId: number, sessionId: number, machineProfileId: string | null = null): CompletedWorkoutExercise {
  return { exerciseId, sessionId, machineProfileId, exerciseName: "", muscle: "Chest", sets: [], completedAt: "2026-10-24T18:00:00.000Z" };
}
function workout(patch: Partial<ActiveWorkout> = {}): ActiveWorkout {
  return { ...createActiveWorkout({ key: "sun", label: "Sun", muscles: ["Chest", "Triceps"] }, "Chest / Triceps", "chest-triceps", slots), ...patch };
}

describe("workout slots", () => {
  it("checks off slots from completed entries, even out of order", () => {
    const progress = workoutSlotProgress(workout({ completedExercises: [done(dip, 11)], currentExercise: { ...emptyActiveExercise(), exerciseId: bench, slotId: "a" } }));
    expect(progress.map((item) => [item.slot.id, item.status])).toEqual([["a", "current"], ["b", "done"], ["c", "pending"]]);
  });

  it("offers the first waiting slot after the current exercise is saved", () => {
    expect(nextPendingSlot(workout({ completedExercises: [done(bench, 10)] }))?.id).toBe("b");
    expect(nextPendingSlot(workout({ completedExercises: [done(bench, 10), done(dip, 11), done(fly, 12)] }))).toBeNull();
  });

  it("lists work saved before slots existed as done", () => {
    const legacy = workout({ slots: undefined, completedExercises: [done(bench, 10)] });
    expect(workoutSlotProgress(legacy)).toEqual([expect.objectContaining({ status: "done", sessionId: 10, slot: expect.objectContaining({ exerciseId: bench }) })]);
  });

  it("puts an unplanned exercise before the current one, so the skipped one comes next", () => {
    const active = workout({ currentExercise: { ...emptyActiveExercise(), exerciseId: bench, slotId: "a" } });
    const chosen = slotForChosenExercise(active, pushdown, null);
    expect(chosen.slots.map((slot) => slot.exerciseId)).toEqual([pushdown, bench, dip, fly]);
    expect(slotForChosenExercise(active, fly, null).slot.id).toBe("c");
  });

  it("adds and removes planned exercises without duplicating one still waiting", () => {
    expect(appendWorkoutSlot(workout(), fly, null).slots).toHaveLength(3);
    expect(appendWorkoutSlot(workout(), pushdown, null).slots?.map((slot) => slot.exerciseId)).toEqual([bench, dip, fly, pushdown]);
    expect(removeWorkoutSlot(workout(), "b").slots?.map((slot) => slot.id)).toEqual(["a", "c"]);
  });

  it("keeps slots and rest through draft normalization and drops malformed ones", () => {
    const normalized = normalizeActiveWorkout({ ...workout(), slots: [...slots, { id: "a", exerciseId: 9 }, { id: "", exerciseId: 1 }],
      rest: { startedAt: "2026-10-24T18:00:00.000Z", seconds: 90, setIndex: 1 } });
    expect(normalized?.slots).toEqual(slots);
    expect(normalized?.rest).toEqual({ startedAt: "2026-10-24T18:00:00.000Z", seconds: 90, exerciseId: null, setIndex: 1 });
    expect(normalizeActiveWorkout({ ...workout(), rest: { startedAt: "soon", seconds: 90 } })?.rest).toBeNull();
  });
});

describe("swapping and reordering today's plan", () => {
  const open = (slotId: string, exerciseId: number) => ({ currentExercise: { ...emptyActiveExercise(), exerciseId, slotId } });
  const order = (active: ActiveWorkout) => active.slots?.map((slot) => slot.superset ? `${slot.id}+` : slot.id);

  it("replaces the open exercise in its place, or puts the new one first so the open one comes next", () => {
    const active = workout(open("b", dip));
    const replaced = slotForChosenExercise(active, pushdown, null, true);
    expect(replaced.slots.map((slot) => slot.exerciseId)).toEqual([bench, pushdown, fly]);
    expect(slotForChosenExercise(active, pushdown, null).slots.map((slot) => slot.exerciseId)).toEqual([bench, pushdown, dip, fly]);
    // A planned exercise moves up rather than being planned twice.
    const pulled = slotForChosenExercise(active, fly, null, true);
    expect(pulled.slot.id).toBe("c");
    expect(pulled.slots.map((slot) => slot.id)).toEqual(["a", "c"]);
  });

  it("places a pick made after a save before the next waiting exercise", () => {
    const afterSave = workout({ completedExercises: [done(bench, 10)] });
    expect(slotForChosenExercise(afterSave, pushdown, null).slots.map((slot) => slot.exerciseId)).toEqual([bench, pushdown, dip, fly]);
  });

  it("moves a slot before or after another", () => {
    expect(order(moveWorkoutSlot(workout(), "c", "a", "before"))).toEqual(["c", "a", "b"]);
    expect(order(moveWorkoutSlot(workout(), "a", "b", "after"))).toEqual(["b", "a", "c"]);
  });

  it("makes supersets by dropping one exercise on another, and keeps partners side by side", () => {
    const paired = pairWorkoutSlots(workout(), "c", "a");
    expect(order(paired)).toEqual(["a+", "c+", "b"]);
    expect(new Set(paired.slots?.map((slot) => slot.superset).filter(Boolean)).size).toBe(1);
    const three = pairWorkoutSlots(paired, "b", "a");
    expect(order(three)).toEqual(["a+", "c+", "b+"]);
    // Dragged out, a partner leaves; dropped inside another superset, a slot lands after it.
    expect(order(moveWorkoutSlot(paired, "c", "b", "after"))).toEqual(["a", "b", "c"]);
    expect(order(moveWorkoutSlot(paired, "b", "c", "before"))).toEqual(["a+", "c+", "b"]);
    expect(order(moveWorkoutSlot(paired, "b", "a", "before"))).toEqual(["b", "a+", "c+"]);
  });

  it("splits a superset when a partner is unlinked or removed", () => {
    const paired = pairWorkoutSlots(workout(), "b", "a");
    expect(order(unlinkWorkoutSlot(paired, "a"))).toEqual(["b", "a", "c"]);
    expect(order(removeWorkoutSlot(paired, "b"))).toEqual(["a", "c"]);
  });

  it("keeps set-aside exercises through normalization, once per slot", () => {
    const parked = { ...emptyActiveExercise(), exerciseId: dip, slotId: "b", sets: [{ reps: "8", weight: "40" }] };
    const normalized = normalizeActiveWorkout({ ...workout(), parkedExercises: [parked, { ...parked, exerciseId: fly }, { ...parked, slotId: undefined }, "junk"] });
    expect(normalized?.parkedExercises).toEqual([expect.objectContaining({ exerciseId: dip, slotId: "b" })]);
    expect(normalizeActiveWorkout(workout())).not.toHaveProperty("parkedExercises");
  });

  it("keeps supersets through normalization, but not a superset of one", () => {
    const normalized = normalizeActiveWorkout({ ...workout(), slots: [{ ...slots[0], superset: "g" }, slots[1], { ...slots[2], superset: "g" }, { id: "d", exerciseId: 9, superset: "lonely" }] });
    expect(normalized?.slots?.map((slot) => [slot.id, slot.superset ?? null])).toEqual([["a", "g"], ["c", "g"], ["b", null], ["d", null]]);
  });

  it("finds a slot's partners that are not done yet", () => {
    const paired = pairWorkoutSlots(workout(open("a", bench)), "b", "a");
    expect(supersetSlots(paired, "a").map((slot) => slot.id)).toEqual(["a", "b"]);
    expect(supersetSlots({ ...paired, completedExercises: [done(dip, 11)] }, "a")).toEqual([]);
    expect(supersetSlots(paired, "c")).toEqual([]);
  });

  it("alternates partners within a round and rests once the round is over", () => {
    const left = new Set(["a", "b", "c"]);
    const has = (id: string) => left.has(id);
    expect(supersetNext(["a", "b", "c"], "a", has)).toEqual({ slotId: "b", rest: false });
    expect(supersetNext(["a", "b", "c"], "c", has)).toEqual({ slotId: "a", rest: true });
    left.delete("a");
    expect(supersetNext(["a", "b", "c"], "c", has)).toEqual({ slotId: "b", rest: true });
    left.clear();
    expect(supersetNext(["a", "b"], "b", has)).toEqual({ slotId: null, rest: true });
  });
});

describe("template exercises", () => {
  it("are shared by days that train the same muscles, in any listed order", () => {
    expect(templateExerciseKey(["Triceps", "Chest"])).toBe(templateExerciseKey(["Chest", "Triceps"]));
    const stored = { [templateExerciseKey(["Chest", "Triceps"])]: [{ exerciseId: bench, machineProfileId: null }, { exerciseId: dip, machineProfileId: null }] };
    expect(withTemplateExercises({ id: "legacy-weekday:wed", label: "Wed", muscles: ["Chest", "Triceps"], exerciseIds: [], createdAt: null, updatedAt: null }, stored).exerciseIds).toEqual([bench, dip]);
  });

  it("learn the order exercises were done, keep planned ones not done, and forget removed ones", () => {
    const finished = removeWorkoutSlot(workout({ completedExercises: [done(dip, 11), done(bench, 10), done(pushdown, 12, "stack-a")] }), "c");
    expect(learnedTemplateExercises(finished)).toEqual([
      { exerciseId: dip, machineProfileId: null }, { exerciseId: bench, machineProfileId: null }, { exerciseId: pushdown, machineProfileId: "stack-a" }
    ]);
    const skippedFly = workout({ completedExercises: [done(bench, 10)] });
    expect(learnedTemplateExercises(skippedFly).map((item) => item.exerciseId)).toEqual([bench, dip, fly]);
  });

  it("start a workout with fresh slot identities for each remembered exercise", () => {
    const created = slotsFromTemplate([{ exerciseId: bench, machineProfileId: null }, { exerciseId: fly, machineProfileId: "cable-left" }]);
    expect(created.map((slot) => [slot.exerciseId, slot.machineProfileId])).toEqual([[bench, null], [fly, "cable-left"]]);
    expect(new Set(created.map((slot) => slot.id)).size).toBe(2);
  });

  it("normalize stored lists, dropping duplicates and invalid entries", () => {
    expect(normalizeTemplateExercises({ "Chest+Triceps": [{ exerciseId: 1 }, { exerciseId: 1 }, { exerciseId: -2 }, "x"], empty: [], "": [{ exerciseId: 3 }] }))
      .toEqual({ "Chest+Triceps": [{ exerciseId: 1, machineProfileId: null }] });
    expect(normalizeTemplateExercises([1, 2])).toEqual({});
  });
});
