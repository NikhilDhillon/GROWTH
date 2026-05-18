import { Pressable, StyleSheet, View } from "react-native";
import { LogOut } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { palette, spacing } from "@/utils/theme";

export function SettingsScreen() {
  const exercises = useFitnessStore((state) => state.exercises);
  const currentUser = useFitnessStore((state) => state.currentUser);
  const logout = useFitnessStore((state) => state.logout);
  const strengthCount = exercises.filter((exercise) => exercise.is_strength_exercise).length;

  return (
    <Screen>
      <View>
        <Label>Local-only configuration</Label>
        <Title>Settings</Title>
      </View>

      <Panel>
        <SectionTitle>Account</SectionTitle>
        <Body>{currentUser ? `${currentUser.name} (${currentUser.email})` : "Not signed in"}</Body>
        <Pressable style={styles.logoutButton} onPress={() => void logout()}>
          <LogOut size={18} color={palette.surface} />
          <Body style={styles.logoutText}>Logout</Body>
        </Pressable>
      </Panel>

      <Panel>
        <SectionTitle>Strength formula</SectionTitle>
        <Body>Each set starts with estimated 1RM and rep quality, then later sets receive diminishing importance. The total is divided by the square root of set count.</Body>
      </Panel>

      <Panel>
        <SectionTitle>Exercise tracking</SectionTitle>
        <Body>{exercises.length} exercises created. {strengthCount} marked as strength exercises for graphing.</Body>
      </Panel>

      <Panel>
        <SectionTitle>Storage</SectionTitle>
        <Body>Data is stored locally in SQLite on device. There is no login, backend, cloud sync, or network dependency.</Body>
      </Panel>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logoutButton: {
    minHeight: 46,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  logoutText: {
    color: palette.surface,
    fontWeight: "900"
  }
});
