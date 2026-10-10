import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ platform: { OS: "web" }, alert: vi.fn() }));
vi.mock("react-native", () => ({ useColorScheme: () => "light", Platform: native.platform, Alert: { alert: native.alert } }));

import { confirmDeletion, deleteWithConfirmation } from "@/utils/deletion";

const prompt = { title: "Delete entry?", message: "Other observations will be preserved." };

beforeEach(() => {
  native.platform.OS = "web";
  native.alert.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("deliberate deletion", () => {
  it("uses real web confirmation before deleting once", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("window", { confirm });
    const deleteRecord = vi.fn().mockResolvedValue(undefined);

    expect(await deleteWithConfirmation({ ...prompt, deleteRecord, fallbackError: "Delete failed." })).toEqual({ status: "deleted" });
    expect(confirm).toHaveBeenCalledWith("Delete entry?\n\nOther observations will be preserved.");
    expect(deleteRecord).toHaveBeenCalledTimes(1);
    expect(native.alert).not.toHaveBeenCalled();
  });

  it("does not delete when web confirmation is cancelled", async () => {
    vi.stubGlobal("window", { confirm: () => false });
    const deleteRecord = vi.fn();

    expect(await deleteWithConfirmation({ ...prompt, deleteRecord, fallbackError: "Delete failed." })).toEqual({ status: "cancelled" });
    expect(deleteRecord).not.toHaveBeenCalled();
  });

  it("fails closed when browser confirmation is unavailable", async () => {
    vi.stubGlobal("window", {});
    const deleteRecord = vi.fn();

    expect(await deleteWithConfirmation({ ...prompt, deleteRecord, fallbackError: "Delete failed." })).toEqual({
      status: "failed", error: "Confirmation is unavailable. Nothing was deleted."
    });
    expect(deleteRecord).not.toHaveBeenCalled();
  });

  it("reports persistence failure without claiming deletion or retrying the write", async () => {
    vi.stubGlobal("window", { confirm: () => true });
    const deleteRecord = vi.fn().mockRejectedValue(new Error("Connection lost. Please retry."));

    expect(await deleteWithConfirmation({ ...prompt, deleteRecord, fallbackError: "Delete failed." })).toEqual({
      status: "failed", error: "Connection lost. Please retry."
    });
    expect(deleteRecord).toHaveBeenCalledTimes(1);
  });

  it("does not delete when the browser rejects the confirmation operation", async () => {
    vi.stubGlobal("window", { confirm: () => { throw new Error("Confirmation blocked."); } });
    const deleteRecord = vi.fn();

    expect(await deleteWithConfirmation({ ...prompt, deleteRecord, fallbackError: "Delete failed." })).toEqual({
      status: "failed", error: "Confirmation blocked."
    });
    expect(deleteRecord).not.toHaveBeenCalled();
  });

  it("only confirms native deletion through the destructive action", async () => {
    native.platform.OS = "ios";
    const result = confirmDeletion(prompt);
    const buttons = native.alert.mock.calls[0][2];
    buttons[1].onPress();
    expect(await result).toBe(true);
  });

  it("uses an explicit input-replacement label while preserving native cancellation", async () => {
    native.platform.OS = "ios";
    const result = confirmDeletion({ title: "Replace entered workout?", message: "Discard this draft's input?", confirmLabel: "Replace input" });
    const buttons = native.alert.mock.calls[0][2];
    expect(buttons[1].text).toBe("Replace input");
    buttons[0].onPress();
    expect(await result).toBe(false);
  });

  it("treats native dismissal and cancellation as no deletion", async () => {
    native.platform.OS = "android";
    const dismissed = confirmDeletion(prompt);
    native.alert.mock.calls[0][3].onDismiss();
    expect(await dismissed).toBe(false);

    const cancelled = confirmDeletion(prompt);
    native.alert.mock.calls[1][2][0].onPress();
    expect(await cancelled).toBe(false);
  });
});
