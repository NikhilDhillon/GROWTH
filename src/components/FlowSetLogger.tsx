import { useEffect, useRef, useState } from "react";
import { GestureResponderEvent, Platform, Pressable, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Line, Path, Polygon, Rect, Stop, Text as SvgText } from "react-native-svg";

const watchTicks = 60;
/** The rest ring reads like a kitchen timer: a full turn is three minutes. */
const restFaceSeconds = 180;
const secondsPerTick = restFaceSeconds / watchTicks;
import { Check, Plus } from "lucide-react-native";

import { FlowLoadGhost } from "@/components/FlowLoadGhost";
import { Body } from "@/components/Text";
import { restLimits } from "@/constants/guidedWorkout";
import { isLoggedSet } from "@/services/workouts/setCapture";
import type { FlowLoadGhostKind } from "@/services/workouts/loadGhost";
import { angleAt, angleDelta, dialPoint, flowDial, FlowRing, maxRoll, ringAt, ringPath, rolledValue, settledRoll } from "@/services/workouts/flowDial";
import type { LoggedSetDraft } from "@/types";
import { confirmHaptic, tickHaptic } from "@/utils/haptics";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

export type FlowRest = {
  remaining: number;
  total: number;
  /** The next set of this exercise, e.g. "210 × 8"; null after its last set. */
  next: string | null;
  nextExercise: string | null;
  canAddSet: boolean;
};

type Props = {
  sets: readonly LoggedSetDraft[];
  /** The row the dial logs next; null once every row is logged. */
  row: number | null;
  weight: number;
  reps: number;
  weightStep: number;
  /** "lb", "lb added" or "lb assist". */
  weightCaption: string;
  formatLoad: (load: number) => string;
  rest: FlowRest | null;
  /** Shown once every set is logged, e.g. while the exercise saves. */
  status?: string | null;
  /** Fill the screen: the numbers take the free space and the dial sits at the bottom. */
  fill?: boolean;
  /** The dial is reopening an already logged set (row) to correct it. */
  editing?: boolean;
  /** A faint bar or cable stack above the numbers, showing the settled load. */
  loadGhost?: FlowLoadGhostKind | null;
  disabled?: boolean;
  onChange: (values: { weight: number; reps: number }) => void;
  onLog: () => void;
  onSkipRest: () => void;
  onAddSet: () => void;
  /** Winding the rest ring: the rest now ends this many seconds from now. */
  onAdjustRest?: (seconds: number) => void;
  /** The current exercise's note, shown under the set pills; tapping it opens the note. */
  note?: string;
  onNote?: () => void;
  /** Tapping a finished set's pill reopens it on the dial. */
  onEditSet?: (row: number) => void;
  /** While editing: put the set back in the queue, or leave it as it was. */
  onUnlog?: () => void;
  onCancelEdit?: () => void;
};

type Roll = { base: number; roll: number };

const { width: frameWidth, height: frameHeight, cx, cy, hub } = flowDial;
const ringOrder: FlowRing[] = ["weight", "reps"];
/** SVG text on the web does not inherit the app's system font. */
const dialFont = Platform.OS === "web" ? "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" : undefined;
/** Momentum runs on elapsed time, so slow or throttled frames never stretch a spin out. */
const frictionPerMs = 0.992;
/** Degrees per millisecond; a hard flick still travels only a handful of values. */
const maxSpin = 1.1;
const maxCoastMs = 1200;

function formatRest(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Flow mode: the next set's weight and reps are read at the top and changed by
 * rolling the dial underneath like a timer wheel. A flick keeps it spinning, it
 * settles on a value, and each value passing the marker ticks. The hub logs the
 * set or skips rest.
 */
export function FlowSetLogger(props: Props) {
  const { sets, row, weight, reps, weightStep, weightCaption, formatLoad, rest, status, fill = false, editing = false, disabled = false } = props;
  const { palette, styles } = useStyles();
  const [width, setWidth] = useState(0);
  const [activeRing, setActiveRing] = useState<FlowRing | null>(null);
  const [, setFrameCount] = useState(0);
  const dialRef = useRef<View>(null);
  const rolls = useRef<Record<FlowRing, Roll>>({ weight: { base: weight, roll: 0 }, reps: { base: reps, roll: 0 } });
  const shown = useRef<Record<FlowRing, number>>({ weight, reps });
  const motion = useRef<{ ring: FlowRing; last: number; time: number; velocity: number } | null>(null);
  const frame = useRef<number | null>(null);
  const coasting = useRef<FlowRing | null>(null);
  const settledLoad = useRef(weight);

  const scale = width / frameWidth;
  const resting = Boolean(rest);
  const turning = row !== null && !resting && !disabled;
  const loggedCount = sets.filter(isLoggedSet).length;

  // Values set elsewhere (a new set, an undo) reset the wheels whenever they are at rest.
  if (!motion.current && frame.current === null) {
    for (const [ring, value] of [["weight", weight], ["reps", reps]] as const) {
      if (rolls.current[ring].base !== value || rolls.current[ring].roll !== 0) rolls.current[ring] = { base: value, roll: 0 };
      shown.current[ring] = value;
    }
  }
  // The load picture follows the wheel only once it has settled.
  if (!motion.current && frame.current === null) settledLoad.current = weight;
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  const stepOf = (ring: FlowRing) => ring === "reps" ? 1 : weightStep;
  const minimumOf = (ring: FlowRing) => ring === "reps" ? 1 : 0;
  const valueOf = (ring: FlowRing) => rolledValue(rolls.current[ring].base, rolls.current[ring].roll, ring, stepOf(ring), minimumOf(ring));
  const redraw = () => setFrameCount((count) => count + 1);

  function report(ring: FlowRing) {
    const value = valueOf(ring);
    if (value === shown.current[ring]) return;
    shown.current[ring] = value;
    tickHaptic();
    props.onChange({ weight: valueOf("weight"), reps: valueOf("reps") });
  }

  function framePoint(event: GestureResponderEvent) {
    const native = event.nativeEvent as unknown as Record<string, any>;
    const node = dialRef.current as unknown as { getBoundingClientRect?: () => { left: number; top: number } } | null;
    let point: { x: number; y: number } | null = null;
    if (Platform.OS === "web" && node?.getBoundingClientRect) {
      const touch = native.touches?.[0] ?? native.changedTouches?.[0];
      const clientX = touch?.clientX ?? native.clientX;
      const clientY = touch?.clientY ?? native.clientY;
      if (typeof clientX === "number" && typeof clientY === "number") {
        const rect = node.getBoundingClientRect();
        point = { x: clientX - rect.left, y: clientY - rect.top };
      }
    }
    if (!point && typeof native.locationX === "number" && typeof native.locationY === "number") point = { x: native.locationX, y: native.locationY };
    return point && scale > 0 ? { x: point.x / scale, y: point.y / scale } : null;
  }

  function stopMomentum() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    coasting.current = null;
  }

  function grab(event: GestureResponderEvent) {
    const point = framePoint(event);
    const ring = point ? ringAt(point.x, point.y) : null;
    if (!point || !ring) return;
    stopMomentum();
    motion.current = { ring, last: angleAt(point.x, point.y), time: Date.now(), velocity: 0 };
    setActiveRing(ring);
  }

  function turn(event: GestureResponderEvent) {
    const current = motion.current;
    const point = framePoint(event);
    if (!current || !point) return;
    const angle = angleAt(point.x, point.y);
    const delta = angleDelta(current.last, angle);
    const now = Date.now();
    const state = rolls.current[current.ring];
    const limit = maxRoll(state.base, current.ring, stepOf(current.ring), minimumOf(current.ring));
    // A little give past the lowest value, pulled back when released.
    state.roll = Math.min(limit + flowDial.rings[current.ring].degreesPerStep * 0.35, state.roll + delta);
    const sample = Math.max(-maxSpin, Math.min(maxSpin, delta / Math.max(8, now - current.time)));
    current.velocity = 0.6 * current.velocity + 0.4 * sample;
    current.last = angle;
    current.time = now;
    report(current.ring);
    redraw();
  }

  function release() {
    const current = motion.current;
    if (!current) return;
    motion.current = null;
    setActiveRing(null);
    const ring = current.ring;
    coasting.current = ring;
    // A finger that stopped before lifting leaves the wheel where it is.
    let velocity = Date.now() - current.time > 90 ? 0 : current.velocity;
    const started = Date.now();
    let last = started;
    const run = () => {
      const now = Date.now();
      const elapsed = Math.min(250, now - last);
      last = now;
      const state = rolls.current[ring];
      const limit = maxRoll(state.base, ring, stepOf(ring), minimumOf(ring));
      if (Math.abs(velocity) > 0.01 && state.roll < limit && now - started < maxCoastMs) {
        state.roll = Math.min(limit, state.roll + velocity * elapsed);
        velocity *= Math.pow(frictionPerMs, elapsed);
      } else {
        const target = settledRoll(Math.min(state.roll, limit), ring);
        const gap = target - state.roll;
        if (Math.abs(gap) < 0.3) {
          state.roll = target;
          report(ring);
          rolls.current[ring] = { base: valueOf(ring), roll: 0 };
          frame.current = null;
          coasting.current = null;
          redraw();
          return;
        }
        state.roll += gap * (1 - Math.pow(0.75, elapsed / 16));
      }
      report(ring);
      redraw();
      frame.current = requestAnimationFrame(run);
    };
    frame.current = requestAnimationFrame(run);
  }

  function ringMarks(ring: FlowRing) {
    const { r0, r1, degreesPerStep } = flowDial.rings[ring];
    const middle = (r0 + r1) / 2;
    const state = rolls.current[ring];
    const center = Math.round(-state.roll / degreesPerStep);
    const marks = [];
    for (let index = center - 8; index <= center + 8; index += 1) {
      const angle = index * degreesPerStep + state.roll;
      const value = Math.round((state.base + index * stepOf(ring)) * 100) / 100;
      if (Math.abs(angle) > 112 || value < minimumOf(ring)) continue;
      if (Math.abs(index - center) <= 2) {
        const nearness = Math.max(0, 1 - Math.abs(angle) / degreesPerStep);
        const point = dialPoint(middle, angle);
        marks.push(<SvgText key={`${ring}-${index}`} x={point.x} y={point.y + 5 + 2 * nearness} textAnchor="middle" fontFamily={dialFont}
          fill={nearness > 0.5 ? palette.ink : palette.muted} fontSize={13 + 6 * nearness} fontWeight={nearness > 0.5 ? "800" : "600"}>
          {ring === "reps" ? String(value) : formatLoad(value)}
        </SvgText>);
      } else {
        const inner = dialPoint(middle - 3, angle), outer = dialPoint(middle + 3, angle);
        marks.push(<Line key={`${ring}-${index}`} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={palette.border} strokeWidth={1.5} strokeLinecap="round" />);
      }
    }
    return marks;
  }

  function nudge(ring: FlowRing, direction: 1 | -1) {
    const value = Math.max(minimumOf(ring), Math.round((valueOf(ring) + direction * stepOf(ring)) * 100) / 100);
    props.onChange(ring === "reps" ? { weight, reps: value } : { weight: value, reps });
  }

  const hubLabel = resting ? "Skip" : editing ? "Save" : row !== null ? "Done" : "…";
  const hubAccessibility = resting ? "Skip rest" : editing ? `Save set ${(row ?? 0) + 1} as ${formatLoad(weight)} ${weightCaption} for ${reps} reps`
    : row !== null ? `Log ${formatLoad(weight)} ${weightCaption} for ${reps} reps` : status ?? "Saving";
  const onHub = resting ? props.onSkipRest : row !== null ? () => { confirmHaptic(); props.onLog(); } : undefined;
  let working = 0;
  const setNames = sets.map((set) => set.isWarmup ? "Warm-up" : `Set ${++working}`);
  const restCaption = !rest ? "" : rest.next ? `next ${rest.next}` : rest.nextExercise ? `next: ${rest.nextExercise}` : "rest";

  return (
    <View style={[styles.wrap, fill && styles.fill]}>
      <View style={styles.pills}>
        {sets.map((set, index) => {
          if (isLoggedSet(set)) {
            const open = editing && index === row;
            return <Pressable key={index} accessibilityRole="button" accessibilityLabel={`${setNames[index]}: ${formatLoad(Number(set.weight))} × ${set.reps}. ${open ? "Being edited" : "Edit"}`}
              hitSlop={{ top: 0, bottom: 6, left: 4, right: 4 }} disabled={disabled || !props.onEditSet} onPress={() => open ? props.onCancelEdit?.() : props.onEditSet?.(index)}
              style={pressableFeedback([styles.pill, open ? styles.pillCurrent : styles.pillDone])}>
              {open ? null : <Check size={13} color={palette.muted} />}
              <Body style={open ? [styles.pillText, styles.pillCurrentText] : styles.pillDoneText}>{open ? setNames[index] : `${formatLoad(Number(set.weight))} × ${set.reps}`}</Body>
            </Pressable>;
          }
          const current = index === row && !resting;
          return <View key={index} style={[styles.pill, current && styles.pillCurrent]}>
            <Body style={[styles.pillText, current && styles.pillCurrentText]}>{setNames[index]}</Body>
          </View>;
        })}
      </View>

      {props.onNote ? <Pressable accessibilityRole="button" accessibilityLabel={props.note?.trim() ? `Note: ${props.note.trim()}. Edit note` : "Add a note"} disabled={disabled}
        onPress={props.onNote} style={pressableFeedback(styles.note)}>
        {props.note?.trim() ? null : <Plus size={14} color={palette.muted} />}
        <Body numberOfLines={1} style={[styles.noteText, Boolean(props.note?.trim()) && styles.noteTextFilled]}>{props.note?.trim() || "Add note"}</Body>
      </Pressable> : null}

      {rest ? <RestWatch rest={rest} caption={restCaption} disabled={disabled} onAddSet={props.onAddSet} onAdjust={props.onAdjustRest} /> : null}
      {rest ? null : <View accessibilityLiveRegion="polite" style={[styles.hero, fill && styles.heroFill]}>
        {row === null ? <View style={styles.heroBlock}>
          <Body style={styles.heroDone}>{status ?? `${loggedCount} ${loggedCount === 1 ? "set" : "sets"} logged`}</Body>
        </View> : <View style={styles.heroBlock}>
          {props.loadGhost ? <FlowLoadGhost visual={props.loadGhost} load={settledLoad.current}
            dimmed={activeRing === "weight" || coasting.current === "weight"} /> : null}
          {editing ? <Body style={styles.heroCaption}>Fixing {setNames[row ?? 0]?.toLowerCase()}</Body> : null}
          <View style={styles.heroValues}>
          <View style={styles.heroBlock}>
            <Body style={[styles.heroNumber, fill && styles.heroNumberFill, activeRing === "reps" && styles.heroDimmed]}>{formatLoad(weight)}</Body>
            <Body style={styles.heroCaption}>{weightCaption}</Body>
          </View>
          <Body style={[styles.heroTimes, fill && styles.heroTimesFill]}>×</Body>
          <View style={styles.heroBlock}>
            <Body style={[styles.heroNumber, fill && styles.heroNumberFill, activeRing === "weight" && styles.heroDimmed]}>{reps}</Body>
            <Body style={styles.heroCaption}>reps</Body>
          </View>
          </View>
          {editing ? <View style={styles.links}>
            <Pressable accessibilityRole="button" disabled={disabled} onPress={props.onUnlog} style={pressableFeedback(styles.link)}>
              <Body style={styles.linkText}>Not done</Body>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={disabled} onPress={props.onCancelEdit} style={pressableFeedback(styles.link)}>
              <Body style={styles.linkText}>Cancel</Body>
            </Pressable>
          </View> : null}
        </View>}
      </View>}

      {rest ? <Pressable accessibilityRole="button" accessibilityLabel="Skip rest" disabled={disabled} onPress={props.onSkipRest} style={pressableFeedback(styles.skip)}>
        <Body style={styles.skipText}>Skip rest</Body>
      </Pressable> : <View
        ref={dialRef}
        style={[styles.dial, { height: scale ? frameHeight * scale : frameHeight }, disabled && styles.disabled]}
        onLayout={(event) => setWidth(Math.max(1, event.nativeEvent.layout.width))}
        onStartShouldSetResponder={(event) => {
          if (!turning) return false;
          const point = framePoint(event);
          return Boolean(point && ringAt(point.x, point.y));
        }}
        onResponderTerminationRequest={() => false}
        onResponderGrant={grab}
        onResponderMove={turn}
        onResponderRelease={release}
        onResponderTerminate={release}
      >
        {width ? (
          <Svg width={width} height={frameHeight * scale} viewBox={`0 0 ${frameWidth} ${frameHeight}`} pointerEvents="none">
            <Defs>
              <LinearGradient id="flowDialFade" x1="0" y1={String(cy)} x2="0" y2={String(cy + 48)} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={fill ? palette.background : palette.surface} stopOpacity={0} />
                <Stop offset="1" stopColor={fill ? palette.background : palette.surface} stopOpacity={1} />
              </LinearGradient>
            </Defs>
            {turning ? ringOrder.map((ring) => {
              const { r0, r1 } = flowDial.rings[ring];
              return <Path key={ring} d={ringPath(r0, r1)} fillRule="evenodd" fill={activeRing === ring ? palette.border : palette.surfaceAlt} />;
            }) : <Path d={ringPath(flowDial.rings.reps.r0, flowDial.rings.weight.r1)} fillRule="evenodd" fill={palette.surfaceAlt} />}
            {turning ? [...ringMarks("weight"), ...ringMarks("reps")] : null}
            {turning ? <Polygon points={`${cx - 6},4 ${cx + 6},4 ${cx},13`} fill={palette.ink} /> : null}
            <Rect x={0} y={cy} width={frameWidth} height={frameHeight - cy} fill="url(#flowDialFade)" />
          </Svg>
        ) : null}
        {width && turning ? ringOrder.map((ring) => {
          // Screen readers adjust each ring by a step; touches pass through to the dial.
          const size = 64 * scale;
          return <View key={ring} pointerEvents="none" accessible accessibilityRole="adjustable" accessibilityLabel={ring === "reps" ? "Reps" : `Weight in ${weightCaption}`}
            accessibilityValue={{ text: ring === "reps" ? `${reps} reps` : `${formatLoad(weight)} ${weightCaption}` }}
            accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
            onAccessibilityAction={(event) => nudge(ring, event.nativeEvent.actionName === "increment" ? 1 : -1)}
            style={[styles.ringTarget, { left: (cx * scale) - size / 2, top: (cy - flowDial.rings[ring].r1 + 4) * scale, width: size, height: size }]} />;
        }) : null}
        {width ? (
          <Pressable accessibilityRole="button" accessibilityLabel={hubAccessibility} disabled={disabled || !onHub} onPress={onHub}
            style={pressableFeedback([styles.hub, { left: (cx - hub) * scale, top: (cy - hub) * scale, width: hub * 2 * scale, height: hub * 2 * scale, borderRadius: hub * scale }])}>
            <Body style={styles.hubText}>{hubLabel}</Body>
          </Pressable>
        ) : null}
      </View>}
    </View>
  );
}

/**
 * Rest as a kitchen timer: the face is three minutes, one tick per three seconds,
 * lit while that time remains. Past three minutes the ring goes round again: an
 * inner row lights from 12 o'clock for the time beyond. Winding the ring clockwise
 * adds time and anticlockwise takes it away, keeping the whole rest within 1:30 to
 * 5:00, ticking as it goes; letting go snaps to five seconds.
 */
function RestWatch({ rest, caption, disabled, onAddSet, onAdjust }: {
  rest: FlowRest; caption: string; disabled: boolean; onAddSet: () => void; onAdjust?: (seconds: number) => void;
}) {
  const { palette, styles } = useStyles();
  const [size, setSize] = useState(0);
  const [winding, setWinding] = useState<number | null>(null);
  const faceRef = useRef<View>(null);
  const wind = useRef<{ last: number; seconds: number; min: number; max: number } | null>(null);
  const shown = winding ?? Math.max(0, rest.remaining);
  const lit = Math.ceil(Math.min(restFaceSeconds, shown) / secondsPerTick);
  const lapLit = Math.ceil(Math.max(0, shown - restFaceSeconds) / secondsPerTick);
  const ticks = Array.from({ length: watchTicks }, (_, index) => {
    const major = index % 5 === 0;
    const inner = dialPointOn(major ? 84 : 87, index * 6), outer = dialPointOn(96, index * 6);
    return <Line key={index} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={index < lit ? palette.ink : palette.border}
      strokeWidth={major ? 2.4 : 1.4} strokeLinecap="round" />;
  });
  const lapTicks = Array.from({ length: lapLit }, (_, index) => {
    const major = index % 5 === 0;
    const inner = dialPointOn(major ? 68 : 71, index * 6), outer = dialPointOn(79, index * 6);
    return <Line key={`lap-${index}`} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={palette.ink}
      strokeWidth={major ? 2.4 : 1.4} strokeLinecap="round" />;
  });

  function facePoint(event: GestureResponderEvent) {
    const native = event.nativeEvent as unknown as Record<string, any>;
    const node = faceRef.current as unknown as { getBoundingClientRect?: () => { left: number; top: number } } | null;
    let point: { x: number; y: number } | null = null;
    if (Platform.OS === "web" && node?.getBoundingClientRect) {
      const touch = native.touches?.[0] ?? native.changedTouches?.[0];
      const clientX = touch?.clientX ?? native.clientX;
      const clientY = touch?.clientY ?? native.clientY;
      if (typeof clientX === "number" && typeof clientY === "number") {
        const rect = node.getBoundingClientRect();
        point = { x: clientX - rect.left, y: clientY - rect.top };
      }
    }
    if (!point && typeof native.locationX === "number" && typeof native.locationY === "number") point = { x: native.locationX, y: native.locationY };
    if (!point || !size) return null;
    const x = point.x * 200 / size, y = point.y * 200 / size;
    return { radius: Math.hypot(x - 100, y - 100), angle: Math.atan2(x - 100, 100 - y) * 180 / Math.PI };
  }

  function turn(event: GestureResponderEvent) {
    const current = wind.current;
    const point = facePoint(event);
    if (!current || !point) return;
    const before = current.seconds;
    current.seconds = Math.max(current.min, Math.min(current.max, current.seconds + angleDelta(current.last, point.angle) / 6 * secondsPerTick));
    current.last = point.angle;
    // A firmer tap when the ring starts or ends its second turn.
    if ((before > restFaceSeconds) !== (current.seconds > restFaceSeconds)) confirmHaptic();
    else if (Math.ceil(current.seconds / secondsPerTick) !== Math.ceil(before / secondsPerTick)) tickHaptic();
    setWinding(current.seconds);
  }

  function letGo() {
    const current = wind.current;
    wind.current = null;
    if (!current) return;
    const seconds = Math.round(current.seconds / 5) * 5;
    setWinding(null);
    onAdjust?.(seconds);
  }

  return (
    <View style={styles.watchArea} onLayout={(event) => setSize(Math.min(300, event.nativeEvent.layout.width, event.nativeEvent.layout.height))}>
      {size ? <View ref={faceRef} accessibilityLiveRegion="polite" style={[{ width: size, height: size }, styles.watchFace]}
        onStartShouldSetResponder={(event) => {
          if (disabled || !onAdjust) return false;
          // The ring winds; the middle stays free for its text and links.
          const point = facePoint(event);
          return Boolean(point && point.radius >= 62 && point.radius <= 112);
        }}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(event) => {
          const point = facePoint(event);
          if (!point) return;
          const elapsed = Math.max(0, rest.total - rest.remaining);
          wind.current = { last: point.angle, seconds: Math.max(0, rest.remaining),
            min: Math.max(0, restLimits.min - elapsed), max: Math.max(0, restLimits.max - elapsed) };
          setWinding(wind.current.seconds);
        }}
        onResponderMove={turn}
        onResponderRelease={letGo}
        onResponderTerminate={letGo}
        accessible={Boolean(onAdjust)}
        accessibilityRole="adjustable"
        accessibilityLabel="Rest remaining"
        accessibilityValue={{ text: formatRest(Math.round(shown)) }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => onAdjust?.(Math.max(0, Math.round(rest.remaining) + (event.nativeEvent.actionName === "increment" ? 15 : -15)))}
      >
        <Svg width={size} height={size} viewBox="0 0 200 200" pointerEvents="none">{ticks}{lapTicks}</Svg>
        <View style={styles.watchCenter} pointerEvents="box-none">
          <Body style={styles.watchTime}>{formatRest(Math.round(shown))}</Body>
          <Body style={styles.heroCaption}>{caption}</Body>
          {rest.canAddSet ? <Pressable accessibilityRole="button" disabled={disabled} onPress={onAddSet} style={pressableFeedback(styles.link)}>
            <Body style={styles.linkText}>Add a set</Body>
          </Pressable> : null}
        </View>
      </View> : null}
      {onAdjust && size ? <Body style={styles.watchHint}>{winding === null ? "Turn the ring to change the rest" : "Let go to set"}</Body> : null}
    </View>
  );
}

function dialPointOn(radius: number, degrees: number) {
  const angle = degrees * Math.PI / 180;
  return { x: 100 + radius * Math.sin(angle), y: 100 - radius * Math.cos(angle) };
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  wrap: { gap: spacing.md },
  fill: { flex: 1 },
  pills: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm },
  pill: { minHeight: 36, paddingHorizontal: spacing.lg, borderRadius: 999, borderWidth: 1, borderColor: palette.border, flexDirection: "row", alignItems: "center", gap: 4 },
  pillCurrent: { backgroundColor: palette.ink, borderColor: palette.ink },
  pillDone: { backgroundColor: palette.surfaceAlt, borderColor: palette.surfaceAlt },
  pillText: { color: palette.muted, fontSize: 13, fontWeight: "700" },
  pillCurrentText: { color: palette.surface },
  pillDoneText: { color: palette.muted, fontSize: 13, fontWeight: "700" },
  hero: { minHeight: 112, alignItems: "center", justifyContent: "center" },
  heroFill: { flex: 1 },
  heroValues: { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: spacing.md },
  heroBlock: { alignItems: "center" },
  heroNumber: { color: palette.ink, fontSize: 56, lineHeight: 62, fontWeight: "800", letterSpacing: -1.5, fontVariant: ["tabular-nums"] },
  heroNumberFill: { fontSize: 68, lineHeight: 74 },
  heroDimmed: { color: palette.muted },
  heroTimes: { color: palette.muted, fontSize: 32, lineHeight: 62 },
  heroTimesFill: { lineHeight: 74 },
  heroDone: { color: palette.ink, fontSize: 24, lineHeight: 30, fontWeight: "800", textAlign: "center" },
  heroCaption: { color: palette.muted, fontSize: 13 },
  links: { flexDirection: "row", justifyContent: "center", gap: spacing.md, marginTop: spacing.xs },
  link: { minHeight: 36, justifyContent: "center", paddingHorizontal: spacing.sm },
  linkText: { color: palette.ink, fontSize: 13, fontWeight: "700", textDecorationLine: "underline" },
  dial: {
    width: "100%", position: "relative",
    ...(Platform.OS === "web" ? { touchAction: "none", userSelect: "none", cursor: "grab" } as object : {})
  },
  disabled: { opacity: 0.5 },
  hub: { position: "absolute", backgroundColor: palette.ink, alignItems: "center", justifyContent: "center" },
  hubText: { color: palette.surface, fontSize: 17, fontWeight: "900" },
  ringTarget: { position: "absolute", backgroundColor: "transparent" },
  note: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 36, marginTop: spacing.xs, alignSelf: "center", maxWidth: "100%", paddingHorizontal: spacing.md },
  noteText: { color: palette.muted, fontSize: 13, fontWeight: "600", flexShrink: 1 },
  noteTextFilled: { color: palette.ink, fontWeight: "500" },
  watchArea: { flex: 1, alignItems: "center", justifyContent: "center" },
  watchFace: Platform.OS === "web" ? { touchAction: "none", userSelect: "none", cursor: "grab" } as object : {},
  watchHint: { color: palette.muted, fontSize: 12, marginTop: spacing.xs },
  watchCenter: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", gap: 2 },
  watchTime: { color: palette.ink, fontSize: 54, lineHeight: 60, fontWeight: "800", letterSpacing: -1.5, fontVariant: ["tabular-nums"] },
  skip: { minHeight: 56, borderRadius: 999, backgroundColor: palette.ink, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm },
  skipText: { color: palette.surface, fontSize: 17, fontWeight: "900" }
}));
