# Recorded battle and run statistics

This bounded specification follows the Spec Kit specification/acceptance pattern; this checkout has no installed Spec Kit integration. It changes no reader schema.

## Contract

- A battle's standing timeline and `BattleUnit` metrics describe that battle only. The reader subtracts pre-battle lifetime fight/kill counters. Known counters win over log observations; never take the larger value, which can retain undone actions.
- Damage, damage taken, healing given/received and movement come from the backend's standing-history replay (or its explicitly estimated fight recorder). Do not add the timeline to those totals. Map movement is recorded Manhattan distance, not a path-length claim. Stat points sum positive gains excluding movement.
- Stable army keys identify characters across battles. Display names are labels, and enemy pool slots are battle-local. Explicit actor/target IDs win; legacy entries without IDs resolve only unambiguous army keys or enemy labels, never a guessed name match.
- Missing metrics remain null, displayed as a dash. Most totals are null if any contributing metric is unknown; the run's damage, healing and movement totals instead add what was recorded and are marked partial when any battle lacked it (null only when nothing was recorded). Available observations remain visible in breakdown rows. Log-only fight/kill counts describe recorded actions and can be incomplete. Turn charts are recorded observations, not counter reconstructions.
- Run scope includes completed battles. Deduplicate by battle ID and exclude any stale copy of a battle that resumed. Sort newest first before character aggregation. No undone branches enter standing totals.
- Battle Share opens the in-battle popup. Standouts may open a clearly labeled whole-run character card. History's Battles and Characters Stats buttons open run-wide summaries directly, without navigating to a recording.

## Acceptance

- Synthetic public-aggregation tests compare the same unit and battle scope across tally, Share rows, army totals, character totals and run totals for live, finished, rewound and incomplete recordings.
- Tests cover counter/log disagreement, identical display names, explicit IDs, legacy identity ambiguity, live/history duplication, unknown versus zero, positive growth and large histories.
- History dialogs retain loading/error/empty states and fit desktop 16:9/16:10 with internal table scrolling, large text, keyboard dismissal/focus return and reduced motion.
- More Stats removes the requested redundant copy, uses numeric comparisons with `Avg`, replaces Magic left with numeric Stat increases, and centers only Standouts' controls on a compact translucent surface.
