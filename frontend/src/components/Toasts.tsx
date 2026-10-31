import { CONCEPT_ICON } from "../icons/concepts";
import { useMemo, useState } from "react";
import { Icon } from "./Icon";

export interface Toast {
  id: number;
  kind: "ok" | "warning" | "error" | "info";
  title: string;
  body?: string;
  action?: { label: string; run: () => void };
  ttl?: number;
  /** On its way out (fading), removed a moment later. */
  leaving?: boolean;
}

export interface ToastState {
  items: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const LEAVE_MS = 200;
const KIND_ICON = { ok: CONCEPT_ICON.done, warning: CONCEPT_ICON.warning, error: CONCEPT_ICON.warning, info: CONCEPT_ICON.info } as const;

export function useToasts(): ToastState {
  const [items, setItems] = useState<Toast[]>([]);
  const fns = useMemo(() => {
    // A toast fades out before it's removed.
    const dismiss = (id: number) => {
      setItems((xs) => xs.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      window.setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), LEAVE_MS);
    };
    const push = (t: Omit<Toast, "id">) => {
      const toast = { ...t, id: nextId++ };
      setItems((xs) => [...xs.slice(-4), toast]);
      const ttl = t.ttl ?? (t.kind === "warning" || t.kind === "error" ? 9000 : 4000);
      window.setTimeout(() => dismiss(toast.id), ttl);
    };
    return { push, dismiss };
  }, []);
  return useMemo(() => ({ items, ...fns }), [items, fns]);
}

export function Toasts({ state }: { state: ToastState }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {state.items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}${t.leaving ? " leaving" : ""}`}>
          <Icon name={KIND_ICON[t.kind]} className="toast-icon" />
          <div className="toast-main">
            <strong>{t.title}</strong>
            {t.body && <p>{t.body}</p>}
          </div>
          <div className="toast-actions">
            {t.action && (
              <button
                className="btn small"
                onClick={() => {
                  t.action!.run();
                  state.dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="icon-btn" aria-label="Dismiss" onClick={() => state.dismiss(t.id)}>
              <Icon name={CONCEPT_ICON.close} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
