# Working on Divine Pulse

For player-facing behavior see [README](../README.md); for technical guides by audience see [docs](../docs/README.md).
Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Divine Pulse is GPL-3.0: by contributing, you
agree that your work is released under that license.

Found a bug or have an idea? Open an issue first, so nobody spends time on something that won't fit. Security problems
go through [the security policy](SECURITY.md), not an issue.

## Prerequisites

- Windows 10/11 for the supported development and release workflow.
- Python 3.12 or newer and Node.js 24.x on `PATH` (Node 24.15 has been verified). The locked Vite version accepts
  Node `^20.19.0 || >=22.12.0`; the native TypeScript test scripts also need Node's `--experimental-strip-types`,
  so use Node 22.12+ or 24.x rather than an earlier Node 20 release.
- Git. Inno Setup 6 is optional for local installer builds; without it, the Windows portable archive can still be
  built. The GitHub CLI is only needed when creating a draft release with the release script.

App builds contain no game data and fetch none. Installing Python and Node dependencies may require network access.

## Local setup

From the repository root, run `tools\setup.bat` on Windows. It creates `backend/.venv`, installs runtime dependencies,
builds the frontend, and creates a source shortcut. It does not install the development test and lint dependencies;
install those as shown below before running checks. To set up manually:

```powershell
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
cd ..\frontend
npm ci
npm test
npm run build
```

Source-mode data is stored in the repository's `data/` directory; set `DIVINE_PULSE_DATA_DIR` to use another location.
See [Development in the README](../README.md#development) for run commands and the battle demo.

## No game files in the repository

Never commit game files: no images, text, tables, raw game bytes or memory captures from the game, and no dump of
it. Players import their own dump, and the only images in the repository are the project's own brand files. The test
`backend/tests/test_no_game_content.py` (rules in `tools/game_content.py`, also applied to the release zip by
`tools/release.py`) fails when a tracked file looks like game content. Test data is synthetic: made-up names and
rows.

Your own import lives in `game-assets/` at the repository root, which git ignores (import it with the app's Game
files page or `python -m app.gamefiles extract "<dump folder>"` from `backend/`; see
[the importer guide](../docs/game-assets/README.md)).

## Optional test inputs

Public checks need no game files. Three environment variables enable more tests; without them those tests skip:

| Variable | Points at |
|---|---|
| `DIVINE_PULSE_GAME_ASSETS` | an import of your own game (the folder the importer wrote) |
| `DIVINE_PULSE_GAME_DUMP` | a dump of your own game |
| `DIVINE_PULSE_CAPTURES` | memory captures taken from your own game |

`DIVINE_PULSE_DATA_DIR` moves the data folder, which keeps experiments away from your real runs. Keep captures and
imports outside the repository.

## Naming

Every branch and pull request has one of these types:

| Type | For |
|---|---|
| `feature` | Something new a player can use |
| `fix` | Something that was wrong and now works |
| `docs` | Documentation only |
| `refactor` | Code changes that don't change behavior |
| `test` | Tests only |
| `chore` | Dependencies, build, release and repository upkeep |

| What | Form | Example |
|---|---|---|
| Branch | `<type>/<issue number>-<short-description>`, lower case with hyphens; leave out the number if there's no issue | `fix/42-hp-after-level-up` |
| Pull request title | `<type>: <what it does>`, starting with a verb, lower case | `fix: keep the HP after a level-up` |
| Bug issue title | What goes wrong | `Roster shows the wrong HP after a level-up` |
| Feature issue title | The change, starting with a verb | `Add a filter for units in reserve` |

Pull requests are squash-merged, so the title becomes the commit on the target branch. Put `Closes #42` in the
description to close the issue when it merges. Commits on your branch can be worded however helps you. Release
branches are named `release/<version>` and urgent hotfix branches `hotfix/<version>`.

## Day to day

1. The maintainer creates a `release/<version>` branch from `main` for the next release. Create ordinary changes on
   their own branches and open pull requests into that release branch. Feature, fix, docs, refactor, test and chore
   branches must not target `main`. Only a `release/*` or `hotfix/*` branch may be proposed to `main`; see
   [the release guide](../docs/releasing.md).
2. Add a line under `## Unreleased` in `CHANGELOG.md` for anything a player would notice.
3. Run the local checks before opening a pull request. CI runs the same ones on every pull request, with no game files.
   A first-time contributor's run starts once a maintainer has read the change and approved it. Use the project venv
   explicitly so the commands do not depend on whichever Python happens to be on `PATH`:

```
cd backend
.venv\Scripts\python -m ruff check --config pyproject.toml . ../tools ../packaging
.venv\Scripts\python -m pytest -q
cd ../frontend
npm test
npm run build
```

`ruff check ... --fix` fixes most lint findings itself. Lint rules are in `backend/pyproject.toml`.

Backend responsibilities and extension examples are in [Backend architecture](../docs/BACKEND_ARCHITECTURE.md).
The backend tests enforce layer dependency direction; run `.venv\Scripts\python -B architecture.py` from `backend/`
for that check alone.

## Releasing

Only a maintainer runs a release. Merge the reviewed release or hotfix branch into `main` through a pull request,
then follow [the release guide](../docs/releasing.md) to tag and publish the tested commit.
