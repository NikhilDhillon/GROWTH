import { Platform } from "react-native";

import { addCalendarDays, calendarWeekday } from "@/domain/calendar";
import { parseImportData } from "@/services/import/importService";
import { useFitnessStore } from "@/store/useFitnessStore";
import { todayIso } from "@/utils/date";

/**
 * Development-only demo profile for trying the app on a phone or simulator.
 * It exists only in local mode (no Supabase configured) and never in release builds.
 */
export const demoAccount = { name: "Demo Lifter", email: "demo@growth.test", password: "growth-demo-2026" } as const;

declare const __DEV__: boolean | undefined;

export function demoAccountAvailable() {
  const development = typeof __DEV__ !== "undefined" && Boolean(__DEV__);
  const cloudConfigured = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  return development && (Platform.OS !== "web" || !cloudConfigured);
}

type Lift = { name: string; start: number; weeklyGain: number; increment: number; warmup?: boolean; reps: [number, number, number] };

// The default split: Saturday rest, then chest/triceps, back/biceps, legs/shoulders, twice.
const days: Record<string, Lift[]> = {
  chest: [
    { name: "Barbell Bench Press", start: 165, weeklyGain: 2.5, increment: 5, warmup: true, reps: [8, 7, 6] },
    { name: "Incline Dumbbell Press", start: 50, weeklyGain: 0.8, increment: 5, reps: [10, 9, 8] },
    { name: "Cable Fly", start: 30, weeklyGain: 0.6, increment: 5, reps: [12, 12, 10] },
    { name: "Cable Triceps Pushdown", start: 40, weeklyGain: 0.8, increment: 5, reps: [12, 10, 9] },
    { name: "Skull Crusher", start: 50, weeklyGain: 0.7, increment: 5, reps: [10, 9, 8] }
  ],
  back: [
    { name: "Barbell Row", start: 145, weeklyGain: 2, increment: 5, warmup: true, reps: [8, 8, 7] },
    { name: "Lat Pulldown", start: 120, weeklyGain: 1.5, increment: 5, reps: [10, 9, 8] },
    { name: "Seated Cable Row", start: 110, weeklyGain: 1.5, increment: 5, reps: [10, 10, 9] },
    { name: "Barbell Curl", start: 65, weeklyGain: 0.8, increment: 5, reps: [10, 8, 7] },
    { name: "Hammer Curl", start: 30, weeklyGain: 0.5, increment: 5, reps: [12, 10, 10] },
    { name: "Dumbbell Shrug", start: 60, weeklyGain: 1, increment: 5, reps: [12, 12, 10] }
  ],
  legs: [
    { name: "Back Squat", start: 215, weeklyGain: 3.5, increment: 5, warmup: true, reps: [8, 7, 6] },
    { name: "Romanian Deadlift", start: 185, weeklyGain: 2.5, increment: 5, reps: [10, 8, 8] },
    { name: "Leg Press", start: 270, weeklyGain: 5, increment: 10, reps: [12, 10, 10] },
    { name: "Overhead Press", start: 95, weeklyGain: 1.2, increment: 5, reps: [8, 7, 6] },
    { name: "Lateral Raise", start: 20, weeklyGain: 0.3, increment: 5, reps: [15, 12, 12] }
  ]
};
const rotation: Record<string, keyof typeof days | null> = { sun: "chest", mon: "back", tue: "legs", wed: "chest", thu: "back", fri: "legs", sat: null };

/** Deterministic noise so the demo looks lived-in but is identical on every device. */
function noise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function roundTo(value: number, increment: number) {
  return Math.max(increment, Math.round(value / increment) * increment);
}

export function buildDemoImport(today = todayIso(), weeks = 18) {
  const start = addCalendarDays(today, -weeks * 7);
  const workouts: object[] = [];
  const bodyweight: object[] = [];
  const bodyMeasurements: object[] = [];
  for (let offset = 0; offset < weeks * 7; offset += 1) {
    const date = addCalendarDays(start, offset);
    const week = offset / 7;
    if (noise(offset + 1) > 0.25) {
      bodyweight.push({ date, weight: Number((176 + week * 0.28 + (noise(offset + 500) - 0.5) * 1.6).toFixed(1)) });
    }
    if (offset % 14 === 0) {
      bodyMeasurements.push({ date, measurements: {
        waist: Number((32.6 - week * 0.02 + (noise(offset + 900) - 0.5) * 0.2).toFixed(2)),
        chest: Number((40.5 + week * 0.06).toFixed(2)),
        arm_flexed: { left: Number((14.6 + week * 0.025).toFixed(2)), right: Number((14.8 + week * 0.025).toFixed(2)) },
        thigh: { left: Number((23.4 + week * 0.03).toFixed(2)), right: Number((23.5 + week * 0.03).toFixed(2)) }
      } });
    }
    const plan = rotation[calendarWeekday(date)];
    // About one planned session in ten is missed, like a real training log.
    if (!plan || noise(offset + 1300) < 0.1) continue;
    const easyDay = noise(offset + 1700) < 0.2;
    workouts.push({ date, exercises: days[plan].map((lift, index) => {
      const load = roundTo(lift.start + lift.weeklyGain * week + (noise(offset * 7 + index) - 0.5) * lift.increment, lift.increment);
      const sets = lift.reps.map((reps) => ({ reps: Math.max(4, reps - (easyDay ? 1 : 0)), weight: load }));
      return { name: lift.name, sets: lift.warmup ? [{ reps: 8, weight: roundTo(load * 0.5, lift.increment), isWarmup: true }, ...sets] : sets };
    }) });
  }
  return JSON.stringify({ schemaVersion: 2, unit: "lb", bodyweightUnit: "lb", bodyMeasurementUnit: "in", bodyweight, bodyMeasurements, workouts });
}

/** Signs into the demo profile, creating and filling it on first use. Returns a user-facing error, if any. */
export async function loadDemoAccount(): Promise<string | null> {
  const store = useFitnessStore.getState;
  await store().login({ email: demoAccount.email, password: demoAccount.password });
  if (store().currentUser) return null;
  useFitnessStore.setState({ authError: null });
  await store().register({ ...demoAccount });
  if (!store().currentUser) return store().authError ?? "Could not create the demo account.";
  try {
    const preview = parseImportData(buildDemoImport(), store().exercises);
    await store().importTrainingData({ ...preview, expectedAccountId: store().currentUser?.id });
    useFitnessStore.setState({ operationNotice: "Demo account loaded with 18 weeks of training, weigh-ins and tape measurements." });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load demo data.";
    useFitnessStore.setState({ operationNotice: `Demo account created, but its data could not load: ${message}` });
    return message;
  }
}
