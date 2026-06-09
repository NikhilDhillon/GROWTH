import { MachineProfile, MachineProfileType, MachineStackUnit, UnitSystem } from "@/types";

export type MachineProfileDraft = {
  id?: string;
  label: string;
  machineType: MachineProfileType;
  stackUnit: MachineStackUnit;
  increment: number;
  minLoad: number;
  maxLoad: number;
  pulleyRatio: MachineProfile["pulleyRatio"];
  location?: string;
  modelName?: string;
  notes?: string;
  exerciseIds?: number[];
};

export const machineProfileTypeOptions: Array<{
  type: MachineProfileType;
  label: string;
  detail: string;
}> = [
  { type: "single_pulley", label: "Single pulley", detail: "One cable stack, common for pushdowns and curls." },
  { type: "dual_pulley", label: "Dual pulley", detail: "Two adjustable arms or two sides of one station." },
  { type: "lat_pulldown", label: "Lat pulldown", detail: "Tall selectorized pulldown with thigh pads." },
  { type: "low_row", label: "Low row", detail: "Seated or floor-level cable row station." },
  { type: "cable_crossover", label: "Cable crossover", detail: "Wide station with left and right stacks." },
  { type: "selectorized", label: "Selectorized machine", detail: "Pin-loaded machine with a guided movement path." }
];

export const pulleyRatioOptions: MachineProfile["pulleyRatio"][] = ["unknown", "1:1", "2:1", "4:1"];

export function createMachineProfile(input: MachineProfileDraft, existing?: MachineProfile): MachineProfile {
  const timestamp = new Date().toISOString();
  const increment = positiveNumber(input.increment, 5);
  const minLoad = nonNegativeNumber(input.minLoad, 0);
  const maxLoad = Math.max(minLoad + increment, positiveNumber(input.maxLoad, 100));
  return {
    id: existing?.id ?? input.id ?? createId(),
    label: cleanText(input.label) || machineTypeLabel(input.machineType),
    machineType: validMachineType(input.machineType),
    stackUnit: validStackUnit(input.stackUnit),
    increment,
    minLoad,
    maxLoad,
    pulleyRatio: validPulleyRatio(input.pulleyRatio),
    location: cleanText(input.location),
    modelName: cleanText(input.modelName),
    notes: cleanText(input.notes),
    exerciseIds: normalizeExerciseIds(input.exerciseIds ?? existing?.exerciseIds ?? []),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    lastUsedAt: existing?.lastUsedAt ?? null
  };
}

export function normalizeMachineProfiles(value: unknown): MachineProfile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const input = record as Partial<MachineProfile>;
    if (typeof input.id !== "string") return [];
    const profile = createMachineProfile({
      id: input.id,
      label: input.label ?? "",
      machineType: input.machineType ?? "selectorized",
      stackUnit: input.stackUnit ?? "lb",
      increment: Number(input.increment),
      minLoad: Number(input.minLoad),
      maxLoad: Number(input.maxLoad),
      pulleyRatio: input.pulleyRatio ?? "unknown",
      location: input.location,
      modelName: input.modelName,
      notes: input.notes,
      exerciseIds: input.exerciseIds
    }, {
      ...input,
      id: input.id,
      label: input.label ?? "",
      machineType: input.machineType ?? "selectorized",
      stackUnit: input.stackUnit ?? "lb",
      increment: Number(input.increment),
      minLoad: Number(input.minLoad),
      maxLoad: Number(input.maxLoad),
      pulleyRatio: input.pulleyRatio ?? "unknown",
      exerciseIds: normalizeExerciseIds(input.exerciseIds),
      createdAt: typeof input.createdAt === "string" ? input.createdAt : new Date().toISOString(),
      updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
      lastUsedAt: typeof input.lastUsedAt === "string" ? input.lastUsedAt : null
    });
    return [{ ...profile, lastUsedAt: typeof input.lastUsedAt === "string" ? input.lastUsedAt : null }];
  }).sort(compareMachineProfiles);
}

export function upsertMachineProfile(profiles: MachineProfile[], profile: MachineProfile) {
  const existing = profiles.some((item) => item.id === profile.id);
  const next = existing
    ? profiles.map((item) => (item.id === profile.id ? profile : item))
    : [profile, ...profiles];
  return normalizeMachineProfiles(next);
}

export function touchMachineProfile(profiles: MachineProfile[], profileId: string | null | undefined, exerciseId?: number | null) {
  if (!profileId) return profiles;
  const timestamp = new Date().toISOString();
  return normalizeMachineProfiles(profiles.map((profile) => {
    if (profile.id !== profileId) return profile;
    const exerciseIds = exerciseId ? normalizeExerciseIds([...profile.exerciseIds, exerciseId]) : profile.exerciseIds;
    return { ...profile, exerciseIds, lastUsedAt: timestamp, updatedAt: timestamp };
  }));
}

export function preferredMachineProfile(profiles: MachineProfile[], exerciseId?: number | null) {
  const sorted = normalizeMachineProfiles(profiles);
  return sorted.find((profile) => Boolean(exerciseId && profile.exerciseIds.includes(exerciseId))) ?? sorted[0] ?? null;
}

export function profileAppliesToExercise(profile: MachineProfile | null | undefined, exerciseId?: number | null) {
  if (!profile || !exerciseId) return false;
  return profile.exerciseIds.length === 0 || profile.exerciseIds.includes(exerciseId);
}

export function machineTypeLabel(type: MachineProfileType) {
  return machineProfileTypeOptions.find((option) => option.type === type)?.label ?? "Cable machine";
}

export function stackUnitLabel(unit: MachineStackUnit, fallbackUnit: UnitSystem) {
  if (unit === "plate") return "plate";
  return unit || fallbackUnit;
}

export function formatMachineLoad(value: number | string, profile: MachineProfile | null | undefined, fallbackUnit: UnitSystem) {
  const parsed = typeof value === "number" ? value : Number(value.trim().replace(",", "."));
  if (!Number.isFinite(parsed)) return "";
  const formatted = parsed.toFixed(1).replace(".0", "");
  const unit = stackUnitLabel(profile?.stackUnit ?? fallbackUnit, fallbackUnit);
  return unit === "plate" ? `plate ${formatted}` : `${formatted} ${unit}`;
}

export function suggestedMachineLoads(profile: MachineProfile | null | undefined, lastLoad?: number | null) {
  if (!profile) return [];
  const step = positiveNumber(profile.increment, 5);
  const base = Number.isFinite(lastLoad) && Number(lastLoad) > 0 ? Number(lastLoad) : Math.max(profile.minLoad, step);
  const values = [-2, -1, 0, 1, 2]
    .map((offset) => roundToStep(base + offset * step, step))
    .filter((value) => value >= profile.minLoad && value <= profile.maxLoad);
  return [...new Set(values)].sort((left, right) => left - right);
}

export function inferMachineDraftFromModel(modelName: string, unitSystem: UnitSystem): Partial<MachineProfileDraft> {
  const text = modelName.toLowerCase();
  const stackUnit = text.includes("kg") ? "kg" : text.includes("plate") ? "plate" : unitSystem;
  const increment = stackUnit === "kg" ? 2.5 : stackUnit === "plate" ? 1 : 5;
  const machineType: MachineProfileType = text.includes("lat")
    ? "lat_pulldown"
    : text.includes("row")
      ? "low_row"
      : text.includes("dual") || text.includes("functional")
        ? "dual_pulley"
        : text.includes("crossover")
          ? "cable_crossover"
          : text.includes("single")
            ? "single_pulley"
            : "selectorized";
  const pulleyRatio: MachineProfile["pulleyRatio"] = text.includes("2:1") || text.includes("half") ? "2:1" : text.includes("4:1") ? "4:1" : "unknown";
  return { machineType, stackUnit, increment, pulleyRatio };
}

function compareMachineProfiles(left: MachineProfile, right: MachineProfile) {
  const leftUsed = left.lastUsedAt ?? left.updatedAt;
  const rightUsed = right.lastUsedAt ?? right.updatedAt;
  return rightUsed.localeCompare(leftUsed) || left.label.localeCompare(right.label);
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validMachineType(value: unknown): MachineProfileType {
  return machineProfileTypeOptions.some((option) => option.type === value) ? value as MachineProfileType : "selectorized";
}

function validStackUnit(value: unknown): MachineStackUnit {
  return value === "kg" || value === "plate" ? value : "lb";
}

function validPulleyRatio(value: unknown): MachineProfile["pulleyRatio"] {
  return value === "1:1" || value === "2:1" || value === "4:1" ? value : "unknown";
}

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeExerciseIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

function roundToStep(value: number, step: number) {
  return Number((Math.round(value / step) * step).toFixed(2));
}

function createId() {
  return `machine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
