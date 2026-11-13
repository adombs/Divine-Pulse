/** A unit's run score: what it is, and how it is written. (The backend's domain/best_unit.py works it out.) */
export const SCORE_EXPLANATION = "Damage dealt plus healing done, averaged over the completed battles the unit was deployed in (not as an adjutant).";

export const fmtScore = (score: number | undefined) => (score ?? 0).toLocaleString();
