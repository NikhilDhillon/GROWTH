import { describe, expect, it } from "vitest";

import { createDefaultTrainingSplit, normalizeTrainingSplit, upgradeUncustomisedTrainingSplit } from "@/constants/trainingSplit";

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
