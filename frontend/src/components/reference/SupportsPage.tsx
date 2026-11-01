/**
 * The Supports page: who can support whom (By Character and All Pairings), what the monastery activities
 * are worth (Gifts, Meals, and Lost Items). Each view lives in
 * ./supports/; the page itself works out who the support cast is and keeps the views in step.
 */
import { gameLanguageLocale } from "../../gameLanguage";
import { useMemo, useState } from "react";
import type { Unit } from "../../api";
import { characterPortraitKey } from "../../portraits";
import { canonical } from "../../fuzzy";
import { Character, useReference } from "../../reference/types";
import { SupportPair, useSupports } from "../../reference/supports";
import { PageHeader } from "../layout";
import { Loading } from "../common";
import { useNav } from "../../nav";
import { usePeopleFilters } from "../../filters";
import { ByCharacter } from "./supports/ByCharacter";
import { Pairings } from "./supports/Pairings";
import { Gifts } from "./supports/Gifts";
import { Filters, HOUSES, NPC_HOUSE, Person, isByleth, pairOnRoutes } from "./supports/shared";
import "./supports.css";

type Tab = "character" | "matrix" | "gifts";

interface Props {
  units: Unit[];
  part2: boolean;
}

export function SupportsPage(props: Props) {
  return <SupportsContent {...props} />;
}

function SupportsContent({ units, part2 }: Props) {
  const ref = useReference();
  const data = useSupports();
  const nav = useNav();
  const [people] = usePeopleFilters();
  // Keep old links to the retired rules tab useful instead of rendering a blank view.
  const tab: Tab = nav.route.tab === "matrix" || nav.route.tab === "gifts" ? nav.route.tab : "character";
  const setTab = (t: Tab) => nav.go({ page: "supports", tab: t });
  const runByleth = characterPortraitKey("byleth", units);
  const [filters, setFilters] = useState<Filters>({ byleth: runByleth === "byleth_f" ? "F" : "M", endingsOnly: false });
  // "Byleth" (from links) means whichever Byleth is shown.
  // The id comes from the URL or a link: accept a misspelt or differently cased name too.
  const rawSelected =
    (nav.route.id && data && canonical(nav.route.id, [...new Set(data.pairs.flatMap((p) => [p.a, p.b]))])) || nav.route.id || "Byleth";
  const selected = isByleth(rawSelected) ? `Byleth (${filters.byleth})` : rawSelected;
  const setSelected = (name: string) => nav.go({ page: "supports", tab: "character", id: isByleth(name) ? "Byleth" : name });

  const cast = useMemo<Person[]>(() => {
    if (!data || !ref) return [];
    const names = new Set(data.pairs.flatMap((p) => [p.a, p.b]));
    const byName = new Map(ref.characters.map((c) => [c.key, c] as const));
    const out: Person[] = [...names]
      .filter((n) => !isByleth(n) || n === `Byleth (${filters.byleth})`)
      .map((n) => {
        const c: Character | undefined = byName.get(isByleth(n) ? "byleth" : n.toLowerCase());
        return {
          name: n,
          label: c?.name ?? data.names[n] ?? n,
          key: isByleth(n) ? (n.endsWith("(F)") ? "byleth_f" : "byleth_m") : n.toLowerCase(),
          house: c?.house ?? NPC_HOUSE[n] ?? "Other",
          charKey: c?.key ?? null,
        };
      });
    const order = new Map(ref.characters.map((c, i) => [c.name, i]));
    const rank = (p: Person) => order.get(p.label) ?? 999;
    return out.sort(
      (a, b) => HOUSES.indexOf(a.house) - HOUSES.indexOf(b.house) || rank(a) - rank(b) || a.name.localeCompare(b.name, gameLanguageLocale()),
    );
  }, [data, ref, filters.byleth]);

  const pairsFor = (name: string) => (data ? data.pairs.filter((p) => p.a === name || p.b === name) : []);
  const byName = new Map(cast.map((p) => [p.name, p] as const));
  // Only the Byleth being shown counts, so the tab's count matches the list's.
  const pairCount = data?.pairs.filter((p) => byName.has(p.a) && byName.has(p.b)).length;
  const routeOk = (p: SupportPair) => {
    const a = byName.get(p.a);
    const b = byName.get(p.b);
    return !a || !b || pairOnRoutes(p, a, b, people.routes);
  };

  return (
    <div className="ref-page sup-page list-page">
      <PageHeader
        title="Supports"
        tabs={[
          { id: "character", label: "By Character", count: cast.length || undefined },
          { id: "matrix", label: "All Pairings", count: pairCount },
          { id: "gifts", label: "Gifts, Meals, and Lost Items" },
        ]}
        tab={tab}
        onTab={setTab}
      />
      {!data || !ref ? (
        <Loading />
      ) : tab === "character" ? (
        <ByCharacter
          data={data}
          people={cast}
          selected={selected}
          onSelect={setSelected}
          pairsFor={pairsFor}
          routeOk={routeOk}
          filters={filters}
          setFilters={setFilters}
          units={units}
          part2={part2}
        />
      ) : tab === "matrix" ? (
        <Pairings
          data={data}
          people={cast}
          part2={part2}
          units={units}
          routeOk={routeOk}
          filters={filters}
          setFilters={setFilters}
          onOpen={setSelected}
        />
      ) : (
        <Gifts data={data} people={cast} part2={part2} />
      )}
    </div>
  );
}
