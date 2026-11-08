# Backend HTTP API contracts

The HTTP boundary lives in `backend/app/interface/`: `api.py` defines routes, `inputs.py` validates request bodies,
and `responses.py` shapes response models. `backend/app/main.py` mounts the router. The frontend's manually
maintained TypeScript client and API types are in `frontend/src/api.ts`.

## Contract rules

- Treat the Python request and response models as the server contract. Keep the TypeScript types and client methods
  aligned when a route or payload changes; they are intentionally maintained by hand, not generated.
- Request body models reject unknown fields. Preserve the validation and normalization rules in `inputs.py` when
  changing a field, and keep the UI's corresponding input validation aligned.
- Keep interface concerns in this layer. Business operations belong in `backend/app/application/`; domain models
  must not depend on FastAPI or frontend types.
- Add or update focused tests in `backend/tests/test_api_contracts.py` for observable route, validation, status-code,
  and response-shape changes. Run the backend suite for the complete check.

Useful routes include `/api/runs`, `/api/runs/{run_id}/units`, `/api/settings`, `/api/battle`, `/api/events` (SSE),
`/api/memory/check`, `/api/health`, and `/api/quit` (quits the app after answering with its `pid`, for the uninstaller's
`--quit`; 404 when no window is attached). The route declarations and contract tests are authoritative for the complete
surface; this guide intentionally does not duplicate every payload schema.

## Local access

The server listens on loopback only, and `backend/app/interface/security.py` rejects what a web page in the
player's browser could send it: a `Host` that isn't `127.0.0.1`, `localhost` or `[::1]`, an `Origin` that isn't the
address the request came in on, and (for `/api`, `/game-assets` and any non-GET request) a `Sec-Fetch-Site` from
another site. Programs that send none of those headers pass on `Host` alone. Add tests to
`backend/tests/test_api_security.py` when changing this.

## Units

Each unit in `GET /api/runs/{run_id}/units` carries `death`: null while alive, else `{battle_id, battle_name, scenario,
turn, step, t, by, manual, at}`, where it fell (the battle's "fell" log entry) and whether the user marked it dead by hand
(`battle_id` and the rest null when no fall of it was recorded). `marked_alive` is true when the user said the unit is
alive although the game marks it dead. Runs saved before these fields load with `death` null and `marked_alive` false. `PUT /api/runs/{run_id}/units/{key}/dead`
`{dead}` marks a unit dead (linked to its latest fall that stood, if any) or alive, and answers with the unit; 404 for an
unknown run or unit. The tracker takes deaths from the game's "Is Dead" roster flag, as `backend/app/domain/deaths.py`
describes.

## Battle

Battle `enemy_stats` entries include `person_id`, the person-data row for named and generic units, or null when unavailable. Older saved battles without the field load with null.

Battle `units` and `enemy_stats` entries include `allegiance`, the faction ID on the unit's battle record (`data/factions.json`), read on every poll so a reveal that changes it shows during the battle; null when not read. Older saved battles without the field load with null.

## Game assets (imported from the user's dump)

Assets extracted by `app.gamefiles` live in `GAME_ASSETS_DIR` (`infrastructure/paths.py`: `DIVINE_PULSE_GAME_ASSETS`,
else `<data folder>/game-assets` installed, `<repo>/game-assets` from source). `infrastructure/game_assets.py` is the
only reader; callers treat missing assets as not imported yet.

| Route | Result |
|---|---|
| `GET /api/game-assets/status` | `{available, folder, version, dlc, created, files, families, skipped, outdated, languages, job}`. With no import, the response includes `available`, `folder`, and `job`. The job includes `state`, `phase`, `done`, `total`, and `error`. |
| `POST /api/game-assets/scan` `{dump}` | What the folder holds: `{romfs, exefs, build, version, supported, dlc: {name: path \| null}, parts, importable, problems}`; a missing base has `romfs: null` and a problem entry |
| `POST /api/game-assets/import` `{dump}` | 202 `{job}`; extracts into a temporary folder beside `GAME_ASSETS_DIR`, verifies it, then swaps it in, so a failed import keeps the old assets; 409 while a job runs; 400 for an unsupported build |
| `POST /api/game-assets/import-nsps` `{nsps, keys, keep_dumps?}` | 202 `{job}`. Extracts the selected NSPs using the player's keys and imports the verified outputs. An optional new `keep_dumps` directory retains the raw extraction on success. |
| `POST /api/game-assets/verify` | `{ok, checked, errors, warnings}` (lists capped at 200) |
| `POST /api/game-assets/pick-folder` | `{path}` from the desktop folder dialog, `{path: null}` if cancelled; 501 outside the desktop window |
| `POST /api/game-assets/pick-nsps`, `POST /api/game-assets/pick-keys` | Native file dialogs returning `{paths}` for the selected packages and `{path}` for the keys file. |
| `DELETE /api/game-assets` | Removes the imported folder; 409 while a job runs |
| `GET /game-assets/{path}` | A file listed in the manifest (404 otherwise), with an `ETag` from its manifest hash |

`parts` contains one entry each for `base`, `update`, `exefs`, and each DLC title ID. Each entry is
`{id, name, found, path, detail, required}`: `path` and `detail` are strings or null, while `found` and
`required` are booleans. `detail` describes the detected update or build when known. `importable` is a boolean;
`problems` is a list of explanations when an identified part prevents import.

The event stream sends `game_assets` events with the status (including `job`) whenever a job progresses or the
assets change. The frontend reads files through `frontend/src/gameAssets.ts`.
