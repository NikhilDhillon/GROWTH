import { describe, expect, it } from "vitest";

import { createDefaultTrainingSplit, normalizeTrainingSplit, sameTrainingSplitDays, setSplitDayMuscles, toggleSplitDayMuscle, upgradeUncustomisedTrainingSplit } from "@/constants/trainingSplit";

const previousDefault = [
  { key: "mon", label: "Mon", muscles: ["Chest", "Triceps"] },
  { key: "tue", label: "Tue", muscles: ["Back", "Biceps", "Traps"] },
  { key: "wed", label: "Wed", muscles: ["Legs", "Shoulders"] },
  { key: "thu", label: "Thu", muscles: [] },
  { key: "fri", label: "Fri", muscles: ["Chest", "Triceps"] },
  { key: "sat", label: "Sat", muscles: ["Back", "Biceps", "Traps"] },
  { key: "sun", label: "Sun", muscles: ["Legs", "Shoulders"] }
];

describe("training split defaults", () => {
  it("rests on Saturday and rotates chest/triceps, back/biceps, legs/shoulders from Sunday", () => {
    const days = Object.fromEntries(createDefaultTrainingSplit().days.map((day) => [day.key, day.muscles]));
    expect(days).toEqual({
      sun: ["Chest", "Triceps"], mon: ["Back", "Biceps", "Traps"], tue: ["Legs", "Shoulders"],
      wed: ["Chest", "Triceps"], thu: ["Back", "Biceps", "Traps"], fri: ["Legs", "Shoulders"], sat: []
    });
  });

  it("moves an untouched previous default to the current one and keeps its metadata", () => {
    const saved = normalizeTrainingSplit({ days: previousDefault, updated_at: "2026-07-01T00:00:00.000Z", updated_by: "You" });
    const upgraded = upgradeUncustomisedTrainingSplit(saved);
    expect(upgraded.days).toEqual(createDefaultTrainingSplit().days);
    expect(upgraded.updated_at).toBe("2026-07-01T00:00:00.000Z");
  });

  it("never rewrites a customised split", () => {
    const custom = normalizeTrainingSplit({ days: previousDefault.map((day) => day.key === "thu" ? { ...day, muscles: ["Forearms"] } : day) });
    expect(upgradeUncustomisedTrainingSplit(custom)).toBe(custom);
  });
});

describe("editing a training split", () => {
  const days = () => createDefaultTrainingSplit().days;
  const musclesOn = (split: ReturnType<typeof days>, key: string) => split.find((day) => day.key === key)?.muscles;

  it("adds and removes a muscle on one day, keeping display order and the other days", () => {
    const added = toggleSplitDayMuscle(days(), "mon", "Chest");
    expect(musclesOn(added, "mon")).toEqual(["Chest", "Back", "Biceps", "Traps"]);
    expect(musclesOn(toggleSplitDayMuscle(added, "mon", "Traps"), "mon")).toEqual(["Chest", "Back", "Biceps"]);
    expect(added.filter((day) => day.key !== "mon")).toEqual(days().filter((day) => day.key !== "mon"));
  });

  it("sets a whole day, dropping duplicates, and an empty list makes it a rest day", () => {
    expect(musclesOn(setSplitDayMuscles(days(), "sat", ["Shoulders", "Legs", "Legs"]), "sat")).toEqual(["Legs", "Shoulders"]);
    expect(musclesOn(setSplitDayMuscles(days(), "sun", []), "sun")).toEqual([]);
  });

  it("never mutates the split it was given", () => {
    const original = days();
    toggleSplitDayMuscle(original, "tue", "Abs");
    setSplitDayMuscles(original, "wed", []);
    expect(original).toEqual(days());
  });

  it("treats the same muscles in a different order as unchanged", () => {
    const reordered = days().map((day) => ({ ...day, muscles: [...day.muscles].reverse() }));
    expect(sameTrainingSplitDays(days(), reordered)).toBe(true);
    expect(sameTrainingSplitDays(days(), toggleSplitDayMuscle(days(), "sat", "Abs"))).toBe(false);
  });
});
