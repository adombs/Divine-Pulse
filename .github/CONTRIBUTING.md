# Working on Divine Pulse

For player-facing behavior see [README](../README.md); use this guide to contribute.
Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Divine Pulse is GPL-3.0: by contributing, you
agree that your work is released under that license.

Found a bug or have an idea? Open an issue first, so nobody spends time on something that won't fit. Security problems
go through [the security policy](SECURITY.md), not an issue.

## Prerequisites

Windows 10/11 and macOS 12+ (Apple silicon) are both supported for development, running from source and building
releases, with the same steps. Each needs:

| | Windows | macOS |
|---|---|---|
| Python | 3.12 or newer (python.org; the `py` launcher finds it) | 3.12 or newer (`brew install python@3.13`; macOS's own `python3` is 3.9) |
| Node.js | 22.12+ or 24.x (24.15 has been verified) | the same (`brew install node`) |
| System tools | none; [Inno Setup 6](https://jrsoftware.org/isinfo.php) only for building the installer | Xcode's command-line tools (`xcode-select --install`): the memory reader helper is compiled and signed locally |
| Git, and the GitHub CLI for releases | yes | yes |

The locked Vite version accepts Node `^20.19.0 || >=22.12.0`; the native TypeScript test scripts also need Node's
`--experimental-strip-types`, so use Node 22.12+ or 24.x rather than an earlier Node 20 release. Without Inno Setup,
the Windows portable archive can still be built.

App builds contain no game data and fetch none. Installing Python and Node dependencies may require network access.

## Local setup

The setup scripts take the same steps, in the same order, on both systems: they find Python 3.12+ and Node.js 22.12+,
create `backend/.venv` with the runtime dependencies, build the macOS memory reader (Windows needs nothing), build the
frontend, and put a *Divine Pulse (source)* shortcut on the desktop. Run them again after pulling changes. The launch
scripts check that setup ran and the frontend is built, then start the app from `backend/`.

| | Windows | macOS |
|---|---|---|
| Set up | `tools\setup.bat` | `tools/setup.sh` |
| Start | the desktop shortcut, or `tools\launch.bat` | the desktop shortcut, or `tools/launch.sh` |
| The project's Python | `backend\.venv\Scripts\python` | `backend/.venv/bin/python` |

Setup doesn't install the development test and lint dependencies; install those as below before running checks. To
set up by hand (`<python>` is the project's Python from the table):

```
cd backend
python -m venv .venv            # python3.13 -m venv .venv on macOS
<python> -m pip install -r requirements-dev.txt
cd ../frontend
npm ci
npm test
npm run build
```

Source-mode data is stored in the repository's `data/` directory; set `DIVINE_PULSE_DATA_DIR` to use another location.
Run the desktop app from the `backend` folder with `<python> -m app` after building the frontend. On macOS, the memory
reader's tests read a real process: allow developer tools once (`sudo DevToolsSecurity -enable`), or they wait on a
password prompt.

## No game files in the repository

Never commit game files: no images, text, tables, raw game bytes or memory captures from the game, and no dump of
it. Players import their own dump, and the only images in the repository are the project's own brand files. The test
`backend/tests/test_no_game_content.py` (rules in `tools/game_content.py`, also applied to the release zip by
`tools/release.py`) fails when a tracked file looks like game content. Test data is synthetic: made-up names and
rows.

Keep personal dumps, NSPs, keys, captures and imported assets outside Git. Use the app's **Game files** screen to
import for local testing. To run the desktop app from the source checkout, use the shortcut created by setup or the
launch script. Tracking needs FE3H v1.2.0 in Eden (Windows) or Astris (macOS).

## Optional test inputs

CI runs the checks on Windows and macOS, each with Python 3.12 and 3.14, and a release build on each, which it unzips,
starts and quits (`tools/smoke_app.py`) and keeps for a week as the run's artifacts; all use synthetic data and project
files. To run additional local tests, set the appropriate
environment variable and run pytest from the backend directory with the project's Python.

| Variable | Points at |
|---|---|
| DIVINE_PULSE_GAME_ASSETS | A directory containing an already imported game and its manifest.json |
| DIVINE_PULSE_GAME_DUMP | An extracted FE3H v1.2.0 dump |
| DIVINE_PULSE_CAPTURES | Private recorded test fixtures |
| DIVINE_PULSE_TEST_PACKAGED_DIR | A built Windows program folder. Inno Setup 6 is required for these tests. |

To try a release build as CI does, build it and run `python tools/release.py check` (the files, their checksums and
the game-content scan) and `python tools/smoke_app.py` (unzips, starts and quits it) on either system.

Use DIVINE_PULSE_DATA_DIR to keep source experiments away from your real runs.

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
   explicitly so the commands do not depend on whichever Python happens to be on `PATH` (`<python>` is
   `.venv\Scripts\python` on Windows, `.venv/bin/python` on macOS):

```
cd backend
<python> -m ruff check --config pyproject.toml . ../tools ../packaging
<python> -m pytest -q
cd ../frontend
npm test
npm run build
```

`ruff check ... --fix` fixes most lint findings itself. Lint rules are in `backend/pyproject.toml`.

Backend responsibilities and extension examples are in [Backend architecture](../docs/BACKEND_ARCHITECTURE.md).
The backend tests enforce layer dependency direction; run `<python> -B architecture.py` from `backend/`
for that check alone.

## Releasing

Only a maintainer runs a release. Merge the reviewed release or hotfix branch into `main` through a pull request,
then follow [the release guide](../docs/releasing.md) to tag and publish the tested commit: `tools/release.py
finalize` runs on Windows and on a Mac, each building and adding its own files to the same draft.
