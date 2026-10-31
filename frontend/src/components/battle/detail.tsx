/** Sections the unit and enemy cards share: combat totals, who it fought, and its fights and actions. */
import { CONCEPT_ICON } from "../../icons/concepts";
import type { ReactNode } from "react";
import { Section } from "../layout";
import { plural } from "../../format";
import { Item, involves, opponents } from "./model";
import { ItemList, Num, WhoLink } from "./parts";
import { Icon } from "../Icon";

export function CombatTiles({
  fights,
  defeats,
  dealt,
  taken,
  extra = [],
}: {
  fights: number | null;
  defeats: number | null;
  dealt: number | null;
  taken: number | null;
  extra?: [string, number | null, string?][];
}) {
  const rows: [string, number | null, string?][] = [
    ["Fights", fights], ["Killed", defeats], ["Dealt", dealt, "damage"], ["Taken", taken, "damage"], ...extra,
  ];
  return (
    <dl className="combat-totals">
      {rows.map(([label, value, note]) => <div key={label} title={note}><dt>{label}</dt><dd><Num value={value} /></dd></div>)}
    </dl>
  );
}

/** Everyone `id` fought: fights, damage each way, and who defeated whom. */
function Opponents({ items, id }: { items: Item[]; id: string }) {
  const rows = opponents(items, id);
  return (
    <>
      <h3 className="card-subtitle">Opponents</h3>
      {rows.length === 0 ? (
        <p className="muted">No fights yet.</p>
      ) : (
        <table className="mini-table">
          <thead>
            <tr>
              <th className="left">Against</th>
              <th title="Fights between them">Fights</th>
              <th title="Damage dealt to them">Dealt</th>
              <th title="Damage taken from them">Taken</th>
              <th className="left">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td className="left">
                  <WhoLink id={o.id} />
                </td>
                <td>{o.fights}</td>
                <td>{o.dealt}</td>
                <td>{o.taken}</td>
                <td className="left">
                  {o.outcome === "won" ? (
                    <span className="outcome won">
                      <Icon name={CONCEPT_ICON.defeat} /> killed
                    </span>
                  ) : o.outcome === "lost" ? (
                    <span className="outcome lost">
                      <Icon name={CONCEPT_ICON.fell} /> killed by
                    </span>
                  ) : (
                    ""
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** The latest of `id`'s fights and actions, and a button for the rest. */
export function FightsAndActions({ items, id, totals }: { items: Item[]; id: string; totals?: ReactNode }) {
  const mine = items.filter((i) => involves(i, id) && !i.heading);
  return (
    <Section title="Fights and actions" icon={CONCEPT_ICON.actions} summary={mine.length ? plural(mine.length, "entry", "entries") : "Nothing yet"}>
      {totals}
      <Opponents items={items} id={id} />
      <h3 className="card-subtitle">Recent actions</h3>
      <div className="recent-actions-list"><ItemList items={mine} /></div>
    </Section>
  );
}
