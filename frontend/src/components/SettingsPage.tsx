/**
 * Settings (#/settings/<section>): a rail of sections on the left (each marked when it holds unsaved changes or a
 * field to fix), the picked section's settings on the right in groups of rows (what it is and what it does, then the
 * control), and a Save bar along the bottom of that panel while anything is unsaved. On desktop the page fits the
 * window and only the panel scrolls. Appearance and spoilers apply at once (they're kept in this browser); the
 * tracker's own settings wait for Save. Styles: settings.css.
 */
import { CONCEPT_ICON } from "../icons/concepts";
import { FormEvent, KeyboardEvent, ReactNode, useEffect, useId, useRef, useState } from "react";
import { About, api, LABELS, SaveBackupStatus, Settings } from "../api";
import { DEFAULT_CONFIG, EBST_TYPES, EbstConfig, OTHER_KEYS } from "../ebst";
import { SPOILER_CATEGORIES, SpoilerCategory, setAllSpoilers, useSpoilers } from "../spoilers";
import { ToastState } from "./Toasts";
import { Segmented, Switch } from "./ui";
import { AppearanceState, FONTS, TEXT_SCALE, loadFont } from "../appearance";
import { useNav } from "../nav";
import { IS_LINUX, IS_MAC, PLATFORM, PLATFORM_NAME, type Platform } from "../platform";
import { PageHeader } from "./layout";
import { Icon, IconName } from "./Icon";
import { MemoryCheck } from "./MemoryCheck";
import { StaggerSlider } from "./battle/replay";
import { PanSensitivitySlider, PanSpeedSlider } from "./battle/camera";
import { BattleReplaySettings } from "./battle/OverlaySettings";
import { FACE_LOOKS, UNIT_LOOKS } from "./battle/mapIcons";
import { StepSlider } from "./Slider";
import { GameFilesSection } from "./game-files/GameFilesSection";
import { useReference } from "../reference/types";
import { Sources, SpoilerButton } from "./common";
import "./settings-game-files.css";
import "./settings.css";

const TEXT_STOPS = Math.round((TEXT_SCALE.max - TEXT_SCALE.min) / TEXT_SCALE.step) + 1;

/** What each game reader needs, under Settings > General > Game. */
const READER_NOTES: Record<Settings["memory_reader"], string> = {
  auto: "Finds the game in whichever supported program is running: Eden (Windows or Linux, with fastmem enabled), Astris (macOS), Ryubing or Ryujinx, or FE3H Recomp by onerag90 (Windows). Fire Emblem: Three Houses must be v1.2.0.",
  eden: "Requires Windows or Linux, Eden with fastmem enabled, and Fire Emblem: Three Houses v1.2.0.",
  ryujinx: "Requires Astris on macOS, or Ryubing (or Ryujinx) on Windows, macOS or Linux, running Fire Emblem: Three Houses v1.2.0.",
  recomp: "Requires Windows, FE3H Recomp by onerag90 (fe3hrecomp.exe) running Fire Emblem: Three Houses v1.2.0.",
};

const READERS: [Settings["memory_reader"], string][] = [["auto", "Auto"], ["eden", "Eden"], ["ryujinx", "Astris / Ryubing"], ["recomp", "FE3H Recomp by onerag90"]];
/** Readers a computer can't use (Eden is read on Windows and Linux, and FE3H Recomp is a Windows program): left out
 * there, unless already chosen (settings brought over from another computer). */
const UNAVAILABLE_READERS: Record<Platform, Settings["memory_reader"][]> = { windows: [], macos: ["eden", "recomp"], linux: ["recomp"] };
/** Not yet tried with the real emulators and the game. */
const LINUX_NOTE = " Linux support is experimental: if the game isn't found, please report it with tracker.log (About > Data folder > Open).";
/** Whose game saves are found without being asked for. */
const SAVES_FOUND = IS_LINUX ? "Eden's and Ryubing's" : "Eden's, Astris's and Ryubing's";
/** Astris only runs on macOS. */
const readerName = (id: Settings["memory_reader"], name: string) => (id === "ryujinx" && IS_LINUX ? "Ryubing / Ryujinx" : name);

type SettingsTab ="game-files" | "general" | "ebst" | "spoilers" | "appearance" | "battle-replay" | "about";
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
      <Group title="Text">
        <Row label="Text size">
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
        <Row label="Font" wide>
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
              Auto matches the run's chapter.
              {!preferences.portraits && <> Part II needs its spoiler shown.</>}
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
        <Row label="Group actions" hint="Actions in a row on the same unit replay together.">
          <Switch checked={appearance.groupActions} label="Replay grouped actions together" onChange={(groupActions) => update({ groupActions })} />
        </Row>
        {appearance.groupActions && (
          <>
            <Row label="Stagger grouped actions" hint="Play grouped actions one after another.">
              <Switch checked={appearance.staggerActions} label="Stagger grouped actions" onChange={(staggerActions) => update({ staggerActions })} />
            </Row>
            {appearance.staggerActions && (
              <Row label="Stagger" hint="0%: all at once. 100%: one after another.">
                <StaggerSlider value={appearance.actionStagger} onChange={(actionStagger) => update({ actionStagger })} />
              </Row>
            )}
          </>
        )}
        <Row label="Camera pan speed" hint="How fast the camera moves to the next action.">
          <PanSpeedSlider value={appearance.panSpeed} onChange={(panSpeed) => update({ panSpeed })} />
        </Row>
        <Row label="Camera pan sensitivity" hint="How close to the edge before the camera pans.">
          <PanSensitivitySlider value={appearance.panMargin} onChange={(panMargin) => update({ panMargin })} />
        </Row>
      </Group>
      <p className="set-group-note">For the battle page. Export Video has its own.</p>
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
        note="Apply sets every unit's eBST, and the default for new units."
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
  const [memoryReader, setMemoryReader] = useState<Settings["memory_reader"]>("auto");
  const [duplicates, setDuplicates] = useState<Settings["duplicate_battles"]>("keep_best");
  const [checkUpdates, setCheckUpdates] = useState(true);
  const [launchWithGame, setLaunchWithGame] = useState(false);
  const [backupLimit, setBackupLimit] = useState("3");
  const [saveFolder, setSaveFolder] = useState("");
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
    setLaunchWithGame(s.launch_with_game ?? false);
    setRecordingLimit(String(s.max_recordings));
    setBackupLimit(String(s.save_backups ?? 3));
    setSaveFolder(s.save_folder ?? "");
  };

  // A failed read used to leave the page on "Loading…" for good, with an unhandled rejection.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoadError(null);
    api.settings().then((s) => { if (live) apply(s); }, (err: Error) => { if (live) setLoadError(err.message); });
    api.about().then((a) => { if (live) setDesktop(a.desktop); }, () => { if (live) setDesktop(false); });
    return () => { live = false; };
  }, [loadAttempt]);
  // A new section starts at its top.
  useEffect(() => { panelRef.current?.scrollTo({ top: 0 }); }, [tab]);

  const count = Number(recordingLimit);
  const invalid = !recordingLimit.trim() || !Number.isInteger(count) || count < 0 || count > 1000;
  const backups = Number(backupLimit);
  const backupsInvalid = !backupLimit.trim() || !Number.isInteger(backups) || backups < 0 || backups > 100;
  const problems: Partial<Record<SettingsTab, boolean>> = { general: invalid || backupsInvalid };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (invalid || backupsInvalid) return;
    try {
      const s = await api.saveSettings({
        window_mode: windowMode,
        memory_reader: memoryReader,
        duplicate_battles: duplicates,
        check_updates: checkUpdates,
        launch_with_game: launchWithGame,
        max_recordings: count,
        save_backups: backups,
        save_folder: saveFolder.trim(),
      });
      apply(s);
      onSaved(s);
      toasts.push({ kind: "ok", title: "Settings saved" });
    } catch (err) {
      toasts.push({ kind: "error", title: "Couldn't save settings", body: (err as Error).message });
    }
  };

  if (!settings) {
    return loadError
      ? <div className="startup-error" role="alert"><span>Couldn't read the settings: {loadError}</span><button type="button" className="btn" onClick={() => setLoadAttempt((n) => n + 1)}>Retry</button></div>
      : <p className="muted">Loading…</p>;
  }

  const changed: Partial<Record<SettingsTab, boolean>> = {
    general: count !== settings.max_recordings || windowMode !== settings.window_mode || memoryReader !== settings.memory_reader || duplicates !== (settings.duplicate_battles ?? "keep_best") || checkUpdates !== (settings.check_updates ?? true)
      || launchWithGame !== (settings.launch_with_game ?? false)
      || backups !== (settings.save_backups ?? 3) || saveFolder.trim() !== (settings.save_folder ?? ""),
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
              {tab === "game-files" && <GameFilesSection desktop={desktop} heading={false} />}
              {tab === "general" && (
                <>
                  <Group title="Game" note={READER_NOTES[memoryReader] + (IS_LINUX ? LINUX_NOTE : "")}>
                    <Row label="Read the game from" hint="Save the setting, then check the connection.">
                      <Segmented label="Read the game from" value={memoryReader} onChange={setMemoryReader} options={READERS.filter(([id]) => !UNAVAILABLE_READERS[PLATFORM].includes(id) || id === settings.memory_reader).map(([id, name]) => [id, readerName(id, name)])} />
                    </Row>
                    <Row label="Connection">
                      <MemoryCheck key={settings.memory_reader} />
                    </Row>
                    {PLATFORM === "windows" && (
                      <Row label="Launch with Game" hint="Opens Divine Pulse when Eden, Ryubing/Ryujinx or FE3H Recomp starts, even after you close it.">
                        <Segmented label="Launch with Game" value={launchWithGame ? "on" : "off"} onChange={(v) => setLaunchWithGame(v === "on")} options={[["on", "On"], ["off", "Off"]]} />
                      </Row>
                    )}
                  </Group>
                  <SaveBackupsGroup key={`${settings.save_folder ?? ""}|${settings.save_backups}`} toasts={toasts} id={ids + "-backups"}
                    limit={backupLimit} setLimit={setBackupLimit} invalid={backupsInvalid}
                    folder={saveFolder} setFolder={setSaveFolder} />
                  <Group title="Battle recordings">
                    <Row label="Maximum raw recordings" htmlFor={ids + "-recordings"}
                      hint="0 turns it off. The oldest are removed first."
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
                        <Segmented label="Window mode" value={windowMode} onChange={setWindowMode} options={[["windowed", "Windowed"], ["fullscreen", IS_MAC ? "Full Screen" : "Borderless Fullscreen"]]} />
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

/** Backup Game Saves: how many older versions of each save to keep, which save folder, and where the copies are. */
function SaveBackupsGroup({ toasts, id, limit, setLimit, invalid, folder, setFolder }: {
  toasts: ToastState;
  id: string;
  limit: string;
  setLimit: (v: string) => void;
  invalid: boolean;
  folder: string;
  setFolder: (v: string) => void;
}) {
  const [status, setStatus] = useState<SaveBackupStatus | null>(null);
  useEffect(() => {
    let live = true;
    api.saveBackups().then((s) => { if (live) setStatus(s); }, () => { if (live) setStatus(null); });
    return () => { live = false; };
  }, []);
  const open = async () => {
    try {
      await api.openSaveBackups();
    } catch (e) {
      toasts.push({ kind: "error", title: "Couldn't open the folder", body: (e as Error).message });
    }
  };
  const found = status?.sources ?? [];
  return (
    <Group title="Backup Game Saves">
      <Row label="Older versions to keep" htmlFor={id}
        hint="Each save is copied, and when the game overwrites it, up to this many earlier versions are kept. 0 turns backups off."
        error={invalid ? "Enter a whole number from 0 to 100." : undefined}>
        <input id={id} type="number" min={0} max={100} step={1}
          value={limit} onChange={(e) => setLimit(e.target.value)} aria-invalid={invalid} />
      </Row>
      <Row label="Save folder" htmlFor={id + "-folder"} wide
        // FE3H Recomp only runs on Windows, and Astris only on a Mac.
        hint={folder.trim() ? `Leave empty to find ${SAVES_FOUND}${PLATFORM === "windows" ? " and FE3H Recomp's" : ""} saves automatically.`
          : found.length ? <>Found: {found.map((f) => <code key={f} className="path">{f}</code>)}</>
          : `None found yet. ${SAVES_FOUND} are found automatically${PLATFORM === "windows" ? ", and FE3H Recomp's once it has run with Divine Pulse open" : ""}. Or paste the folder here.`}>
        <input id={id + "-folder"} type="text" value={folder} placeholder="Automatic" onChange={(e) => setFolder(e.target.value)} />
      </Row>
      {status && (
        <Row label="Backups" wide hint="To restore one, copy it back into the save folder under the save's own name, with the game closed.">
          <span className="with-unit set-path">
            <code className="path">{status.folder}</code>
            <button type="button" className="btn small" onClick={open}>
              Open
            </button>
          </span>
        </Row>
      )}
    </Group>
  );
}

/** Version and the data folder, so it's easy to back up, move to another PC, or find the log. Also shown in a window
 * from the game files gate, so its groups don't depend on the Settings page around them. */
export function AboutSection({ toasts }: { toasts: ToastState }) {
  const reference = useReference();
  const [about, setAbout] = useState<About | null>(null);
  useEffect(() => {
    let live = true;
    api.about().then((a) => { if (live) setAbout(a); }, () => { if (live) setAbout(null); });
    return () => { live = false; };
  }, []);
  if (!about) return null;
  // platform.ts is the one source for which computer this is (the tracker's, as the page is only shown there).
  const mac = IS_MAC;
  const program = IS_LINUX ? "the Divine Pulse program" : "Divine Pulse.exe";
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
          <span className="set-value">{about.version} · {PLATFORM_NAME[PLATFORM]}</span>
        </Row>
        <Row
          label="Data folder"
          wide
          hint={mac
            // The Mac app keeps it in Application Support; there is no folder beside the app to use instead.
            ? <>Runs, battles, settings and the log (tracker.log). To move to another Mac, copy this folder to the same place there.</>
            : <>Runs, battles, settings and the log (tracker.log). To move to another PC, copy this folder to the same place there, or put it next to {program} as a folder named <code>data</code>.</>}
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
            The open-source software bundled with the tracker and its licenses are listed in <i>Third-party notices.txt</i>{mac
              ? <> inside the app: Control-click <i>Divine Pulse.app</i>, choose Show Package Contents, and open Contents › Resources.</>
              : " next to the program."}
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
