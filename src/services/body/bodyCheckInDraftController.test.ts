import { describe, expect, it } from "vitest";
import { assertCaptureDraftReplacement, CaptureDraftConflictError } from "@/database/captureDrafts.shared";
import { createBodyCheckInDraft, createBodyCheckInRequest } from "@/screens/BodyCheckIn/bodyCheckInForm";
import { BodyCheckInDraftController, BodyDraftStorage } from "./bodyCheckInDraftController";

function memory(initial: string | null = null) {
  let raw = initial;
  let failure = false;
  const storage: BodyDraftStorage = { read: async () => raw, write: async (expected, next) => {
    assertCaptureDraftReplacement(raw, expected, next);
    if (failure) throw new Error("Storage full");
    raw = next;
  } };
  return { storage, raw: () => raw, fail: (next: boolean) => { failure = next; } };
}
function draft() {
  const value = createBodyCheckInDraft("2026-10-09", { weight: "kg", circumference: "in" });
  value.weight = "80.375";
  return value;
}

describe("recoverable body input stays distinct from recorded facts", () => {
  it("restores unsubmitted input and the frozen save identity after a fresh initialization", async () => {
    const saved = draft();
    saved.pending = createBodyCheckInRequest(saved, "52000000-0000-0000-0000-000000000001");
    const data = memory();
    const original = new BodyCheckInDraftController(data.storage);
    await original.load(); await original.save(saved);
    const restarted = new BodyCheckInDraftController(data.storage);
    expect(await restarted.load()).toEqual(saved);
    expect(data.raw()).toBe(JSON.stringify(saved));
  });

  it("serializes rapid keystrokes and awaits them before reload", async () => {
    const data = memory(); const controller = new BodyCheckInDraftController(data.storage);
    await controller.load();
    const first = controller.save({ ...draft(), weight: "8" });
    const last = controller.save({ ...draft(), weight: "80.5" });
    const recovered = controller.load();
    await first; await last;
    expect((await recovered)?.weight).toBe("80.5");
  });

  it("refuses a stale tab's overwrite or clear and can explicitly reload the newer draft", async () => {
    const data = memory(); const one = new BodyCheckInDraftController(data.storage); const two = new BodyCheckInDraftController(data.storage);
    await one.load(); await two.load();
    await one.save(draft());
    await expect(two.save({ ...draft(), weight: "90" })).rejects.toBeInstanceOf(CaptureDraftConflictError);
    await expect(two.save(null)).rejects.toBeInstanceOf(CaptureDraftConflictError);
    expect((await two.load())?.weight).toBe("80.375");
    await two.save({ ...draft(), weight: "81" });
    expect(JSON.parse(data.raw()!).weight).toBe("81");
  });

  it("failed cleanup retains pending receipt evidence and permits retry", async () => {
    const saved = draft(); saved.pending = createBodyCheckInRequest(saved, "52000000-0000-0000-0000-000000000002");
    const data = memory(JSON.stringify(saved)); const controller = new BodyCheckInDraftController(data.storage);
    await controller.load(); data.fail(true);
    await expect(controller.save(null)).rejects.toThrow("Storage full");
    expect(data.raw()).toBe(JSON.stringify(saved));
    data.fail(false); await controller.save(null); expect(data.raw()).toBeNull();
  });

  it.each(["{bad json", JSON.stringify({ version: 999, weight: "80" })])("never overwrites unreadable historical draft evidence: %s", async (raw) => {
    const data = memory(raw); const controller = new BodyCheckInDraftController(data.storage);
    await expect(controller.load()).rejects.toThrow(/preserved/);
    await expect(controller.save(draft())).rejects.toThrow(/preserved/);
    expect(data.raw()).toBe(raw);
  });

  it("preserves invalid unfinished field text for correction rather than coercing it", async () => {
    const saved = draft(); saved.weight = "80.."; saved.fields.waist.value = "still measuring";
    const data = memory(JSON.stringify(saved)); const controller = new BodyCheckInDraftController(data.storage);
    expect(await controller.load()).toEqual(saved);
  });
  it("preserves inconsistent retry evidence instead of submitting values different from the form", async () => {
    const saved = draft(); saved.pending = createBodyCheckInRequest(saved, "52000000-0000-0000-0000-000000000003");
    saved.pending.weight = "999";
    const raw = JSON.stringify(saved); const data = memory(raw); const controller = new BodyCheckInDraftController(data.storage);
    await expect(controller.load()).rejects.toThrow(/preserved/);
    await expect(controller.save(null)).rejects.toThrow(/preserved/);
    expect(data.raw()).toBe(raw);
  });
});
