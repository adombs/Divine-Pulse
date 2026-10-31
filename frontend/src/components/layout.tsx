/**
 * The building blocks every page is made of (docs/ui-design.md): a page header with status and sub-tabs, a list with
 * a detail card, number tiles, meters and empty states. Pages compose these rather than styling their own.
 */
import { CONCEPT_ICON } from "../icons/concepts";
import { createContext, ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SubTabs } from "./common";
import { CardBanner, SectionHead } from "./ui";
import { Accordion, Collapse, NoAccordion, useDisclosure, useInAccordion } from "./disclosure";
import { Icon, IconName } from "./Icon";
import { useNav } from "../nav";
import { PopupActions, useInPopup } from "./CharacterPopup";

export interface Tab<T extends string> {
  id: T;
  label: string;
  /** Shown after the label ("Enemies 12"). */
  count?: number;
}

/** The top of a page: its title, a one-line status (chips), actions on the right, and sub-tabs when it has views. */
export function PageHeader<T extends string>({
  title,
  status,
  actions,
  tabs,
  tab,
  onTab,
}: {
  title: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  tabs?: Tab<T>[];
  tab?: T;
  onTab?: (t: T) => void;
}) {
  const { route } = useNav();
  return (
    <header className="page-header">
      <SectionHead
        icon={<Icon name={CONCEPT_ICON[route.page]} className="page-icon" />}
        right={
          <>
            {actions}
            <BackButton />
          </>
        }
      >
        {title}
      </SectionHead>
      {status && <div className="page-status">{status}</div>}
      {tabs && tab !== undefined && onTab && (
        <SubTabs label={typeof title === "string" ? `${title} views` : "Views"} value={tab} onChange={onTab} options={tabs.map((t) => [t.id, tabLabel(t)])} />
      )}
    </header>
  );
}

/** Back to where you were (also Alt+← and the mouse's back button); at the right end of every page header. */
export function BackButton() {
  const nav = useNav();
  return (
    <button
      type="button"
      className="btn small page-back"
      onClick={nav.back}
      disabled={!nav.canBack}
      title="Back to where you were (Alt+←)"
    >
      <Icon name={CONCEPT_ICON.back} />
      Back
    </button>
  );
}

function tabLabel(t: Tab<string>): string {
  return t.count === undefined ? t.label : `${t.label} ${t.count}`;
}

/** A status chip for a page header: "Live", "Turn 3", "Won". `tone` colours it; `accent` marks a temporary view. */
export function StatusChip({ children, tone, title }: { children: ReactNode; tone?: "live" | "good" | "bad" | "warn" | "accent"; title?: string }) {
  return (
    <span className={`status-chip ${tone ?? ""}`} title={title}>
      {children}
    </span>
  );
}

/**
 * A list (table) on the left and the selected item's DetailCard beside it. On wide screens the page fits the sheet:
 * what's above the table stays put, only the table scrolls, and the card fills the column beside it. Stacked on
 * narrow screens.
 */
export function MasterDetail({ children, detail, wide }: { children: ReactNode; detail: ReactNode; wide?: boolean }) {
  return (
    <div className={`roster-layout ${wide ? "ref-layout" : ""}${detail ? "" : " single"}`}>
      <div className="master">{children}</div>
      {detail}
    </div>
  );
}

interface Pane {
  id: string;
  title: ReactNode;
  icon: IconName;
}

interface PaneState {
  active: string | undefined;
  register: (p: Pane) => () => void;
}

const PaneContext = createContext<PaneState | null>(null);

// The section picked last, shown again on the next card that has it (browsing units keeps you on Inventory).
let lastPane: string | undefined;

// Icons for sections defined elsewhere that don't pass their own.
const PANE_ICON: Record<string, IconName> = { "On the map": CONCEPT_ICON.position, Position: CONCEPT_ICON.position };

/**
 * The banner-titled card for the selected item of a MasterDetail. Its Sections are a bar of icons along its bottom
 * (an icon grows into its section's name while the pointer is on it), and the picked one is shown; the rest of the
 * card (the profile, key numbers) always shows. `actions` are icon buttons at the top right, beside the name; `icon` replaces the banner's crest. In a
 * character popup the card leaves out its banner and its actions go into the window's header (the popup has both).
 */
export function DetailCard({ title, label, actions, icon, children }: { title: ReactNode; label: string; actions?: ReactNode; icon?: ReactNode; children: ReactNode }) {
  const popup = useInPopup();
  const [panes, setPanes] = useState<Pane[]>([]);
  const [picked, setPicked] = useState(lastPane);
  const active = panes.some((p) => p.id === picked) ? picked : panes[0]?.id;
  const register = useCallback((p: Pane) => {
    setPanes((list) => [...list.filter((x) => x.id !== p.id), p]);
    return () => setPanes((list) => list.filter((x) => x.id !== p.id));
  }, []);
  const pick = (id: string) => {
    lastPane = id;
    setPicked(id);
  };
  // Stacked under the list (narrow screens): bring another item's card into view.
  const ref = useRef<HTMLElement>(null);
  const shown = useRef(label);
  useEffect(() => {
    if (shown.current === label) return;
    shown.current = label;
    if (!popup && window.matchMedia("(max-width: 1150px)").matches) ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [label, popup]);
  return (
    <aside ref={ref} className={`unit-card ref-card${popup ? " in-popup" : ""}`} aria-label={label}>
      {!popup && <CardBanner title={title} right={actions} icon={icon} />}
      {popup && actions && <PopupActions>{actions}</PopupActions>}
      <div className={`card-frame${panes.length ? " with-bar" : ""}`}>
        <PaneContext.Provider value={{ active, register }}>
          {/* Folds in the card stay an accordion. Another item's card fades in (the picked section stays picked). */}
          <Accordion>
            <div key={label} className="card-swap card-main">
              {children}
            </div>
          </Accordion>
        </PaneContext.Provider>
        {panes.length > 0 && (
          <div className="card-bar" role="tablist" aria-label={`${label}: sections`}>
            {panes.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                className={`bar-btn${p.id === active ? " active" : ""}`}
                aria-selected={p.id === active}
                aria-label={p.id}
                title={p.id}
                onClick={() => pick(p.id)}
              >
                <Icon name={p.icon} />
                <span className="bar-label" aria-hidden="true">{p.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * A labelled sub-section of a DetailCard or a page. In a card it's one of the sections in the card's sidebar (`icon`
 * there), shown when picked. In an Accordion its header opens and closes it, with `summary` beside the title while
 * it's closed; `open` opens it to start with. `right` stays in the header.
 */
export function Section({
  title,
  right,
  summary,
  open,
  icon,
  children,
}: {
  title: ReactNode;
  right?: ReactNode;
  summary?: ReactNode;
  open?: boolean;
  icon?: IconName;
  children: ReactNode;
}) {
  const pane = useContext(PaneContext);
  const collapsible = useInAccordion();
  const d = useDisclosure(typeof title === "string" ? title : undefined, open ?? false);
  const id = typeof title === "string" ? title : "";
  const register = pane?.register;
  const paneIcon = icon ?? PANE_ICON[id] ?? CONCEPT_ICON.section;
  useLayoutEffect(() => (register && id ? register({ id, title, icon: paneIcon }) : undefined), [register, id, paneIcon]); // eslint-disable-line react-hooks/exhaustive-deps
  if (pane && id) {
    if (pane.active !== id) return null;
    return (
      <section className="block card-pane" role="tabpanel" aria-label={id}>
        <SectionHead right={right}>{title}</SectionHead>
        {/* Sections inside a section are laid out as usual. */}
        <PaneContext.Provider value={null}>
          <NoAccordion>{children}</NoAccordion>
        </PaneContext.Provider>
      </section>
    );
  }
  if (!collapsible) {
    return (
      <section className="block">
        <SectionHead right={right}>{title}</SectionHead>
        {children}
      </section>
    );
  }
  return (
    <section className={`block foldable${d.open ? " open" : ""}`}>
      <div className="sec-head">
        <button type="button" className="sec-toggle" aria-expanded={d.open} onClick={d.toggle}>
          <h2>
            {title}
          </h2>
          {summary != null && <span className="sec-summary">{summary}</span>}
          <Icon name={CONCEPT_ICON.down} className="sec-caret" />
        </button>
        {right && <div className="sec-head-right">{right}</div>}
      </div>
      <Collapse open={d.open}>
        <div className="block-body">{children}</div>
      </Collapse>
    </section>
  );
}

/** A row of key numbers. */
export function Tiles({ children }: { children: ReactNode }) {
  return <div className="tiles compact">{children}</div>;
}

export function Tile({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {note && <span className="tile-note">{note}</span>}
    </div>
  );
}

/** A thin bar for a share (0-1): HP, magic left. Low shares turn red, middling amber. */
export function Meter({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tone = pct <= 30 ? "bad" : pct <= 60 ? "warn" : "good";
  return (
    <span className={`meter ${tone}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </span>
  );
}

/** A list of selectable rows (battles, runs). */
export function RowList({ children }: { children: ReactNode }) {
  return <ul className="row-list">{children}</ul>;
}

/** One row of a RowList: a lead chip, a title and facts; selecting it opens the thing (`open` says how). */
export function ListRow({
  selected,
  onClick,
  lead,
  title,
  facts,
  open,
}: {
  selected: boolean;
  onClick: () => void;
  lead?: ReactNode;
  title: ReactNode;
  facts?: ReactNode;
  open?: string;
}) {
  return (
    <li>
      <button type="button" className={`list-row item ${selected ? "selected" : ""}`} onClick={onClick} aria-pressed={selected}>
        {lead}
        <span className="list-row-title">{title}</span>
        {facts && <span className="list-row-facts">{facts}</span>}
        {open && (
          <span className="list-row-open">
            {open} <Icon name={CONCEPT_ICON.next} />
          </span>
        )}
      </button>
    </li>
  );
}

/** What to do when there's nothing to show yet. */
export function EmptyState({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      {title && <p className="empty-title">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

/** A small key/value list for a DetailCard ("Class: Swordmaster"). */
export function Facts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="profile-rows facts">
      {rows.map(([k, v], i) => (
        <div key={i} className="fact">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
