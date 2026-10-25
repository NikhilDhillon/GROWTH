/**
 * Geometry and gesture math for the flow mode dial: two concentric rings (reps
 * inside, load outside) around a Done hub. A ring rolls with the finger like a
 * timer wheel: values are laid out rising clockwise, so rolling clockwise brings
 * lower values under the 12 o'clock marker. Coordinates are in a fixed 328-wide
 * frame that the component scales to its width.
 */
export type FlowRing = "reps" | "weight";

export const flowDial = {
  width: 328,
  height: 232,
  cx: 164,
  cy: 178,
  hub: 46,
  rings: {
    reps: { r0: 54, r1: 100, degreesPerStep: 24 },
    weight: { r0: 106, r1: 160, degreesPerStep: 16 }
  }
} as const;

/** The ring under a point, with a little slack at the edges; null for the hub and outside. */
export function ringAt(x: number, y: number): FlowRing | null {
  const r = Math.hypot(x - flowDial.cx, y - flowDial.cy);
  const { reps, weight } = flowDial.rings;
  if (r >= reps.r0 - 4 && r <= reps.r1 + 3) return "reps";
  if (r > reps.r1 + 3 && r <= weight.r1 + 12) return "weight";
  return null;
}

/** Degrees clockwise from 12 o'clock. */
export function angleAt(x: number, y: number) {
  return Math.atan2(x - flowDial.cx, flowDial.cy - y) * 180 / Math.PI;
}

/** The shortest turn between two angles, so crossing 6 o'clock never jumps a full circle. */
export function angleDelta(from: number, to: number) {
  let delta = to - from;
  while (delta > 180) delta -= 360;
  while (delta <= -180) delta += 360;
  return delta;
}

/** The value under the marker after the ring has rolled by an angle (clockwise positive). */
export function rolledValue(base: number, roll: number, ring: FlowRing, step: number, minimum: number) {
  const steps = Math.round(-roll / flowDial.rings[ring].degreesPerStep);
  return Math.max(minimum, Math.round((base + steps * step) * 100) / 100);
}

/** How far clockwise a ring may roll before the value under the marker would pass the minimum. */
export function maxRoll(base: number, ring: FlowRing, step: number, minimum: number) {
  return Math.max(0, (base - minimum) / step) * flowDial.rings[ring].degreesPerStep;
}

/** The nearest resting angle, where a value sits exactly under the marker. */
export function settledRoll(roll: number, ring: FlowRing) {
  const degrees = flowDial.rings[ring].degreesPerStep;
  return -Math.round(-roll / degrees) * degrees || 0;
}

/** A point on a ring at an angle clockwise from 12 o'clock. */
export function dialPoint(r: number, degrees: number) {
  const t = degrees * Math.PI / 180;
  return { x: flowDial.cx + r * Math.sin(t), y: flowDial.cy - r * Math.cos(t) };
}

/** A filled band between two radii from one angle to another, clockwise. */
export function bandPath(r0: number, r1: number, from: number, to: number) {
  const large = to - from > 180 ? 1 : 0;
  const a = dialPoint(r1, from), b = dialPoint(r1, to), c = dialPoint(r0, to), d = dialPoint(r0, from);
  return `M${a.x} ${a.y}A${r1} ${r1} 0 ${large} 1 ${b.x} ${b.y}L${c.x} ${c.y}A${r0} ${r0} 0 ${large} 0 ${d.x} ${d.y}Z`;
}

/** A full ring as one even-odd path. */
export function ringPath(r0: number, r1: number) {
  const { cx, cy } = flowDial;
  return `M${cx - r1} ${cy}A${r1} ${r1} 0 1 1 ${cx + r1} ${cy}A${r1} ${r1} 0 1 1 ${cx - r1} ${cy}Z`
    + `M${cx - r0} ${cy}A${r0} ${r0} 0 1 0 ${cx + r0} ${cy}A${r0} ${r0} 0 1 0 ${cx - r0} ${cy}Z`;
}
