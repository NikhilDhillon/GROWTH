import { useEffect, useRef, useState } from "react";
import { readReportContext, writeReportContext } from "@/database/reportContext";

/** Device preferences only. This state is never an observation or calculation authority. */
export function useReportContext<T>(accountId: string | number | null | undefined, report: string, defaults: T, validate: (input: unknown) => input is T) {
  const key = accountId == null ? null : `growth.report.v1:${typeof accountId}:${encodeURIComponent(String(accountId))}:${report}`;
  const [state, setState] = useState<{ key: string | null; value: T }>({ key, value: defaults });
  const [error, setError] = useState<string | null>(null);
  const identity = useRef(key); identity.current = key;
  const queue = useRef(Promise.resolve());
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    setState({ key, value: defaults }); setError(null);
    if (!key) return;
    void readReportContext(key).then((raw) => {
      if (token !== generation.current || key !== identity.current) return;
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (validate(parsed)) setState({ key, value: parsed });
    }).catch(() => { if (key === identity.current) setError("Report selections could not be restored on this device."); });
    return () => { generation.current++; };
  }, [key]);
  const value = state.key === key ? state.value : defaults;
  function update(next: T) {
    if (identity.current !== key || !validate(next)) return;
    generation.current++; // A late load cannot overwrite an interactive selection.
    setState({ key, value: next });
    if (!key) return;
    queue.current = queue.current.catch(() => undefined).then(() => writeReportContext(key, JSON.stringify(next)))
      .then(() => { if (identity.current === key) setError(null); })
      .catch(() => { if (identity.current === key) setError("Report selections could not be saved on this device."); });
  }
  return { value, update, error };
}
