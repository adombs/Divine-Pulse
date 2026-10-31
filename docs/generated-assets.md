# Generated files

The repository holds no game-derived data. What the program shows from the game is built on the player's PC by the
importer (`backend/app/gamefiles`, see [game-assets/README.md](game-assets/README.md)) into a `game-assets/` folder
that git ignores, and read from there by `backend/app/infrastructure/game_assets.py` and the frontend's
`gameAssets.ts`.

Normal builds (`tools/build.py`, `npm run build`) need no game files and fetch nothing.

One file in the repository is generated:

| Output | Input | Refresh |
|---|---|---|
| `frontend/src/components/iconPaths.ts` | the installed `@phosphor-icons/core` package and the icon list in the script | from `frontend/`: `node scripts/build-icons.mjs` |

`frontend/src/reference/wiki/fe-wiki.json` is edited by hand and stays under GFDL 1.3; its sources and license are in
[its README](../frontend/src/reference/wiki/README.md).
