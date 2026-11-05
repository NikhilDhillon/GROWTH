import { Pressable, StyleSheet, View } from "react-native";

import { Body, Label } from "@/components/Text";
import { BodyFigure } from "@/screens/BodyMeasurements/BodyFigure";
import { changeBarScale } from "@/screens/BodyMeasurements/bodyFigureReadings";
import { currentMeasurementChannels, type MeasurementChannel, type MeasurementOverview, type MeasurementOverviewChannel, type MeasurementOverviewRow } from "@/services/body/bodyMeasurementReport";
import type { BodyFigureChoice, CircumferenceUnit } from "@/types";
import { BodyMeasurementKey, circumferenceFromStorageUnit, formatCircumferenceChange, roundCircumferenceChange } from "@/utils/bodyMeasurements";
import { formatCompactDate } from "@/utils/date";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

const groups = ["Torso", "Arms", "Legs"] as const;
const nowWidth = 56;
const changeWidth = 40;
type BarScale = ReturnType<typeof changeBarScale>;

/** The body on top for the instant picture, with every number in the rows below it. */
export function TapeOverview({ overview, figure, unit, onOpen }: {
  overview: MeasurementOverview;
  figure: BodyFigureChoice;
  unit: CircumferenceUnit;
  onOpen: (key: BodyMeasurementKey, channel: MeasurementChannel) => void;
}) {
  const { palette, styles } = useStyles();
  const scale = changeBarScale(overview.changeDomainCm);
  const { window } = overview;
  const hasRows = overview.rows.length > 0;
  return (
    <View style={styles.wrap}>
      <BodyFigure overview={overview} figure={figure} unit={unit} onOpen={onOpen} />
      {hasRows ? <>
        <View style={styles.legend}>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: palette.grew }]} /><Body style={styles.note}>Grew</Body></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: palette.shrank }]} /><Body style={styles.note}>Shrank</Body></View>
          <View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: palette.steady }]} /><Body style={styles.note}>No change</Body></View>
          <Body style={styles.note}>Stronger = bigger change</Body>
        </View>
        <View style={styles.headerRow}>
          <Body numberOfLines={1} style={[styles.note, styles.flex]}>{window ? `${formatCompactDate(window.start)} – ${formatCompactDate(window.end)}` : "No entries in this range"}</Body>
          <Body numberOfLines={1} style={[styles.note, styles.number, { width: nowWidth }]}>Now, {unit}</Body>
          <Body accessibilityLabel="Change" numberOfLines={1} style={[styles.note, styles.number, { width: changeWidth }]}>Chg</Body>
        </View>
        {groups.map((group) => {
          const rows = overview.rows.filter((row) => row.group === group);
          return rows.length ? (
            <View key={group}>
              <Label style={styles.group}>{group}</Label>
              {rows.map((row) => <OverviewRow key={row.key} row={row} scale={scale} unit={unit} onOpen={onOpen} />)}
            </View>
          ) : null;
        })}
        {overview.unmeasured.length ? <Body style={styles.note}>Not measured yet: {overview.unmeasured.join(", ")}</Body> : null}
        <Body style={styles.hint}>Tap a body part to open its chart.</Body>
      </> : <Body style={styles.empty}>Record a check-in to see every body part here.</Body>}
    </View>
  );
}

function OverviewRow({ row, scale, unit, onOpen }: {
  row: MeasurementOverviewRow;
  scale: BarScale;
  unit: CircumferenceUnit;
  onOpen: (key: BodyMeasurementKey, channel: MeasurementChannel) => void;
}) {
  const { styles } = useStyles();
  const hasEntries = row.channels.some((channel) => channel.points.length > 0);
  const newest = row.channels.reduce((latest, channel) => channel.latest.date > latest ? channel.latest.date : latest, "");
  const changes = row.average ? [row.average] : row.channels;
  const measured = changes.filter((channel) => channel.changeCm !== null);
  const allSteady = measured.length > 0 && measured.every((channel) => roundCircumferenceChange(channel.changeCm!, unit) === 0);
  const now = currentMeasurementChannels(row);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={describeRow(row, unit)} accessibilityHint="Opens this body part's chart"
      onPress={() => onOpen(row.key, row.average ? "average" : row.channels[0].channel)} style={pressableFeedback(styles.row)}>
      <Body style={styles.label}>{row.label}</Body>
      <View style={styles.bars}>
        {!hasEntries ? <Body style={styles.note}>Last {formatCompactDate(newest)}</Body>
          : allSteady ? <Body style={styles.note}>No change</Body>
            : <ChangeBars channels={changes} scale={scale} unit={unit} />}
      </View>
      <View style={styles.values}>
        <View style={[styles.column, { width: nowWidth }]}>
          {now.map((channel) => (
            <Body key={channel.channel} numberOfLines={1} style={styles.now}>
              {sideLetter(channel.channel, now.length) ? <Body style={styles.side}>{sideLetter(channel.channel, now.length)} </Body> : null}
              {circumferenceFromStorageUnit(channel.latest.valueCm, unit).toFixed(1)}
            </Body>
          ))}
        </View>
        <View style={[styles.column, { width: changeWidth }]}>
          {changes.map((channel) => (
            <Body key={channel.channel} numberOfLines={1} style={[styles.change, channel.changeCm === null && styles.changeUnknown]}>
              {channel.changeCm === null ? "—" : formatCircumferenceChange(channel.changeCm, unit)}
            </Body>
          ))}
          {row.average ? <Body numberOfLines={1} style={styles.averageTag}>avg</Body> : null}
        </View>
      </View>
    </Pressable>
  );
}

function ChangeBars({ channels, scale, unit }: { channels: MeasurementOverviewChannel[]; scale: BarScale; unit: CircumferenceUnit }) {
  const { palette, styles } = useStyles();
  const span = scale.high - scale.low;
  const percent = (value: number) => `${(value / span) * 100}%` as const;
  return (
    <View style={styles.barTrack}>
      {channels.map((channel) => {
        const change = channel.changeCm;
        const steady = change !== null && roundCircumferenceChange(change, unit) === 0;
        return (
          <View key={channel.channel} style={channels.length > 1 ? styles.barSlotPaired : styles.barSlot}>
            {steady ? <View style={[styles.steadyMark, { left: percent(-scale.low) }]} />
              : change !== null ? <View style={[styles.bar, {
                left: percent(Math.min(0, change) - scale.low),
                width: percent(Math.abs(change)),
                backgroundColor: change > 0 ? palette.grew : palette.shrank,
                opacity: channel.channel === "right" ? 0.6 : 1
              }]} /> : null}
          </View>
        );
      })}
      <View style={[styles.zero, { left: percent(-scale.low) }]} />
    </View>
  );
}

function sideLetter(channel: MeasurementChannel, channelCount: number) {
  if (channel === "left") return "L";
  if (channel === "right") return "R";
  return channel === "single" && channelCount > 1 ? "S" : "";
}

function describeRow(row: MeasurementOverviewRow, unit: CircumferenceUnit) {
  const name = (channel: MeasurementChannel, count: number) => channel === "left" ? "Left " : channel === "right" ? "Right " : channel === "single" && count > 1 ? "Single value " : "";
  const change = (channel: MeasurementOverviewChannel) => channel.changeCm === null ? "no change to report in this range"
    : `${formatCircumferenceChange(channel.changeCm, unit)} ${unit} since ${formatCompactDate(channel.points[0].date)}`;
  const value = (channel: MeasurementOverviewChannel) => `${circumferenceFromStorageUnit(channel.latest.valueCm, unit).toFixed(1)} ${unit} on ${formatCompactDate(channel.latest.date)}`;
  const now = currentMeasurementChannels(row);
  if (row.average) return `${row.label}. ${now.map((channel) => `${name(channel.channel, now.length)}${value(channel)}`).join(". ")}. Average ${change(row.average)}`;
  return `${row.label}. ${row.channels.map((channel) => `${name(channel.channel, row.channels.length)}${value(channel)}, ${change(channel)}`).join(". ")}`;
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  wrap: { gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  legend: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", columnGap: spacing.md, rowGap: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingTop: spacing.xs },
  note: { color: palette.muted, fontSize: 12, lineHeight: 16 },
  hint: { color: palette.muted, fontSize: 13, lineHeight: 18 },
  empty: { textAlign: "center", paddingVertical: spacing.sm },
  number: { textAlign: "right" },
  group: { paddingTop: spacing.sm, paddingBottom: spacing.xs },
  row: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: palette.border },
  label: { width: 88, color: palette.ink, fontSize: 13, lineHeight: 16, fontWeight: "600" },
  bars: { flex: 1, minWidth: 0, justifyContent: "center" },
  barTrack: { gap: 4 },
  barSlot: { height: 12 },
  barSlotPaired: { height: 10 },
  bar: { position: "absolute", top: 0, bottom: 0, borderRadius: 2 },
  zero: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: palette.ink },
  values: { flexDirection: "row", gap: 6 },
  column: { gap: 2 },
  steadyMark: { position: "absolute", top: 1, bottom: 1, width: 8, marginLeft: -4, borderRadius: 4, backgroundColor: palette.steady },
  averageTag: { color: palette.muted, fontSize: 11, lineHeight: 16, textAlign: "right" },
  now: { color: palette.ink, fontSize: 13, lineHeight: 16, textAlign: "right", fontVariant: ["tabular-nums"] },
  side: { color: palette.muted, fontSize: 11 },
  change: { color: palette.ink, fontSize: 13, lineHeight: 16, fontWeight: "700", textAlign: "right", fontVariant: ["tabular-nums"] },
  changeUnknown: { color: palette.muted, fontWeight: "400" }
}));
