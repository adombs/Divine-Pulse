/**
 * A skill rank as the game draws it: the circled letter of the skills screen (E grey to S red, with its "+"), and a
 * picker of all twelve.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { WEAPON_RANKS } from "../reference/weaponRanks";
import { GameImage } from "./GameImage";
import "./rank-icon.css";

export const rankIconPath = (rank: string) => `images/icons/ranks/${rank.toLowerCase().replace("+", "-plus")}.png`;
const known = (rank: string | undefined | null): rank is string => !!rank && (WEAPON_RANKS as readonly string[]).includes(rank);

/** A rank's icon; anything that isn't a rank ("+2") stays text, and no rank is a dash. */
export function RankIcon({ rank, title }: { rank: string | undefined | null; title?: string }) {
  if (!known(rank)) return <span className="rank-icon none" title={title}>{rank || "—"}</span>;
  return <GameImage className="rank-icon" imported={rankIconPath(rank)} alt={rank} title={title ?? rank} draggable={false} />;
}

/** Choose a rank: a button showing it, opening the twelve in a grid. Left and Right step it without opening. */
export function RankPicker({ value, onChange, label }: { value: string; onChange: (rank: string) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const id = `ranks-${useId().replace(/[^\w-]/g, "")}`;
  const at = WEAPON_RANKS.indexOf(value as (typeof WEAPON_RANKS)[number]);
  const step = (by: number) => onChange(WEAPON_RANKS[Math.max(0, Math.min(WEAPON_RANKS.length - 1, (at < 0 ? 0 : at) + by))]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(`#${id}`) && e.target !== button.current) setOpen(false);
    };
    const move = () => setAnchor(button.current?.getBoundingClientRect() ?? null);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", move, true);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("scroll", move, true); };
  }, [open, id]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); step(1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); step(-1); }
    else if (e.key === "Escape" && open) { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setOpen(false); }
  };
  const pick = (rank: string) => { onChange(rank); setOpen(false); button.current?.focus(); };
  return (
    <>
      <button
        ref={button}
        type="button"
        className="rank-picker"
        aria-label={`${label}: ${value || "none"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${label} (← → to change)`}
        onClick={() => { setAnchor(button.current?.getBoundingClientRect() ?? null); setOpen((o) => !o); }}
        onKeyDown={onKey}
      >
        <RankIcon rank={value} title="" />
      </button>
      {open && anchor && createPortal(
        <div
          id={id}
          className="rank-menu"
          role="listbox"
          aria-label={label}
          style={{ top: anchor.bottom + 4, left: Math.max(8, Math.min(anchor.left - 80, window.innerWidth - 230)) }}
        >
          {WEAPON_RANKS.map((r) => (
            <button key={r} type="button" role="option" aria-selected={r === value} className={r === value ? "on" : ""} onClick={() => pick(r)} title={r}>
              <RankIcon rank={r} title="" />
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
