import { CONCEPT_ICON } from "../../icons/concepts";
import { gameLanguageLocale } from "../../gameLanguage";
import { Fragment, useMemo, useState } from "react";
import { Icon } from "../Icon";
import { useSpoiler } from "../../spoilers";
import type { Unit } from "../../api";
import { characterPortraitKey, runCharacterKeys, unitForCharacter } from "../../portraits";
import { crestLabel, crestName, isMysteryCrest } from "../../reference/crests";
import { canonical, searchMatches } from "../../fuzzy";
import {
  Character,
  GameClass,
  ReferenceData,
  SKILL_LABEL,
  SkillKey,
  STAT_KEYS,
  STAT_LABEL,
  StatKey,
  TIERS,
  useReference,
} from "../../reference/types";
import { KeyPortrait } from "../ui";
import { AffiliationIcon } from "../AffiliationIcon";
import { SkillIcon } from "../SkillIcon";
import { SkillChips } from "./SkillChips";
import { DetailCard, MasterDetail, PageHeader, Section } from "../layout";
import { useNav } from "../../nav";
import { AFFILIATIONS, passes, usePeopleFilters } from "../../filters";
import { PeopleFilterChips, PeopleFilterFields, usePeopleFilterCount } from "../PeopleFilters";
import { AbilityLink, ArtLink, BattalionLink, ClassLink, CrestLink, ItemLink, SupportsLink, SpellLink, LinkedDescription } from "../Links";
import { itemSummary, spellSummary } from "../../reference/gameData";
import { GearIcon } from "../battle/gameIcons";
import { AbilityIcon, ArtIcon, CrestMark, ItemIcon, SpellIcon } from "../../reference/icons";
import "./classes.css";
import "./characters.css";
import {
  FilterChip,
  FilterMenu,
  RefLink,
  Loading,
  NoMatches,
  SearchBox,
  Segmented,
  Spoiler,
  useSort,
} from "../common";
const compareValues = (a: number | string, b: number | string) => typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), gameLanguageLocale());

type View = "growths" | "bases" | "maxes";
type Tab = "characters" | "crests";
type SortKey = "name" | "house" | StatKey | "total";

const VIEW_LABEL: Record<View, string> = { growths: "Growth Rates", bases: "Base Stats", maxes: "Max Stats" };

interface Props {
  units: Unit[];
  part2: boolean;
}

export function CharactersPage(props: Props) {
  return <CharactersContent {...props} />;
}

function CharactersContent({ units, part2 }: Props) {
  const data = useReference();
  const nav = useNav();
  const tab: Tab = nav.route.tab === "crests" ? "crests" : "characters";
  const setTab = (t: Tab) => nav.go({ page: "characters", tab: t });
  return (
    <div className="ref-page list-page">
      <PageHeader
        title="Characters"
        tabs={[
          { id: "characters", label: "Characters", count: data?.characters.length },
          { id: "crests", label: "Crests", count: data?.crests.length },
        ]}
        tab={tab}
        onTab={setTab}
      />
      {!data ? (
        <Loading />
      ) : tab === "characters" ? (
        <CharacterTable data={data} units={units} part2={part2} />
      ) : (
        <CrestTable data={data} units={units} part2={part2} />
      )}
    </div>
  );
}

function CharacterTable({ data, units, part2 }: { data: ReferenceData } & Props) {
  const nav = useNav();
  const [people] = usePeopleFilters();
  const [showIdentities] = useSpoiler("identities");
  const [peopleCount, clearPeople] = usePeopleFilterCount(["affiliation", "run"]);
  const [view, setView] = useState<View>("growths");
  const [filter, setFilter] = useState("");
  const [withClass, setWithClass] = useState("");
  const selected = nav.route.id ?? null;
  const select = (key: string) => nav.go({ page: "characters", tab: "characters", id: key });
  const { sort, header } = useSort<SortKey>({ key: "house", dir: 1 }, ["name", "house"]);

  const cls = view === "growths" ? data.classes.find((c) => c.name === withClass) : undefined;
  const inRun = useMemo(() => runCharacterKeys(units), [units]);
  const value = (c: Character, k: StatKey) => c[view][k] + (cls ? cls.growths[k] : 0);
  const total = (c: Character) => STAT_KEYS.reduce((n, k) => n + value(c, k), 0);

  const rows = useMemo(() => {
    const list = data.characters.filter(
      (c) =>
        passes({ ...people, routes: [] }, { key: c.key, house: c.house, inRun: inRun.has(c.key) }) &&
        searchMatches(filter, c.name, c.full_name, c.house, c.start_class === "Death Knight" && !showIdentities ? "" : c.start_class, ...c.crests.map((x) => x.name), ...c.personal.map((p) => p.name)),
    );
    const houseIdx = (c: Character) => AFFILIATIONS.indexOf(c.house as (typeof AFFILIATIONS)[number]);
    const val = (c: Character): number | string =>
      sort.key === "name" ? c.name : sort.key === "house" ? houseIdx(c) : sort.key === "total" ? total(c) : value(c, sort.key);
    const order = new Map(data.characters.map((c, i) => [c.key, i]));
    return list.sort((a, b) => compareValues(val(a), val(b)) * sort.dir || order.get(a.key)! - order.get(b.key)!);
  }, [data, people, inRun, filter, sort, view, withClass, showIdentities]);

  // The id comes from the URL (the character whose card shows): accept a misspelt or differently cased name too. With
  // none picked, the first row's card shows.
  const current =
    data.characters.find((c) => c.key === selected) ??
    (selected ? data.characters.find((c) => c.name === canonical(selected, data.characters.map((x) => x.name))) : undefined) ??
    rows[0] ??
    null;

  return (
    <MasterDetail
      wide
      detail={
        current && <CharacterCard c={current} data={data} unit={unitForCharacter(current.key, units)} part2={part2} withClass={cls} />
      }
    >
      <div className="toolbar">
        <SearchBox placeholder="Search name, crest, ability" value={filter} onChange={setFilter} />
        <FilterMenu
          count={peopleCount + Number(!!withClass)}
          onClear={() => {
            clearPeople();
            setWithClass("");
          }}
          chips={
            <>
              {cls && <FilterChip onClear={() => setWithClass("")}>Growths as a {cls.name}</FilterChip>}
              <PeopleFilterChips fields={["affiliation", "run"]} />
            </>
          }
        >
          <PeopleFilterFields fields={["affiliation", "run"]} />
          <label className="field" title="Growth rates in a class are the character's own plus the class's">
            <span>Growths in a class</span>
            <select value={withClass} onChange={(e) => setWithClass(e.target.value)}>
              <option value="">Own growths only</option>
              {TIERS.map((t) => (
                <optgroup key={t} label={t}>
                  {data.classes
                    .filter((c) => c.tier === t)
                    .map((c) => (
                      <option key={c.name} value={c.name}>
                        + {c.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        </FilterMenu>
        <span className="toolbar-end">
          <Segmented label="Values" value={view} onChange={setView} options={(Object.keys(VIEW_LABEL) as View[]).map((v) => [v, VIEW_LABEL[v]] as const)} />
        </span>
      </div>
      <div className="table-wrap">
        <table className="units ref-table">
          <thead>
            <tr>
              {header("name", "Name", { className: "left" })}
              {header("house", <Icon name={CONCEPT_ICON.affiliation} />, { className: "left house-col", title: "Sort by house" })}
              {STAT_KEYS.map((k) => header(k, STAT_LABEL[k], { stat: k }))}
              {header("total", "Total", { className: "bst-col", title: `Sum of the nine ${VIEW_LABEL[view].toLowerCase()}` })}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr
                key={c.key}
                className={current?.key === c.key ? "selected" : ""}
                onClick={() => select(c.key)}
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(c.key))}
              >
                <td className="left name-cell">
                  <div className="who">
                    <KeyPortrait portraitKey={characterPortraitKey(c.key, units)} name={c.name} part2={part2} size={34} />
                    <div className="who-text">
                      <span className="who-name">
                        {c.name}
                        {inRun.has(c.key) && (
                          <span className="in-run" title="In your active run">
                            <Icon name={CONCEPT_ICON.inRun} weight="fill" />
                          </span>
                        )}
                      </span>
                      <span className="who-class">{c.start_class === "Death Knight" && !showIdentities ? "Class hidden" : c.start_class}</span>
                    </div>
                  </div>
                </td>
                <td className="left house-cell">
                  <AffiliationIcon house={c.house} />
                </td>
                {STAT_KEYS.map((k) => (
                  <td key={k} className="num" title={cls ? `${c.growths[k]} + ${cls.growths[k]} (${cls.name})` : undefined}>
                    {value(c, k)}
                  </td>
                ))}
                <td className="num bst-col">{total(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <NoMatches
            what="characters"
            onReset={() => {
              setFilter("");
              clearPeople();
            }}
          />
        )}
      </div>
    </MasterDetail>
  );
}

function CharacterCard({
  c,
  data,
  unit,
  part2,
  withClass,
}: {
  c: Character;
  data: ReferenceData;
  unit?: Unit;
  part2: boolean;
  withClass?: GameClass;
}) {
  // Byleth starts as the tracked Byleth's portrait (see the Portrait setting on their roster card).
  const [bylethGender, setBylethGender] = useState<"m" | "f">(unit && characterPortraitKey("byleth", [unit]) === "byleth_f" ? "f" : "m");
  const isByleth = c.key === "byleth";
  const classNames = new Set(data.classes.map((x) => x.name));
  const classLink = (name: string) => (name && classNames.has(name) ? <ClassLink name={name} /> : name || "—");
  const art = (name: string) => data.combat_arts.find((a) => a.name === name);
  const learnedAbilities = c.abilities.filter((a) => !/^Battalion /.test(a.name));
  const battalionAbilities = c.abilities.filter((a) => /^Battalion /.test(a.name));
  const crestText = (list: { name: string; major: boolean }[]) =>
    list.length ? list.map((x) => crestLabel(x.name, x.major)).join(", ") : "None";
  const crestList = (list: { name: string; major: boolean }[]) =>
    list.length ? list.map((x) => <span key={`${x.name}-${x.major}`}><CrestMark name={x.name} major={x.major} /> <CrestLink name={x.name} /> {!isMysteryCrest(x.name) && <span className="muted">({x.major ? "Major" : "Minor"})</span>}</span>) : <span className="muted">None</span>;
  // A learned ability or art's skill (its icon) and rank.
  const rankMark = (a: { skill?: SkillKey | ""; rank: string }) => (
    <>
      {a.skill && <SkillIcon skill={a.skill} />} {a.rank}
    </>
  );
  const carried = (unit?.inventory ?? []).filter((it) => it.kind !== "spell");
  const hiddenCrests = c.crests_spoiler && crestText(c.crests_spoiler) !== crestText(c.crests) ? crestText(c.crests_spoiler) : null;

  return (
    <DetailCard title={c.name} icon={<AffiliationIcon house={c.house} />} label={`${c.name} reference`}>
      <div className="profile">
        <span className="profile-portrait">
          <KeyPortrait portraitKey={isByleth ? `byleth_${bylethGender}` : c.key} name={c.name} part2={part2} size={96} />
        </span>
        <dl className="profile-rows">
          <dt>Name</dt>
          <dd className="wide" title={c.full_name}>
            {c.full_name}
          </dd>
          <dt>House</dt>
          <dd className="house-mark">
            <AffiliationIcon house={c.house} />
          </dd>
          <dt className="second">Gender</dt>
          <dd>
            {isByleth ? (
              <span className="gender-toggle" role="group" aria-label="Byleth's gender">
                {(["m", "f"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={bylethGender === g ? "on" : ""}
                    aria-pressed={bylethGender === g}
                    title={g === "m" ? "Male" : "Female"}
                    onClick={() => setBylethGender(g)}
                  >
                    <Icon name={g === "m" ? CONCEPT_ICON.male : CONCEPT_ICON.female} />
                  </button>
                ))}
              </span>
            ) : (
              c.gender
            )}
          </dd>
          <dt>Class</dt>
          <dd>{c.start_class === "Death Knight" ? <Spoiler category="identities">{classLink(c.start_class)}</Spoiler> : classLink(c.start_class)}</dd>
          <dt className="second">Crest</dt>
          <dd className="crest-marks" title={crestText(c.crests)}>
            {crestList(c.crests)}
          </dd>
          <dt>Birthday</dt>
          <dd>{c.birthday || "—"}</dd>
          <dt className="second">Age</dt>
          <dd>{c.age || "—"}</dd>
        </dl>
      <dl className="profile-rows more">
        {hiddenCrests && (
          <>
            <dt title="Crest revealed later in the story">Later</dt>
            <dd className="crest-marks wide">
              <Spoiler>{crestList(c.crests_spoiler!)}</Spoiler>
            </dd>
          </>
        )}
          <dt>Height</dt>
          <dd className="wide">{c.height || "—"}</dd>
      </dl>
      </div>

      <Section title="Stats" icon={CONCEPT_ICON.growth}>
        <SkillChips character={c} />
        <div className="stats-split character-stats">
        <table className="ref-stats">
          <thead>
            <tr>
              <th />
              <th title="Stats when the character joins">Base</th>
              <th title="Chance (%) to gain a point each level">Growth</th>
              {withClass && <th title={`Growth as a ${withClass.name}`}>+{withClass.name.split(" ")[0]}</th>}
              <th title="Highest the stat can go">Max</th>
              {unit && <th title={`${unit.name} in your active run (bonuses from abilities removed)`}>Yours</th>}
            </tr>
          </thead>
          <tbody>
            {STAT_KEYS.map((k) => (
              <tr key={k}>
                <th>{STAT_LABEL[k]}</th>
                <td>{c.bases[k]}</td>
                <td>
                  <span className="growth">
                    <span className="stat-bar" aria-hidden>
                      <span style={{ width: `${Math.min(100, c.growths[k])}%` }} />
                    </span>
                    <span>{c.growths[k]}%</span>
                  </span>
                </td>
                {withClass && <td>{c.growths[k] + withClass.growths[k]}%</td>}
                <td>{c.maxes[k]}</td>
                {unit && <td className={unit.base_values[k] >= c.maxes[k] ? "capped" : ""}>{unit.base_values[k] || "—"}</td>}
              </tr>
            ))}
            <tr className="total">
              <th>Total</th>
              <td>{STAT_KEYS.reduce((n, k) => n + c.bases[k], 0)}</td>
              <td>{STAT_KEYS.reduce((n, k) => n + c.growths[k], 0)}%</td>
              {withClass && <td>{STAT_KEYS.reduce((n, k) => n + c.growths[k] + withClass.growths[k], 0)}%</td>}
              <td>{STAT_KEYS.reduce((n, k) => n + c.maxes[k], 0)}</td>
              {unit && <td />}
            </tr>
          </tbody>
        </table>
        </div>
      </Section>

      {unit && (
        <>
          <Section title="Equipment" icon={CONCEPT_ICON.equipment}>
            {carried.length > 0 || unit.accessory ? (
              <ul className="item-list">
                {carried.map((it, i) => (
                  <li key={`${it.id}-${i}`} title={itemSummary(data.items.find((item) => item.name === it.name))}>
                    <span>
                      <GearIcon kind={it.kind === "other" ? "item" : it.kind} weapon={it.weapon} name={it.name} /> <ItemLink name={it.name} />
                    </span>
                    <span className="rank">{it.full ? `${it.uses}/${it.full}` : `×${it.uses}`}</span>
                  </li>
                ))}
                {unit.accessory && (
                  <li title={itemSummary(data.items.find((item) => item.name === unit.accessory))}>
                    <span>
                      <ItemIcon name={unit.accessory} />
                      <ItemLink name={unit.accessory} />
                    </span>
                  </li>
                )}
              </ul>
            ) : (
              <p className="muted">No equipment</p>
            )}
          </Section>

        </>
      )}

      <Section title="Abilities" icon={CONCEPT_ICON.ability}>
        {unit && (unit.personal_ability || unit.abilities.length > 0) && (
          <>
            <h4 className="sub-title">Equipped in your run</h4>
            <ul className="item-list">
              {[unit.personal_ability, ...unit.abilities].filter(Boolean).map((name, i) => (
                <li key={`${name}-${i}`} title={data.abilities.find((a) => a.name === name)?.description} className={i === 0 && unit.personal_ability ? "personal" : ""}>
                  <span>
                    <AbilityIcon name={name} />
                    <AbilityLink name={name} />
                  </span>
                </li>
              ))}
            </ul>
            <h4 className="sub-title">Personal and learned</h4>
          </>
        )}
        <ul className="item-list">
          {c.personal.map((p) => (
            <li key={p.name} className="personal" title="Personal ability">
              <span>
                <AbilityIcon name={p.name} />
                <b>
                  <AbilityLink name={p.name} />
                </b>
                <span className="desc"><LinkedDescription text={p.description} /></span>
              </span>
            </li>
          ))}
          {c.budding && !art(c.budding.unlock) && (
            <li className="personal" title={`Budding talent: unlocked by training ${SKILL_LABEL[c.budding.skill]}`}>
              <span>
                <SkillIcon skill={c.budding.skill} aptitude="budding" title={`Budding talent in ${SKILL_LABEL[c.budding.skill]}`} /> →{" "}
                <b><AbilityLink name={c.budding.unlock} /></b>
                <span className="desc"><LinkedDescription text={c.budding.description} /></span>
              </span>
            </li>
          )}
        </ul>
        {learnedAbilities.length > 0 && (
          <>
            <h4 className="sub-title">Skill abilities</h4>
            <ul className="item-list learned" title="Learned from skill ranks, on top of what every unit learns">
              {learnedAbilities.map((a) => (
                <li key={`a-${a.name}-${a.rank}`} title={data.abilities.find((x) => x.name === a.name)?.description}>
                  <span>
                    <AbilityIcon name={a.name} />
                    <AbilityLink name={a.name} />
                  </span>
                  <span className="rank">{rankMark(a)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {battalionAbilities.length > 0 && (
          <>
            <h4 className="sub-title">Battalion abilities</h4>
            <ul className="item-list learned" title="Available while the battalion has endurance">
              {battalionAbilities.map((a) => (
                <li key={`b-${a.name}-${a.rank}`} title={data.abilities.find((x) => x.name === a.name)?.description}>
                  <span>
                    <AbilityIcon name={a.name} />
                    <AbilityLink name={a.name} />
                  </span>
                  <span className="rank">{rankMark(a)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="Combat Arts" icon={CONCEPT_ICON.art}>
        {c.budding && art(c.budding.unlock) && (
          <ul className="item-list">
            <li className="personal" title={`Budding talent in ${SKILL_LABEL[c.budding.skill]}`}>
              <span><ArtIcon name={c.budding.unlock} /><ArtLink name={c.budding.unlock} />
                <span className="desc"><LinkedDescription text={c.budding.description} /></span>
              </span>
            </li>
          </ul>
        )}
        {unit && <>
          <h4 className="sub-title">Equipped in your run</h4>
            {unit.combat_arts?.length ? (
              <ul className="item-list">
                {unit.combat_arts.map((name) => (
                  <li key={name} title={art(name) ? artSummary(art(name)!) : undefined}>
                    <span>
                      <ArtIcon name={name} />
                      <ArtLink name={name} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No combat arts</p>
            )}
        </>}
        <h4 className="sub-title">Learned from skill ranks</h4>
        {c.arts.length > 0 ? (
          <>
            <ul className="item-list learned" title="Learned from skill ranks">
              {c.arts.map((a) => {
                const info = art(a.name);
                return (
                  <li key={`c-${a.name}-${a.rank}-${a.skill}`} title={info ? artSummary(info) : undefined}>
                    <span>
                      <ArtIcon name={a.name} />
                      <ArtLink name={a.name} />
                    </span>
                    <span className="rank">{rankMark(a)}</span>
                  </li>
                );
              })}
            </ul>
          </>
        ) : <p className="muted">No learned combat arts</p>}
      </Section>

      <Section title="Spells" icon={CONCEPT_ICON.spell}>
        {(c.spells.reason.length > 0 || c.spells.faith.length > 0) && (
          <div className="spell-cols">
            {(["reason", "faith"] as const).map((school) => (
              <div key={school}>
                <h4 className="sub-title">
                  <SkillIcon skill={school} title={school === "reason" ? "Reason spells" : "Faith spells"} />
                </h4>
                <ul className="item-list">
                  {c.spells[school].map((s) => (
                    <li key={s.name} title={spellSummary(data.magic.find((m) => m.name === s.name))}>
                      <span>
                        <SpellIcon name={s.name} />
                        <SpellLink name={s.name} />
                      </span>
                      <span className="rank">{s.rank}</span>
                    </li>
                  ))}
                  {c.spells[school].length === 0 && <li className="muted">None</li>}
                </ul>
              </div>
            ))}
          </div>
        )}
        {c.spells.reason.length === 0 && c.spells.faith.length === 0 && <p className="muted">No spells</p>}
      </Section>

      {unit && (
        <>
          <Section title="Battalion" icon={CONCEPT_ICON.battalion}>
            {unit.battalion ? <><p><BattalionLink name={unit.battalion} /></p>{data.battalions?.filter((b) => b.name === unit.battalion).map((b) => <p className="desc" key={b.name}><LinkedDescription text={b.description} /> · Endurance {b.endurance}</p>)}</> : <p className="muted">No battalion</p>}
          </Section>
          <Section title="Crest" icon={CONCEPT_ICON.crest}>
            {c.crests.length ? <div className="crest-marks">{crestList(c.crests)}</div> : <p className="muted">No crest</p>}
          </Section>
        </>
      )}

      <p className="card-link">
        <SupportsLink name={c.name}>Supports &amp; gifts <Icon name={CONCEPT_ICON.go} /></SupportsLink>
      </p>
    </DetailCard>
  );
}

export function artSummary(a: { might: string; hit: string; crit: string; range: string; cost: string; description: string }): string {
  const parts = [
    a.might && `Mt ${a.might}`,
    a.hit && `Hit ${a.hit}`,
    a.crit && `Crit ${a.crit}`,
    a.range && `Rng ${a.range}`,
    a.cost && `Cost ${a.cost}`,
  ].filter(Boolean);
  return parts.join(" · ") + (a.description ? `\n${a.description}` : "");
}

function CrestTable({ data, units, part2 }: { data: ReferenceData } & Props) {
  const nav = useNav();
  const [people] = usePeopleFilters();
  const [filter, setFilter] = useState("");
  const [peopleCount, clearPeople] = usePeopleFilterCount(["affiliation", "run"]);
  const runKeys = useMemo(() => runCharacterKeys(units), [units]);
  const filtered = data.crests.filter((crest) => {
    const bearers = [...crest.bearers.major, ...crest.bearers.minor].map((name) => data.characters.find((ch) => ch.name === name)).filter((ch): ch is Character => !!ch);
    const matching = bearers.filter((ch) => passes({ ...people, routes: [] }, { key: ch.key, house: ch.house, inRun: runKeys.has(ch.key) }));
    return (!people.affiliations.length && !people.runOnly || matching.length > 0) && searchMatches(filter, crest.name, crest.effect, ...matching.map((ch) => ch.name));
  });
  const selected = nav.route.id ?? filtered[0]?.name;
  const current = filtered.find((c) => c.name === selected) ?? filtered[0];
  const select = (name: string) => nav.go({ page: "characters", tab: "crests", id: name });
  if (!current) return <><div className="toolbar"><SearchBox placeholder="Search crest or bearer" value={filter} onChange={setFilter} /><FilterMenu count={peopleCount} onClear={clearPeople} chips={<PeopleFilterChips fields={["affiliation", "run"]} />}><PeopleFilterFields fields={["affiliation", "run"]} /></FilterMenu></div><NoMatches what="crests" onReset={() => { setFilter(""); clearPeople(); }} /></>;
  const bearerGroup = (title: string, names: string[]) => {
    const people = names.map((n) => data.characters.find((c) => c.name === n)).filter((c): c is Character => !!c);
    if (!people.length) return null;
    return (
      <>
        <h4 className="sub-title">{title}</h4>
        <div className="people unit-grid">
          {people.map((ch) => {
            const person = (
              <RefLink onClick={() => nav.go({ page: "characters", tab: "characters", id: ch.key })} title={`Open ${ch.name} on the Characters page`}>
                <span className="person">
                  <KeyPortrait portraitKey={characterPortraitKey(ch.key, units)} name={ch.name} part2={part2} size={72} />
                  <span className="person-name">{ch.name}</span>
                </span>
              </RefLink>
            );
            // Some bearer lists include identities that the character's visible crest list still calls Mystery.
            const publicCrest = ch.crests.some((crest) => crest.name === current.name && crest.major === (title === "Major bearers"));
            return publicCrest ? <Fragment key={ch.key}>{person}</Fragment> : <Spoiler key={ch.key} category="crests">{person}</Spoiler>;
          })}
        </div>
      </>
    );
  };
  const hasBearers = current.bearers.major.length + current.bearers.minor.length > 0;
  return (
    <MasterDetail
      wide
      detail={
        <DetailCard title={crestName(current.name)} icon={<CrestMark name={current.name} />} label={`${crestName(current.name)} crest reference`}>
          <div className="crest-head">
            <div>
              <p><LinkedDescription text={current.effect} /></p>
            </div>
          </div>
          {bearerGroup("Major bearers", current.bearers.major)}
          {bearerGroup("Minor bearers", current.bearers.minor)}
          {!hasBearers && <p className="muted">No playable bearer is known.</p>}
        </DetailCard>
      }
    >
      <div className="toolbar"><SearchBox placeholder="Search crest, effect or bearer" value={filter} onChange={setFilter} /><FilterMenu count={peopleCount} onClear={clearPeople} chips={<PeopleFilterChips fields={["affiliation", "run"]} />}><PeopleFilterFields fields={["affiliation", "run"]} /></FilterMenu><span className="muted small">{filtered.length} crests</span></div>
      <div className="table-wrap crest-table-wrap">
        <table className="units ref-table crest-table">
          <thead>
            <tr>
              <th className="left">Crest</th>
              <th className="left">Effect</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((crest) => (
              <tr
                key={crest.name}
                className={current.name === crest.name ? "selected" : ""}
                onClick={() => select(crest.name)}
                tabIndex={0}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(crest.name))}
              >
                <td className="left name-cell">
                  <div className="who">
                    <CrestMark name={crest.name} />
                    <span className="who-name">{crestName(crest.name)}</span>
                  </div>
                </td>
                <td className="left wrap small"><LinkedDescription text={crest.effect} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MasterDetail>
  );
}
