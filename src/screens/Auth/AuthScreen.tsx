import { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { KeyRound, LogIn, UserPlus, TrendingUp } from "lucide-react-native";

import { Panel } from "@/components/Panel";
import { Screen } from "@/components/Screen";
import { Body, Label, SectionTitle, Title } from "@/components/Text";
import { useFitnessStore } from "@/store/useFitnessStore";
import { createThemedStyles } from "@/utils/themedStyles";
import { spacing } from "@/utils/theme";

type Mode = "login" | "register" | "reset" | "update";

export function AuthScreen({ forcePasswordUpdate = false, onPasswordUpdated }: { forcePasswordUpdate?: boolean; onPasswordUpdated?: () => void }) {
  const { palette, styles } = useStyles();
  const [mode, setMode] = useState<Mode>(forcePasswordUpdate ? "update" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const submitting = useRef(false);
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
    if (submitting.current) return;
    clearAuthError();
    setSubmissionError(null);
    if (!isUpdating && !email.trim()) {
      setSubmissionError("Enter your email address.");
      return;
    }
    if (!isResetting && !password) {
      setSubmissionError("Enter your password.");
      return;
    }
    if ((isUpdating || isRegistering) && password !== confirmPassword) {
      setSubmissionError("Passwords do not match.");
      return;
    }
    if (isRegistering && !name.trim()) {
      setSubmissionError("Enter your name.");
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
    try {
      if (isResetting) {
        await resetPassword({ email });
      } else if (isUpdating) {
        const succeeded = await updatePassword({ password });
        if (!succeeded) return;
        setPassword("");
        setConfirmPassword("");
        onPasswordUpdated?.();
      } else if (isRegistering) {
        await register({ name, email, password });
      } else {
        await login({ email, password });
      }
    } catch (error) {
      setSubmissionError(error instanceof Error ? error.message : "Could not complete this request. Please retry.");
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  function switchMode(nextMode: Mode) {
    if (submitting.current) return;
    clearAuthError();
    setSubmissionError(null);
    setMode(nextMode);
  }

  return (
    <KeyboardAvoidingView style={styles.keyboard} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Screen scroll>
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}><TrendingUp size={20} color={palette.surface} /></View>
            <Label style={styles.brandName}>GROWTH</Label>
          </View>
          <Title>{title}</Title>
          <Body>Log every set. Watch every lift trend up.</Body>
        </View>

        <Panel>
          {!isUpdating ? (
            <View style={styles.modeRow}>
              <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === "login" }} disabled={isSubmitting} onPress={() => switchMode("login")} style={[styles.modeButton, mode === "login" && styles.modeButtonActive]}>
                <Body style={[styles.modeText, mode === "login" && styles.modeTextActive]}>Login</Body>
              </Pressable>
              <Pressable accessibilityRole="tab" accessibilityState={{ selected: mode === "register" }} disabled={isSubmitting} onPress={() => switchMode("register")} style={[styles.modeButton, mode === "register" && styles.modeButtonActive]}>
                <Body style={[styles.modeText, mode === "register" && styles.modeTextActive]}>Register</Body>
              </Pressable>
            </View>
          ) : null}

          {isRegistering ? (
            <View style={styles.field}>
              <Label>Name</Label>
              <TextInput editable={!isSubmitting} style={styles.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={palette.muted} autoCapitalize="words" />
            </View>
          ) : null}

          {!isUpdating ? (
            <View style={styles.field}>
              <Label>Email</Label>
              <TextInput editable={!isSubmitting} style={styles.input} value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={palette.muted} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
            </View>
          ) : null}

          {!isResetting ? (
            <View style={styles.field}>
              <Label>{isUpdating ? "New password" : "Password"}</Label>
              <TextInput editable={!isSubmitting} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={isUpdating || isRegistering ? "new-password" : "current-password"} style={styles.input} value={password} onChangeText={setPassword} placeholder={isUpdating ? "New password" : "Password"} placeholderTextColor={palette.muted} />
            </View>
          ) : null}

          {isRegistering || isUpdating ? (
            <View style={styles.field}>
              <Label>Confirm password</Label>
              <TextInput editable={!isSubmitting} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="new-password" style={styles.input} value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Confirm password" placeholderTextColor={palette.muted} />
            </View>
          ) : null}

          {!isResetting && password && confirmPassword && password !== confirmPassword ? <Body style={styles.errorText}>Passwords do not match.</Body> : null}
          {authError ? <Body style={styles.errorText}>{authError}</Body> : null}
          {submissionError ? <Body style={styles.errorText}>{submissionError}</Body> : null}
          {authNotice ? <Body style={styles.noticeText}>{authNotice}</Body> : null}

          <Pressable disabled={isSubmitting} style={styles.primaryButton} onPress={handleSubmit}>
            {isResetting || isUpdating ? <KeyRound size={19} color={palette.surface} /> : isRegistering ? <UserPlus size={19} color={palette.surface} /> : <LogIn size={19} color={palette.surface} />}
            <Body style={styles.primaryButtonText}>{isSubmitting ? "Please wait…" : isUpdating ? "Update password" : isResetting ? "Send reset email" : isRegistering ? "Create account" : "Login"}</Body>
          </Pressable>

          {!isUpdating && !isRegistering ? (
            <Pressable disabled={isSubmitting} onPress={() => switchMode(isResetting ? "login" : "reset")} style={styles.secondaryButton}>
              <Body style={styles.secondaryText}>{isResetting ? "Back to login" : "Forgot password?"}</Body>
            </Pressable>
          ) : null}
        </Panel>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const useStyles = createThemedStyles((palette) => StyleSheet.create({
  keyboard: {
    flex: 1,
    backgroundColor: palette.background
  },
  hero: {
    paddingTop: spacing.xxl,
    paddingBottom: spacing.sm,
    gap: spacing.sm
  },
  modeRow: {
    flexDirection: "row",
    padding: 3,
    gap: 3,
    borderRadius: 12,
    backgroundColor: palette.surfaceAlt
  },
  modeButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center"
  },
  modeButtonActive: {
    backgroundColor: palette.ink
  },
  modeText: {
    color: palette.muted,
    fontWeight: "700"
  },
  modeTextActive: {
    color: palette.surface
  },
  field: {
    gap: 6
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.ink
  },
  brandName: {
    color: palette.ink,
    fontSize: 13,
    letterSpacing: 2
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    color: palette.ink,
    backgroundColor: palette.surface,
    fontSize: 16,
    fontWeight: "600"
  },
  errorText: {
    color: palette.danger,
    fontWeight: "800"
  },
  noticeText: {
    color: palette.success,
    fontWeight: "700"
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 12,
    backgroundColor: palette.ink,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  primaryButtonText: {
    color: palette.surface,
    fontWeight: "800",
    fontSize: 16
  },
  secondaryButton: {
    minHeight: 40,
    alignItems: "center",
    justifyContent: "center"
  },
  secondaryText: {
    color: palette.muted,
    fontWeight: "700"
  }
}));
