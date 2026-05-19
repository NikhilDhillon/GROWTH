import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { KeyRound, LogIn, UserPlus } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { palette, spacing } from "@/utils/theme";

type Mode = "login" | "register" | "reset" | "update";

export function AuthScreen({ forcePasswordUpdate = false, onPasswordUpdated }: { forcePasswordUpdate?: boolean; onPasswordUpdated?: () => void }) {
  const [mode, setMode] = useState<Mode>(forcePasswordUpdate ? "update" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const login = useFitnessStore((state) => state.login);
  const register = useFitnessStore((state) => state.register);
  const resetPassword = useFitnessStore((state) => state.resetPassword);
  const updatePassword = useFitnessStore((state) => state.updatePassword);
  const authError = useFitnessStore((state) => state.authError);
  const authNotice = useFitnessStore((state) => state.authNotice);
  const clearAuthError = useFitnessStore((state) => state.clearAuthError);
  const isRegistering = mode === "register";
  const isResetting = mode === "reset";
  const isUpdating = mode === "update";
  const title = isUpdating ? "Choose new password" : isResetting ? "Reset password" : isRegistering ? "Create account" : "Welcome back";

  async function handleSubmit() {
    clearAuthError();
    if (isResetting) {
      if (!email.trim()) return;
      await resetPassword({ email });
      return;
    }
    if (isUpdating) {
      if (!password || password !== confirmPassword) return;
      await updatePassword({ password });
      setPassword("");
      setConfirmPassword("");
      onPasswordUpdated?.();
      return;
    }
    if (!email.trim() || !password) return;
    if (isRegistering) {
      if (!name.trim() || password !== confirmPassword) return;
      await register({ name, email, password });
      return;
    }

    await login({ email, password });
  }

  function switchMode(nextMode: Mode) {
    clearAuthError();
    setMode(nextMode);
  }

  return (
    <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen scroll>
        <View style={styles.hero}>
          <Label>GROWTH</Label>
          <Title>{title}</Title>
          <Body>Track your strength from any browser.</Body>
        </View>

        <Panel>
          {!isUpdating ? (
            <View style={styles.modeRow}>
              <Pressable onPress={() => switchMode("login")} style={[styles.modeButton, mode === "login" && styles.modeButtonActive]}>
                <Body style={[styles.modeText, mode === "login" && styles.modeTextActive]}>Login</Body>
              </Pressable>
              <Pressable onPress={() => switchMode("register")} style={[styles.modeButton, mode === "register" && styles.modeButtonActive]}>
                <Body style={[styles.modeText, mode === "register" && styles.modeTextActive]}>Register</Body>
              </Pressable>
            </View>
          ) : null}

          {isRegistering ? (
            <View style={styles.field}>
              <Label>Name</Label>
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" />
            </View>
          ) : null}

          {!isUpdating ? (
            <View style={styles.field}>
              <Label>Email</Label>
              <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" />
            </View>
          ) : null}

          {!isResetting ? (
            <View style={styles.field}>
              <Label>{isUpdating ? "New password" : "Password"}</Label>
              <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder={isUpdating ? "New password" : "Password"} />
            </View>
          ) : null}

          {isRegistering || isUpdating ? (
            <View style={styles.field}>
              <Label>Confirm password</Label>
              <TextInput style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Confirm password" />
            </View>
          ) : null}

          {!isResetting && password && confirmPassword && password !== confirmPassword ? <Body style={styles.errorText}>Passwords do not match.</Body> : null}
          {authError ? <Body style={styles.errorText}>{authError}</Body> : null}
          {authNotice ? <Body style={styles.noticeText}>{authNotice}</Body> : null}

          <Pressable style={styles.primaryButton} onPress={handleSubmit}>
            {isResetting || isUpdating ? <KeyRound size={19} color={palette.surface} /> : isRegistering ? <UserPlus size={19} color={palette.surface} /> : <LogIn size={19} color={palette.surface} />}
            <Body style={styles.primaryButtonText}>{isUpdating ? "Update password" : isResetting ? "Send reset email" : isRegistering ? "Create account" : "Login"}</Body>
          </Pressable>

          {!isUpdating && !isRegistering ? (
            <Pressable onPress={() => switchMode(isResetting ? "login" : "reset")} style={styles.secondaryButton}>
              <Body style={styles.secondaryText}>{isResetting ? "Back to login" : "Forgot password?"}</Body>
            </Pressable>
          ) : null}
        </Panel>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboard: {
    flex: 1,
    backgroundColor: palette.background
  },
  hero: {
    paddingTop: spacing.xxl,
    gap: spacing.sm
  },
  modeRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  modeButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.surface
  },
  modeButtonActive: {
    backgroundColor: palette.ink,
    borderColor: palette.ink
  },
  modeText: {
    color: palette.ink,
    fontWeight: "800"
  },
  modeTextActive: {
    color: palette.surface
  },
  field: {
    gap: spacing.sm
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    color: palette.ink,
    backgroundColor: palette.surface,
    fontWeight: "700"
  },
  errorText: {
    color: palette.danger,
    fontWeight: "800"
  },
  noticeText: {
    color: palette.accent,
    fontWeight: "800"
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 8,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  primaryButtonText: {
    color: palette.surface,
    fontWeight: "900"
  },
  secondaryButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryText: {
    color: palette.ink,
    fontWeight: "900"
  }
});
