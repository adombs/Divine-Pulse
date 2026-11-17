/**
 * The Planner's Archive entries (what a plan can name and notes can link to), their icons, and the search box that
 * picks one.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useReference, type ReferenceData } from "../../reference/types";
import { isStoryClass, tierRank } from "../../reference/links";
import { abilityIconUrl, artIconUrl, crestIconUrl, itemIconUrl, spellIconUrl, RefIcon } from "../../reference/icons";
import { useSpoiler } from "../../spoilers";
import { KIND_LABEL, searchEntries, type ArchiveEntry, type LinkKind } from "../../planner";
import { TierIcon } from "../reference/TierIcon";
import { Icon, type IconName } from "../Icon";
import { CONCEPT_ICON } from "../../icons/concepts";

/** The game-asset path of an entry's in-game icon; units and classes have none. */
export function entryIcon(kind: LinkKind, id: string, ref: ReferenceData | null): string | null {
  switch (kind) {
    case "art": return artIconUrl(id);
    case "ability": return abilityIconUrl(id);
    case "spell": return spellIconUrl(id);
    case "weapon": case "item": return itemIconUrl(id);
    case "crest": return crestIconUrl(id);
    case "battalion": return ref?.battalions?.find((b) => b.name === id)?.icon ?? null;
    default: return null;
  }
}

/** Every linkable Archive entry, units first; story classes only when their spoilers are shown. */
export function useArchiveEntries(): { ref: ReferenceData | null; entries: ArchiveEntry[] } {
  const ref = useReference();
  const [storyClasses] = useSpoiler("storyClasses");
  const entries = useMemo(() => {
    if (!ref) return [];
    const out: ArchiveEntry[] = [];
    const add = (kind: LinkKind, id: string, label = id) => out.push({ kind, id, label, icon: null });
    for (const c of ref.characters) add("unit", c.key, c.name);
    for (const c of sortClasses(ref.classes.filter((c) => storyClasses || !isStoryClass(c.name)))) add("class", c.name);
    for (const i of ref.items) add(i.kind === "Weapon" ? "weapon" : "item", i.name);
    for (const a of ref.combat_arts) if (!out.some((e) => e.kind === "art" && e.id === a.name)) add("art", a.name);
    for (const a of ref.abilities) add("ability", a.name);
    for (const m of ref.magic) add("spell", m.name);
    for (const b of ref.battalions ?? []) add("battalion", b.name);
    for (const c of ref.crests) add("crest", c.name, `Crest of ${c.name}`);
    return out;
  }, [ref, storyClasses]);
  return { ref, entries };
}

export const sortClasses = <T extends { name: string; tier: string }>(classes: T[]) =>
  [...classes].sort((a, b) => tierRank(a) - tierRank(b) || a.name.localeCompare(b.name));

/** An entry's picture: its in-game icon, a class's tier plate, or nothing. */
export function EntryIcon({ entry, data: ref }: { entry: Pick<ArchiveEntry, "kind" | "id">; data: ReferenceData | null }) {
  if (entry.kind === "class") {
    const tier = ref?.classes.find((c) => c.name === entry.id)?.tier;
    return tier ? <span className="ref-icons" aria-hidden><TierIcon tier={tier} size={20} decorative /></span> : null;
  }
  const src = entryIcon(entry.kind, entry.id, ref);
  return src ? <span className="ref-icons" aria-hidden><RefIcon src={src} /></span> : null;
}

/** Results of a search, under the box (or the caret) that asked: a list to pick from with the arrows and Enter. */
export function EntryMenu({
  id,
  anchor,
  items,
  active,
  onHover,
  onPick,
  data: ref,
  showKind,
  notes,
  empty,
}: {
  id: string;
  anchor: DOMRect;
  items: ArchiveEntry[];
  active: number;
  onHover: (i: number) => void;
  onPick: (e: ArchiveEntry) => void;
  data: ReferenceData | null;
  showKind?: boolean;
  /** A word or two beside an entry (why it's suggested), in place of its kind. */
  notes?: Map<string, string>;
  empty?: ReactNode;
}) {
  const menu = useRef<HTMLUListElement>(null);
  const [above, setAbove] = useState(false);
  useLayoutEffect(() => {
    const h = menu.current?.offsetHeight ?? 0;
    setAbove(anchor.bottom + h + 12 > window.innerHeight && anchor.top - h - 12 > 0);
  }, [anchor, items.length]);
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  const style = {
    left: Math.max(8, Math.min(anchor.left, window.innerWidth - 320)),
    ...(above ? { bottom: window.innerHeight - anchor.top + 4 } : { top: anchor.bottom + 4 }),
    minWidth: Math.max(anchor.width, 240),
  };
  return createPortal(
    <ul id={id} ref={menu} className="entry-menu" role="listbox" style={style} onMouseDown={(e) => e.preventDefault()}>
      {items.length === 0 && <li className="entry-empty">{empty ?? "No matches"}</li>}
      {items.map((e, i) => (
        <li
          key={`${e.kind}:${e.id}`}
          id={`${id}-${i}`}
          data-index={i}
          role="option"
          aria-selected={i === active}
          className={i === active ? "on" : ""}
          onMouseEnter={() => onHover(i)}
          onClick={() => onPick(e)}
        >
          <EntryIcon entry={e} data={ref} />
          <span className="entry-name">{e.label}</span>
          {notes?.has(e.id) ? <span className="entry-kind">{notes.get(e.id)}</span> : showKind && <span className="entry-kind">{KIND_LABEL[e.kind]}</span>}
        </li>
      ))}
    </ul>,
    document.body,
  );
}

/** A search box that adds an entry: type, then pick with the arrows and Enter, or click. Opened empty, it lists
 * `suggested` (what the unit's plan makes available) when given; typing searches every entry. */
export function EntryPicker({
  entries,
  placeholder,
  onPick,
  exclude,
  suggested,
  notes: marks,
  icon = CONCEPT_ICON.add,
  className,
}: {
  entries: ArchiveEntry[];
  placeholder: string;
  onPick: (e: ArchiveEntry) => void;
  exclude?: readonly string[];
  suggested?: { entry: ArchiveEntry; note: string }[];
  /** A word or two beside entries in search results too (the suggestions' own notes win while the box is empty). */
  notes?: Map<string, string>;
  icon?: IconName;
  className?: string;
}) {
  const { ref } = useArchiveEntries();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = `picker-${useId().replace(/[^\w-]/g, "")}`;
  const items = useMemo(() => {
    if (!text.trim() && suggested) return suggested.map((s) => s.entry).filter((e) => !exclude?.includes(e.id));
    const left = exclude?.length ? entries.filter((e) => !exclude.includes(e.id)) : entries;
    return searchEntries(left, text, text ? 8 : 50);
  }, [entries, exclude, text, suggested]);
  const notes = useMemo(() => {
    const out = new Map(marks);
    if (!text.trim() && suggested) for (const s of suggested) out.set(s.entry.id, s.note);
    return out.size ? out : undefined;
  }, [text, suggested, marks]);
  const show = () => {
    setAnchor(input.current?.getBoundingClientRect() ?? null);
    setOpen(true);
  };
  useEffect(() => setActive(0), [text]);
  useEffect(() => {
    if (!open) return;
    // Keep the list under the box while the window scrolls.
    const move = () => setAnchor(input.current?.getBoundingClientRect() ?? null);
    window.addEventListener("scroll", move, true);
    window.addEventListener("resize", move);
    return () => { window.removeEventListener("scroll", move, true); window.removeEventListener("resize", move); };
  }, [open]);
  const pick = (e: ArchiveEntry) => {
    onPick(e);
    setText("");
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return show();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a + step + items.length) % Math.max(items.length, 1));
    } else if (e.key === "Enter" && open && items[active]) {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setOpen(false);
    }
  };
  return (
    <div className={`entry-picker${className ? ` ${className}` : ""}`}>
      <Icon name={icon} className="entry-picker-icon" />
      <input
        ref={input}
        value={text}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="list"
        aria-activedescendant={open && items[active] ? `${id}-${active}` : undefined}
        onChange={(e) => { setText(e.target.value); show(); }}
        onFocus={show}
        onClick={show}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
      />
      {open && anchor && <EntryMenu id={id} anchor={anchor} items={items} active={active} onHover={setActive} onPick={pick} data={ref} notes={notes}
        empty={suggested && !text.trim() ? "Type to search" : undefined} />}
    </div>
  );
}
