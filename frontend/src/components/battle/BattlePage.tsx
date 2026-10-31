/**
 * The Battle page (docs/ui-design.md): the live battle, or a selected recording (#/battle/<id>), in the same views
 * (`BattleView`), marked as a recording. The run's battles and their stats are on the History page.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import { useEffect, useMemo, useState } from "react";
import { api, Battle, Unit } from "../../api";
import { PageHeader, StatusChip, Tab } from "../layout";
import { useNav } from "../../nav";
import { houseOfCharacter } from "../AffiliationIcon";
import { Icon } from "../Icon";
import { characterKeyOfName, characterKeyOfUnit, faceUrl, portraitUrl } from "../../portraits";
import { useReference } from "../../reference/types";
import { armyId, enemies, enemyId, people, timeline } from "./model";
import type { MapLook } from "./mapIcons";
import { MoreStatsTab } from "./MoreStatsTab";
import { OverviewTab } from "./OverviewTab";
import { BattleNav, BattleNavContext, CopySummary, useElapsed } from "./parts";
import { battleName, KIND_LABEL } from "./scenarios";
import { UnitsTab } from "./UnitsTab";
import { UnitPopup } from "./UnitPopup";
import { isObject } from "./map";
import { factionOf } from "./factions";
import { useSpoiler } from "../../spoilers";
import { expressionPaths, HURT_EXPRESSION, personFor, usePortraitData } from "../../persons";

type View = "overview" | "units" | "more";

interface Props {
  battle: Battle | null;
  /** A selected finished battle. It stays selected while the user visits other pages. */
  recording: Battle | null;
  runId: string | null;
  /** Bumped whenever battles change (one started, ended or was deleted), to reload the history. */
  version: number;
  units: Unit[];
  part2: boolean;
  /** How units are drawn on the map (Settings > Appearance). */
  mapLook: MapLook;
  replaySpeed: number;
  onReplaySpeed: (speed: number) => void;
  onDeleteRecording: () => void;
  at?: string | null;
}

export function BattlePage({ battle, recording, runId, version, units, part2, mapLook, replaySpeed, onReplaySpeed, onDeleteRecording, at }: Props) {
  // The run's battles, for More stats' comparison.
  const [history, setHistory] = useState<Battle[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!runId) {
      setHistory([]);
      return () => { cancelled = true; };
    }
    api.battles(runId).then(
      (battles) => { if (!cancelled) setHistory(battles); },
      () => { if (!cancelled) setHistory([]); },
    );
    return () => { cancelled = true; };
  }, [runId, version]);

  const shown = battle ?? recording;
  if (!shown) {
    return (
      <section className="battle-page">
        <PageHeader title="Battle" />
        <p className="muted">Loading battle…</p>
      </section>
    );
  }
  return <><BattleView key={shown.id} battle={shown} live={battle} history={history} roster={units} part2={part2} mapLook={mapLook} replaySpeed={replaySpeed} onReplaySpeed={onReplaySpeed} at={at} recording={battle ? undefined : { onDelete: onDeleteRecording }} /></>;
}

interface ViewProps {
  battle: Battle;
  /** The battle in progress, if any (a recording offers to jump to it). */
  live: Battle | null;
  history: Battle[];
  roster: Unit[];
  part2: boolean;
  mapLook: MapLook;
  replaySpeed: number;
  onReplaySpeed: (speed: number) => void;
  /** A unit to open the battle at ("Units" with it selected). */
  at?: string | null;
  /** Set when this is a selected past battle: delete it. */
  recording?: { onDelete: () => void };
}

/** One battle's views, live or a selected recording. Key it by the battle's id. */
export function BattleView(p: ViewProps) {
  const { at = null, recording } = p;
  const portraitData = usePortraitData();
  const battle = useMemo(() => ({ ...p.battle, enemy_stats: Object.fromEntries(Object.entries(p.battle.enemy_stats ?? {}).map(([slot, enemy]) => {
    const personId = (enemy as typeof enemy & { person_id?: number | null }).person_id;
    const person = personFor(portraitData, personId);
    return [slot, person?.name && person.face && !isObject(enemy) ? { ...enemy, name: person.name, label: person.name } : enemy];
  })) }), [p.battle, portraitData]);
  const [showIdentities] = useSpoiler("identities");
  const [showLaterPortraits] = useSpoiler("portraits");
  const go = useNav().go;
  const [view, setView] = useState<View>(at ? "units" : "overview");
  // The unit open in the character popup ("a:<key>" / "e:<slot>"), from anywhere on the page, and the one whose card
  // is beside the Units table (units opened there show in that card).
  const [unit, setUnit] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(at ? armyId(at) : null);
  const open = view === "units" ? setPicked : setUnit;
  // Opened again at another unit (a link from History's stats).
  useEffect(() => {
    if (!at) return;
    setPicked(armyId(at));
    setView("units");
  }, [at]);

  const seconds = useElapsed(battle.started_at, battle.active, battle.seconds, battle.away_s ?? 0);
  const items = useMemo(() => timeline(battle), [battle]);
  const who = useMemo(() => people(battle), [battle]);
  const portraits = useMemo(() => {
    // Everyone, from the game's own IDs as of this reading: so a unit that turns up for the first time, changes class
    // or name (Tomas to Solon) or falls has the right face. Your roster's own pick (Byleth's) comes first.
    const out = new Map<string, string | null>();
    for (const u of battle.units) {
      const mine = p.roster.find((r) => r.key === u.key);
      out.set(armyId(u.key), (mine && portraitUrl(mine, p.part2)) || faceUrl({ character: u.character, classId: u.class_id, female: u.female, name: u.name, seed: u.key }, p.part2));
    }
    for (const [slot, e] of Object.entries(battle.enemy_stats ?? {})) {
      out.set(enemyId(slot), faceUrl({ character: e.character, classId: e.class_id, female: e.female, name: e.name || e.label, seed: slot }, p.part2));
    }
    return out;
  }, [p.roster, p.part2, battle.units, battle.enemy_stats, showIdentities, showLaterPortraits]);
  const importedFaces = useMemo(() => {
    const out = new Map<string, string>();
    for (const u of battle.units) {
      if (u.hp != null && u.now.hp > 0 && u.hp / u.now.hp < 0.25) {
        const face = expressionPaths(portraitData, u.character, p.part2 && showLaterPortraits)[HURT_EXPRESSION];
        if (face) out.set(armyId(u.key), face);
      }
    }
    for (const [slot, e] of Object.entries(battle.enemy_stats ?? {})) {
      const id = (e as typeof e & { person_id?: number | null }).person_id;
      const face = isObject(e) ? null : personFor(portraitData, id)?.face;
      if (face) out.set(enemyId(slot), face);
    }
    return out;
  }, [battle.units, battle.enemy_stats, portraitData, p.part2, showLaterPortraits]);
  const ref = useReference();
  const houses = useMemo(() => {
    const out = new Map<string, string>();
    const set = (id: string, key: string | null) => {
      const house = houseOfCharacter(ref, key);
      if (house) out.set(id, house);
    };
    for (const r of p.roster) set(armyId(r.key), characterKeyOfUnit(r));
    // Named characters not in the roster (Jeralt fighting beside you) have their house too.
    for (const u of battle.units) {
      const id = armyId(u.key);
      if (!out.has(id)) set(id, characterKeyOfName(u.name));
      out.set(id, factionOf(u.character, battle.scenario, "player", out.get(id)));
    }
    for (const [slot, e] of Object.entries(battle.enemy_stats ?? {})) {
      const id = enemyId(slot);
      const masked = /death knight|flame emperor/i.test(e.name || e.label);
      if (masked && !showIdentities) {
        out.set(id, /flame emperor/i.test(e.name || e.label) ? "Flame Emperor Army" : "Affiliation hidden");
        continue;
      }
      if (e.name) set(id, characterKeyOfName(e.name));
      out.set(id, factionOf(e.character, battle.scenario, e.side ?? "enemy", out.get(id)));
    }
    return out;
  }, [p.roster, ref, battle.units, battle.enemy_stats, battle.scenario, showIdentities]);
  const configs = useMemo(() => new Map(p.roster.map((u) => [u.key, u.ebst_effective])), [p.roster]);
  const nav: BattleNav = {
    people: who,
    portrait: (id) => portraits.get(id) ?? null,
    importedFace: (id) => importedFaces.get(id) ?? null,
    mapLook: p.mapLook,
    replaySpeed: p.replaySpeed,
    setReplaySpeed: p.onReplaySpeed,
    ebstConfig: (key) => configs.get(key) ?? null,
    house: (id) => houses.get(id),
    open,
  };

  const tabs: Tab<View>[] = [
    { id: "overview", label: "Overview" },
    { id: "units", label: "Units", count: battle.units.length + enemies(battle).filter((e) => !isObject(e)).length },
    { id: "more", label: "More Stats" },
  ];
  const ended = !battle.active;
  const name = battleName(battle);

  return (
    <BattleNavContext.Provider value={nav}>
      <section className="battle-page fit">
        <PageHeader
          title={name.title}
          status={
            <span className="battle-meta">
              {!recording && !ended && <StatusChip tone="live">Live</StatusChip>}
              {name.kind && <StatusChip>{KIND_LABEL[name.kind]}</StatusChip>}
              {name.place && <span className="battle-place">{name.place}</span>}
              {recording && <span className="battle-date">{new Date(battle.started_at).toLocaleString()}</span>}
            </span>
          }
          actions={
            <>
              {recording && p.live && (
                <button type="button" className="btn small primary" onClick={() => go({ page: "battle" })}>
                  Live Battle
                </button>
              )}
              <CopySummary battle={battle} seconds={seconds} />
              {recording && (
                <button type="button" className="btn small danger" onClick={recording.onDelete} title="Delete this battle from the history">
                  <Icon name={CONCEPT_ICON.delete} /> Delete
                </button>
              )}
            </>
          }
          tabs={tabs}
          tab={view}
          onTab={setView}
        />
        <div key={view} className={`battle-body view-${view} view-enter`}>
          {view === "overview" && <OverviewTab battle={battle} items={items} seconds={seconds} />}
          {view === "units" && <UnitsTab battle={battle} items={items} selected={picked} onSelect={setPicked} roster={p.roster} part2={p.part2} />}
          {view === "more" && <MoreStatsTab battle={battle} items={items} seconds={seconds} history={p.history} />}
        </div>
        <UnitPopup battle={battle} items={items} id={unit} onClose={() => setUnit(null)} roster={p.roster} part2={p.part2} />
      </section>
    </BattleNavContext.Provider>
  );
}
