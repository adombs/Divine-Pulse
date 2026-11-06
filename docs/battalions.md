# Battalion integration

The importer supplies reference data; the memory reader supplies an unconfirmed assignment observation. These are
separate inputs. Importing a battalion's level progression does not establish the assigned battalion's current level
or whether its modifiers apply in combat.

## Assignment contract

The run's unit keeps `battalion` (the last named observation) and optional `battalion_id`. The ID distinguishes
duplicate names and survives language changes. Older saved runs without an ID remain readable. A named observation
updates the pair; an unresolved imported name leaves the stored pair alone. An empty string represents the legacy
reader's observation of no assignment and clears the ID. A missing observation (`None` in readings) does not clear it.
The scanner waits for two matching snapshots before applying changes and refreshes imported names when the import
or selected game language changes, even if the roster bytes have not changed.

New battle unit payloads retain `battalion` and `battalion_id` independently of later roster updates, including saved
battles and run/battle export and import. Null means the assignment was not recorded or was unknown; empty string
means observed without an assignment. The This Battle character panel uses that battle's recorded assignment;
This Run keeps the current roster assignment. Older battles show an unknown assignment and are never backfilled
from today's roster. Reference details still resolve by the recorded ID first, including translated names; runtime
level, endurance and remaining gambit uses are not copied from the roster into historical panels. These recorded
assignments do not manufacture a gambit action or replay step.

## Evidence boundary

The legacy reader treats roster `+0x18` (u16, `0xFFFF` for no assignment) as a marker and `+0x1E` (u8) as a battalion
ID. These locations are **unconfirmed**: the original observation has not been independently reproduced with
recorded before/after assignment and removal states. Retaining the candidate ID does not raise its confidence. The
character panels continue to label assignments unconfirmed. Synthetic tests establish decoding and preservation
behavior only; they cannot validate the game's memory layout.

Before using the assignment for combat math, capture two independent ground-truth states with different known
assignments, plus removal, and compare the candidate fields against the visible in-game selections. Current
battalion level, endurance, remaining gambit uses and runtime modifier adjustments also need independently verified
fields. No such fields or combat effects are enabled here. The battle history does not yet have a verified gambit
action decoder. Native gambit icons and directional targeting footprints remain unavailable.

## Imported reference

The existing extractor reads battalion modifiers and five-level progression from `fixed_data.bin` section 11,
gambit attack parameters from section 3 and use counts from section 8. It exports battalion icons selected from the
native atlas; gambit icons and areas are omitted when unverified. Old imports may contain only names, descriptions
and endurance. Reimporting adds the available reference fields.

The frontend resolves an assignment by ID first. If that ID is absent from the current import, it does not attach
another row's details just because the name matches. Older name-only assignments retain loose name matching when
the result is unambiguous. Battalion and gambit text follow the selected game language with imported text as the
fallback. Without a current battalion level, displayed modifiers are explicitly level 1 reference values.
