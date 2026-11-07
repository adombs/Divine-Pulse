import { SKILL_LABEL, type Aptitude, type SkillKey } from "../reference/types";
import { MissingGameAsset, useGameImageUrl } from "./GameImage";
import { maskStyle } from "./gameImageSources";

/** Every trainable skill uses a symbol cut from the game's UI atlas. */
const SKILL_FILE: Record<SkillKey, string> = {
  sword: "weapon-sword", lance: "weapon-lance", axe: "weapon-axe", bow: "weapon-bow",
  brawling: "weapon-gauntlets", reason: "weapon-reason", faith: "weapon-faith",
  authority: "skill-authority", heavy_armor: "skill-heavy-armor",
  riding: "skill-riding", flying: "skill-flying",
};

const TONE: Record<string, { colour: string; label: string }> = {
  strong: { colour: "var(--green)", label: "strength" },
  weak: { colour: "var(--red)", label: "weakness" },
  budding: { colour: "var(--accent)", label: "budding talent" },
  weak_budding: { colour: "var(--red)", label: "weakness and budding talent" },
  none: { colour: "color-mix(in srgb, currentColor 38%, transparent)", label: "no particular aptitude" },
};

/**
 * A skill's icon, filled by how the unit takes to it: green for a strength, red for a weakness, purple for a
 * budding talent, grey for none. A weakness that is also a budding talent stays red.
 * Pass `aptitude={undefined}` to get the plain icon in the surrounding text colour (a skill with no unit).
 */
export function SkillIcon({ skill, aptitude, title }: { skill: SkillKey; aptitude?: Aptitude; title?: string }) {
  const tone = aptitude === undefined ? null : TONE[aptitude ?? "none"];
  const colour = tone?.colour ?? "currentColor";
  const tip = title ?? `${SKILL_LABEL[skill]}${tone ? `: ${tone.label}` : ""}`;
  const file = SKILL_FILE[skill];
  const url = useGameImageUrl(`images/icons/${file.startsWith("weapon-") ? `weapons/${file.slice(7)}` : `skills/${file.slice(6)}`}.png`);
  if (!url) return <MissingGameAsset label={tip} />;
  return (
    <span className="skill-icon" style={{ color: colour }} title={tip} role="img" aria-label={tip}>
      <span className="skill-icon-mask" style={maskStyle(url)} />
    </span>
  );
}
