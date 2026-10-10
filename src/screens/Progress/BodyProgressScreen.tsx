import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Body } from "@/components/Text";
import { useReportContext } from "@/hooks/useReportContext";
import { BodyweightScreen } from "@/screens/Bodyweight/BodyweightScreen";
import { BodyMeasurementsScreen } from "@/screens/BodyMeasurements/BodyMeasurementsScreen";
import { useFitnessStore } from "@/store/useFitnessStore";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";
import { pressableFeedback } from "@/utils/touch";

type BodyView = "weight" | "measurements";
function valid(value: unknown): value is { view: BodyView } {
  return !!value && typeof value === "object" && ["weight", "measurements"].includes((value as { view: string }).view);
}
export function BodyProgressScreen({ progressTabs }: { progressTabs?: ReactNode } = {}) {
  const { styles } = useStyles();
  const account = useFitnessStore((s) => s.currentUser?.id);
  const context = useReportContext(account, "body-progress", { view: "weight" as BodyView }, valid);
  const controls = <View style={styles.header}>{progressTabs}
    <View accessibilityRole="tablist" style={styles.row}>{(["weight", "measurements"] as const).map((view) => <Pressable key={view} accessibilityRole="tab" accessibilityState={{ selected: context.value.view === view }} onPress={() => context.update({ view })} style={pressableFeedback([styles.button, context.value.view === view && styles.selected])}><Body style={[styles.text, context.value.view === view && styles.textSelected]}>{view === "weight" ? "Bodyweight" : "Tape measurements"}</Body></Pressable>)}</View>
    {context.error ? <Body>{context.error}</Body> : null}
  </View>;
  return context.value.view === "weight" ? <BodyweightScreen progressTabs={controls} /> : <BodyMeasurementsScreen progressTabs={controls} />;
}
const useStyles = createThemedStyles((palette) => StyleSheet.create({
  header: { gap: spacing.sm }, row: { flexDirection: "row", gap: spacing.xs },
  button: { flex: 1, minHeight: 34, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm, borderRadius: 999 },
  selected: { backgroundColor: palette.accentSoft },
  text: { color: palette.muted, fontSize: 14, fontWeight: "700" },
  textSelected: { color: palette.ink }
}));
