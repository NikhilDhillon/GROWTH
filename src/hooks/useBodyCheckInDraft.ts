import { useEffect, useRef, useState } from "react";
import type { BodyCheckInDraft } from "@/screens/BodyCheckIn/bodyCheckInForm";
import { readBodyCheckInDraft, writeBodyCheckInDraft } from "@/database/captureDrafts";
import { BodyCheckInDraftController } from "@/services/body/bodyCheckInDraftController";

export function useBodyCheckInDraft(accountId: string | number | null | undefined, defaults: BodyCheckInDraft) {
  const [draft, displayDraft] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const value = useRef(defaults);
  const controller = useRef<{ accountId: string | number; instance: BodyCheckInDraftController } | null>(null);
  const account = useRef(accountId);
  account.current = accountId;

  useEffect(() => {
    let active = true;
    setReady(false);
    setRecoveryError(null);
    if (accountId == null) { controller.current = null; return; }
    const instance = new BodyCheckInDraftController({ read: () => readBodyCheckInDraft(accountId), write: (expected, next) => writeBodyCheckInDraft(accountId, expected, next) });
    controller.current = { accountId, instance };
    void instance.load().then((saved) => {
      if (!active) return;
      value.current = saved ?? defaults;
      displayDraft(value.current);
      setReady(true);
    }).catch((caught) => { if (active) setRecoveryError(message(caught)); });
    return () => { active = false; };
  }, [accountId]);

  function setDraft(update: BodyCheckInDraft | ((current: BodyCheckInDraft) => BodyCheckInDraft)) {
    if (!ready || account.current !== accountId || controller.current?.accountId !== accountId) return;
    const next = typeof update === "function" ? update(value.current) : update;
    value.current = next;
    displayDraft(next);
    void controller.current?.instance.save(next).catch((caught) => {
      if (account.current === accountId) setRecoveryError(message(caught));
    });
  }

  async function flushDraft(next?: BodyCheckInDraft) {
    const instance = controller.current?.instance;
    if (!ready || !instance || account.current !== accountId || controller.current?.accountId !== accountId) throw new Error("Wait for your saved body-entry draft to load before recording.");
    if (next) { value.current = next; displayDraft(next); }
    try { await instance.save(next ?? value.current); }
    catch (caught) { if (account.current === accountId) setRecoveryError(message(caught)); throw caught; }
    if (account.current === accountId) setRecoveryError(null);
  }

  async function clearDraft(nextDefaults: BodyCheckInDraft = defaults) {
    const instance = controller.current?.instance;
    if (!instance || account.current !== accountId || controller.current?.accountId !== accountId) return;
    await instance.save(null);
    if (account.current === accountId) { value.current = nextDefaults; displayDraft(nextDefaults); setRecoveryError(null); }
  }

  async function reloadDraft() {
    if (!controller.current || account.current !== accountId || controller.current.accountId !== accountId) return;
    const saved = await controller.current.instance.load();
    if (account.current === accountId) { value.current = saved ?? defaults; displayDraft(value.current); setRecoveryError(null); setReady(true); }
  }

  const belongsToAccount = controller.current?.accountId === accountId;
  return { draft: belongsToAccount ? draft : defaults, setDraft, ready: ready && belongsToAccount, recoveryError, flushDraft, clearDraft, reloadDraft };
}
function message(error: unknown) { return error instanceof Error ? error.message : "Your body-entry draft could not be saved. Keep this page open."; }
