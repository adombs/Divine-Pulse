/**
 * Settings (#/settings/<section>): a rail of sections on the left (each marked when it holds unsaved changes or a
 * field to fix), the picked section's settings on the right in groups of rows (what it is and what it does, then the
 * control), and a Save bar along the bottom of that panel while anything is unsaved. On desktop the page fits the
 * window and only the panel scrolls. Appearance and spoilers apply at once (they're kept in this browser); the
 * tracker's own settings wait for Save. Styles: settings.css.
 */
import { CONCEPT_ICON } from "../icons/concepts";
import { FormEvent, KeyboardEvent, ReactNode, useEffect, useId, useRef, useState } from "react";
import { numberError } from "../validation";
import { About, api, LABELS, Settings } from "../api";
import { DEFAULT_CONFIG, EBST_TYPES, EbstConfig, OTHER_KEYS } from "../ebst";
import { SPOILER_CATEGORIES, SpoilerCategory, setAllSpoilers, useSpoilers } from "../spoilers";
import { ToastState } from "./Toasts";
import { Segmented, Switch } from "./ui";
import { AppearanceState, FONTS, TEXT_SCALE, loadFont } from "../appearance";
import { useNav } from "../nav";
import { PageHeader } from "./layout";
import { Icon, IconButton, IconName } from "./Icon";
import { MemoryCheck } from "./MemoryCheck";
import { ReplaySpeedSlider } from "./battle/replay";
import { FACE_LOOKS, UNIT_LOOKS } from "./battle/mapIcons";
import { StepSlider } from "./Slider";
import { GameFilesSection } from "./game-files/GameFilesSection";
import { useReference } from "../reference/types";
import { Sources, SpoilerButton } from "./common";
import "./settings-game-files.css";
import "./settings.css";

const TEXT_STOPS = Math.round((TEXT_SCALE.max - TEXT_SCALE.min) / TEXT_SCALE.step) + 1;

type SettingsTab = "game-files" | "general" | "battles" | "ebst" | "spoilers" | "appearance" | "testing" | "about";
const TABS: { id: SettingsTab; label: string; icon: IconName; blurb: string }[] = [
  { id: "general", label: "General", icon: CONCEPT_ICON.settings, blurb: "Game connection and window" },
  { id: "game-files", label: "Game files", icon: CONCEPT_ICON.item, blurb: "Import from your own game" },
  { id: "battles", label: "Battles", icon: CONCEPT_ICON.battle, blurb: "Reading battles and alerts" },
  { id: "ebst", label: "eBST", icon: CONCEPT_ICON.statUp, blurb: "How effective stats are counted" },
  { id: "spoilers", label: "Spoilers", icon: CONCEPT_ICON.hide, blurb: "What stays hidden for now" },
  { id: "appearance", label: "Appearance", icon: CONCEPT_ICON.edit, blurb: "Theme, text, faces and the map" },
  { id: "testing", label: "Debug", icon: CONCEPT_ICON.log, blurb: "Research and diagnostics" },
  { id: "about", label: "About", icon: CONCEPT_ICON.info, blurb: "Version, data folder, credits" },
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

/** A group of settings under a small title, in one framed panel. */
function Group({ title, right, note, children }: { title: string; right?: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="set-group" aria-label={title}>
      <header className="set-group-head">
        <h3>{title}</h3>
        {right && <div className="set-group-right">{right}</div>}
      </header>
      {note && <p className="set-group-note">{note}</p>}
      <div className="set-rows">{children}</div>
    </section>
  );
}

/**
 * One setting: its name and what it does on the left, the control on the right (below, when `wide`). `htmlFor` ties
 * the name to an input.
 */
function Row({ label, hint, htmlFor, error, wide, children }: { label: ReactNode; hint?: ReactNode; htmlFor?: string; error?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`set-row${wide ? " wide" : ""}${error ? " invalid" : ""}`}>
      <div className="set-text">
        {htmlFor ? <label className="set-label" htmlFor={htmlFor}>{label}</label> : <span className="set-label">{label}</span>}
        {hint && <span className="set-hint">{hint}</span>}
        {error && <span className="set-error" role="alert">{error}</span>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

/** A number of seconds, with its unit. */
function Seconds({ id, value, onChange, error }: { id: string; value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <span className="with-unit">
      <input id={id} type="number" min={0.1} max={60} step={0.1} value={value} onChange={(e) => onChange(e.target.value)} className={error ? "invalid" : ""} aria-invalid={!!error} />
      seconds
    </span>
  );
}

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
      <Group title="Theme and text" note="Changes apply at once and are remembered in this browser.">
        <Row label="Theme">
          <Segmented label="Theme" value={appearance.theme} onChange={(theme) => update({ theme })} options={[["light", "Light"], ["dark", "Dark"]]} />
        </Row>
        <Row label="Text size" hint="Applies to every page. Press Apply when it looks right.">
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
        </Row>
        <Row label="Font" hint="Each sample is shown in its own typeface." wide>
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
        </Row>
      </Group>
      <Group title="Portraits and faces" note="When a sprite is unavailable, its portrait is used instead.">
        <Row
          label="Portraits"
          hint={
            <>
              Auto follows the active playthrough once post-timeskip portraits are enabled in Spoilers.
              {!preferences.portraits && <> Later portraits are hidden.</>}
            </>
          }
        >
          <div className="settings-actions"><Segmented
            label="Portraits"
            value={appearance.portraits}
            onChange={(portraits) => update({ portraits })}
            options={preferences.portraits ? [["auto", "Auto"], ["part1", "Part I"], ["part2", "Part II"]] : [["auto", "Auto"], ["part1", "Part I"]]}
          /><SpoilerButton conceal={preferences.portraits} onClick={() => { setSpoiler("portraits", !preferences.portraits); if (!preferences.portraits) update({ portraits: "part2" }); }} label={preferences.portraits ? "Hide later portrait spoilers" : "Show later portrait spoilers and select Part II portraits"} /></div>
        </Row>
        <Row label="My unit faces" hint="In battle: unit lists, the log and cards.">
          <Segmented label="My unit faces in battle" value={appearance.myUnitFaces} onChange={(myUnitFaces) => update({ myUnitFaces })} options={FACE_LOOKS} />
        </Row>
        <Row label="Other unit faces" hint="In battle: enemies, allies and other armies.">
          <Segmented label="Other unit faces in battle" value={appearance.otherUnitFaces} onChange={(otherUnitFaces) => update({ otherUnitFaces })} options={FACE_LOOKS} />
        </Row>
      </Group>
      <Group title="Battle map">
        <Row label="My units">
          <Segmented label="My units on the battle map" value={appearance.mapMine} onChange={(mapMine) => update({ mapMine })} options={UNIT_LOOKS} />
        </Row>
        <Row label="Other units">
          <Segmented label="Other units on the battle map" value={appearance.mapOthers} onChange={(mapOthers) => update({ mapOthers })} options={UNIT_LOOKS} />
        </Row>
        <Row label="Replay speed" hint="How fast a battle replays on the map.">
          <ReplaySpeedSlider value={appearance.replaySpeed} onChange={(replaySpeed) => update({ replaySpeed })} />
        </Row>
      </Group>
    </>
  );
}

function SpoilerSection() {
  const { preferences, setSpoiler } = useSpoilers();
  const categories = Object.keys(SPOILER_CATEGORIES) as SpoilerCategory[];
  const shown = categories.filter((c) => preferences[c]).length;
  return (
    <Group
      title={`${shown} of ${categories.length} shown`}
      note="Spoilers apply at once and are remembered in this browser."
      right={
        <div className="settings-actions">
          <SpoilerButton onClick={() => setAllSpoilers(true)} label="Show all spoilers" />
          <SpoilerButton conceal onClick={() => setAllSpoilers(false)} label="Hide all spoilers" />
        </div>
      }
    >
      {categories.map((category) => (
        <Row
          key={category}
          label={SPOILER_CATEGORIES[category].label}
          hint={<span aria-live="polite"><strong className={`spoiler-state${preferences[category] ? " shown" : ""}`}>{preferences[category] ? "Shown" : "Hidden"}:</strong> {SPOILER_CATEGORIES[category].hint}</span>}
        >
          <SpoilerButton conceal={preferences[category]} onClick={() => setSpoiler(category, !preferences[category])} label={`${preferences[category] ? "Hide" : "Show"} ${SPOILER_CATEGORIES[category].label.toLowerCase()}`} />
        </Row>
      ))}
    </Group>
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
  if (!runId) return <p className="set-empty">Create a playthrough to set eBST for its units.</p>;
  if (loading) return <p className="set-empty">Loading eBST settings…</p>;
  if (error) return <p className="set-empty field-hint error">{error}</p>;
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
      <Group
        title="eBST for this playthrough"
        note="Apply replaces every unit's eBST setup, including custom setups, and sets the default for units added later. You can still change individual units in the Roster afterwards."
      >
        {(["offense", "defense"] as const).map((field) => (
          <Row key={field} label={field === "offense" ? "Offense type" : "Defense type"}>
            <Segmented
              label={`eBST ${field} type`}
              value={config[field]}
              onChange={(value) => setConfig((old) => ({ ...old, [field]: value }))}
              options={EBST_TYPES.map(({ id, label, hint }) => [id, label, hint] as const)}
            />
          </Row>
        ))}
      </Group>
      <Group title="Also count">
        {OTHER_KEYS.map((key) => (
          <Row key={key} label={LABELS[key]}>
            <Switch
              checked={config.stats.includes(key)}
              label={`Include ${LABELS[key]} in eBST`}
              onChange={(on) => setConfig((old) => ({ ...old, stats: OTHER_KEYS.filter((k) => k === key ? on : old.stats.includes(k)) }))}
            />
          </Row>
        ))}
      </Group>
      <div className="set-apply">
        <button type="button" className="btn primary" disabled={saving} onClick={apply}>{saving ? "Applying…" : "Apply to all units"}</button>
      </div>
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
  const ids = useId();
  const railRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

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
  // A new section starts at its top.
  useEffect(() => { panelRef.current?.scrollTo({ top: 0 }); }, [tab]);

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
  const railKey = (e: KeyboardEvent, i: number) => {
    const n = TABS.length;
    const to = e.key === "ArrowDown" || e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowUp" || e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    setTab(TABS[to].id);
    railRefs.current[to]?.focus();
  };
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <section className="settings-page">
      <PageHeader
        title="Settings"
        actions={<IconButton icon={CONCEPT_ICON.turn} label="Restore recommended values (save to keep them)" onClick={restoreRecommended} />}
      />
      <div className="settings-shell">
        <nav className="settings-rail" aria-label="Settings sections">
          <div role="tablist" aria-orientation="vertical" aria-label="Settings sections" className="rail-list">
            {TABS.map((t, i) => {
              const mark = problems[t.id] ? "error" : changed[t.id] ? "changed" : null;
              return (
                <button
                  key={t.id}
                  ref={(el) => { railRefs.current[i] = el; }}
                  type="button"
                  role="tab"
                  id={`${ids}-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls={`${ids}-panel`}
                  tabIndex={tab === t.id ? 0 : -1}
                  className={`rail-tab${tab === t.id ? " on" : ""}`}
                  onClick={() => setTab(t.id)}
                  onKeyDown={(e) => railKey(e, i)}
                >
                  <span className="rail-icon" aria-hidden="true"><Icon name={t.icon} /></span>
                  <span className="rail-text">
                    <span className="rail-label">{t.label}</span>
                    <span className="rail-blurb">{t.blurb}</span>
                  </span>
                  {mark && (
                    <span className={`rail-mark ${mark}`} title={mark === "error" ? "A field here needs fixing" : "Unsaved changes"}>
                      <span className="set-sr">{mark === "error" ? ", needs fixing" : ", unsaved changes"}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>
        <form className="settings-panel" onSubmit={save} noValidate>
          <div className="settings-scroll" ref={panelRef} id={`${ids}-panel`} role="tabpanel" aria-labelledby={`${ids}-tab-${tab}`}>
            <header className="settings-panel-head">
              <h2>{current.label}</h2>
              <p>{current.blurb}</p>
            </header>
            <div key={tab} className="settings-body">
              {tab === "game-files" && <GameFilesSection desktop={desktop} />}
              {tab === "general" && (
                <>
                  <Group title="Game" note="Requires FE3H 1.2.0 in Eden with fastmem enabled. Other yuzu-based emulators may work but have not been tested.">
                    <Row label="Connection">
                      <MemoryCheck />
                    </Row>
                    <Row label="Read interval" htmlFor={`${ids}-interval`} hint="Recommended: 1 second. Changes are stored after two matching reads." error={intervalError || undefined}>
                      <Seconds id={`${ids}-interval`} value={interval} onChange={setIntervalS} error={intervalError || undefined} />
                    </Row>
                  </Group>
                  {desktop && (
                    <Group title="Window">
                      <Row label="Mode">
                        <Segmented label="Window mode" value={windowMode} onChange={setWindowMode} options={[["windowed", "Windowed"], ["fullscreen", "Borderless Fullscreen"]]} />
                      </Row>
                    </Group>
                  )}
                </>
              )}
              {tab === "battles" && (
                <>
                  <Group title="Reading">
                    <Row
                      label="Battle read interval"
                      htmlFor={`${ids}-battle-interval`}
                      hint={<>Recommended: 0.1 seconds, or 0.5 to ease emulator load. Changes appear after about {battleLatency(Number(battleInterval))}; faster reads can improve fight estimates.</>}
                      error={battleIntervalError || undefined}
                    >
                      <Seconds id={`${ids}-battle-interval`} value={battleInterval} onChange={setBattleInterval} error={battleIntervalError || undefined} />
                    </Row>
                    <Row label="Fight estimates" hint="When the game's battle history cannot be read, estimates use HP changes and combat math. The tracker returns to exact history when available.">
                      <Switch
                        checked={estimateFights}
                        onChange={setEstimateFights}
                        label={estimateFights ? "Work out fights when the game's battle history can't be read" : "Leave damage untracked when the history can't be read"}
                      />
                    </Row>
                  </Group>
                  <Group title="During a battle">
                    <Row label="Battle page" hint="Show the Battle page instead of the Roster during a battle.">
                      <Switch checked={battlePage} onChange={setBattlePage} label={battlePage ? "Show the Battle page instead of the Roster during a battle" : "Stay on the Roster during a battle"} />
                    </Row>
                    <Row label="Roster filter" hint="Show only the units in a battle when it starts.">
                      <Switch checked={battleAuto} onChange={setBattleAuto} label={battleAuto ? "Show only the units in a battle when it starts" : "Don't filter the Roster in battles"} />
                    </Row>
                    <Row label="Battle alerts" hint="Notify when a unit leaves the battle or a Divine Pulse is used.">
                      <Switch checked={battleAlerts} onChange={setBattleAlerts} label={battleAlerts ? "Notify when a unit leaves the battle or a Divine Pulse is used" : "No battle notifications"} />
                    </Row>
                  </Group>
                </>
              )}
              {tab === "spoilers" && <SpoilerSection />}
              {tab === "ebst" && <EbstSection key={settings.active_run_id} runId={settings.active_run_id} toasts={toasts} />}
              {tab === "appearance" && <AppearanceSection state={appearance} />}
              {tab === "testing" && (
                <Group title="Research tools" note="Leave the last two options off for normal play.">
                  <Row label="Record battles" hint="Keeps raw memory for the last 5 battles in battle-recordings. Each can use up to 200 MB; older recordings are deleted.">
                    <Switch checked={recordBattles} onChange={setRecordBattles} label={recordBattles ? "Save raw battle memory for research (last 5 battles)" : "Don't record battles"} />
                  </Row>
                  <Row label="Check fight estimates" hint="Writes a comparison with the game's history to pairing-checks after each battle. The Battle page is unchanged.">
                    <Switch checked={pairingCheck} onChange={setPairingCheck} label={pairingCheck ? "Compare the estimates with the game's history" : "Off"} />
                  </Row>
                  <Row
                    label="Ignore the history"
                    hint={<span className={hideHistory ? "form-error" : undefined}>The log and damage become estimates while this is on. Turn it off to restore exact history on the next read.</span>}
                  >
                    <Switch checked={hideHistory} onChange={setHideHistory} label={hideHistory ? "The Battle page shows estimates only" : "Off"} />
                  </Row>
                </Group>
              )}
              {tab === "about" && <AboutSection toasts={toasts} />}
            </div>
          </div>
          {dirty && (
            <div className={`settings-save${invalid ? " invalid" : ""}`} role="status">
              <span className="settings-save-text">
                {invalid ? <>Fix the fields marked in red on {tabNames(problems)} to save</> : <>Unsaved changes on {tabNames(changed)}</>}
              </span>
              <button className="btn primary" type="submit" disabled={invalid}>
                Save Settings
              </button>
            </div>
          )}
        </form>
      </div>
    </section>
  );
}

/** How long a change takes to reach the Battle page at this read interval: one to two reads. */
function battleLatency(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const fmt = (n: number) => (n < 10 ? n.toFixed(n < 1 ? 2 : 1).replace(/\.?0+$/, "") : String(Math.round(n)));
  return `${fmt(seconds)}–${fmt(seconds * 2)} seconds`;
}

/** Version and the data folder, so it's easy to back up, move to another PC, or find the log. Also shown in a window
 * from the game files gate, so its groups don't depend on the Settings page around them. */
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
    <div className="set-about">
      <Group title="This copy">
        <Row label="Version">
          <span className="set-value">{about.version} · Windows</span>
        </Row>
        <Row
          label="Data folder"
          wide
          hint={<>Runs, battles, settings and the log (tracker.log). To move to another PC, copy this folder to the same place there, or put it next to Divine Pulse.exe as a folder named <code>data</code>.</>}
        >
          <span className="with-unit set-path">
            <code className="path">{about.data_dir}</code>
            <button type="button" className="btn small" onClick={open}>
              Open
            </button>
          </span>
        </Row>
      </Group>
      <Group title="Tracking and reference notes">
        <div className="set-prose">
          <p>Battles are recorded while the tracker reads the game. Each one is filed in History when it ends.</p>
          <p>Battle outlook is a rough estimate from what the tracker can read: units at risk of falling (losing Byleth or a house leader loses the battle), current HP, army strength against the other units on the map, progress, losses, Divine Pulses and level-ups.</p>
          <p>When the game's battle history cannot be read, fight estimates use HP changes and combat math. The tracker returns to exact history when available. Untracked values come from the game's Divine Pulse list, which could not be read.</p>
          <p>For eBST, Offense and Defense each count as one value: Auto uses the higher of the pair, Flex the average. Click HP, Mv, Dex, Spd, Lck or Cha to count it too. eBST is everything counted added up and divided by how many went in.</p>
          <p>Return a lost item to its owner for +20 support. Liked gifts give +20, neutral +10, disliked nothing. Anyone not listed is neutral.</p>
          {reference && <Sources sources={reference.sources} />}
        </div>
      </Group>
      <Group title="Credits">
        <div className="set-prose">
          <p>
            A fan-made tool, not affiliated with or endorsed by Nintendo, Intelligent Systems or Koei Tecmo. <i>Fire Emblem: Three Houses</i> and
            its artwork are © Nintendo / Intelligent Systems / Koei Tecmo.
          </p>
          <ul className="plain-list credits">
            {CREDITS.map(([name, what]) => (
              <li key={name}>
                <b>{name}</b>: {what}
              </li>
            ))}
          </ul>
          <p className="credits">Support availability and class-change notes: text from <i>List of supports in Fire Emblem: Three Houses</i> and <i>Class change</i>, <a href="https://fireemblemwiki.org">Fire Emblem Wiki</a>, by Fire Emblem Wiki contributors; page histories: <a href="https://fireemblemwiki.org/w/index.php?title=List_of_supports_in_Fire_Emblem:_Three_Houses&amp;action=history">List of supports</a>, <a href="https://fireemblemwiki.org/w/index.php?title=Class_change&amp;action=history">Class change</a>; licensed under <a href="https://www.gnu.org/licenses/fdl-1.3.txt">GNU Free Documentation License 1.3</a>; modified by reformatting and abridgment.</p>
          <p className="set-hint">
            The open-source software bundled with the tracker and its licenses are listed in <i>Third-party notices.txt</i> next to the program.
          </p>
        </div>
      </Group>
    </div>
  );
}

/** Where the tracker's game data and mechanics come from (docs/third-party-notices.md has the details). */
const CREDITS: [string, string][] = [
  ["Your game files", "all imported game data"],
  ["Three Houses Research Group", "the game's file formats, and terrain and battle names (bsic map editor, MIT License)"],
  ["fe3h.com, Samurai Gamers, Corridors of Time, FE Universe", "game mechanics: linked attacks, terrain, classes, hit rolls"],
  ["Phosphor Icons", "the app's icons (MIT License)"],
];
