import { Fragment, ReactNode, useRef, useState } from "react";
import { GestureResponderEvent, Platform, Pressable, StyleSheet, View } from "react-native";
import { Check, Link2, X } from "lucide-react-native";

import { Body } from "@/components/Text";
import { confirmHaptic, tickHaptic } from "@/utils/haptics";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback, touchHitSlop } from "@/utils/touch";

export type PlanChip = {
  id: string;
  name: string;
  status: "done" | "current" | "pending";
  superset?: string | null;
  /** Sets logged on an exercise set aside for now. */
  logged?: number;
  /** Not part of today's plan (work saved before the plan existed): it stays put. */
  fixed?: boolean;
};

export type PlanDrop = { id: string; kind: "before" | "after" | "pair" };

type Rect = { x: number; y: number; width: number; height: number };
type Press = { id: string; x: number; y: number; timer: ReturnType<typeof setTimeout> | null; dragging: boolean; moved: boolean };

/** Holding a chip this long picks it up, like an app icon on a home screen. */
const pickUpMs = 260;
const slop = 8;

/**
 * Today's plan as chips. Tap one to switch to it; hold and drag one to move it,
 * or drop it onto another to make a superset. Linked chips sit in one outline,
 * and the link between them splits them again.
 */
export function PlanChips({ items, disabled, onActivate, onRemove, onMove, onPair, onUnlink, trailing }: {
  items: PlanChip[];
  disabled: boolean;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, targetId: string, placement: "before" | "after") => void;
  onPair: (id: string, targetId: string) => void;
  onUnlink: (id: string) => void;
  /** e.g. the add-an-exercise chip. */
  trailing?: ReactNode;
}) {
  const { palette, styles } = useStyles();
  const nodes = useRef(new Map<string, View | null>());
  const rects = useRef(new Map<string, Rect>());
  const press = useRef<Press | null>(null);
  const target = useRef<PlanDrop | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; target: PlanDrop | null } | null>(null);

  function measure() {
    rects.current.clear();
    for (const [id, node] of nodes.current) node?.measureInWindow((x, y, width, height) => rects.current.set(id, { x, y, width, height }));
  }

  /** The chip under the finger: its middle makes a superset, its edges place before or after; otherwise the nearest chip. */
  function dropAt(x: number, y: number, movingId: string): PlanDrop | null {
    let nearest: { id: string; distance: number; after: boolean } | null = null;
    for (const [id, rect] of rects.current) {
      const item = items.find((entry) => entry.id === id);
      if (id === movingId || !item || item.fixed) continue;
      const across = (x - rect.x) / rect.width;
      if (y >= rect.y - 4 && y <= rect.y + rect.height + 4 && across >= 0 && across <= 1) {
        if (item.status !== "done" && across > 0.25 && across < 0.75) return { id, kind: "pair" };
        return { id, kind: across < 0.5 ? "before" : "after" };
      }
      const distance = Math.hypot(x - (rect.x + rect.width / 2), y - (rect.y + rect.height / 2));
      if (!nearest || distance < nearest.distance) nearest = { id, distance, after: x > rect.x + rect.width / 2 };
    }
    return nearest && nearest.distance < 140 ? { id: nearest.id, kind: nearest.after ? "after" : "before" } : null;
  }

  function point(event: GestureResponderEvent) {
    return { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
  }

  function grant(id: string, event: GestureResponderEvent) {
    const { x, y } = point(event);
    const current: Press = { id, x, y, dragging: false, moved: false, timer: null };
    current.timer = setTimeout(() => {
      current.timer = null;
      if (press.current !== current || current.moved) return;
      current.dragging = true;
      target.current = null;
      measure();
      confirmHaptic();
      setDrag({ id, dx: 0, dy: 0, target: null });
    }, pickUpMs);
    press.current = current;
  }

  function move(event: GestureResponderEvent) {
    const current = press.current;
    if (!current) return;
    const { x, y } = point(event);
    const dx = x - current.x, dy = y - current.y;
    if (!current.dragging) {
      if (Math.hypot(dx, dy) > slop) current.moved = true;
      return;
    }
    const next = dropAt(x, y, current.id);
    if (next?.id !== target.current?.id || next?.kind !== target.current?.kind) tickHaptic();
    target.current = next;
    setDrag({ id: current.id, dx, dy, target: next });
  }

  function release() {
    const current = press.current;
    press.current = null;
    if (!current) return;
    if (current.timer) clearTimeout(current.timer);
    if (!current.dragging) {
      if (!current.moved) onActivate(current.id);
      return;
    }
    const dropped = target.current;
    target.current = null;
    setDrag(null);
    if (!dropped) return;
    if (dropped.kind === "pair") onPair(current.id, dropped.id);
    else onMove(current.id, dropped.id, dropped.kind);
  }

  function cancel() {
    const current = press.current;
    press.current = null;
    if (current?.timer) clearTimeout(current.timer);
    setDrag(null);
  }

  /** Screen readers move a chip one place at a time, or link it to the next one. */
  function accessibilityAction(item: PlanChip, action: string) {
    const movable = items.filter((entry) => !entry.fixed);
    const index = movable.findIndex((entry) => entry.id === item.id);
    if (action === "earlier" && index > 0) onMove(item.id, movable[index - 1].id, "before");
    if (action === "later" && index < movable.length - 1) onMove(item.id, movable[index + 1].id, "after");
    if (action === "superset" && index < movable.length - 1) onPair(item.id, movable[index + 1].id);
  }

  function chip(item: PlanChip) {
    if (item.status === "done") return (
      <View key={item.id} ref={(node) => { nodes.current.set(item.id, node); }} style={[styles.chip, styles.chipDone]}>
        <Check size={14} color={palette.success} />
        <Body numberOfLines={1} style={styles.doneText}>{item.name}</Body>
      </View>
    );
    const current = item.status === "current";
    const lifted = drag?.id === item.id;
    const hover = drag?.target?.id === item.id ? drag.target.kind : null;
    return (
      <View key={item.id} ref={(node) => { nodes.current.set(item.id, node); }}
        onStartShouldSetResponder={() => !disabled}
        onResponderGrant={(event) => { grant(item.id, event); return true; }}
        onResponderMove={move}
        onResponderRelease={release}
        onResponderTerminate={cancel}
        onResponderTerminationRequest={() => !press.current?.dragging}
        style={[styles.chip, current && styles.chipCurrent, hover === "pair" && styles.chipTarget, lifted && styles.chipLifted,
          lifted && { transform: [{ translateX: drag!.dx }, { translateY: drag!.dy }] }]}>
        {hover === "before" || hover === "after" ? <View style={[styles.insert, hover === "before" ? styles.insertBefore : styles.insertAfter]} /> : null}
        {/* The name is the button for screen readers; the remove button beside it stays reachable on its own. */}
        <View accessible accessibilityRole="button" accessibilityLabel={current ? `${item.name}, current exercise` : `Switch to ${item.name}`}
          accessibilityHint="Hold and drag to move it, or drop it on another exercise to superset them"
          accessibilityActions={[{ name: "activate" }, { name: "earlier", label: "Move earlier" }, { name: "later", label: "Move later" }, { name: "superset", label: "Superset with the next exercise" }]}
          onAccessibilityAction={(event) => event.nativeEvent.actionName === "activate" ? onActivate(item.id) : accessibilityAction(item, event.nativeEvent.actionName)}
          style={styles.label}>
          <Body numberOfLines={1} style={[styles.chipText, current && styles.chipCurrentText]}>{item.logged ? `${item.name} · ${item.logged}` : item.name}</Body>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name} from today's plan`} hitSlop={touchHitSlop} disabled={disabled}
          onPress={() => onRemove(item.id)} style={pressableFeedback(styles.remove)}>
          <X size={14} color={current ? palette.surface : palette.muted} />
        </Pressable>
      </View>
    );
  }

  // Runs of chips sharing a superset are drawn inside one outline.
  const runs: PlanChip[][] = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (last && item.superset && last[0].superset === item.superset) last.push(item);
    else runs.push([item]);
  }

  return (
    <View style={styles.chips}>
      {runs.map((run) => run.length < 2 ? chip(run[0]) : (
        <View key={`group-${run[0].id}`} style={styles.group}>
          {run.map((item, index) => <Fragment key={item.id}>
            {index ? <Pressable accessibilityRole="button" accessibilityLabel={`Take ${item.name} out of the superset`} hitSlop={touchHitSlop} disabled={disabled}
              onPress={() => onUnlink(item.id)} style={pressableFeedback(styles.link)}>
              <Link2 size={14} color={palette.muted} />
            </Pressable> : null}
            {chip(item)}
          </Fragment>)}
        </View>
      ))}
      {trailing}
    </View>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  group: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", maxWidth: "100%", gap: 2, padding: 2, borderRadius: 999, borderWidth: 1, borderStyle: "dashed", borderColor: palette.muted },
  chip: {
    minHeight: 36, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingLeft: spacing.md, paddingRight: spacing.sm,
    borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface,
    ...(Platform.OS === "web" ? { touchAction: "none", userSelect: "none", cursor: "grab" } as object : {})
  },
  chipCurrent: { backgroundColor: palette.ink, borderColor: palette.ink },
  chipDone: { backgroundColor: palette.surfaceAlt, borderColor: palette.surfaceAlt, paddingRight: spacing.md },
  chipTarget: { borderColor: palette.ink, backgroundColor: palette.surfaceAlt },
  chipLifted: { zIndex: 10, opacity: 0.92, borderColor: palette.ink },
  label: { flexShrink: 1, minHeight: 34, justifyContent: "center" },
  chipText: { color: palette.ink, fontWeight: "700", fontSize: 13, flexShrink: 1 },
  chipCurrentText: { color: palette.surface },
  doneText: { color: palette.muted, fontWeight: "700", fontSize: 13, flexShrink: 1 },
  remove: { width: 20, height: 28, alignItems: "center", justifyContent: "center" },
  link: { width: 22, height: 28, alignItems: "center", justifyContent: "center" },
  insert: { position: "absolute", top: 4, bottom: 4, width: 3, borderRadius: 2, backgroundColor: palette.ink },
  insertBefore: { left: -6 },
  insertAfter: { right: -6 }
}));
