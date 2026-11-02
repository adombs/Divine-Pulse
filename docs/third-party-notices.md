# Third-party notices

## Divine Pulse authorship and copyright

Divine Pulse was originally created by Adombs. Copyright (c) 2026 Adombs.
Divine Pulse is licensed under the GNU General Public License version 3 only; see `LICENSE.txt`.

Divine Pulse is a fan-made tool. It isn't affiliated with or endorsed by Nintendo, Intelligent Systems or Koei Tecmo.
*Fire Emblem: Three Houses* is © Nintendo / Intelligent Systems / Koei Tecmo.

## Game content

Divine Pulse contains no game content: no art, text, tables or maps. Players import their own game dump, and the
program builds everything it shows from it on their PC. The repository and the release are checked for this
(`tools/game_content.py`).

## NSP extraction tools

The installer includes extraction code from [NSP Unpacker](https://github.com/adombs/nsp-unpacker) (MIT, © 2026 adombs;
the license is included in the source). Windows releases include [NSTool](https://github.com/jakcron/nstool)
(MIT, © 2019 Jack). Its license and dependency notices ship in `tools/nstool-licenses/` alongside the program.
The executable's version, source, hashes and dependency revisions are recorded in `vendor/nstool/README.md`.

## Fire Emblem Wiki text

`frontend/src/reference/wiki/fe-wiki.json` holds class-change restrictions and support availability and notes, by Fire
Emblem Wiki contributors. Sources: [Class change](https://fireemblemwiki.org/wiki/Class_change)
([history](https://fireemblemwiki.org/w/index.php?title=Class_change&action=history)) and
[List of supports in Fire Emblem: Three Houses](https://fireemblemwiki.org/wiki/List_of_supports_in_Fire_Emblem:_Three_Houses)
([history](https://fireemblemwiki.org/w/index.php?title=List_of_supports_in_Fire_Emblem:_Three_Houses&action=history)).
Licensed under the GNU Free Documentation License 1.3; modified: reformatted and abridged. The data file remains under
GFDL 1.3 and is not covered by the application's GPL-3.0 license. The full license is
`frontend/src/reference/wiki/LICENSE-GFDL-1.3.txt` and ships with each release as `GFDL-1.3.txt` beside the program.

## Game mechanics and research

The combat model, fight estimates, stat bonuses, terrain kinds and the notes on reading the game's files and memory
draw on these community sources (cited where they're used, in the code and in `docs/`). Nothing is copied from them
except as noted below:

- [Fire Emblem Wiki](https://fireemblemwiki.org): terrain effects, battalions, class change, supports.
- [fe3h.com Linked Attacks guide](https://www.fe3h.com/linked_attacks).
- [Samurai Gamers](https://samurai-gamers.com/fire-emblem-three-houses/): terrain list, class abilities, class base
  stats, accessory list.
- [Corridors of Time, "On game mechanics"](https://corridorsoftime.substack.com/p/on-game-mechanics-pt-1): how hit
  rolls are averaged.
- [FE Universe randomizer thread](https://feuniverse.us/t/fire-emblem-three-houses-randomizer-custom-build/9774):
  the class table's mounted stat boosts.
- The [Three Houses Research Group](https://github.com/three-houses-research-team): the bsic map editor (its terrain
  list is the basis of `backend/app/data/terrain_kinds.json`) and the
  [010 Editor binary templates](https://github.com/three-houses-research-team/010-binary-templates) (game file
  formats).

### bsic (terrain kinds)

```
MIT License

Copyright (c) 2019 Three Houses Research Group

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of
the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Logo

- The Divine Pulse swirl (`branding/icons/` and `frontend/public/brand/`) is original artwork made for this
  project; no game artwork is used in it.
- The "DIVINE PULSE" wordmark in `frontend/public/brand/home-lockup-cream.png` is set in
  [Cinzel](https://fonts.google.com/specimen/Cinzel) by Natanael Gama. Cinzel is licensed under the SIL Open Font
  License 1.1, which allows its use in logos.

## Software bundled in the program

| Component | License |
|---|---|
| Python, typing-extensions | PSF License |
| FastAPI, Pydantic, Pydantic Core, annotated-types, annotated-doc, typing-inspection, Starlette, bottle, cffi | MIT |
| Uvicorn | BSD-3-Clause |
| Pillow | MIT-CMU |
| pywebview | BSD-3-Clause |
| pythonnet, clr-loader | MIT |
| pystray | LGPL-3.0 |
| websockets, python-dotenv, click, colorama, idna, proxy_tools, pycparser (Uvicorn, pywebview and clr-loader dependencies) | BSD-3-Clause |
| PyYAML, httptools, watchfiles, h11, anyio, six, setuptools | MIT |
| OpenTelemetry API (a FastAPI and Starlette dependency) | Apache-2.0 |
| packaging (the Python package) | Apache-2.0 or BSD-2-Clause |
| Microsoft WebView2 libraries (included with pywebview) | BSD-3-Clause |
| PyInstaller bootloader (starts the program) | GPL-2.0 with the bootloader exception, which allows bundling it with programs under any license |
| React, React DOM, scheduler | MIT |
| Fonts via Fontsource: EB Garamond, Cinzel, Cormorant Garamond, Alegreya, Spectral, Crimson Pro, Atkinson Hyperlegible | SIL Open Font License 1.1 |
| [Phosphor Icons](https://phosphoricons.com) (the app's icons; copyright 2023 Phosphor Icons) | MIT |

The Windows installer is built with [Inno Setup](https://jrsoftware.org/isinfo.php). The full license texts ship in
the `Third-party licenses` folder beside the program; the texts the packages don't carry themselves are in
`packaging/third-party-licenses/`. pystray (LGPL-3.0) is used unmodified and stored as compiled Python modules inside
`Divine Pulse.exe`. To use a modified copy, change it in your build environment and rebuild from this source with
`tools/build.py`.
