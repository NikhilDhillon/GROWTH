export function createEmptyPlateCounts() {
  return { 45: 0, 35: 0, 25: 0, 10: 0, 5: 0 };
}

export function formatElapsedWorkoutTime(startedAt: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  return `${hours}:${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
