import type { GameAssetsJob } from "../../api";

const phases: Record<string, string> = { starting: "Getting ready", exe_tables: "Reading game data", text: "Importing text", data: "Importing data", portraits: "Importing portraits", icons: "Importing icons", map: "Importing maps", music: "Importing music", verify: "Checking imported files" };

export const formatElapsed = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
const count = (n: number) => n.toLocaleString();

/** The import's steps (NSP files are unpacked first), which one is running, and what it is doing right now. */
export function importSteps(job: GameAssetsJob) {
  const steps = [...(job.source === "nsp" ? ["Unpack NSP files"] : []), "Import game data", "Check imported files"];
  const current = job.phase === "extracting" ? 0 : steps.length - (job.phase === "verify" ? 1 : 2);
  const families = Math.max(0, job.total - 1);
  let detail: string, done = 0, total = 0, note = "";
  if (job.phase === "extracting") {
    detail = job.step?.label || "Unpacking NSP files";
    done = job.step?.done ?? 0; total = job.step?.total ?? 0;
    if (total) note = `${count(Math.min(done, total))} of ${count(total)} files${job.step?.current ? ` \u00b7 ${job.step.current}` : ""}`;
  } else if (job.phase === "verify") {
    detail = "Checking the imported files";
  } else {
    const part = job.phase && job.phase !== "starting" ? Math.min(job.done + 1, families) : 0;
    detail = `${phases[job.phase ?? ""] ?? "Importing game data"}${part ? ` (${part} of ${families})` : ""}`;
    done = Math.min(job.done, families); total = families;
    if (job.files) note = `${count(job.files)} files written`;
  }
  return { steps, current, detail, done, total, note };
}
