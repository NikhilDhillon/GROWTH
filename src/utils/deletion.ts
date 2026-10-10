import { Alert, Platform } from "react-native";

type DeletionPrompt = { title: string; message: string; confirmLabel?: string };
export type DeletionResult =
  | { status: "deleted" }
  | { status: "cancelled" }
  | { status: "failed"; error: string };

// React Native Web's Alert is a no-op. Missing confirmation must fail closed.
export async function confirmDeletion({ title, message, confirmLabel = "Delete" }: DeletionPrompt): Promise<boolean> {
  if (Platform.OS === "web") {
    if (typeof window === "undefined" || typeof window.confirm !== "function") {
      throw new Error("Confirmation is unavailable. Nothing was deleted.");
    }
    return window.confirm(`${title}\n\n${message}`);
  }

  return new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) }
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

export async function deleteWithConfirmation({
  title,
  message,
  deleteRecord,
  fallbackError
}: DeletionPrompt & { deleteRecord: () => Promise<void>; fallbackError: string }): Promise<DeletionResult> {
  try {
    if (!await confirmDeletion({ title, message })) return { status: "cancelled" };
    await deleteRecord();
    return { status: "deleted" };
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : fallbackError };
  }
}
