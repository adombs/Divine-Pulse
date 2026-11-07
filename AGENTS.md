# Divine Pulse project instructions

Read this file, [CONTRIBUTING](.github/CONTRIBUTING.md), and [UI design](docs/ui-design.md) before changing the app.
Include the relevant rules in delegated work. These maintainer decisions persist between sessions; update them
when the maintainer states a reusable preference instead of leaving that preference only in a chat or private notes.

## UI decisions

- This is a desktop application. Work on and review **16:9 and 16:10 views only**, using 1600×900 and 1600×1000
  as representative approval sizes. Do not implement, polish, test, or capture phone/mobile views unless the
  maintainer explicitly requests them. Keep ordinary browser behavior intact without expanding the task into
  mobile work.
- Keep the interface concise. Do not add unsolicited subtitles, repeated counts, instructional hints, or footer
  explanations. History statistics must not show comparison count subtitles, "Select a column to compare",
  search/totals explanations, or a permanent "Not fully recorded" legend. Unknown values retain their explicit
  sentinel and accessible reason, rather than becoming zero.
- In History's Character Stats, show the native character sprite to the left of the character name. Center numeric
  column headings, values, and totals. Battle Stats uses the same battle-type colours as History for main,
  auxiliary, paralogue, and DLC battles.
- Label the Battalion's 1–5 level selector **Level**. Its stat bonuses are modifiers; do not confuse those values
  with a battalion level.
- Required game artwork comes from the player's import. Never substitute initials, unrelated icons, different
  portraits/sprites, or recreated game artwork for a missing required asset. Report an error or unavailable state.

## Review and delivery

- After UI changes, inspect the actual final application at both desktop aspect ratios. Save selected screenshots
  from final code in a clearly named private approval folder, and provide its path and direct image links before
  asking to merge. Do not make the maintainer search test logs or hidden evidence folders for approval images.
- Keep screenshot folders limited to current selected images with simple names. Do not mix rejected or obsolete
  captures into the approval set. Game files and screenshots containing game content must stay out of Git.
- Follow the contribution guide's branch, PR, changelog, lint, tests, and build requirements. Ordinary PRs target
  the active `release/*` branch; update the appropriate open PR for review corrections. Push and prepare the PR when ready.
  Do not merge or release without the maintainer's explicit authorization.
- Do not add coauthor attribution trailers to commits.
