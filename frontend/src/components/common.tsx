import { CONCEPT_ICON } from "../icons/concepts";
import { ReactNode, useEffect, useRef, useState } from "react";
import { StatTip } from "./ui";
import { Icon } from "./Icon";
import { SpoilerCategory, useSpoiler } from "../spoilers";

export type Sort<K extends string> = { key: K; dir: 1 | -1 };

/** Sortable column headers: click to sort, click again to flip. Names sort A→Z first, numbers high→low. */
export function useSort<K extends string>(initial: Sort<K>, textKeys: K[] = []) {
  const [sort, setSort] = useState<Sort<K>>(initial);
  const toggle = (key: K) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: textKeys.includes(key) ? 1 : -1 }));
  const header = (key: K, label: ReactNode, opts: { title?: string; className?: string; stat?: string; note?: ReactNode } = {}) => (
    <th
      key={key}
      className={`${opts.className ?? ""} sortable ${sort.key === key ? "sorted" : ""}`}
      onClick={() => toggle(key)}
      title={opts.stat ? undefined : (opts.title ?? `Sort by ${typeof label === "string" ? label : key}`)}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
    >
      {opts.stat ? (
        <StatTip
          k={opts.stat}
          extra={
            <>
              {opts.note && <>{opts.note} </>}Click to sort.
            </>
          }
        >
          {label}
        </StatTip>
      ) : (
        label
      )}
      <span className="sort-arrow">{sort.key === key && <Icon name={sort.dir === 1 ? CONCEPT_ICON.up : CONCEPT_ICON.down} />}</span>
    </th>
  );
  return { sort, header };
}

export function compareValues(a: number | string, b: number | string): number {
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
}


/** Text hidden behind a click, for story reveals. */
export function Spoiler({ children, category = "crests" }: { children: ReactNode; category?: SpoilerCategory }) {
  const [open, setOpen] = useSpoiler(category);
  return open ? (
    <span className="spoiler-open">{children}</span>
  ) : (
    <button type="button" className="spoiler-btn" onClick={() => setOpen(true)} title="Story spoiler: click to show">
      Show spoiler
    </button>
  );
}

/** An inline link to another reference entry (class ↔ character). */
export function RefLink({ children, onClick, title }: { children: ReactNode; onClick?: () => void; title?: string }) {
  if (!onClick) return <>{children}</>;
  return (
    <button type="button" className="ref-link" onClick={(event) => { event.stopPropagation(); onClick(); }} title={title}>
      {children}
    </button>
  );
}

/**
 * A page's sub-pages: an underlined tab strip under the section header.
 */
export function SubTabs<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="sub-tabs" role="tablist" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} className={value === id ? "on" : ""} onClick={() => onChange(id)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** The chevron of an expandable table row (turns when open). */
export function RowCaret({ open }: { open: boolean }) {
  return <Icon name={CONCEPT_ICON.open} className={`row-caret${open ? " open" : ""}`} />;
}

/** A button that opens a small panel of extra options (filters); closes on an outside click or Escape. */
export function Dropdown({ label, badge, children, small }: { label: string; badge?: number; children: ReactNode; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      <button type="button" className={`btn${small ? " small" : ""} dropdown-btn ${badge ? "active" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
        {badge ? <span className="dropdown-badge">{badge}</span> : null}
        <Icon name={CONCEPT_ICON.down} className="caret" />
      </button>
      {open && <div className="dropdown-panel pop-in">{children}</div>}
    </div>
  );
}

export function Loading() {
  return <p className="muted">Loading reference data…</p>;
}

export function Sources({ sources }: { sources: { name: string; url: string }[] }) {
  return (
    <p className="muted small ref-sources">
      Data: {sources.map((s, i) => (
        <span key={s.url}>
          {i > 0 && " · "}
          {s.url === "game-files" ? s.name : <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>}
        </span>
      ))}
      . No internet needed.
    </p>
  );
}

/** "Select all that apply": a compact list of checkboxes. Nothing ticked means no filter. */
export function CheckList<T extends string>({
  label,
  options,
  value,
  onChange,
  columns = 1,
}: {
  label: string;
  options: readonly (readonly [T, ReactNode])[];
  value: T[];
  onChange: (v: T[]) => void;
  columns?: number;
}) {
  const toggle = (id: T) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <fieldset className="checklist">
      <legend>
        {label}
        {value.length > 0 && (
          <button type="button" className="checklist-clear" onClick={() => onChange([])}>
            Any
          </button>
        )}
      </legend>
      <div className="checklist-items" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {options.map(([id, text]) => (
          <label key={id} className={value.includes(id) ? "on" : ""}>
            <input type="checkbox" checked={value.includes(id)} onChange={() => toggle(id)} />
            <span>{text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function FilterChip({ children, onClear }: { children: ReactNode; onClear: () => void }) {
  return (
    <span className="filter-chip">
      {children}
      <button type="button" aria-label="Remove filter" onClick={onClear}>
        <Icon name={CONCEPT_ICON.close} />
      </button>
    </span>
  );
}

/**
 * The search box every list page uses. Matching is fuzzy (see fuzzy.ts searchMatches): small typos and
 * missing words still find things.
 */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <span className="search-box">
      <Icon name={CONCEPT_ICON.search} className="search-icon" />
      <input
        className="search"
        type="search"
        placeholder={placeholder}
        value={value}
        maxLength={60}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && value && (e.stopPropagation(), onChange(""))}
        aria-label={placeholder}
      />
      {value && (
        <button type="button" className="search-clear" aria-label="Clear search" onClick={() => onChange("")}>
          <Icon name={CONCEPT_ICON.close} />
        </button>
      )}
    </span>
  );
}

/**
 * The Filters button used on every page: its panel holds the page's filter fields, with a "Clear filters"
 * button whenever any is on. Active filters show as chips after the button (`chips`).
 */
export function FilterMenu({
  count,
  onClear,
  children,
  chips,
  label = "Filters",
  small,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
  chips?: ReactNode;
  label?: string;
  small?: boolean;
}) {
  return (
    <>
      <Dropdown label={label} badge={count} small={small}>
        {children}
        {count > 0 && (
          <button type="button" className="btn small" onClick={onClear}>
            Clear Filters
          </button>
        )}
      </Dropdown>
      {chips}
    </>
  );
}

/** "Nothing matches" under a list, with a way to undo the search and filters. */
export function NoMatches({ what, onReset }: { what: string; onReset?: () => void }) {
  return (
    <p className="muted no-matches">
      No {what} match the search and filters.
      {onReset && (
        <>
          {" "}
          <button type="button" className="link-btn" onClick={onReset}>
            Show Everything
          </button>
        </>
      )}
    </p>
  );
}

/** Removable chips for the ticked options of a CheckList. */
export function CheckChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly (readonly [T, ReactNode])[];
  value: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <>
      {value.map((id) => (
        <FilterChip key={id} onClear={() => onChange(value.filter((x) => x !== id))}>
          {options.find(([o]) => o === id)?.[1] ?? id}
        </FilterChip>
      ))}
    </>
  );
}

export { Segmented } from "./ui";
