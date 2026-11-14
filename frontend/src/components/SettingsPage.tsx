/**
 * Settings (#/settings/<section>): a rail of sections on the left (each marked when it holds unsaved changes or a
 * field to fix), the picked section's settings on the right in groups of rows (what it is and what it does, then the
 * control), and a Save bar along the bottom of that panel while anything is unsaved. On desktop the page fits the
 * window and only the panel scrolls. Appearance and spoilers apply at once (they're kept in this browser); the
 * tracker's own settings wait for Save. Styles: settings.css.
 */
import { CONCEPT_ICON } from "../icons/concepts";
import { FormEvent, KeyboardEvent, ReactNode, useEffect, useId, useRef, useState } from "react";
import { About, api, LABELS, Settings } from "../api";
import { DEFAULT_CONFIG, EBST_TYPES, EbstConfig, OTHER_KEYS } from "../ebst";
import { SPOILER_CATEGORIES, SpoilerCategory, setAllSpoilers, useSpoilers } from "../spoilers";
import { ToastState } from "./Toasts";
import { Segmented, Switch } from "./ui";
import { AppearanceState, FONTS, TEXT_SCALE, loadFont } from "../appearance";
import { useNav } from "../nav";
import { PageHeader } from "./layout";
import { Icon, IconName } from "./Icon";
import { MemoryCheck } from "./MemoryCheck";
import { ReplaySpeedSlider } from "./battle/replay";
import { BattleReplaySettings } from "./battle/OverlaySettings";
import { FACE_LOOKS, UNIT_LOOKS } from "./battle/mapIcons";
import { StepSlider } from "./Slider";
import { GameFilesSection } from "./game-files/GameFilesSection";
import { useReference } from "../reference/types";
import { Sources, SpoilerButton } from "./common";
import "./settings-game-files.css";
import "./settings.css";

const TEXT_STOPS = Math.round((TEXT_SCALE.max - TEXT_SCALE.min) / TEXT_SCALE.step) + 1;

type SettingsTab = "game-files" | "general" | "ebst" | "spoilers" | "appearance" | "battle-replay" | "about";
const TABS: { id: SettingsTab; label: string; icon: IconName; blurb: string }[] = [
  { id: "general", label: "General", icon: CONCEPT_ICON.settings, blurb: "Game connection and window" },
  { id: "game-files", label: "Game files", icon: CONCEPT_ICON.item, blurb: "Import from your own game" },
  { id: "ebst", label: "eBST", icon: CONCEPT_ICON.statUp, blurb: "How effective stats are counted" },
  { id: "spoilers", label: "Spoilers", icon: CONCEPT_ICON.hide, blurb: "What stays hidden for now" },
  { id: "battle-replay", label: "Battle Replay", icon: CONCEPT_ICON.play, blurb: "Units, playback and overlays" },
  { id: "appearance", label: "Appearance", icon: CONCEPT_ICON.edit, blurb: "Text size and font" },
  { id: "about", label: "About", icon: CONCEPT_ICON.info, blurb: "Version, data folder, credits" },
];

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

function AppearanceSection({ state }: { state: AppearanceState }) {
  const { appearance, update } = state;
  // Load every font so the previews below render in their own typeface.
  useEffect(() => FONTS.forEach(loadFont), []);
  // The text size waits for Apply: resizing everything while the slider is dragged makes the page jump.
  const [textScale, setTextScale] = useState(appearance.textScale);
  useEffect(() => setTextScale(appearance.textScale), [appearance.textScale]);
  return (
    <>
      <Group title="Text" note="Changes apply at once and are remembered for this installation.">
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
    </>
  );
}

/** Settings > Battle Replay: how units look in battle and on the map, how a replay plays, then the map's overlays. */
function BattleReplaySection({ state }: { state: AppearanceState }) {
  const { appearance, update } = state;
  const { preferences, setSpoiler } = useSpoilers();
  return (
    <>
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
          <Segmented
            label="Portraits"
            value={appearance.portraits}
            onChange={(portraits) => { if (portraits === "part2") setSpoiler("portraits", true); update({ portraits }); }}
            options={[["auto", "Auto"], ["part1", "Part I"], ["part2", "Part II"]]}
          />
        </Row>
        <Row label="My unit faces" hint="In battle: unit lists, the log and cards.">
          <Segmented label="My unit faces in battle" value={appearance.myUnitFaces} onChange={(myUnitFaces) => update({ myUnitFaces })} options={FACE_LOOKS} />
        </Row>
        <Row label="Other unit faces" hint="In battle: Enemy Units, Ally Units and Third Army.">
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
        <Row label="Group moves" hint="Consecutive moves in one phase, with nothing else between them, replay at once, on the map and in videos (Export Video can change it for one video).">
          <Switch checked={appearance.groupMoves} label="Replay consecutive moves together" onChange={(groupMoves) => update({ groupMoves })} />
        </Row>
      </Group>
      <p className="set-group-note">These settings apply to the battle map and are saved as you change them. Video export has its own layout settings.</p>
      <BattleReplaySettings />
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
      note="Spoilers apply at once and are remembered for this installation."
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
  const [recordingLimit, setRecordingLimit] = useState("3");
  const [windowMode, setWindowMode] = useState<Settings["window_mode"]>("windowed");
  const [memoryReader, setMemoryReader] = useState<Settings["memory_reader"]>("eden");
  const [duplicates, setDuplicates] = useState<Settings["duplicate_battles"]>("keep_best");
  const [checkUpdates, setCheckUpdates] = useState(true);
  // The window mode only applies to the desktop window, not the browser.
  const [desktop, setDesktop] = useState(false);
  const ids = useId();
  const railRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  const apply = (s: Settings) => {
    setSettings(s);
    setWindowMode(s.window_mode);
    setMemoryReader(s.memory_reader);
    setDuplicates(s.duplicate_battles ?? "keep_best");
    setCheckUpdates(s.check_updates ?? true);
    setRecordingLimit(String(s.max_recordings));
  };

  useEffect(() => {
    api.settings().then(apply);
    api.about().then((a) => setDesktop(a.desktop), () => setDesktop(false));
  }, []);
  // A new section starts at its top.
  useEffect(() => { panelRef.current?.scrollTo({ top: 0 }); }, [tab]);

  const count = Number(recordingLimit);
  const invalid = !recordingLimit.trim() || !Number.isInteger(count) || count < 0 || count > 1000;
  const problems: Partial<Record<SettingsTab, boolean>> = { general: invalid };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    try {
      const s = await api.saveSettings({
        window_mode: windowMode,
        memory_reader: memoryReader,
        duplicate_battles: duplicates,
        check_updates: checkUpdates,
        max_recordings: count,
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
    general: count !== settings.max_recordings || windowMode !== settings.window_mode || memoryReader !== settings.memory_reader || duplicates !== (settings.duplicate_battles ?? "keep_best") || checkUpdates !== (settings.check_updates ?? true),
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
                  <Group title="Game" note={memoryReader === "recomp"
                    ? "Requires Windows, FE3H Recomp by onerag90 (fe3hrecomp.exe) running Fire Emblem: Three Houses v1.2.0."
                    : "Requires Windows, Eden with fastmem enabled, and Fire Emblem: Three Houses v1.2.0."}>
                    <Row label="Read the game from" hint="Save the setting, then check the connection.">
                      <Segmented label="Read the game from" value={memoryReader} onChange={setMemoryReader} options={[["eden", "Eden"], ["recomp", "FE3H Recomp by onerag90"]]} />
                    </Row>
                    <Row label="Connection">
                      <MemoryCheck key={settings.memory_reader} />
                    </Row>
                  </Group>
                  <Group title="Battle recordings">
                    <Row label="Maximum raw recordings" htmlFor={ids + "-recordings"}
                      hint="Enter 0 to turn off raw recording. Older recordings are removed when the limit is reached."
                      error={invalid ? "Enter a whole number from 0 to 1000." : undefined}>
                      <input id={ids + "-recordings"} type="number" min={0} max={1000} step={1}
                        value={recordingLimit} onChange={(e) => setRecordingLimit(e.target.value)} aria-invalid={invalid} />
                    </Row>
                  </Group>
                  <Group title="Battles">
                    <Row label="Repeated battles">
                      <Segmented label="Repeated battles" value={duplicates} onChange={setDuplicates} options={[["keep_best", "Keep Best"], ["keep_latest", "Keep Latest"], ["ask", "Ask"]]} />
                    </Row>
                  </Group>
                  <Group title="Updates">
                    <Row label="Check for updates on startup">
                      <Segmented label="Check for updates on startup" value={checkUpdates ? "on" : "off"} onChange={(v) => setCheckUpdates(v === "on")} options={[["on", "On"], ["off", "Off"]]} />
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
              {tab === "spoilers" && <SpoilerSection />}
              {tab === "ebst" && <EbstSection key={settings.active_run_id} runId={settings.active_run_id} toasts={toasts} />}
              {tab === "appearance" && <AppearanceSection state={appearance} />}
              {tab === "battle-replay" && <BattleReplaySection state={appearance} />}
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
          <p>Battle outlook is a rough chance of winning. It goes up as enemies go down (5 of 10 enemies down) and with level-ups. It compares how healthy each side is, unit by unit (Your Units 80% HP, Enemy Units 60%). It goes down as your units fall, and when a unit is low on HP with enemies in reach (Dimitri 8/28 HP, 2 enemies in reach). Losing Byleth or a house leader loses the battle.</p>
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
