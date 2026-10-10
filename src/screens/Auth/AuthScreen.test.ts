import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";

// Exercise the screen's input/action boundary without adding a DOM or native renderer.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0 }));
const auth = vi.hoisted(() => ({
  login: vi.fn(), register: vi.fn(), resetPassword: vi.fn(), updatePassword: vi.fn(),
  authError: null as string | null, authNotice: null, clearAuthError: vi.fn()
}));
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (next: unknown) => {
      hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next;
    }];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  }
}));
vi.mock("react-native", () => ({ useColorScheme: () => "light",
  KeyboardAvoidingView: "KeyboardAvoidingView", Pressable: "Pressable", TextInput: "TextInput", View: "View",
  Platform: { OS: "web" }, StyleSheet: { create: (styles: unknown) => styles }
}));
vi.mock("lucide-react-native", () => ({ KeyRound: "KeyRound", LogIn: "LogIn", TrendingUp: "TrendingUp", UserPlus: "UserPlus" }));
vi.mock("@/components/Panel", () => ({ Panel: "Panel" }));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/Text", () => ({ Body: "Body", Label: "Label", SectionTitle: "SectionTitle", Title: "Title" }));
vi.mock("@/store/useFitnessStore", () => ({ useFitnessStore: (select: (state: typeof auth) => unknown) => select(auth) }));

import { AuthScreen } from "@/screens/Auth/AuthScreen";

type Element = { type: unknown; props: { [key: string]: any; children?: unknown } };
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function render(onPasswordUpdated: () => void) {
  hooks.cursor = 0;
  return AuthScreen({ forcePasswordUpdate: true, onPasswordUpdated });
}
function input(tree: unknown, placeholder: string) {
  return elements(tree).find((item) => item.type === "TextInput" && item.props.placeholder === placeholder)!;
}
function submit(tree: unknown) {
  return elements(tree).find((item) => item.type === "Pressable")!;
}
function enterPassword(onPasswordUpdated: () => void) {
  const tree = render(onPasswordUpdated);
  input(tree, "New password").props.onChangeText("test-password-123");
  input(tree, "Confirm password").props.onChangeText("test-password-123");
  return render(onPasswordUpdated);
}

beforeEach(() => {
  // Expo transforms JSX automatically; the Node test transform uses classic JSX.
  vi.stubGlobal("React", React);
  hooks.slots = [];
  hooks.cursor = 0;
  vi.clearAllMocks();
  auth.authError = null;
  auth.updatePassword.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("password recovery completion", () => {
  it("keeps recovery and entered passwords available after a rejected update", async () => {
    const completed = vi.fn();
    auth.updatePassword.mockImplementation(async () => {
      auth.authError = "Password update failed. Please retry.";
      return false;
    });
    await submit(enterPassword(completed)).props.onPress();

    const tree = render(completed);
    expect(completed).not.toHaveBeenCalled();
    expect(input(tree, "New password").props.value).toBe("test-password-123");
    expect(input(tree, "Confirm password").props.value).toBe("test-password-123");
    expect(submit(tree).props.disabled).toBe(false);
    expect(elements(tree).some((item) => item.props.children === "Password update failed. Please retry.")).toBe(true);
  });

  it("completes recovery and clears passwords only after a successful update", async () => {
    const completed = vi.fn();
    auth.updatePassword.mockResolvedValue(true);
    await submit(enterPassword(completed)).props.onPress();

    expect(completed).toHaveBeenCalledTimes(1);
    expect(input(render(completed), "New password").props.value).toBe("");
    expect(input(render(completed), "Confirm password").props.value).toBe("");
  });

  it("does not submit twice when tapped again before the first update completes", async () => {
    const completed = vi.fn();
    let finish!: (success: boolean) => void;
    auth.updatePassword.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const button = submit(enterPassword(completed));
    const pending = button.props.onPress();
    await button.props.onPress();
    expect(auth.updatePassword).toHaveBeenCalledTimes(1);
    expect(submit(render(completed)).props.disabled).toBe(true);
    expect(completed).not.toHaveBeenCalled();

    finish(true);
    await pending;
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it("preserves retry state and reports an unexpected rejected request", async () => {
    const completed = vi.fn();
    auth.updatePassword.mockRejectedValue(new Error("Disconnected."));
    await submit(enterPassword(completed)).props.onPress();

    const tree = render(completed);
    expect(completed).not.toHaveBeenCalled();
    expect(input(tree, "New password").props.value).toBe("test-password-123");
    expect(elements(tree).some((item) => item.props.children === "Disconnected.")).toBe(true);
  });

  it("masks both password fields and disables automatic correction", () => {
    const tree = render(vi.fn());
    for (const placeholder of ["New password", "Confirm password"]) {
      expect(input(tree, placeholder).props.secureTextEntry).toBe(true);
      expect(input(tree, placeholder).props.autoCorrect).toBe(false);
    }
  });
});
