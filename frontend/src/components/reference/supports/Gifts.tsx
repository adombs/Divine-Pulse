/**
 * Gifts, Meals, and Lost Items: imported recipes and the characters who like or dislike each item.
 */
import { CONCEPT_ICON } from "../../../icons/concepts";
import { useMemo, useState } from "react";
import { MonasteryPerson, SupportData } from "../../../reference/supports";
import { KeyPortrait } from "../../ui";
import { DetailCard, EmptyState, MasterDetail } from "../../layout";
import { NoMatches, SearchBox, Segmented } from "../../common";
import { Icon } from "../../Icon";
import { RefIcon, itemIconUrl } from "../../../reference/icons";
import { searchMatches } from "../../../fuzzy";
import { CharLink } from "../../Links";
import { Person } from "./shared";

type Kind = "lost" | "gifts" | "meals";

const KIND_ICON = { lost: CONCEPT_ICON.lostItem, gifts: CONCEPT_ICON.gifts, meals: CONCEPT_ICON.meals } as const;

const LABELS: [Kind, string][] = [
  ["lost", "Lost Items"],
  ["gifts", "Gifts"],
  ["meals", "Meals"],
];

interface Group {
  label: string;
  names: string[];
  tone?: "good" | "bad";
}

interface Entry {
  id: string;
  title: string;
  groups: Group[];
  search: string[];
  ingredients?: SupportData["meals"][number]["ingredients"];
  needsImport?: boolean;
}

export function Gifts({ data, people, part2 }: { data: SupportData; people: Person[]; part2: boolean }) {
  const [kind, setKind] = useState<Kind>("lost");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const entries = Object.entries(data.people);

  const invert = (field: keyof MonasteryPerson) => {
    const m = new Map<string, string[]>();
    for (const [name, info] of entries)
      for (const item of (info[field] as string[] | undefined) ?? []) m.set(item, [...(m.get(item) ?? []), name]);
    return m;
  };

  const lists = useMemo(() => {
    const liked = invert("liked_gifts");
    const disliked = invert("disliked_gifts");
    const lost: Entry[] = [...invert("lost_items")]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([item, who]) => ({ id: item, title: item, groups: [{ label: "Belongs To", names: who }], search: [item, ...who] }));
    const gifts: Entry[] = [...new Set([...liked.keys(), ...disliked.keys()])].sort().map((g) => ({
      id: g,
      title: g,
      groups: [
        { label: "Liked By", names: liked.get(g) ?? [], tone: "good" as const },
        { label: "Disliked By", names: disliked.get(g) ?? [], tone: "bad" as const },
      ],
      search: [g, ...(liked.get(g) ?? []), ...(disliked.get(g) ?? [])],
    }));
    const likedMeals = invert("liked_meals");
    const dislikedMeals = invert("disliked_meals");
    const meals: Entry[] = data.meals.map((meal) => ({
      id: meal.id, title: meal.name,
      ingredients: meal.ingredients,
      needsImport: !meal.ingredients || !meal.preferences,
      groups: meal.preferences ? [
        { label: "Liked By", names: likedMeals.get(meal.name) ?? [], tone: "good" as const },
        { label: "Disliked By", names: dislikedMeals.get(meal.name) ?? [], tone: "bad" as const },
      ] : [],
      search: [meal.name, ...(meal.ingredients ?? []).map((i) => i.name), ...(likedMeals.get(meal.name) ?? []), ...(dislikedMeals.get(meal.name) ?? [])],
    })).sort((a, b) => a.title.localeCompare(b.title));
    return { lost, gifts, meals } satisfies Record<Kind, Entry[]>;
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const matching = (k: Kind) => lists[k].filter((e) => searchMatches(q, ...e.search));
  const counts = { lost: 0, gifts: 0, meals: 0 } as Record<Kind, number>;
  for (const [k] of LABELS) counts[k] = matching(k).length;
  const rows = matching(kind);
  const current = rows.find((e) => e.id === picked) ?? rows[0] ?? null;
  const elsewhere = q.trim() ? LABELS.filter(([k]) => k !== kind && counts[k] > 0) : [];
  const toolbar = (
    <div className="toolbar">
      <Segmented
        label="What to look up"
        value={kind}
        onChange={(k) => {
          setKind(k);
          setPicked(null);
        }}
        options={LABELS.map(([id, label]) => [id, <span className="filter-label"><Icon name={KIND_ICON[id]} />{label}<span className="seg-count">{counts[id]}</span></span>] as const)}
      />
      <SearchBox placeholder={kind === "meals" ? "Search meals, ingredients or names" : "Search items or names"} value={q} onChange={setQ} />
    </div>
  );

  if (kind === "lost") {
    return <div className="sup-lost-view">
      {toolbar}
      {rows.length === 0 ? <NoMatches what="lost items" onReset={q ? () => setQ("") : undefined} /> :
        <ul className="sup-lost-grid">{rows.map((entry) => <li key={entry.id} className="sup-lost-card">
          <h3>{itemIconUrl(entry.title) ? <RefIcon src={itemIconUrl(entry.title)} /> : <Icon name={CONCEPT_ICON.lostItem} />} {entry.title}</h3>
          <Faces names={entry.groups.flatMap((group) => group.names)} people={people} part2={part2} size={40} />
        </li>)}</ul>}
    </div>;
  }

  return (
    <MasterDetail wide detail={<ItemCard entry={current} people={people} part2={part2} />}>
      {toolbar}
      {kind === "meals" && lists.meals.length === 0 ? (
        <EmptyState title="Import meals">Import your game files in Settings to add the dining hall's meals.</EmptyState>
      ) : rows.length === 0 && (
        <NoMatches what={LABELS.find(([k]) => k === kind)![1].toLowerCase()} onReset={q ? () => setQ("") : undefined} />
      )}
      {rows.length === 0 && elsewhere.length > 0 && (
        <p className="sup-elsewhere">
          Found in{" "}
          {elsewhere.map(([k, label], i) => (
            <span key={k}>
              {i > 0 && ", "}
              <button type="button" className="btn small" onClick={() => setKind(k)}>
                {label} {counts[k]}
              </button>
            </span>
          ))}
        </p>
      )}
      <div className="table-wrap sup-scroll">
        <ul className="sup-items">
          {rows.map((e) => {
            const faces = e.groups.flatMap((g) => g.names);
            const on = current?.id === e.id;
            return (
              <li key={e.id} className={`sup-item${on ? " picked" : ""}`}>
                <button type="button" className="sup-item-btn" aria-pressed={on} onClick={() => setPicked(e.id)}>
                  {itemIconUrl(e.title) ? (
                    <RefIcon src={itemIconUrl(e.title)} className="sup-item-icon" />
                  ) : (
                    <Icon name={KIND_ICON[kind]} className="sup-item-icon" title={LABELS.find(([k]) => k === kind)![1]} />
                  )}
                  <span className="sup-item-text">
                    <span className="sup-item-name">{e.title}</span>
                  </span>
                  {(kind !== "meals" || e.groups.length > 0) && <span className="sup-item-faces">
                    {faces.slice(0, 6).map((n) => (
                      <KeyPortrait key={n} portraitKey={keyFor(people, n)} name={n} part2={part2} size={28} />
                    ))}
                    {faces.length > 6 && <span className="sup-more">+{faces.length - 6}</span>}
                    {faces.length === 0 && <span className="muted small">Nobody</span>}
                  </span>}
                  <Icon name={CONCEPT_ICON.open} className="sup-caret" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </MasterDetail>
  );
}

const keyFor = (people: Person[], name: string) => people.find((p) => p.label === name)?.key ?? name.toLowerCase();
const charKeyFor = (people: Person[], name: string) => people.find((p) => p.label === name)?.charKey ?? null;

function Faces({
  names,
  people,
  part2,
  size = 48,
}: {
  names: string[];
  people: Person[];
  part2: boolean;
  size?: number;
}) {
  if (!names.length) return <span className="muted">Nobody</span>;
  return (
    <span className="sup-faces">
      {names.map((n) => (
        <span key={n} className="sup-face-tile">
          <KeyPortrait portraitKey={keyFor(people, n)} name={n} part2={part2} size={size} />
          <CharLink charKey={charKeyFor(people, n)}>{n}</CharLink>
        </span>
      ))}
    </span>
  );
}

function ItemCard({
  entry,
  people,
  part2,
}: {
  entry: Entry | null;
  people: Person[];
  part2: boolean;
}) {
  if (!entry)
    return (
      <DetailCard title="Nothing picked" label="Nothing picked">
        <EmptyState title="Nothing to show">Search or select an entry.</EmptyState>
      </DetailCard>
    );
  return (
    <DetailCard title={entry.title} label={entry.title}>
      {entry.needsImport && <p className="muted">Reimport your game files in Settings to add recipes and meal preferences.</p>}
      <div className="sup-preference-groups">
        {entry.ingredients && <section className="sup-preference-group">
          <h3><Icon name={CONCEPT_ICON.meals} /> Recipe</h3>
          <ul>{entry.ingredients.map((item) => <li key={item.id}>{item.name} × {item.quantity}</li>)}</ul>
        </section>}
        {entry.groups.map((g) => (
          <div key={g.label} className={`sup-preference-group${g.tone ? ` ${g.tone}` : ""}`}>
            <h3>
              <Icon name={g.tone === "bad" ? CONCEPT_ICON.disliked : CONCEPT_ICON.liked} /> {g.label} <span>{g.names.length}</span>
            </h3>
            <Faces names={g.names} people={people} part2={part2} size={64} />
          </div>
        ))}
      </div>
    </DetailCard>
  );
}
