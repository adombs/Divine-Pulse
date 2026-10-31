/** What each stat does in Three Houses, for hover explanations. */
export const STAT_INFO: Record<string, { name: string; text: string }> = {
  hp: { name: "HP", text: "Hit points. The unit falls when they reach 0." },
  mv: { name: "Movement", text: "How many spaces the unit can move each turn." },
  str: {
    name: "Strength",
    text: "Damage with weapons and physical combat arts. Every 5 Str also cancels a point of a weapon's weight, which would otherwise slow the unit down.",
  },
  mag: { name: "Magic", text: "Damage with spells and magic combat arts, and how much white magic heals." },
  dex: { name: "Dexterity", text: "Hit rate with weapons, and half of critical chance (with Luck)." },
  spd: {
    name: "Speed",
    text: "Attack speed: 4 or more above the foe's lets the unit attack twice. Attack speed is also the unit's Avoid against weapons.",
  },
  lck: {
    name: "Luck",
    text: "Critical avoid (the foe's chance to crit you). Also half of critical chance, and part of hit and avoid with magic.",
  },
  def: { name: "Defense", text: "Reduces damage taken from weapons and physical arts." },
  res: { name: "Resistance", text: "Reduces damage taken from magic." },
  cha: { name: "Charm", text: "Gambit damage and hit rate. Gambits are the battalion attacks that don't get counterattacked." },
  ebst: {
    name: "eBST",
    text: "Effective base stat total: the unit's offense stat + defense stat (per their Offense / Defense types) plus whichever of HP, Mv, Dex, Spd, Lck and Cha are switched on, divided by how many of those went in. A quick measure of how well a unit fights.",
  },
};
