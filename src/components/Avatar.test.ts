import { expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ useColorScheme: () => "light", StyleSheet: { create: (styles: unknown) => styles }, Text: "Text", View: "View" }));

import { initials } from "./Avatar";

it("uses first and last initials, falling back gracefully", () => {
  expect(initials("Alex")).toBe("A");
  expect(initials("kunwar singh padda")).toBe("KP");
  expect(initials("  ")).toBe("?");
  expect(initials("jane.doe")).toBe("JD");
});
