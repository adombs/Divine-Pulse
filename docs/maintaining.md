# Maintaining the repository

For the maintainer. Contributors need only [the contributing guide](../.github/CONTRIBUTING.md); releases are in
[the release guide](releasing.md).

## Reviewing a pull request

This project has no CI, so nothing runs a contributor's code for you. Read the change before running it on your PC,
then check it out and run the checks from CONTRIBUTING:

```
gh pr checkout <number>
```

Look for game files as well as bugs: `backend/tests/test_no_game_content.py` catches most, not all. Merge with
**Squash and merge**, the only method turned on. The pull request's title becomes the commit message, so correct it
first if it doesn't follow the naming rules.

## Triage

New issues arrive labelled `needs triage`. For each one:

1. Replace `needs triage` with an `area:` label, and `needs reproduction` if it can't be acted on yet.
2. Add `priority: high` if it breaks tracking, loses data, or affects most players.
3. Mark small, self-contained ones `good first issue`.

## Branch and tag rules

The rules are in `.github/rulesets/`. GitHub doesn't read that folder by itself: apply them with the commands below.

| File | What it does | Who can skip it |
|---|---|---|
| `main-history.json` | `main` can't be deleted or force-pushed | Nobody |
| `main-pull-requests.json` | Changes to `main` go through a pull request, with a straight history | Repository admins |
| `release-tags.json` | A `v*` tag can't be moved or deleted | Nobody |

No approvals are required, because GitHub doesn't let you approve your own pull request, and no status checks are
required, because there is no CI. Admins can skip the pull request rule because `tools/release.py` pushes its version
commit directly to `main`. To change that, make the release script open a pull request first.

GitHub offers these rules on a private repository only with GitHub Pro. On a free plan they apply once the repository
is public.

```
gh api --method POST repos/adombs/Divine-Pulse/rulesets --input .github/rulesets/main-history.json
gh api --method POST repos/adombs/Divine-Pulse/rulesets --input .github/rulesets/main-pull-requests.json
gh api --method POST repos/adombs/Divine-Pulse/rulesets --input .github/rulesets/release-tags.json
```

## Going public

Going public shows everything on every branch, including the first commit. Before it:

1. Merge or close every open pull request, and delete branches you don't want seen.
2. Put a contact address on your GitHub profile: [the code of conduct](../.github/CODE_OF_CONDUCT.md) sends reports there.
3. Decide whether you're comfortable publishing this. It's a fan tool that reads a commercial game's memory, documents
   its file formats and works with an emulator. It ships no game content, but consider asking a lawyer: only one can
   tell you about your risk.
4. Check [the third-party notices](third-party-notices.md) once more against what the app bundles.

Then:

```
gh repo edit adombs/Divine-Pulse --visibility public --accept-visibility-change-consequences
gh api --method PUT repos/adombs/Divine-Pulse/private-vulnerability-reporting
```

Turn on secret scanning and push protection under **Settings → Advanced Security**, and apply the rules above. Try
each rule: a direct push to a test branch should work, and a force-push to `main` should be refused.

The README tells players to download the latest release, and this repository has none yet, so publish one
([release guide](releasing.md)).
