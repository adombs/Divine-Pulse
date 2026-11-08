/**
 * Links that open a reference entry from anywhere in the app (each is a history entry, so Back returns).
 * Names are matched fuzzily against the reference data, so a saved or hand-typed name ("Gremroy", "HP+5")
 * still opens the right class or ability.
 */
import { ReactNode } from "react";
import { canonical } from "../fuzzy";
import { isMysteryCrest } from "../reference/crests";
import { useNav } from "../nav";
import { useReference } from "../reference/types";
import { useSpoiler } from "../spoilers";
import { gambitOwner, isStoryClass, matchNames } from "../reference/links";
import { RefLink } from "./common";

/** A character by Characters page key ("edelgard", "byleth"). Renders plain text when there's no key. */
export function CharLink({ charKey, children, title }: { charKey: string | null | undefined; children: ReactNode; title?: string }) {
  const nav = useNav();
  if (!charKey) return <>{children}</>;
  return (
    <RefLink
      onClick={() => nav.go({ page: "archive", tab: "characters", id: charKey })}
      title={title ?? "Open in the Archive"}
    >
      {children}
    </RefLink>
  );
}

/** A class by name. An unknown name or enemy class shows as plain text. */
export function ClassLink({ name, children }: { name: string; children?: ReactNode }) {
  const nav = useNav();
  const ref = useReference();
  const [showStoryClasses] = useSpoiler("storyClasses");
  const known = !showStoryClasses && isStoryClass(name) ? null : ref ? canonical(name, ref.classes.filter((c) => showStoryClasses || !isStoryClass(c.name)).map((c) => c.name)) : null;
  if (!name || !known) return <>{children ?? (name || "—")}</>;
  return (
    <RefLink onClick={() => nav.go({ page: "archive", tab: "classes", id: known })} title={`Open ${known} in the Archive`}>
      {children ?? name}
    </RefLink>
  );
}

export function ArtLink({ name, children }: { name: string; children?: ReactNode }) {
  const nav = useNav();
  const ref = useReference();
  const known = (ref && canonical(name, ref.combat_arts.map((a) => a.name))) || name;
  return (
    <RefLink onClick={() => nav.go({ page: "archive", tab: "arts", q: known })} title="Look it up in Combat arts">
      {children ?? name}
    </RefLink>
  );
}

export function AbilityLink({ name, children }: { name: string; children?: ReactNode }) {
  const nav = useNav();
  const ref = useReference();
  const known = (ref && canonical(name, ref.abilities.map((a) => a.name))) || name;
  return (
    <RefLink onClick={() => nav.go({ page: "archive", tab: "abilities", q: known })} title={known !== name ? `Look up ${known}` : "Look it up in Abilities"}>
      {children ?? name}
    </RefLink>
  );
}

/** A character's supports (support name: "Edelgard", or "Byleth"). */
export function SupportsLink({ name, children }: { name: string; children: ReactNode }) {
  const nav = useNav();
  return (
    <RefLink onClick={() => nav.go({ page: "supports", tab: "character", id: name })} title="Support partners and gifts">
      {children}
    </RefLink>
  );
}

/** A spell in the bundled Magic reference. Unknown names keep their original text. */
export function SpellLink({ name, children }: { name: string; children?: ReactNode }) {
  const nav = useNav();
  const ref = useReference();
  const known = ref && canonical(name, ref.magic.map((spell) => spell.name));
  if (!known) return <>{children ?? name}</>;
  return <RefLink onClick={() => nav.go({ page: "archive", tab: "magic", q: known })} title={`Look up ${known} in Magic`}>{children ?? name}</RefLink>;
}

/** Available inventory facts, shared with the game's own item tables. */
export function ItemLink({ name, children }: { name: string; children?: ReactNode }) {
  const nav = useNav();
  const ref = useReference();
  const known = ref && canonical(name, ref.items.map((item) => item.name));
  if (!known) return <>{children ?? name}</>;
  const item = ref?.items.find((entry) => entry.name === known);
  return <RefLink onClick={() => nav.go({ page: "archive", tab: item?.kind === "Weapon" ? "weapons" : "items", q: known })} title={`Look up ${known} in ${item?.kind === "Weapon" ? "Weapons" : "Items"}`}>{children ?? name}</RefLink>;
}


/** A battalion by name, linked to its entry in the Archive's Battalions tab (plain text when the import doesn't list it). */
export function BattalionLink({ name, children }: { name: string; children?: ReactNode }) {
  const nav = useNav();
  const ref = useReference();
  const known = ref?.battalions?.length ? canonical(name, ref.battalions.map((b) => b.name)) : null;
  if (!known) return <>{children ?? name}</>;
  return (
    <RefLink onClick={() => nav.go({ page: "archive", tab: "battalions", id: known })} title={`Open ${known} in the Archive`}>
      {children ?? name}
    </RefLink>
  );
}

/** A battalion gambit by name, linked to the battalion that has it in the Archive's Battalions tab (`battalion`: the
 * one the unit is known to have, since several share a gambit). Plain text when no imported battalion has it. */
export function GambitLink({ name, battalion, children }: { name: string; battalion?: string | null; children?: ReactNode }) {
  const nav = useNav();
  const ref = useReference();
  const owner = ref?.battalions?.length ? gambitOwner(ref.battalions, name, battalion) : null;
  if (!owner) return <>{children ?? name}</>;
  return (
    <RefLink onClick={() => nav.go({ page: "archive", tab: "battalions", id: owner })} title={`Open ${owner} in the Archive`}>
      {children ?? name}
    </RefLink>
  );
}

/** A crest by name, as text linked to its entry on the Crests page. */
export function CrestLink({ name, children }: { name: string; children?: ReactNode }) {
  const nav = useNav();
  const ref = useReference();
  const known = ref ? canonical(name, ref.crests.map((c) => c.name)) : null;
  if (isMysteryCrest(name)) return <>Mystery Crest</>;
  if (!known) return <>{children ?? name}</>;
  return (
    <RefLink onClick={() => nav.go({ page: "archive", tab: "crests", id: known })} title={`Open ${known} in the Archive`}>
      {children ?? name}
    </RefLink>
  );
}
/** Link known names in descriptive prose. */
export function LinkedDescription({ text }: { text: string }) {
  const ref = useReference();
  if (!ref || !text) return <>{text}</>;
  const entries = [
    ...ref.crests.map((c) => ({ name: `Crest of ${c.name}`, render: (label: string) => <CrestLink name={c.name}>{label}</CrestLink> })),
    ...ref.characters.map((c) => ({ name: c.name, render: (label: string) => <CharLink charKey={c.key}>{label}</CharLink> })),
    ...ref.classes.map((c) => ({ name: c.name, render: (label: string) => <ClassLink name={c.name}>{label}</ClassLink> })),
    ...ref.magic.map((m) => ({ name: m.name, render: (label: string) => <SpellLink name={m.name}>{label}</SpellLink> })),
    ...ref.combat_arts.map((a) => ({ name: a.name, render: (label: string) => <ArtLink name={a.name}>{label}</ArtLink> })),
    ...ref.abilities.map((a) => ({ name: a.name, render: (label: string) => <AbilityLink name={a.name}>{label}</AbilityLink> })),
    ...ref.items.map((i) => ({ name: i.name, render: (label: string) => <ItemLink name={i.name}>{label}</ItemLink> })),
  ];
  const matches = matchNames(text, entries.map((e) => e.name));
  let end = 0;
  return <>{matches.map((m) => { const before = text.slice(end, m.start); end = m.end; const entry = entries.find((e) => e.name === m.name)!; return <span key={m.start}>{before}{entry.render(text.slice(m.start, m.end))}</span>; })}{text.slice(end)}</>;
}
