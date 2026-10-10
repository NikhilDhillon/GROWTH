import { useEffect, useRef, useState } from "react";
import { readQuickWorkoutDraft, writeQuickWorkoutDraft } from "@/database/quickWorkoutDrafts";
import { QuickWorkoutDraft, QuickWorkoutDraftController } from "@/services/workouts/quickWorkoutDraft";

export function useQuickWorkoutDraft(accountId: string | number | null | undefined, defaults: QuickWorkoutDraft) {
  const [draft, displayDraft] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const value = useRef(defaults);
  const controller = useRef<{ accountId: string | number; instance: QuickWorkoutDraftController } | null>(null);
  const account = useRef(accountId);
  account.current = accountId;
  useEffect(() => {
    let active = true;
    setReady(false);
    setRecoveryError(null);
    if (accountId == null) { controller.current = null; return; }
    const instance = new QuickWorkoutDraftController(String(accountId), { read: () => readQuickWorkoutDraft(accountId), write: (expected, next) => writeQuickWorkoutDraft(accountId, expected, next) });
    controller.current = { accountId, instance };
    void instance.load().then((saved) => { if (active) { value.current = saved ?? defaults; displayDraft(value.current); setReady(true); } })
      .catch((error) => { if (active) setRecoveryError(message(error)); });
    return () => { active = false; };
  }, [accountId]);
  function setDraft(update: QuickWorkoutDraft | ((draft: QuickWorkoutDraft) => QuickWorkoutDraft)) {
    if (!ready || account.current !== accountId || controller.current?.accountId !== accountId) return;
    const next = typeof update === "function" ? update(value.current) : update;
    value.current = next;
    displayDraft(next);
    void controller.current!.instance.save(next).catch((error) => { if (account.current === accountId) setRecoveryError(message(error)); });
  }
  async function flushDraft(next?: QuickWorkoutDraft) {
    const current = controller.current;
    if (!ready || !current || account.current !== accountId || current.accountId !== accountId) throw new Error("Wait for your saved Quick workout draft to load before recording.");
    if (next) { value.current = next; displayDraft(next); }
    try { await current.instance.save(next ?? value.current); }
    catch (error) { if (account.current === accountId) setRecoveryError(message(error)); throw error; }
    if (account.current === accountId) setRecoveryError(null);
  }
  async function clearDraft(nextDefaults: QuickWorkoutDraft = defaults) {
    const current = controller.current;
    if (!current || account.current !== accountId || current.accountId !== accountId) return;
    await current.instance.save(null);
    if (account.current === accountId) { value.current = nextDefaults; displayDraft(nextDefaults); setRecoveryError(null); }
  }
  async function reloadDraft() {
    const current = controller.current;
    if (!current || account.current !== accountId || current.accountId !== accountId) return;
    const saved = await current.instance.load();
    if (account.current === accountId) { value.current = saved ?? defaults; displayDraft(value.current); setReady(true); setRecoveryError(null); }
  }
  return { draft: controller.current?.accountId === accountId ? draft : defaults, setDraft, ready: ready && controller.current?.accountId === accountId,
    recoveryError, flushDraft, clearDraft, reloadDraft };
}
function message(error: unknown) { return error instanceof Error ? error.message : "Your Quick workout draft could not be saved. Keep this page open."; }
