import { Pressable, StyleSheet, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { ProgressTab, ProgressTabs } from "@/components/ProgressTabs";
import { Body } from "@/components/Text";
import { useReportContext } from "@/hooks/useReportContext";
import { AnalyticsScreen } from "@/screens/Analytics/AnalyticsScreen";
import { BodyProgressScreen } from "@/screens/Progress/BodyProgressScreen";
import { BulkAnalyticsScreen } from "@/screens/BulkAnalytics/BulkAnalyticsScreen";
import { useFitnessStore } from "@/store/useFitnessStore";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";

const tabs: ProgressTab[] = ["overview", "strength", "body", "bulk"];
function valid(value: unknown): value is { tab: ProgressTab } { return !!value && typeof value === "object" && tabs.includes((value as { tab: ProgressTab }).tab); }
export function ProgressScreen() {
  const { styles } = useStyles();
  const navigation = useNavigation<any>();
  const route = useRoute();
  const params = route.params as { tab?: ProgressTab; exerciseId?: number; range?: string; comparisonKey?: string; scopeKind?: "overall" | "muscle" | "exercise"; muscleGroup?: import("@/types").MuscleGroup } | undefined;
  const account = useFitnessStore((s) => s.currentUser?.id);
  const preferences = useReportContext(account, "progress", { tab: "strength" as ProgressTab }, valid);
  const requested = params?.tab && tabs.includes(params.tab) ? params.tab : preferences.value.tab;
  const tab = requested === "overview" ? "strength" : requested;
  function changeTab(next: ProgressTab) { preferences.update({ tab: next }); navigation.setParams({ tab: next }); }
  const progressTabs = <ProgressTabs value={tab === "bulk" ? "strength" : tab} onChange={changeTab} />;
  if (tab === "body") return <BodyProgressScreen progressTabs={progressTabs} />;
  if (tab === "bulk") return <BulkAnalyticsScreen progressTabs={<View style={styles.header}>{progressTabs}<Pressable accessibilityRole="button" style={styles.button} onPress={() => changeTab("strength")}><Body>Back to strength</Body></Pressable></View>} initialContext={params} onContextChange={(context) => navigation.setParams(context)} />;
  return <AnalyticsScreen progressTabs={progressTabs} initialExerciseId={params?.exerciseId} initialRange={params?.range} initialComparisonKey={params?.comparisonKey} onContextChange={(context) => navigation.setParams(context)} onCompare={(context) => { preferences.update({ tab: "bulk" }); navigation.setParams({ tab: "bulk", scopeKind: "exercise", ...context }); }} />;
}
const useStyles = createThemedStyles((palette) => StyleSheet.create({
  header: { gap: spacing.sm },
  button: { minHeight: 44, padding: spacing.md, borderWidth: 1, borderColor: palette.border, borderRadius: 8 }
}));
