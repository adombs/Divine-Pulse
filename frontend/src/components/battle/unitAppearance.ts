import type { BattleUnit, EnemyStats } from "../../api";

type Unit = Pick<BattleUnit | EnemyStats, "class_id" | "class_name" | "weapon" | "inventory">;
let crystalWeapons = new Set<number>();

/** The minimap uses the item's crystal flag independently of its combat skill. */
export function indexCrystalWeapons(rows: { id: number; raw?: string }[]): void {
  crystalWeapons = new Set(rows.filter((r) => /^[0-9a-f]{32,}$/i.test(r.raw ?? "") && (parseInt(r.raw!.slice(30, 32), 16) & 0x80) !== 0).map((r) => r.id));
}

/** Recover the crystal icon for recordings made before the reader preserved that distinction. */
export function battleWeapon(unit: Pick<Unit, "weapon" | "inventory"> | undefined): string {
  const kind = unit?.weapon ?? "";
  if (kind === "crest-stone" || ["reason", "faith", "dark"].includes(kind)) return kind;
  const inventory = unit?.inventory ?? [];
  const equipped = inventory.find((item) => item.equipped && item.kind === "weapon")
    ?? inventory.find((item) => item.kind === "weapon" && item.uses > 0);
  return equipped && crystalWeapons.has(equipped.id) ? "crest-stone" : kind;
}

/** Standard and experimental Demonic Beasts occupy four tiles. Other monsters need their own dimensions. */
export function mapSpan(unit: Pick<Unit, "class_id" | "class_name"> | undefined): number {
  if (unit?.class_id != null) return unit.class_id === 63 || unit.class_id === 64 ? 2 : 1;
  return /^(?:Exp\. )?Demonic Beast$/i.test(unit?.class_name ?? "") ? 2 : 1;
}

/** Older imports already contain this native Crest Stone Shard icon. */
export const CRYSTAL_ITEM_ICON = "images/icons/items-native/204.png";
