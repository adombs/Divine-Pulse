/**
 * The Archive: the game's reference in one place. Characters, Crests and Battalions (who and what you field), then
 * Classes and gear. Everything here is general: the same in every run; the run's own units are on the Roster.
 */
import { useMemo, useState } from "react";
import type { Unit } from "../../api";
import { useNav } from "../../nav";
import { useSpoiler } from "../../spoilers";
import { searchMatches } from "../../fuzzy";
import { useReference } from "../../reference/types";
import type { ReferenceData } from "../../reference/types";
import { characterKeyOfUnit, characterPortraitKey } from "../../portraits";
import { DetailCard, MasterDetail, PageHeader } from "../layout";
import { Loading, NoMatches, RefLink, SearchBox } from "../common";
import { KeyPortrait } from "../ui";
import { CONCEPT_ICON } from "../../icons/concepts";
import { Icon } from "../Icon";
import { CharacterTable, CrestTable } from "./CharactersPage";
import { ClassesView, classesTabCounts } from "./ClassesPage";
import type { ClassesTab } from "./ClassesPage";
import { BattalionPanel } from "../character/Battalion";
import { GameImage } from "../GameImage";
import { ScopeTag } from "../character/CharacterHero";
import "./archive.css";

type Tab = "characters" | "crests" | "battalions" | ClassesTab;
const TABS: Tab[] = ["characters", "crests", "battalions", "classes", "arts", "abilities", "magic", "weapons", "items"];
const LABEL: Record<Tab, string> = {
  characters: "Characters", crests: "Crests", battalions: "Battalions", classes: "Classes", arts: "Combat Arts",
  abilities: "Abilities", magic: "Magic", weapons: "Weapons", items: "Items",
};

interface Props {
  units: Unit[];
  part2: boolean;
}

export function ArchivePage({ units, part2 }: Props) {
  const data = useReference();
  const nav = useNav();
  const [showStoryClasses] = useSpoiler("storyClasses");
  const tab: Tab = TABS.includes(nav.route.tab as Tab) ? (nav.route.tab as Tab) : "characters";
  const counts: Record<Tab, number | undefined> = {
    characters: data?.characters.length,
    crests: data?.crests.length,
    battalions: data ? data.battalions?.length ?? 0 : undefined,
    ...classesTabCounts(data, showStoryClasses),
  };
  const listTab = tab === "characters" || tab === "crests" || tab === "battalions";
  return (
    <div className={`ref-page archive-page${listTab ? " list-page" : " classes-page"} archive-${tab}`}>
      <PageHeader
        title="Archive"
        tabs={TABS.map((id) => ({ id, label: LABEL[id], count: counts[id] }))}
        tab={tab}
        onTab={(t) => nav.go({ page: "archive", tab: t })}
      />
      {!data ? (
        <Loading />
      ) : tab === "characters" ? (
        <CharacterTable data={data} units={units} part2={part2} />
      ) : tab === "crests" ? (
        <CrestTable data={data} units={units} part2={part2} />
      ) : tab === "battalions" ? (
        <BattalionTable data={data} units={units} part2={part2} />
      ) : (
        <ClassesView tab={tab} data={data} units={units} part2={part2} />
      )}
    </div>
  );
}

/** Every battalion in the import, and who in this run has it (as last read). */
function BattalionTable({ data, units, part2 }: { data: ReferenceData } & Props) {
  const nav = useNav();
  const [filter, setFilter] = useState(nav.route.q ?? "");
  const list = data.battalions ?? [];
  const holders = useMemo(() => {
    const map = new Map<string, Unit[]>();
    for (const u of units) {
      if (!u.battalion) continue;
      const key = u.battalion.toLowerCase();
      map.set(key, [...(map.get(key) ?? []), u]);
    }
    return map;
  }, [units]);
  const holdersOf = (name: string) => holders.get(name.toLowerCase()) ?? [];
  const rows = list.filter((b) => searchMatches(filter, b.name, b.description, b.gambit?.name ?? "", ...holdersOf(b.name).map((u) => u.name)));
  if (!list.length) {
    return (
      <div className="archive-empty">
        <Icon name={CONCEPT_ICON.battalion} />
        <p>Battalions come from your imported game files, and this import has none. Import your game again on the Game files page in Settings.</p>
      </div>
    );
  }
  const current = rows.find((b) => b.name === nav.route.id) ?? rows[0];
  const select = (name: string) => nav.go({ page: "archive", tab: "battalions", id: name });
  const toolbar = (
    <div className="toolbar">
      <SearchBox placeholder="Search battalions" value={filter} onChange={setFilter} />
      <span className="muted small">{rows.length} battalions</span>
    </div>
  );
  if (!current) return <>{toolbar}<NoMatches what="battalions" onReset={() => setFilter("")} /></>;
  const held = holdersOf(current.name);
  return (
    <MasterDetail
      wide
      detail={
        <DetailCard
          title={current.name}
          icon={current.icon ? <GameImage imported={current.icon} className="bp-icon sm" alt="" /> : undefined}
          label={`${current.name} battalion reference`}
        >
          <div className="archive-battalion-meta">
            <ScopeTag scope="reference" />
          </div>
          <BattalionPanel name={current.name} scope="reference" />
          <h4 className="sub-title">In this run</h4>
          {held.length ? (
            <div className="people unit-grid">
              {held.map((u) => (
                <RefLink key={u.key} onClick={() => nav.go({ page: "roster", id: u.key })} title={`Open ${u.name} on the Roster`}>
                  <span className="person">
                    <KeyPortrait portraitKey={characterPortraitKey(characterKeyOfUnit(u) ?? u.key, units)} name={u.name} part2={part2} size={56} />
                    <span className="person-name">{u.name}</span>
                  </span>
                </RefLink>
              ))}
            </div>
          ) : (
            <p className="muted">No unit in this run has been read with it.</p>
          )}
        </DetailCard>
      }
    >
      {toolbar}
      <div className="table-wrap">
        <table className="units ref-table battalion-table">
          <thead>
            <tr>
              <th className="left">Battalion</th>
              <th title="Endurance, from your imported game files">End</th>
              <th className="left">Gambit</th>
              <th className="left">In this run</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const who = holdersOf(b.name);
              return (
                <tr
                  key={b.id ?? b.name}
                  className={current.name === b.name ? "selected" : ""}
                  onClick={() => select(b.name)}
                  tabIndex={0}
                  aria-selected={current.name === b.name}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(b.name))}
                >
                  <td className="left name-cell">
                    <div className="who">
                      {b.icon ? <GameImage imported={b.icon} className="bp-icon sm" alt="" /> : null}
                      <span className="who-name">{b.name}</span>
                    </div>
                  </td>
                  <td className="num">{b.endurance || "—"}</td>
                  <td className="left small">{b.gambit?.name ?? <span className="muted" title="Not in your imported game files yet">—</span>}</td>
                  <td className="left small">{who.length ? who.map((u) => u.name).join(", ") : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </MasterDetail>
  );
}
