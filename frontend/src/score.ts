/** A unit's run score: what it is, and how it is written. (The backend's domain/best_unit.py works it out.) */
export const SCORE_EXPLANATION = "Average damage plus half the healing per battle deployed.";

export const fmtScore = (score: number | undefined) => (score ?? 0).toLocaleString();
