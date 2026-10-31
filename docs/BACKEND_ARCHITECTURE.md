# Backend architecture

The backend is a local desktop companion, not a hosted service. It reads an emulator, maintains playthroughs in JSON files, serves the dashboard over loopback HTTP, and publishes live notifications. Keep those deployment assumptions unless a feature explicitly changes them.

## Responsibilities and dependencies

```text
HTTP / desktop / polling adapters -> application operations -> domain rules
infrastructure adapters ----------> application ports and domain values
composition.py -------------------> constructs and connects the layers
```

| Area | Owns | Must not own |
| --- | --- | --- |
| `app/domain/` | Units, runs, observations, change proposals, battle values, eBST setup and route rules | HTTP, files, process access, startup |
| `app/application/` | Complete run/unit/settings operations, roster commits and Undo, battle lifecycle/timeline coordination, dependency protocols | FastAPI, concrete stores, memory connections, file I/O |
| `app/infrastructure/` | JSON files, backup/recovery, resource paths, inventory/battle reference lookups, concrete runtime capabilities | HTTP handlers or response types |
| `app/interface/` | HTTP routing, request/response conversion, expected error mapping, optional desktop callback adaptation | Direct emulator or store access |
| `app/composition.py` | Construct stores/readers/operations and own their lifetime | Game calculations |

The existing `gamemem/` and `system/` packages are infrastructure adapters. `infrastructure/polling.py` obtains observations and coordinates scheduling/status while application and domain code own roster updates and battle rules. Existing helpers such as `names.py`, `roster.py`, and `bonuses.py` supply reference-data capabilities at the adapter boundary. Core domain/application code must not import those concrete helpers.

Top-level `handlers.py`, `inventory.py`, `battle.py`, `storage.py`, and `config.py` retain imports for existing callers. New core code should import the owning module.

## Data ownership

- `domain/units.py`: tracked unit facts and preferences, supported stat/skill keys and ranks.
- `domain/ebst.py`: eBST setup values (offense/defense types and toggled stats); `frontend/src/ebst.ts` does the calculation.
- `domain/readings.py`: observations. Missing observation fields retain their previous meaning; `None` and an observed empty collection are different.
- `domain/changes.py`: proposed before/after changes. A new game ID or changed source counts as a real change even when stats match.
- `domain/runs.py`: playthrough values and summaries. Schema version 1 is the currently supported format.
- `domain/battle.py` and `domain/combat.py`: battle facts, samples, identifiers, and pure rules. They do not read tables or memory.
- `interface/responses.py`: dashboard response fields and derived projections, including the declared battle response model.
- `infrastructure/saved_models.py`: validation and refresh of derived reference labels.

A game character ID identifies the game character. A unit dictionary key identifies the existing tracker record. A run slug identifies a saved playthrough. A battle pool slot identifies an observation within a battle. Do not substitute display names or one of these IDs for another.

Do not invent numeric restrictions just because the current decoder reads a narrow field. The decoder can validate its byte format while the domain retains broader legitimate values. Supported stat keys, skill ranks, eBST choices, and nonnegative character IDs are explicit contracts. Partial stat observations remain supported.

## A roster update

1. The polling adapter reads and stabilizes a memory snapshot.
2. The memory/reference adapters convert it into readings.
3. Domain handlers propose changes without writing files.
4. `application/roster_tracking.py` applies the proposed batch through its repository capability.
5. `RunStore.apply_units` performs one locked run update and one file replacement.
6. Only after saving succeeds does the scanner mark the snapshot applied, create Undo, and announce success.

A failed commit remains retryable. Undo uses the same complete-update boundary and retains its Undo record if saving fails. The operation lock serializes scanner updates and Undo; store locks protect individual persistence operations. This does not claim an atomic transaction across run, settings, and battle files.

Battle tracking receives a `BattleSupport` capability. Reference lookups, terrain lookup, fight estimation, and optional diagnostic writing are supplied by infrastructure. The tracker can operate on samples without opening an emulator connection.

## API, errors, and lifecycle

HTTP handlers invoke `BackendOperations`; they map expected application errors to the established 404/409 responses. Request validation remains readable and rejects unknown request fields. Unexpected errors continue to fail visibly rather than becoming successful empty results.

Repositories expose `MissingRecord`; the existing `NotFound` name remains a compatible infrastructure subtype. Persistence errors are not mislabeled as missing records. Settings are published in memory only after their file replacement succeeds.

`composition.build_runtime` shares the launcher's settings instance, builds concrete capabilities, and returns a typed runtime. FastAPI lifespan binds notifications, starts polling when enabled, and closes the runtime on exit. Stopping the reader joins its worker and closes its memory connection/recorder. Unexpected read errors wait for another polling interval instead of spinning.

Data-directory precedence, portable installs, bundled frontend paths, loopback hosting, and desktop/browser/server modes remain unchanged. Optional desktop callbacks are attached after the HTTP server starts, so their adaptation stays at the interface boundary.

## Saved data

Keep existing filenames, JSON keys, run/unit IDs, and calculations stable. Loading saved files refreshes derived weapon labels and orders eBST stat selections without rewriting the source.

An unreadable active battle is logged and preserved instead of being silently treated as a successful read. Do not discard unknown domain facts into plausible values without an explicit policy and a regression test.

Malformed saves and unsupported future schema versions are rejected. The source file is retained. Preserve raw game observations; unknown identity is not proof that a map record represents a real unit.

## Extending the backend

- **Add a game rule:** put the pure calculation or validation in domain; test meaningful examples and invalid states.
- **Add an operation:** coordinate domain values and small ports in application; test it with in-memory fakes, including failure ordering.
- **Add an API field:** define its input/output contract in the interface, delegate the operation, and verify serialized compatibility.
- **Change persistence:** update the infrastructure adapter; add backup, failure, and reload tests. Do not make domain depend on file layouts.
- **Add emulator support:** keep process/build/offset details in the existing memory infrastructure. Produce the same domain observations and run conversion fixtures.

Avoid adding a framework or an interface per method. Introduce a capability when an operation crosses an actual boundary or needs an independent test substitute.

## Checks

From `backend/`:

```text
python -B architecture.py
python -m ruff check --config pyproject.toml . ../tools ../packaging
python -m pytest -q
```

`tests/test_architecture.py` checks all new layer modules, including imports inside functions, and verifies the checker against prohibited examples. It is a lightweight dependency guard, not a full static type checker. It also rejects direct file operations in the domain/application layers.

Run focused tests while editing. Run the full backend suite and Ruff before opening a pull request; build the frontend if it changes. Use temporary data directories, never real saves or a live emulator, in automated tests. See `.github/CONTRIBUTING.md` for the workflow.
