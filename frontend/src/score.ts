/** A unit's run score: what it is, and how it is written. (The backend's domain/best_unit.py works it out.) */
export const SCORE_EXPLANATION = "1,000 points per battle MVP, plus damage dealt and healing done in completed battles.";

export const fmtScore = (score: number | undefined) => (score ?? 0).toLocaleString();
