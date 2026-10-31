# Checking the fight estimates

The Battle page lists every fight. When the game's own history (the list behind the Divine Pulse screen) can be read,
the fights come from it. When it can't, the tracker works the fights out from HP changes and the combat math
(`backend/app/gamemem/combat.py`, `pairing.py`) and marks each with how sure it is. This page says how to measure
those estimates against the real history while you play. It needs FE3H 1.2.0 running in Eden; the tracker only reads
the game's memory.

The automated tests (`backend/tests/test_combat.py`, `test_pairing.py`, `test_battle.py`, `test_history.py`) run
without the game.

## Shadow check

The tracker works the fights out while it also reads the history, and compares the two when the battle ends. Turn on
**Settings → Testing → Check Fight Estimates**, or start the tracker with `DIVINE_PULSE_PAIRING_CHECK=1`, and play a
battle to the end. Include single attacks, a kill, a unit attacked more than once in one enemy phase, and a Divine
Pulse.

When the battle ends, `pairing-checks/<run>-<battle>.json` appears in the data folder. Its `summary` has
`history_fights`, `worked_out`, `pair_right`, `attacker_right`, `missed` and `right_by_confidence`. For each fight
with `"right": false`, the turn, units and confidence say where to look in the game's Divine Pulse list.

Expect almost every fight to pair right, and wrong attackers only at low confidence. Fights from before the tracker
started count as `missed`, and a Divine Pulse can leave undone fights in `worked_out`.

A battle read only counts once two reads in a row agree, so **Settings → Battles → Battle read interval** decides how
many fights land between two counted reads. Try a few values.

## Battle page without the history

Turn on **Settings → Testing → Ignore the History** (or `DIVINE_PULSE_HIDE_HISTORY=1`) and play a few attacks. The
action log should then have one line per fight with a percentage, and damage, defeats and the units table should match
the game. Turn it off again: the next read rebuilds the log from the history, with no percentages.

## Adding a test

Behaviour confirmed this way belongs in the tests. Use made-up units and numbers; don't commit captures from your
game (see [the contributing guide](../.github/CONTRIBUTING.md)). `DIVINE_PULSE_CAPTURES` points the optional capture-based tests at
captures from your own game.
