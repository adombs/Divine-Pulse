/**
 * Form checks, mirroring the backend's (backend/app/interface/inputs.py) so problems show up while typing rather than
 * as an error after saving. The backend still checks everything again.
 */
import { RunSummary } from "./api";

export const MAX_LEN = { runName: 60 };

/** Control characters dropped and whitespace collapsed, like the server does. */
export function cleanText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
}

export function textError(value: string, what: string, max: number, required = true): string | null {
  const v = cleanText(value);
  if (required && !v) return `${what} can't be empty.`;
  if (v.length > max) return `${what} must be at most ${max} characters.`;
  return null;
}

/** A decimal number in [lo, hi] (e.g. seconds), or an error message. */
export function numberError(value: string, what: string, [lo, hi]: [number, number], unit = ""): string | null {
  const t = value.trim();
  if (!t) return `${what} is missing.`;
  const n = Number(t);
  if (!Number.isFinite(n)) return `${what} must be a number.`;
  if (n < lo || n > hi) return `${what} must be between ${lo} and ${hi}${unit}.`;
  return null;
}

/** Another item already using this name (case, spacing and punctuation ignored). */
export function duplicateName<T>(name: string, items: T[], nameOf: (t: T) => string, skip?: T): T | undefined {
  const n = normalizeName(name);
  return items.find((t) => t !== skip && normalizeName(nameOf(t)) === n);
}

const normalizeName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}+]+/gu, " ").trim();


/** Why a run name can't be used, or null. `self`: the run being renamed. */
export function runNameError(name: string, runs: RunSummary[], self?: RunSummary): string | null {
  const err = textError(name, "Run name", MAX_LEN.runName);
  if (err) return err;
  const taken = duplicateName(cleanText(name), runs, (r) => r.name, self);
  return taken ? `There is already a run called "${taken.name}".` : null;
}
