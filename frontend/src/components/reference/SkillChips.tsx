import { SKILL_KEYS, SKILL_LABEL, type Character, type GameClass } from "../../reference/types";
import { SkillIcon } from "../SkillIcon";

export function SkillChips({ character, gameClass }: { character?: Character; gameClass?: GameClass }) {
  const skills = character
    ? SKILL_KEYS.map((key) => {
        const skill = character.skills[key];
        const rank = skill.initial || "E";
        return { key, rank, aptitude: skill.aptitude, title: `${SKILL_LABEL[key]}${skill.aptitude ? `: ${skill.aptitude.replace("_", " and ")}` : ""}, starting rank ${rank}` };
      })
    : SKILL_KEYS.filter((key) => gameClass?.skill_bonus[key] || gameClass?.proficient.includes(key)).map((key) => {
        const proficient = gameClass!.proficient.includes(key);
        const bonus = gameClass!.skill_bonus[key];
        const title = `${SKILL_LABEL[key]}${proficient ? ": proficient (the class trains it)" : ""}${bonus ? `${proficient ? ", " : ": "}+${bonus} skill rank bonus in this class` : ""}`;
        return { key, rank: bonus ? `+${bonus}` : "", aptitude: proficient ? "strong" as const : null, title };
      });
  return <div className="shared-skill-chips">{skills.map(({ key, rank, aptitude, title }) => <span key={key} className={`skill-chip ${aptitude ?? ""}`} title={title}>
    <SkillIcon skill={key} aptitude={aptitude ?? undefined} title={title} /><span className="skill-rank">{rank}</span>
  </span>)}</div>;
}
