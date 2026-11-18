/**
 * The game has a save loaded that isn't the active run's: the tracker syncs nothing until the player switches to the
 * run it belongs to, starts a new run for it, or syncs it with this run. Playing on with it (a battle starting, a unit
 * changing) syncs it with this run without asking.
 */
import { FormEvent, useEffect, useState } from "react";
import { api, RunSummary, SavePromptInfo } from "../api";
import { MAX_LEN, cleanText, runNameError } from "../validation";
import { ToastState } from "./Toasts";
import { Modal } from "./Modal";
import "./save-prompt.css";

interface Props {
  prompt: SavePromptInfo | null;
  runs: RunSummary[];
  /** Reopens the window after it was closed (the sidebar's status). */
  reopen: number;
  onSwitchRun: (id: string) => Promise<void>;
  toasts: ToastState;
}

const updated = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function SavePrompt({ prompt, runs, reopen, onSwitchRun, toasts }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [working, setWorking] = useState(false);
  const key = prompt ? `${prompt.run_id}:${prompt.matches.map((m) => m.id).join(",")}` : "";
  useEffect(() => setOpen(Boolean(key)), [key]);
  useEffect(() => { if (reopen && key) setOpen(true); }, [reopen, key]);
  if (!prompt) return null;
  const active = runs.find((r) => r.id === prompt.run_id);
  const nameError = name.trim() ? runNameError(name, runs) : null;

  const act = async (what: string, action: () => Promise<unknown>) => {
    setWorking(true);
    try {
      await action();
      setOpen(false);
    } catch (e) {
      toasts.push({ kind: "error", title: `Couldn't ${what}`, body: (e as Error).message });
    } finally {
      setWorking(false);
    }
  };
  const startRun = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || nameError) return;
    void act("start the run", async () => {
      const run = await api.createRun(cleanText(name));
      await onSwitchRun(run.id);
      setName("");
      toasts.push({ kind: "ok", title: `Started "${run.name}"` });
    });
  };
  const sync = () => void act("sync the save", () => api.syncSave());

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      className="save-prompt"
      title={prompt.matches.length ? "This save belongs to another run" : "This save isn't tied to a run"}
    >
      <p>
        {prompt.matches.length
          ? <>The game has a save from {prompt.matches.length === 1 ? "another run" : "other runs"} loaded. Nothing is synced into {active ? <strong>{active.name}</strong> : "this run"} until you choose.</>
          : <>The game has a save loaded that no run follows. Nothing is synced into {active ? <strong>{active.name}</strong> : "this run"} until you choose.</>}
      </p>
      {prompt.matches.length > 0 ? (
        <ul className="save-prompt-runs">
          {prompt.matches.map((m) => (
            <li key={m.id}>
              <span className="save-prompt-run">
                <strong>{m.name}</strong>
                <small>Updated {updated.format(new Date(m.updated_at))}</small>
              </span>
              <button type="button" className="btn small" disabled={working} onClick={() => void act("switch runs", () => onSwitchRun(m.id))}>
                Switch to this run
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <form className="save-prompt-new" onSubmit={startRun}>
          <label htmlFor="save-prompt-name">Start a new run with this save</label>
          <div className="save-prompt-row">
            <input
              id="save-prompt-name"
              placeholder="New run name"
              value={name}
              maxLength={MAX_LEN.runName + 10}
              aria-invalid={Boolean(nameError)}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn small" disabled={working || !name.trim() || Boolean(nameError)}>Start a new run</button>
          </div>
          {nameError && <small className="save-prompt-error" role="alert">{nameError}</small>}
        </form>
      )}
      <div className="save-prompt-sync">
        <button type="button" className="btn small" disabled={working} onClick={sync}>Sync with this Run</button>
        <small>Playing on with this save (starting a battle, or any unit changing) also syncs it with this run.</small>
      </div>
    </Modal>
  );
}
