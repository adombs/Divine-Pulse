# Maintaining the repository

For the maintainer. Contributors need only [the contributing guide](../.github/CONTRIBUTING.md); releases are in
[the release guide](releasing.md).

## Who does what

[adombs](https://github.com/adombs) is the only maintainer: reviewing and merging pull requests, triage, security
reports, conduct reports and releases.

## Reviewing a pull request

CI runs the checks from CONTRIBUTING on GitHub's machines, without game files or secrets. A first-time contributor's
run waits for your approval, so read the change first, especially anything under `.github/`, `tools/` or `packaging/`
and any new dependency. A pull request's own version of the workflow is what runs.

CI can't test against real game data. To do that, check the change out and run it on your PC, which holds your game
files, only once you trust it; use a separate Windows account or Windows Sandbox if you're unsure:

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
| `main-pull-requests.json` | Changes to `main` go through a pull request that passes CI, with a straight history | Repository admins |
| `release-tags.json` | A `v*` tag can't be moved or deleted | Nobody |

No approvals are required, because GitHub doesn't let you approve your own pull request. Admins can skip the pull
request rule because `tools/release.py` pushes its version commit directly to `main`. To change that, make the release
script open a pull request first. The required checks are named after the jobs in `.github/workflows/ci.yml`, so change
both together.

GitHub offers these rules on a private repository only with GitHub Pro. On a free plan they apply once the repository
is public.

```
gh api --method POST repos/adombs/Divine-Pulse/rulesets --input .github/rulesets/main-history.json
gh api --method POST repos/adombs/Divine-Pulse/rulesets --input .github/rulesets/main-pull-requests.json
gh api --method POST repos/adombs/Divine-Pulse/rulesets --input .github/rulesets/release-tags.json
```

## Going public

Going public shows everything on every branch, including the first commit, and every pull request's commits and
description, even closed ones with deleted branches. Before it:

1. Merge or close every open pull request, and delete branches you don't want seen.
2. Put a contact address on your GitHub profile: [the code of conduct](../.github/CODE_OF_CONDUCT.md) sends reports there.
3. Decide whether you're comfortable publishing this. It's a fan tool that reads a commercial game's memory, documents
   its file formats, works with an emulator, and can extract a player's NSPs using their own keys. It ships no game
   content, but consider asking a lawyer: only one can tell you about your risk.
4. Check [the third-party notices](third-party-notices.md) once more against what the app bundles.
5. Run a secret scanner over every ref, pull requests included, and clear **Security → Dependabot** alerts:

   ```
   git clone --mirror https://github.com/adombs/Divine-Pulse.git divine-pulse-audit.git
   gitleaks git divine-pulse-audit.git --log-opts="--all" --redact
   ```

Then turn on the protections that depend on it, in this order. Actions runs only GitHub's own pinned actions, with a
read-only token, and every outside contributor's run needs your approval:

```
gh repo edit adombs/Divine-Pulse --visibility public --accept-visibility-change-consequences
gh api --method PUT repos/adombs/Divine-Pulse/private-vulnerability-reporting
gh api --method PUT repos/adombs/Divine-Pulse/actions/permissions -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true
gh api --method PUT repos/adombs/Divine-Pulse/actions/permissions/selected-actions -F github_owned_allowed=true -F verified_allowed=false
gh api --method PUT repos/adombs/Divine-Pulse/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false
gh api --method PUT repos/adombs/Divine-Pulse/actions/permissions/fork-pr-contributor-approval -f approval_policy=all_external_contributors
```

Turn on secret scanning, push protection and Dependabot security updates under **Settings → Advanced Security**.

Check each one rather than assuming it worked:

1. Open a test pull request. Both CI checks should run and pass; apply the rules above only after they have, so the
   required names are known to match. Then a direct push to a test branch should work, and a force-push to `main`
   should be refused.
2. From a second account, fork and open a pull request. The run should wait for your approval and then pass without
   secrets. Open a private report under **Security** from that account too, then close both.
3. Publish a release built from current `main` ([release guide](releasing.md)), after the source is public, so
   the program and its source are available together. Every release so far is a draft and invisible to the public, so
   the README's download link leads nowhere until then. Don't publish older drafts: delete them.
4. In a private browser window, signed out, open the README, CONTRIBUTING, the license, both issue forms and the
   release downloads.
