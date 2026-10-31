/**
 * A unit in one battle, in the character popup (opened from the Units tab, the Overview's unit list, the map and the
 * log): its class, level and HP, its fights, growth, inventory, where it went on the map, who it fought and what it did.
 */
import { CONCEPT_ICON } from "../../icons/concepts";
import type { Battle, BattleUnit, EnemyStats, InventoryItem, Unit, Usage } from "../../api";
import { plural } from "../../format";
import { useNav } from "../../nav";
import { AffiliationIcon } from "../AffiliationIcon";
import { CharacterPopup } from "../CharacterPopup";
import { characterKeyOfUnit } from "../../portraits";
import { IconButton } from "../Icon";
import { DetailCard, Facts, Section } from "../layout";
import { Portrait } from "../ui";
import { CombatTiles, FightsAndActions } from "./detail";
import { isObject } from "./map";
import { useSpoiler } from "../../spoilers";
import { crestsOf } from "./factions";
import { crestLabel } from "../../reference/crests";
import { MapSection } from "./Minimap";
import { alertsFor, armyId, enemies, enemyId, Item, LOW_WEAPON, statGains, tally } from "./model";
import { AbilityLink, ArtLink, BattalionLink, ClassLink, CrestLink } from "../Links";
import { GearIcon } from "./gameIcons";
import { Gains, Supplies, UnitFace, useBattleNav } from "./parts";
import { AbilityIcon, CrestMark } from "../../reference/icons";
import { useReference } from "../../reference/types";
import { itemSummary, spellSummary } from "../../reference/gameData";
import { HpBar } from "./HpBar";
import { EquipMark } from "../EquipMark";
import { ItemLink, SpellLink } from "../Links";

interface Props {
  battle: Battle;
  items: Item[];
  /** The unit shown ("a:<key>" / "e:<slot>"); null: closed. */
  id: string | null;
  onClose: () => void;
  roster: Unit[];
  part2: boolean;
}

export function UnitPopup({ battle, items, id, onClose, roster, part2 }: Props) {
  const { unit, enemy } = find(battle, id);
  const icon = id ? <BattleAffiliation id={id} /> : undefined;
  return (
    <CharacterPopup open={!!(unit || enemy)} onClose={onClose} context="battle" title={unit?.name ?? enemy?.label ?? ""} icon={icon}>
      <UnitDetail battle={battle} items={items} id={id} roster={roster} part2={part2} />
    </CharacterPopup>
  );
}

function find(battle: Battle, id: string | null) {
  const unit = id ? battle.units.find((u) => armyId(u.key) === id) : undefined;
  const enemy = id && !unit ? enemies(battle).find((e) => enemyId(e.slot) === id) : undefined;
  return { unit, enemy };
}

/** The card of a unit in the battle ("a:<key>" / "e:<slot>"): the popup's, and the one beside the Units table. */
export function UnitDetail({ battle, items, id, roster, part2 }: Omit<Props, "onClose">) {
  const { unit, enemy } = find(battle, id);
  if (unit) return <UnitCard unit={unit} battle={battle} items={items} roster={roster.find((r) => r.key === unit.key)} part2={part2} />;
  if (enemy) return <EnemyCard enemy={enemy} battle={battle} items={items} />;
  return null;
}

const nameOf = (battle: Battle, key: string) => battle.units.find((u) => u.key === key)?.name ?? key;

/** A unit's class, or what it is when it isn't a unit (a breakable wall, which the game keeps as a Noble). */
export const classOf = (e: EnemyStats) => (isObject(e) ? "Breakable Wall" : e.class_name);

/** One or two words for what a unit is running low on (the full list is the tooltip). */
const lowLabel = (alerts: string[]) =>
  alerts.length > 1 ? "Running low"
    : alerts[0].startsWith("down to") ? "Low HP"
    : alerts[0].startsWith("no spell") ? "No spells"
    : alerts[0].includes("broken") ? "Broken weapon"
    : "Low weapon";

export function enemyStatus(e: EnemyStats): string {
  if (e.on_map) return "Alive";
  if (e.left) return "Left";
  return "Defeated";
}

function UnitCard({ unit: u, battle, items, roster, part2 }: { unit: BattleUnit; battle: Battle; items: Item[]; roster?: Unit; part2: boolean }) {
  const id = armyId(u.key);
  const t = tally(items, id, { fights: u.combats, defeats: u.defeats });
  const alerts = alertsFor(u);
  const growth = battle.events.filter((e) => e.unit === u.key && (e.kind === "level_up" || e.kind === "stat_up"));
  const level = u.level_ups ? `${u.start_level} → ${u.level}` : String(u.level);
  const gained = statGains(u);
  const nav = useNav();
  const faces = useBattleNav().mapLook?.units ?? "portraits";
  const status = !u.on_map ? (
    <span className="form-error" title="Left the battle">Left</span>
  ) : u.adjutant_of ? (
    <span title={`Adjutant to ${nameOf(battle, u.adjutant_of)}`}>Adjutant</span>
  ) : alerts.length ? (
    <span className="warn-text" title={`Running low: ${alerts.join(", ")}`}>{lowLabel(alerts)}</span>
  ) : "Alive";
  const ref = useReference();
  const character = roster ? ref?.characters.find((c) => c.key === characterKeyOfUnit(roster)) : undefined;
  const equipment = (u.inventory ?? []).filter((i) => i.kind !== "spell");
  const spells = (u.inventory ?? []).filter((i) => i.kind === "spell");
  const abilities = roster ? [roster.personal_ability, ...roster.abilities].filter(Boolean) : [];
  return (
    <DetailCard
      title={u.name}
      icon={<BattleAffiliation id={id} />}
      label={`${u.name} in this battle`}
      actions={
        <>
          <IconButton icon={CONCEPT_ICON.history} label="Run Stats" onClick={() => nav.go({ page: "history", tab: "stats", id: u.key })} />
          {roster && <IconButton icon={CONCEPT_ICON.roster} label="Open in the Roster" onClick={() => nav.go({ page: "roster", id: roster.key })} />}
        </>
      }
    >
      <div className="profile battle-unit-profile">
        <span className="profile-portrait">
          {roster && faces === "portraits" ? <Portrait unit={roster} part2={part2} size={88} /> : <UnitFace id={id} name={u.name} size="lg" />}
        </span>
        <Facts
          rows={[
            ["HP", <HpBar key="hp" hp={u.hp} max={u.now.hp} />],
            ["Level", level],
            ["Status", status],
          ]}
        />
        <ClassSprite id={id} name={u.name} className={u.class_name} />
      </div>
      <Section title="Equipment" icon={CONCEPT_ICON.equipment} summary={inventorySummary(equipment)} open>
        {u.inventory ? <Inventory items={equipment} usage={u.usage} kinds={["weapon", "item"]} /> : <Supplies unit={u} />}
      </Section>
      <Section title="Spells" icon={CONCEPT_ICON.spell} summary={spells.length ? plural(spells.length, "spell") : u.inventory ? "No spells" : "Not read yet"}>
        <Inventory items={u.inventory ? spells : undefined} usage={u.usage} kinds={["spell"]} empty="No spells" />
      </Section>
      <Section title="Combat Arts" icon={CONCEPT_ICON.art} summary={u.arts?.length ? plural(u.arts.length, "art") : u.arts ? "No combat arts" : "Not read yet"}>
        {u.arts?.length ? <ArtList arts={u.arts} /> : <p className="muted">{u.arts ? "No combat arts." : "Not read yet."}</p>}
      </Section>
      <Section title="Abilities" icon={CONCEPT_ICON.ability} summary={abilities.length ? plural(abilities.length, "ability") : roster ? "No abilities" : "Not read yet"}>
        {abilities.length ? <IconRow names={abilities} /> : <p className="muted">{roster ? "No abilities." : "Not read yet."}</p>}
      </Section>
      <Section title="Battalion" icon={CONCEPT_ICON.battalion} summary={roster?.battalion || (roster?.battalion === "" ? "No battalion" : "Not read yet")}>
        <p title={ref?.battalions?.find((b) => b.name === roster?.battalion)?.description}>{roster?.battalion ? <BattalionLink name={roster.battalion} /> : roster?.battalion === "" ? "No battalion." : "Not read yet."}</p>
        {ref?.battalions?.find((b) => b.name === roster?.battalion) && <p className="desc">{ref.battalions.find((b) => b.name === roster?.battalion)?.description} · Endurance {ref.battalions.find((b) => b.name === roster?.battalion)?.endurance}</p>}
      </Section>
      <Section title="Growth" icon={CONCEPT_ICON.growth} summary={growthSummary(u.level_ups, gained)}>
        <Gains gains={u.gains} />
        {growth.length > 0 && (
          <ul className="plain-list">
            {growth.map((e, i) => (
              <li key={i}>{e.text}</li>
            ))}
          </ul>
        )}
        {gained > 0 && <p className="muted small">{plural(gained, "stat point")} gained this battle.</p>}
      </Section>
      <MapSection battle={battle} id={id} />
      <FightsAndActions items={items} id={id} totals={<CombatTiles
        fights={t.fights} defeats={t.defeats} dealt={u.damage_dealt} taken={u.damage_taken}
        extra={[["Healing", u.healing_given, u.healed ? `got ${u.healed} back` : "given"], ["Moved", u.tiles_moved, "tiles"]]}
      />} />
      <CrestSection character={u.character} fallback={character?.crests_spoiler ?? character?.crests} />
    </DetailCard>
  );
}

function EnemyCard({ enemy: e, battle, items }: { enemy: EnemyStats; battle: Battle; items: Item[] }) {
  const id = enemyId(e.slot);
  const t = tally(items, id, { fights: e.combats, defeats: e.defeats });
  const hp = e.hp === null ? null : Math.max(0, e.hp);
  return (
    <DetailCard title={e.label} icon={<BattleAffiliation id={id} />} label={`${e.label} in this battle`}>
      <div className="profile battle-unit-profile">
        <span className="profile-portrait">
          <UnitFace id={id} name={e.label} size="lg" />
        </span>
        <Facts
          rows={[
            ["HP", <HpBar key="hp" hp={hp} max={e.max_hp} />],
            ["Level", e.level],
            ["Status", <span className={!e.on_map ? "form-error" : undefined} title={!e.on_map && e.defeated_by ? `Killed by ${e.defeated_by}` : !e.on_map && e.left ? "Left the map" : undefined}>{enemyStatus(e)}</span>],
          ]}
        />
        <ClassSprite id={id} name={e.label} className={classOf(e)} />
      </div>
      {!isObject(e) && <>
        <Section title="Equipment" icon={CONCEPT_ICON.equipment} summary={inventorySummary(e.inventory?.filter((i) => i.kind !== "spell"))} open>
          <Inventory items={e.inventory?.filter((i) => i.kind !== "spell")} usage={e.usage} kinds={["weapon", "item"]} />
        </Section>
        <Section title="Spells" icon={CONCEPT_ICON.spell} summary={e.inventory ? (e.inventory.some((i) => i.kind === "spell") ? plural(e.inventory.filter((i) => i.kind === "spell").length, "spell") : "No spells") : "Not read yet"}>
          <Inventory items={e.inventory?.filter((i) => i.kind === "spell")} usage={e.usage} kinds={["spell"]} empty="No spells" />
        </Section>
        <Section title="Combat Arts" icon={CONCEPT_ICON.art} summary="Not read yet"><p className="muted">Not read yet.</p></Section>
        <Section title="Abilities" icon={CONCEPT_ICON.ability} summary="Not read yet"><p className="muted">Not read yet.</p></Section>
        <Section title="Battalion" icon={CONCEPT_ICON.battalion} summary="Not read yet"><p className="muted">Not read yet.</p></Section>
        <Section title="Growth" icon={CONCEPT_ICON.growth} summary="Not tracked"><p className="muted">Growth is tracked for your units.</p></Section>
      </>}
      <MapSection battle={battle} id={id} />
      <FightsAndActions items={items} id={id} totals={<CombatTiles fights={t.fights} defeats={t.defeats ?? 0} dealt={e.damage_dealt} taken={e.damage_taken} extra={[["Moved", e.tiles_moved, "tiles"]]} />} />
      {!isObject(e) && <CrestSection character={e.character} />}

    </DetailCard>
  );
}

/** A unit's house emblem, as on the Characters and Roster pages (from the reference data). */
function BattleAffiliation({ id }: { id: string }) {
  const nav = useBattleNav();
  const house = nav.house?.(id);
  const side = nav.people.get(id)?.enemy?.side ?? (id.startsWith("a:") ? "player" : "enemy");
  return house ? <AffiliationIcon house={house} side={side} /> : null;
}

function IconRow({ names }: { names: string[] }) {
  const ref = useReference();
  return (
    <ul className="battle-icon-row">
      {names.map((name) => <li key={name} title={ref?.abilities.find((a) => a.name === name)?.description || name}><AbilityIcon name={name} /><span><AbilityLink name={name} /></span></li>)}
    </ul>
  );
}

function Crests({ crests }: { crests: { name: string; major: boolean }[] }) {
  const ref = useReference();
  return (
    <ul className="battle-icon-row">
      {crests.map((crest) => {
        const entry = ref?.crests.find((c) => c.name === crest.name);
        const effect = (crest.major ? entry?.major_description : entry?.minor_description) || entry?.effect;
        const label = crestLabel(crest.name, crest.major);
        return <li key={crest.name} title={effect ? `${label}: ${effect}` : label}><CrestMark name={crest.name} major={crest.major} /><span><CrestLink name={crest.name}>{label}</CrestLink>{effect ? ` — ${effect}` : ""}</span></li>;
      })}
    </ul>
  );
}

/** Equipped combat arts: each its game icon and its name, linked to its reference entry. */
export function ArtList({ arts }: { arts: string[] }) {
  const ref = useReference();
  return (
    <span className="art-list">
      {arts.map((a) => (
        <span key={a} className="art-chip" title={ref?.combat_arts.find((art) => art.name === a)?.description}>
          <GearIcon kind="art" name={a} />
          <ArtLink name={a} />
        </span>
      ))}
    </span>
  );
}

function ClassSprite({ id, name, className }: { id: string; name: string; className: string }) {
  return <span className="class-portrait">
    <span className="class-portrait-label"><ClassLink name={className} /></span>
    <UnitFace id={id} name={name} size="lg" look="sprites" />
  </span>;
}

function CrestSection({ character, fallback }: { character?: number | null; fallback?: { name: string; major: boolean }[] }) {
  const [shown, setShown] = useSpoiler("crests");
  const native = crestsOf(character);
  const crests = native?.filter((c, i, all) => all.findIndex((x) => x.name === c.name) === i) ?? fallback;
  const none = native?.length === 0 || (native === undefined && fallback?.length === 0);
  const summary = none ? "No crest" : shown && crests?.length ? crests.map((c) => crestLabel(c.name, c.major)).join(", ") : "Unknown";
  return (
    <Section title="Crest" icon={CONCEPT_ICON.crest} summary={summary}>
      {none ? <p>No crest.</p> : shown && crests?.length ? <>
        <Crests crests={crests} />
        <button type="button" className="link-btn" onClick={() => setShown(false)}>Hide crest spoilers</button>
      </> : <p className="muted">Unknown. {crests?.length ? <button type="button" className="link-btn" onClick={() => setShown(true)}>Show crest spoilers</button> : null}</p>}
    </Section>
  );
}

const growthSummary = (levels: number, points: number) =>
  [levels ? `Lv +${levels}` : "", points ? plural(points, "stat point") : ""].filter(Boolean).join(" · ") || "None yet";

const inventorySummary = (list?: InventoryItem[]) => (list?.length ? plural(list.length, "item") : list ? "No equipment" : "Not read yet");

/** What a unit carries: each item and spell with its uses left (of its uses when new), worn and empty ones marked. */
function Inventory({ items, usage, kinds = [], empty = "No equipment" }: { items?: InventoryItem[]; usage?: Usage[] | null; kinds?: Usage["kind"][]; empty?: string }) {
  const ref = useReference();
  const kindOf = (it: InventoryItem): Usage["kind"] => it.kind === "spell" || it.kind === "weapon" ? it.kind : "item";
  const count = (it: InventoryItem) => usage?.filter((u) => u.kind === kindOf(it) && u.id === it.id).reduce((n, u) => n + u.times, 0);
  const previous = (usage ?? []).filter((u) => kinds.includes(u.kind) && !items?.some((it) => kindOf(it) === u.kind && it.id === u.id));
  if (!items?.length && !previous.length) return <p className="muted">{items ? `${empty}.` : "Not read yet."}</p>;
  return (
    <ul className="inventory">
      {(items ?? []).map((it, i) => {
        const counted = it.kind !== "equipment";
        const empty = counted && it.uses === 0;
        const low = counted && !empty && it.kind === "weapon" && it.uses <= LOW_WEAPON;
        return (
          <li key={`${it.kind}-${it.id}-${i}`} title={it.kind === "spell" ? spellSummary(ref?.magic.find((s) => s.name === it.name)) : itemSummary(ref?.items.find((item) => item.name === it.name))} className={`inventory-item ${it.kind}${empty ? " empty" : low ? " low" : ""}`}>
            <span className="inventory-icon">
              <GearIcon kind={it.kind} weapon={it.weapon} name={it.name} />
            </span>
            <span className="inventory-name">{it.kind === "spell" ? <SpellLink name={it.name} /> : <ItemLink name={it.name} />} {it.equipped && <span className="equip-mark-wrap" title="Equipped" aria-label="Equipped"><EquipMark /></span>}</span>
            {counted && (
              <span className="inventory-uses" title={it.full ? `${it.uses} of ${it.full} uses left` : `${plural(it.uses, "use")} left`}>
                {it.uses}
                {it.full ? <span className="muted">/{it.full}</span> : null}
              </span>
            )}
            {(count(it) ?? 0) > 0 && <span className="inventory-battle-uses muted-chip" title="Actions using this item this battle">used {count(it)}</span>}
          </li>
        );
      })}
      {previous.map((u) => <li key={`${u.kind}-${u.id}`} className="inventory-item recorded">
        <span className="inventory-icon"><GearIcon kind={u.kind} weapon={u.weapon} name={u.name} /></span>
        <span className="inventory-name">{u.kind === "spell" ? <SpellLink name={u.name} /> : <ItemLink name={u.name} />}<small>Recorded use</small></span>
        <span className="inventory-uses" title="Current uses not known">—</span>
        <span className="inventory-battle-uses muted-chip" title={`${u.spent} uses spent`}>used {u.times}</span>
      </li>)}
    </ul>
  );
}
