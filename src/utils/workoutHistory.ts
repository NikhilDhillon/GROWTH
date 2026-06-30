import { WorkoutSession, WorkoutSet } from "@/types";

export function latestSetsForExercise(input: {
  exerciseId: number;
  sessions: WorkoutSession[];
  sets: WorkoutSet[];
  machineProfileId?: string | null;
  machineScoped?: boolean;
  includeWarmups?: boolean;
}) {
  const sessionById = new Map(input.sessions.map((session) => [session.id, session]));
  const grouped = input.sets
    .filter((set) => set.exercise_id === input.exerciseId)
    .filter((set) => input.includeWarmups || !set.is_warmup)
    .filter((set) => {
      const sessionMachineProfileId = sessionById.get(set.session_id)?.machine_profile_id ?? null;
      if (input.machineScoped) return Boolean(input.machineProfileId) && sessionMachineProfileId === input.machineProfileId;
      return !input.machineProfileId || sessionMachineProfileId === input.machineProfileId;
    })
    .reduce<Map<number, WorkoutSet[]>>((output, set) => {
      output.set(set.session_id, [...(output.get(set.session_id) ?? []), set]);
      return output;
    }, new Map());

  const latest = [...grouped.entries()]
    .map(([sessionId, groupedSets]) => ({
      sessionId,
      date: sessionById.get(sessionId)?.workout_date ?? groupedSets[0].created_at.slice(0, 10),
      sets: groupedSets.sort((left, right) => left.set_number - right.set_number)
    }))
    .sort((left, right) => left.date.localeCompare(right.date) || left.sessionId - right.sessionId)
    .at(-1);

  return latest?.sets ?? [];
}
