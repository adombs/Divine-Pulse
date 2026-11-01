import { CONCEPT_ICON } from "../icons/concepts";
import { FormEvent, useEffect, useState } from "react";
import { numberError } from "../validation";
import { About, api, LABELS, Settings } from "../api";
import { DEFAULT_CONFIG, EBST_TYPES, EbstConfig, OTHER_KEYS } from "../ebst";
import { SPOILER_CATEGORIES, SpoilerCategory, setAllSpoilers, useSpoilers } from "../spoilers";
import { ToastState } from "./Toasts";
import { SectionHead, Segmented, Switch } from "./ui";
import { AppearanceState, FONTS, TEXT_SCALE, loadFont } from "../appearance";
import { useNav } from "../nav";
import { PageHeader, StatusChip } from "./layout";
import { IconButton } from "./Icon";
import { MemoryCheck } from "./MemoryCheck";
import { ReplaySpeedSlider } from "./battle/replay";
import { FACE_LOOKS, UNIT_LOOKS } from "./battle/mapIcons";
import { StepSlider } from "./Slider";
import { GameFilesSection } from "./game-files/GameFilesSection";
import { useReference } from "../reference/types";
import { Sources } from "./common";
import "./settings-game-files.css";

const TEXT_STOPS = Math.round((TEXT_SCALE.max - TEXT_SCALE.min) / TEXT_SCALE.step) + 1;

type SettingsTab = "game-files" | "general" | "battles" | "ebst" | "spoilers" | "appearance" | "testing" | "about";
const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "game-files", label: "Game files" },
  { id: "battles", label: "Battles" },
  { id: "ebst", label: "eBST" },
  { id: "spoilers", label: "Spoilers" },
  { id: "appearance", label: "Appearance" },
  { id: "testing", label: "Testing" },
  { id: "about", label: "About" },
];

/** What "Restore recommended" sets (the defaults). */
const RECOMMENDED = {
  interval: "1",
  battleInterval: "0.1",
  battleFilter: true,
  battlePage: true,
  battleAlerts: true,
  estimateFights: true,
  recordBattles: true,
  pairingCheck: false,
  hideHistory: false,
};

function AppearanceSection({ state }: { state: AppearanceState }) {
  const { appearance, update } = state;
  const { preferences, setSpoiler } = useSpoilers();
  // Load every font so the previews below render in their own typeface.
  useEffect(() => FONTS.forEach(loadFont), []);
  // The text size waits for Apply: resizing everything while the slider is dragged makes the page jump.
  const [textScale, setTextScale] = useState(appearance.textScale);
  useEffect(() => setTextScale(appearance.textScale), [appearance.textScale]);
  return (
    <>
      <p className="hint">Changes are remembered in this browser.</p>
      <div className="field-row">
        <span className="field-label">Theme</span>
        <Segmented
          label="Theme"
          value={appearance.theme}
          onChange={(theme) => update({ theme })}
          options={[
            ["light", "Light"],
            ["dark", "Dark"],
          ]}
        />
      </div>
      <div className="field-row stacked">
        <span className="field-label">Portraits</span>
        <Segmented
          label="Portraits"
          value={appearance.portraits}
          onChange={(portraits) => {
            if (portraits === "part2") setSpoiler("portraits", true);
            update({ portraits });
          }}
          options={[
            ["auto", "Auto"],
            ["part1", "Part I"],
            ["part2", "Part II"],
          ]}
        />
        <span className="hint">
          Auto follows the active playthrough once post-timeskip portraits are enabled in Spoilers.
          {!preferences.portraits && <> Later portraits are hidden. <button type="button" className="spoiler-btn" onClick={() => setSpoiler("portraits", true)}>Show spoiler</button></>}
        </span>
      </div>
      <div className="field-row">
        <span className="field-label">Map: Main Units</span>
        <Segmented label="Main units on the battle map" value={appearance.mapNamed} onChange={(mapNamed) => update({ mapNamed })} options={UNIT_LOOKS} />
      </div>
      <div className="field-row">
        <span className="field-label">Map: Generic Units</span>
        <Segmented
          label="Generic units on the battle map"
          value={appearance.mapGeneric}
          onChange={(mapGeneric) => update({ mapGeneric })}
          options={UNIT_LOOKS}
        />
      </div>
      <div className="field-row">
        <span className="field-label">Battle: Unit Faces</span>
        <Segmented
          label="Faces in the battle view's Units section"
          value={appearance.unitFaces}
          onChange={(unitFaces) => update({ unitFaces })}
          options={FACE_LOOKS}
        />
      </div>
      <div className="field-row">
        <span className="field-label">Map: Replay Speed</span>
        <ReplaySpeedSlider value={appearance.replaySpeed} onChange={(replaySpeed) => update({ replaySpeed })} />
      </div>
      <div className="field-row">
        <span className="field-label">Text Size</span>
        <StepSlider
          label="Text size"
          bare
          stops={TEXT_STOPS}
          value={Math.round((textScale - TEXT_SCALE.min) / TEXT_SCALE.step)}
          onChange={(i) => setTextScale(Math.round((TEXT_SCALE.min + i * TEXT_SCALE.step) * 100) / 100)}
          valueText={`${Math.round(textScale * 100)}%`}
          variant="timeline"
          slim
          after={
            <>
              <span className="text-size-value">{Math.round(textScale * 100)}%</span>
              <button type="button" className="btn small" disabled={textScale === appearance.textScale} onClick={() => update({ textScale })}>
                Apply
              </button>
              {appearance.textScale !== 1 && (
                <button type="button" className="link-btn" onClick={() => update({ textScale: 1 })}>
                  Reset
                </button>
              )}
            </>
          }
        />
      </div>
      <div className="field-row stacked">
        <span className="field-label">Font</span>
        <div className="font-grid" role="radiogroup" aria-label="Font">
          {FONTS.map((f) => (
            <button
              type="button"
              role="radio"
              aria-checked={appearance.font === f.id}
              key={f.id}
              className={`font-option item ${appearance.font === f.id ? "selected" : ""}`}
              onClick={() => update({ font: f.id })}
            >
              <span className="font-name" style={{ fontFamily: f.heading }}>
                {f.label}
              </span>
              <span className="font-sample" style={{ fontFamily: f.text }}>
                Lysithea von Ordelia
              </span>
              <span className="font-nums" style={{ fontFamily: f.nums }}>
                Str 17 · Mag 23 · eBST 19.5
              </span>
              <span className="font-desc">{f.description}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function SpoilerSection() {
  const { preferences, setSpoiler } = useSpoilers();
  return (
    <>
      <div className="spoiler-settings-head"><SectionHead right={<div className="settings-actions"><button type="button" className="btn" onClick={() => setAllSpoilers(true)}>Show all</button><button type="button" className="btn" onClick={() => setAllSpoilers(false)}>Hide all</button></div>}>Spoilers</SectionHead></div>
      <div className="spoiler-settings">
      {(Object.keys(SPOILER_CATEGORIES) as SpoilerCategory[]).map((category) => (
        <div className="spoiler-setting" key={category}>
          <Switch checked={preferences[category]} onChange={(shown) => setSpoiler(category, shown)} label={SPOILER_CATEGORIES[category].label} />
          <span className="hint" aria-live="polite"><strong className={`spoiler-state${preferences[category] ? " shown" : ""}`}>{preferences[category] ? "Shown" : "Hidden"}:</strong> {SPOILER_CATEGORIES[category].hint}</span>
        </div>
      ))}
      </div>
    </>
  );
}

function EbstSection({ runId, toasts }: { runId: string | null; toasts: ToastState }) {
  const [config, setConfig] = useState<EbstConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!runId) return;
    let live = true;
    setLoading(true);
    api.runEbst(runId).then(
      (value) => { if (live) { setConfig(value); setError(""); setLoading(false); } },
      (err: Error) => { if (live) { setError(err.message); setLoading(false); } },
    );
    return () => { live = false; };
  }, [runId]);
  if (!runId) return <p className="hint">Create a playthrough to set eBST for its units.</p>;
  if (loading) return <p className="muted">Loading eBST settings…</p>;
  if (error) return <p className="field-hint error">{error}</p>;
  const apply = async () => {
    setSaving(true);
    try {
      setConfig(await api.setRunEbst(runId, config));
      toasts.push({ kind: "ok", title: "eBST applied to all units" });
    } catch (err) {
      toasts.push({ kind: "error", title: "Couldn't apply eBST", body: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <SectionHead>eBST for this playthrough</SectionHead>
      <p className="hint">Apply replaces every unit's eBST setup, including custom setups, and sets the default for units added later. You can still change individual units in the Roster afterwards.</p>
      {(["offense", "defense"] as const).map((field) => (
        <div className="field-row" key={field}>
          <span className="field-label">{field === "offense" ? "Offense type" : "Defense type"}</span>
          <Segmented
            label={`eBST ${field} type`}
            value={config[field]}
            onChange={(value) => setConfig((old) => ({ ...old, [field]: value }))}
            options={EBST_TYPES.map(({ id, label, hint }) => [id, label, hint] as const)}
          />
        </div>
      ))}
      {OTHER_KEYS.map((key) => (
        <div className="field-row" key={key}>
          <span className="field-label">{LABELS[key]}</span>
          <Switch
            checked={config.stats.includes(key)}
            label={`Include ${LABELS[key]} in eBST`}
            onChange={(on) => setConfig((old) => ({ ...old, stats: OTHER_KEYS.filter((k) => k === key ? on : old.stats.includes(k)) }))}
          />
        </div>
      ))}
      <button type="button" className="btn" disabled={saving} onClick={apply}>{saving ? "Applying…" : "Apply to all units"}</button>
    </>
  );
}

interface SettingsProps {
  toasts: ToastState;
  onSaved: (s: Settings) => void;
  appearance: AppearanceState;
}

export function SettingsPage({ toasts, onSaved, appearance }: SettingsProps) {
  const nav = useNav();
  const tab = TABS.find((t) => t.id === nav.route.tab)?.id ?? "general";
  const setTab = (t: SettingsTab) => nav.go({ page: "settings", tab: t });
  const [settings, setSettings] = useState<Settings | null>(null);
  const [interval, setIntervalS] = useState("1");
  const [battleAuto, setBattleAuto] = useState(true);
  const [battlePage, setBattlePage] = useState(true);
  const [recordBattles, setRecordBattles] = useState(true);
  const [battleAlerts, setBattleAlerts] = useState(true);
  const [battleInterval, setBattleInterval] = useState(RECOMMENDED.battleInterval);
  const [estimateFights, setEstimateFights] = useState(true);
  const [pairingCheck, setPairingCheck] = useState(false);
  const [hideHistory, setHideHistory] = useState(false);
  const [windowMode, setWindowMode] = useState<Settings["window_mode"]>("windowed");
  // The window mode only applies to the desktop window, not the browser.
  const [desktop, setDesktop] = useState(false);

  const apply = (s: Settings) => {
    setSettings(s);
    setIntervalS(String(s.auto_interval_s));
    setBattleAuto(s.battle_filter_auto);
    setBattlePage(s.battle_page_auto);
    setRecordBattles(s.record_battles);
    setBattleAlerts(s.battle_alerts);
    setBattleInterval(String(s.battle_interval_s));
    setEstimateFights(s.battle_estimate_fights);
    setPairingCheck(s.pairing_check);
    setHideHistory(s.hide_history);
    setWindowMode(s.window_mode);
  };

  const restoreRecommended = () => {
    setIntervalS(RECOMMENDED.interval);
    setBattleInterval(RECOMMENDED.battleInterval);
    setBattleAuto(RECOMMENDED.battleFilter);
    setBattlePage(RECOMMENDED.battlePage);
    setBattleAlerts(RECOMMENDED.battleAlerts);
    setEstimateFights(RECOMMENDED.estimateFights);
    setRecordBattles(RECOMMENDED.recordBattles);
    setPairingCheck(RECOMMENDED.pairingCheck);
    setHideHistory(RECOMMENDED.hideHistory);
  };

  useEffect(() => {
    api.settings().then(apply);
    api.about().then((a) => setDesktop(a.desktop), () => setDesktop(false));
  }, []);

  const intervalError = numberError(interval, "The interval", [0.1, 60], " seconds");
  const battleIntervalError = numberError(battleInterval, "The battle interval", [0.1, 60], " seconds");
  // Which tabs hold unsaved changes or a field to fix, so the Save bar can point to them.
  const problems: Partial<Record<SettingsTab, boolean>> = {
    general: !!intervalError,
    battles: !!battleIntervalError,
  };
  const invalid = Object.values(problems).some(Boolean);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    try {
      const s = await api.saveSettings({
        auto_interval_s: Number(interval),
        battle_filter_auto: battleAuto,
        battle_page_auto: battlePage,
        record_battles: recordBattles,
        battle_alerts: battleAlerts,
        battle_interval_s: Number(battleInterval),
        battle_estimate_fights: estimateFights,
        pairing_check: pairingCheck,
        hide_history: hideHistory,
        window_mode: windowMode,
      });
      apply(s);
      onSaved(s);
      toasts.push({ kind: "ok", title: "Settings saved" });
    } catch (err) {
      toasts.push({ kind: "error", title: "Couldn't save settings", body: (err as Error).message });
    }
  };

  if (!settings) return <p className="muted">Loading…</p>;

  const changed: Partial<Record<SettingsTab, boolean>> = {
    general: Number(interval) !== settings.auto_interval_s || windowMode !== settings.window_mode,
    battles:
      Number(battleInterval) !== settings.battle_interval_s ||
      battlePage !== settings.battle_page_auto ||
      battleAuto !== settings.battle_filter_auto ||
      battleAlerts !== settings.battle_alerts ||
      estimateFights !== settings.battle_estimate_fights,
    testing: recordBattles !== settings.record_battles || pairingCheck !== settings.pairing_check || hideHistory !== settings.hide_history,
  };
  const dirty = Object.values(changed).some(Boolean);

  const tabNames = (which: Partial<Record<SettingsTab, boolean>>) =>
    TABS.filter((t) => which[t.id]).map((t, i, all) => (
      <span key={t.id}>
        {i > 0 && (i === all.length - 1 ? " and " : ", ")}
        <button type="button" className="link-btn" onClick={() => setTab(t.id)}>
          {t.label}
        </button>
      </span>
    ));
  return (
    <section className="settings-page">
      <PageHeader
        title="Settings"
        status={
          <>
            {dirty && <StatusChip tone="warn">Unsaved changes</StatusChip>}
          </>
        }
        actions={
          <IconButton icon={CONCEPT_ICON.turn} label="Restore recommended values (save to keep them)" onClick={restoreRecommended} />
        }
        tabs={TABS.map((t) => ({ ...t, label: `${t.label}${changed[t.id] ? " •" : ""}` }))}
        tab={tab}
        onTab={setTab}
      />
      <form className="settings" onSubmit={save}>
        {tab === "game-files" && <GameFilesSection desktop={desktop} />}
        {tab === "general" && (
          <>
            <SectionHead>Game</SectionHead>
            <p className="hint">Requires FE3H 1.2.0 in Eden with fastmem enabled. Other yuzu-based emulators may work but have not been tested.</p>
            <div className="field-row">
              <span className="field-label">Connection</span>
              <MemoryCheck />
            </div>
            <label className="field-row stacked">
              <span className="field-label">Read interval</span>
              <span className="with-unit">
                <input
                  type="number"
                  min={0.1}
                  max={60}
                  step={0.1}
                  value={interval}
                  onChange={(e) => setIntervalS(e.target.value)}
                  className={intervalError ? "invalid" : ""}
                  aria-invalid={!!intervalError}
                />
                seconds
              </span>
              {intervalError && <span className="field-hint error">{intervalError}</span>}
              <span className="hint">Recommended: 1 second. Changes are stored after two matching reads.</span>
            </label>
            {desktop && (
              <>
                <SectionHead>Window</SectionHead>
                <div className="field-row">
                  <span className="field-label">Mode</span>
                  <Segmented
                    label="Window mode"
                    value={windowMode}
                    onChange={setWindowMode}
                    options={[
                      ["windowed", "Windowed"],
                      ["fullscreen", "Borderless Fullscreen"],
                    ]}
                  />
                </div>
              </>
            )}
          </>
        )}
        {tab === "battles" && (
          <>
            <label className="field-row stacked">
              <span className="field-label">Battle read interval</span>
              <span className="with-unit">
                <input
                  type="number"
                  min={0.1}
                  max={60}
                  step={0.1}
                  value={battleInterval}
                  onChange={(e) => setBattleInterval(e.target.value)}
                  className={battleIntervalError ? "invalid" : ""}
                  aria-invalid={!!battleIntervalError}
                />
                seconds
              </span>
              {battleIntervalError && <span className="field-hint error">{battleIntervalError}</span>}
              <span className="hint">
                Recommended: 0.1 seconds, or 0.5 to ease emulator load. Changes appear after about {battleLatency(Number(battleInterval))}; faster reads can improve fight estimates.
              </span>
            </label>
            <div className="field-row">
              <span className="field-label">Battle Page</span>
              <Switch
                checked={battlePage}
                onChange={setBattlePage}
                label={battlePage ? "Show the Battle page instead of the Roster during a battle" : "Stay on the Roster during a battle"}
              />
            </div>
            <div className="field-row">
              <span className="field-label">Roster Filter</span>
              <Switch
                checked={battleAuto}
                onChange={setBattleAuto}
                label={battleAuto ? "Show only the units in a battle when it starts" : "Don't filter the Roster in battles"}
              />
            </div>
            <div className="field-row">
              <span className="field-label">Battle Alerts</span>
              <Switch
                checked={battleAlerts}
                onChange={setBattleAlerts}
                label={battleAlerts ? "Notify when a unit leaves the battle or a Divine Pulse is used" : "No battle notifications"}
              />
            </div>
            <div className="field-row stacked">
              <span className="field-label">Fight Estimates</span>
              <Switch
                checked={estimateFights}
                onChange={setEstimateFights}
                label={estimateFights ? "Work out fights when the game's battle history can't be read" : "Leave damage untracked when the history can't be read"}
              />
              <span className="hint">
                When the game's battle history cannot be read, estimates use HP changes and combat math. The tracker returns to exact history when available.
              </span>
            </div>
          </>
        )}
        {tab === "spoilers" && <SpoilerSection />}
        {tab === "ebst" && <EbstSection key={settings.active_run_id} runId={settings.active_run_id} toasts={toasts} />}
        {tab === "appearance" && <AppearanceSection state={appearance} />}
        {tab === "testing" && (
          <>
            <p className="hint">Leave the last two options off for normal play.</p>
            <div className="field-row stacked">
              <span className="field-label">Record Battles</span>
              <Switch
                checked={recordBattles}
                onChange={setRecordBattles}
                label={recordBattles ? "Save raw battle memory for research (last 5 battles)" : "Don't record battles"}
              />
              <span className="hint">
                Keeps raw memory for the last 5 battles in battle-recordings. Each can use up to 200 MB; older recordings are deleted.
              </span>
            </div>
            <div className="field-row stacked">
              <span className="field-label">Check Fight Estimates</span>
              <Switch
                checked={pairingCheck}
                onChange={setPairingCheck}
                label={pairingCheck ? "Compare the estimates with the game's history" : "Off"}
              />
              <span className="hint">
                Writes a comparison with the game's history to pairing-checks after each battle. The Battle page is unchanged.
              </span>
            </div>
            <div className="field-row stacked">
              <span className="field-label">Ignore the History</span>
              <Switch
                checked={hideHistory}
                onChange={setHideHistory}
                label={hideHistory ? "The Battle page shows estimates only" : "Off"}
              />
              <span className={hideHistory ? "hint form-error" : "hint"}>
                The log and damage become estimates while this is on. Turn it off to restore exact history on the next read.
              </span>
            </div>
          </>
        )}
        {tab === "about" && <AboutSection toasts={toasts} />}

        {dirty && (
          <div className="dialog-foot sticky-save">
              <span className={invalid ? "field-hint error" : "muted"}>
                {invalid ? <>Fix the fields marked in red on {tabNames(problems)} to save</> : <>Unsaved changes on {tabNames(changed)}</>}
              </span>
            <button className="btn primary" type="submit" disabled={invalid}>
              Save Settings
            </button>
          </div>
        )}
      </form>
    </section>
  );
}

/** How long a change takes to reach the Battle page at this read interval: one to two reads. */
function battleLatency(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const fmt = (n: number) => (n < 10 ? n.toFixed(n < 1 ? 2 : 1).replace(/\.?0+$/, "") : String(Math.round(n)));
  return `${fmt(seconds)}–${fmt(seconds * 2)} seconds`;
}

/** Version and the data folder, so it's easy to back up, move to another PC, or find the log. */
export function AboutSection({ toasts }: { toasts: ToastState }) {
  const reference = useReference();
  const [about, setAbout] = useState<About | null>(null);
  useEffect(() => {
    api.about().then(setAbout, () => setAbout(null));
  }, []);
  if (!about) return null;
  const open = async () => {
    try {
      await api.openDataFolder();
    } catch (e) {
      toasts.push({ kind: "error", title: "Couldn't open the folder", body: (e as Error).message });
    }
  };
  return (
    <>
      <div className="field-row">
        <span className="field-label">Version</span>
        <span>
          {about.version} · Windows
        </span>
      </div>
      <div className="field-row stacked">
        <span className="field-label">Data Folder</span>
        <span className="with-unit">
          <code className="path">{about.data_dir}</code>
          <button type="button" className="btn small" onClick={open}>
            Open
          </button>
        </span>
        <span className="hint">
          Runs, battles, settings and the log (tracker.log). To move to another PC, copy this folder to the same place there, or put it
          next to Divine Pulse.exe as a folder named <code>data</code>.
        </span>
      </div>
      <div className="field-row stacked">
        <span className="field-label">Tracking and reference notes</span>
        <div className="credits">
          <p>Battles are recorded while the tracker reads the game. Each one is filed in History when it ends.</p>
          <p>Battle outlook is a rough estimate from what the tracker can read: units at risk of falling (losing Byleth or a house leader loses the battle), current HP, army strength against the other units on the map, progress, losses, Divine Pulses and level-ups.</p>
          <p>When the game's battle history cannot be read, fight estimates use HP changes and combat math. The tracker returns to exact history when available. Untracked values come from the game's Divine Pulse list, which could not be read.</p>
          <p>For eBST, Offense and Defense each count as one value: Auto uses the higher of the pair, Flex the average. Click HP, Mv, Dex, Spd, Lck or Cha to count it too. eBST is everything counted added up and divided by how many went in.</p>
          <p>Return a lost item to its owner for +20 support. Liked gifts give +20, neutral +10, disliked nothing. Anyone not listed is neutral.</p>
          {reference && <Sources sources={reference.sources} />}
        </div>
      </div>
      <div className="field-row stacked">
        <span className="field-label">Credits</span>
        <span className="credits">
          A fan-made tool, not affiliated with or endorsed by Nintendo, Intelligent Systems or Koei Tecmo. <i>Fire Emblem: Three Houses</i> and
          its artwork are © Nintendo / Intelligent Systems / Koei Tecmo.
        </span>
        <ul className="plain-list credits">
          {CREDITS.map(([name, what]) => (
            <li key={name}>
              <b>{name}</b>: {what}
            </li>
          ))}
        </ul>
        <p className="credits">Support availability and class-change notes: text from <i>List of supports in Fire Emblem: Three Houses</i> and <i>Class change</i>, <a href="https://fireemblemwiki.org">Fire Emblem Wiki</a>, by Fire Emblem Wiki contributors; page histories: <a href="https://fireemblemwiki.org/w/index.php?title=List_of_supports_in_Fire_Emblem:_Three_Houses&amp;action=history">List of supports</a>, <a href="https://fireemblemwiki.org/w/index.php?title=Class_change&amp;action=history">Class change</a>; licensed under <a href="https://www.gnu.org/licenses/fdl-1.3.txt">GNU Free Documentation License 1.3</a>; modified by reformatting and abridgment.</p>
        <span className="hint">
          The open-source software bundled with the tracker and its licenses are listed in <i>Third-party notices.txt</i> next to the program.
        </span>
      </div>
    </>
  );
}

/** Where the tracker's game data and mechanics come from (docs/third-party-notices.md has the details). */
const CREDITS: [string, string][] = [
  ["Your game files", "all imported game data"],
  ["Three Houses Research Group", "the game's file formats, and terrain and battle names (bsic map editor, MIT License)"],
  ["fe3h.com, Samurai Gamers, Corridors of Time, FE Universe", "game mechanics: linked attacks, terrain, classes, hit rolls"],
  ["Phosphor Icons", "the app's icons (MIT License)"],
];
