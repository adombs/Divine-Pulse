import type { ReactNode } from "react";
import { CONCEPT_ICON } from "../icons/concepts";
import { SKILL_LABEL, type SkillKey } from "../reference/types";
import { Icon, type IconName } from "./Icon";
import { SkillIcon } from "./SkillIcon";

/** Keep option and chip text identical; its semantic icon is decorative. */
export function FilterLabel({ children, icon }: { children: ReactNode; icon?: IconName }) {
  return <span className="filter-label">{icon && <Icon name={icon} />}{children}</span>;
}

/** Only known weapon/skill types have an icon. Unknown and Other stay text-only. */
export function SkillFilterLabel({ label }: { label: string }) {
  const skill = (Object.keys(SKILL_LABEL) as SkillKey[]).find((key) => SKILL_LABEL[key].toLowerCase() === label.toLowerCase())
    ?? (label === "Gauntlet" || label === "Gauntlets" ? "brawling" : undefined);
  return <span className="filter-label">{skill ? <span aria-hidden="true"><SkillIcon skill={skill} /></span> : label === "Magic" ? <Icon name={CONCEPT_ICON.spell} /> : null}{label}</span>;
}

export const GENDER_OPTIONS = [
  ["Male", <FilterLabel key="male" icon={CONCEPT_ICON.male}>Men</FilterLabel>],
  ["Female", <FilterLabel key="female" icon={CONCEPT_ICON.female}>Women</FilterLabel>],
] as const;
