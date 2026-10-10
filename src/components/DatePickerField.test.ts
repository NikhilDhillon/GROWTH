import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ show: false }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useState: () => [hooks.show, (value: boolean) => { hooks.show = value; }] }));
vi.mock("react-native", () => ({ useColorScheme: () => "light", Platform: { OS: "android", select: (value: any) => value.native }, Pressable: "Pressable", View: "View", StyleSheet: { create: (value: any) => value } }));
vi.mock("@react-native-community/datetimepicker", () => ({ default: "DateTimePicker" }));
vi.mock("lucide-react-native", () => ({ CalendarDays: "CalendarDays" }));
vi.mock("@/components/Text", () => ({ Body: "Body" }));
import { DatePickerField } from "./DatePickerField";

beforeEach(() => { vi.stubGlobal("React", React); hooks.show = true; });
afterEach(() => vi.unstubAllGlobals());
function picker(node: any): any {
  if (Array.isArray(node)) return node.map(picker).find(Boolean);
  if (!node || typeof node !== "object" || !node.props) return undefined;
  return node.type === "DateTimePicker" ? node : picker(node.props.children);
}
it("dismissal never turns an invalid recorded date into today's provisional picker value", () => {
  const onChange = vi.fn();
  const selected = picker(DatePickerField({ value: "2026-02-30", onChange }));
  selected.props.onChange({ type: "dismissed" }, selected.props.value);
  expect(onChange).not.toHaveBeenCalled();
});
it("explicit calendar selection can correct an unresolved date", () => {
  const onChange = vi.fn();
  picker(DatePickerField({ value: "", onChange })).props.onChange({ type: "set" }, new Date(2026, 9, 9));
  expect(onChange).toHaveBeenCalledWith("2026-10-09");
});
