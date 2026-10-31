# The battle minimap's atlas

FE3H 1.2.0. Texture 10 of the battle UI atlas (DATA1 entry 6050; 6050-6061 are the same atlases per language, this
texture has no text), 1024 x 512, holds the battle minimap's pieces and a few of the unit info panel's. The rects are the game's, read from the player's ExeFS `main` by the importer (they are not written to a file); the labels and evidence below are by sprite id.

## How this was worked out

- **Rects: the game's own.** The rects aren't in the romfs. The main program has the battle UI's sprite table at
  main + 0xd588d0: 295 records of 16 bytes (u16 texture width, height, texture, id, x, y, w, h), id = index, texture 10
  = ids 201-280. The atlas object's `getRect(id)` (main + 0x6a8600) returns table + 4 + 16 x id. Code asks for sprites
  by a global id: 1464 + id for this atlas (main + 0x5c5540 splits global ids by atlas).
- **Uses: the code that draws the minimap** (main + 0x10a000-0x10dc00, disassembled from a dump of main). It walks the 32 x 32 map cells (0x30 bytes each, rows of 0x600) and units, and picks
  sprites by terrain ID, cell flags and unit fields; the addresses are in the table.
- **Terrain colours: the game's own minimaps.** The game doesn't paint terrain tile by tile: it draws a pre-rendered
  minimap of the map (main + 0x10a888, loader main + 0x69bf40, file DATA1 entry 6122, or `nx/ui/still/minimap.bin` in
  patch 4 with the Cindered Shadows maps). That pack holds 48 G1T images, 24 px per tile with the map's tile (0, 0) at
  (72, 72). Image n is map n (0-36), maps 38-41 are images 44-47; 37-43 are other states of maps 7, 13, 14, 21, 22, 6
  and 18, picked by a flag (minimap object + 0x30544) not located (the importer uses the image that matches the map's terrain: map 18
  takes image 43). Every image matches our terrain for its map (99-100% of tiles), and every tile colour in them is one
  of the atlas's swatches 201-212, matched colour for colour: that gives which terrain gets which tile
  (the importer writes it as minimap terrain data, and the app draws these images when it knows the map).

Confidence: *proven (code)*: read from the code that draws it; *proven (colour match)*: exact colour match against the
game's minimaps; *inferred*: where and how it's drawn is proven, what it means is our reading; *unknown*: not drawn by
the minimap, or the flag behind it isn't known.

## Every sprite

| ID | Rect (x, y, w x h) | What | Where the game uses it | Confidence |
| --- | --- | --- | --- | --- |
| 201 | 992, 0, 32 x 32 | Heal tile | Per-map minimap tile for heal tiles, forts, thrones, pray stones (terrain 18, 22, 35, 40, 59) | proven (colour match) |
| 202 | 992, 72, 32 x 32 | Impassable tile (white) | Per-map minimap tile for impassable terrain: walls, pillars, statues, altars, coffins (terrain 0, 20, 34, 45, 63, 75, 93, 98, 109-113) | proven (colour match) |
| 203 | 992, 36, 32 x 32 | Forest tile | Per-map minimap tile for forest, woods, light thicket (terrain 3, 4, 25) | proven (colour match) |
| 204 | 144, 392, 32 x 32 | Thicket tile | Per-map minimap tile for thicket (terrain 24) | proven (colour match) |
| 205 | 992, 108, 32 x 32 | Sand tile | Per-map minimap tile for desert and beach (terrain 5, 73) | proven (colour match) |
| 206 | 800, 368, 32 x 32 | Fliers-only tile (dark grey) | Per-map minimap tile for terrain only fliers cross: rock, mountain, walls, ramparts, rubble, lava, cliffs, houses, valleys, edifices (terrain 8, 9, 13, 16, 19, 21, 29, 37, 42-44, 47, 65, 74, 77, 87, 102) | proven (colour match) |
| 207 | 836, 368, 32 x 32 | Hazard tile (red) | Per-map minimap tile for fiery floor and craters (terrain 52, 54, 55) | proven (colour match) |
| 208 | 968, 372, 32 x 32 | Shoal tile | Per-map minimap tile for shoal (terrain 70) | proven (colour match) |
| 209 | 600, 384, 32 x 32 | Water tile | Per-map minimap tile for river, sea, lake, pond, channel, raised bridge (terrain 6, 11, 71, 72, 83, 86) | proven (colour match) |
| 210 | 180, 392, 32 x 32 | Floor tile (grey) | Per-map minimap tile for indoor floor, tiles, doors, gates (terrain 12, 17, 27, 107, 108). Plains, grass, bridges, stairs, outdoor floor have no tile: the bare grid | proven (colour match) |
| 211 | 216, 392, 32 x 32 | Siege weapon tile (purple) | Per-map minimap tile for ballistae, onagers, fire orbs (terrain 60, 61, 67) | proven (colour match) |
| 212 | 252, 392, 32 x 32 | Cover tile (khaki) | Per-map minimap tile for wardwood, cover, Avo floor (terrain 56-58) | proven (colour match) |
| 213 | 288, 392, 32 x 32 | Cyan marked tile | Drawn on map cells with cell flag +0x24 bit 5 (0x10ba5c). What the flag means isn't known | unknown |
| 214 | 600, 348, 32 x 32 | Pink marked tile | Drawn on map cells with cell flag +0x24 bit 6 (0x10ba50). What the flag means isn't known | unknown |
| 215 | 636, 348, 32 x 32 | Movement range (blue) | Range overlay on cells with flags +0x26 & 0x41 (0x10b824); blue is the game's movement range | proven (code) |
| 216 | 800, 340, 24 x 24 | Range panel cell | One cell of a unit's range pattern in the info panel, drawn over the grid panels 220-222 (0x5d4074); not the minimap | proven (code) |
| 217 | 672, 348, 32 x 32 | Attack range (red) | Range overlay on cells with flags +0x26 & 0x06 (0x10b808); the red cursor 242 also tests these bits | proven (code) |
| 218 | 108, 392, 32 x 32 | Assist range (green, outlined) | Range overlay on cells with flags +0x26 & 0x18, or 0x20 under a unit (0x10b7fc). Green is the game's staff and assist range (meaning inferred) | proven (code) |
| 219 | 752, 0, 136 x 136 | Minimap frame | The minimap's ornate purple frame, drawn as a 9-slice with 16 px borders (0x10a510) | proven (code) |
| 220 | 0, 0, 530 x 242 | Grid panel (large) | Background of the unit range panel (0x115b98 and others). The importer cuts one 24 px cell of it as the map grid: the per-map minimaps have the same grid baked in | proven (code) |
| 221 | 532, 0, 218 x 146 | Grid panel (small) | Background of the unit range panel (0x5d3e24) | proven (code) |
| 222 | 0, 244, 530 x 146 | Grid panel (wide) | Background of the unit range panel (0x5d3dc4) | proven (code) |
| 223 | 892, 0, 96 x 96 | White chevron | Drawn in the unit range panel (0x5d4168), likely marking the unit's own place | inferred |
| 224 | 852, 140, 32 x 32 | Unit badge, player (blue) | A unit on the minimap: badge 224 + team (unit +0xF1: 0 player, 1 enemy, 2 ally, 3 third army) (0x10c174) | proven (code) |
| 225 | 992, 144, 32 x 32 | Unit badge, enemy (red) | As 224, team 1 | proven (code) |
| 226 | 900, 300, 32 x 32 | Unit badge, ally (green) | As 224, team 2 | proven (code) |
| 227 | 968, 336, 32 x 32 | Unit badge, third army (yellow) | As 224, team 3 | proven (code) |
| 228 | 952, 200, 64 x 64 | Large unit badge, player | 228 + team for units with flag +0xD7 bit 4, drawn over 2 x 2 or 3 x 3 tiles (0x10c224): large monsters (inferred). Also in the range panel (0x5d3ef8) | proven (code) |
| 229 | 952, 268, 64 x 64 | Large unit badge, enemy | As 228, team 1 | proven (code) |
| 230 | 832, 300, 64 x 64 | Large unit badge, ally | As 228, team 2 | proven (code) |
| 231 | 900, 336, 64 x 64 | Large unit badge, third army | As 228, team 3 | proven (code) |
| 232 | 892, 100, 96 x 96 | 96 px badge, blue | Not drawn by the minimap; used elsewhere in the battle UI (0x20e14c, 0x281160 ...) | unknown |
| 233 | 752, 140, 96 x 96 | 96 px badge, red | Not drawn by the minimap | unknown |
| 234 | 532, 148, 96 x 96 | 96 px badge, green | Not drawn by the minimap | unknown |
| 235 | 632, 148, 96 x 96 | 96 px badge, yellow | Not drawn by the minimap | unknown |
| 236 | 636, 384, 32 x 32 | Yellow outlined square | Per-tile marker on a multi-tile unit, colour by unit byte +0x105 (other values) (0x10c6f4); likely its barrier (inferred) | proven (code) |
| 237 | 672, 384, 32 x 32 | Orange outlined square | As 236, byte +0x105 = 0 (0x10c6cc) | proven (code) |
| 238 | 0, 392, 32 x 32 | Green outlined square | As 236, byte +0x105 = 2 (0x10c764) | proven (code) |
| 239 | 36, 392, 32 x 32 | Cyan outlined square | As 236, byte +0x105 = 1 (0x10c6e0) | proven (code) |
| 240 | 72, 392, 32 x 32 | Black cracks | Per-tile marker on a multi-tile unit when that tile's flag is off (0x10c7e4); likely a broken barrier (inferred) | proven (code) |
| 241 | 732, 340, 64 x 64 | Map cursor | The tile cursor on the minimap (0x10dbc0) | proven (code) |
| 242 | 532, 348, 64 x 64 | Attack target cursor (red) | Replaces 241 when the cursor's cell is in attack range (flags +0x26 & 0x06) and holds a unit that can be attacked (0x10dbb0) | proven (code) |
| 243 | 852, 200, 96 x 96 | Gold diamond, blue gem | Blinks in place of the weapon glyph (243 + team) on units with flag +0xD7 bit 3 (0x10c104). What the flag means isn't known | proven (code) |
| 244 | 732, 240, 96 x 96 | Gold diamond, red gem | As 243, team 1 | proven (code) |
| 245 | 532, 248, 96 x 96 | Gold diamond, green gem | As 243, team 2 | proven (code) |
| 246 | 632, 248, 96 x 96 | Gold diamond, yellow gem | As 243, team 3 | proven (code) |
| 247 | 324, 392, 32 x 32 | Boot (infantry) | Movement-type icon, not drawn by the minimap (0x24fd08 ...); infantry / armored / cavalry / flying by shape | inferred |
| 248 | 360, 392, 32 x 32 | Helmet (armored) | As 247 | inferred |
| 249 | 396, 392, 32 x 32 | Horse (cavalry) | As 247 | inferred |
| 250 | 432, 392, 32 x 32 | Wing (flying) | As 247 | inferred |
| 251 | 468, 392, 32 x 32 | Bridge post | Drawn on bridge tiles (terrain 10, 72) on map 35 only (0x10ad30) | proven (code) |
| 252 | 800, 404, 32 x 32 | Door | Tile icon for terrain 17 Door, 72 raised Bridge, 107 Abyss Gate (0x10aca4) | proven (code) |
| 253 | 836, 404, 32 x 32 | Gear (device) | Tile icon for terrain 51 Lever, 108 Magic Seal (0x10aa50) | proven (code) |
| 254 | 872, 404, 32 x 32 | Crest Stone | Tile icon for terrain 78 Crest Stone, dimmed (alpha 0x99) once its cell's +0x20 is -1 (used) (0x10ab04) | proven (code) |
| 255 | 908, 404, 32 x 32 | Spiked crest (trap) | Tile icon for terrain 50 Floor Trap, 64 Viskam (0x10ace4) | proven (code) |
| 256 | 708, 408, 32 x 32 | Chest (full) | Tile icon for terrain 46 Chest while its cell's +0x20 isn't -1 (0x10aaa4) | proven (code) |
| 257 | 744, 408, 32 x 32 | Chest (opened) | Tile icon for terrain 46 Chest once its cell's +0x20 is -1 (0x10ab8c) | proven (code) |
| 258 | 944, 408, 32 x 32 | Breakable wall | Tile icon for terrain whose terrain record +8 (wall HP) is 1 or more (0x10aac8) | proven (code) |
| 259 | 980, 408, 32 x 32 | Warp tile | Tile icon for terrain 69 Warp Floor, or cell flag +0x25 bit 1 (0x10adc8) | proven (code) |
| 260 | 504, 416, 32 x 32 | Path, straight | Drawn by the minimap (0x10d2ec ...): the movement path arrow's pieces, by shape | inferred |
| 261 | 540, 416, 32 x 32 | Path, corner | As 260 | inferred |
| 262 | 576, 420, 32 x 32 | Path, end | As 260 | inferred |
| 263 | 612, 420, 32 x 32 | Path, arrowhead | As 260 | inferred |
| 264 | 648, 420, 32 x 32 | Orange target ring | Not drawn by the minimap | unknown |
| 265 | 0, 428, 32 x 32 | Down chevron | Replaces the weapon glyph when 0x5be900 says so for the unit's cell (0x10c1d0), and drawn at 0x10c55c, 0x10c894, 0x10d6b8. What it means isn't known | proven (code) |
| 266 | 36, 428, 32 x 32 | Heart | Drawn as many times as the larger of two unit bytes (0x10d9f8); likely a monster's HP bars (inferred) | proven (code) |
| 267 | 72, 428, 32 x 32 | Dark tile (fog) | Covers cells with flag +0x27 bit 2, where no tile icons are drawn (0x10b454), and terrain 66 (0x10aaf4); fog of war (inferred) | proven (code) |
| 268 | 108, 428, 32 x 32 | Sword | Weapon glyph on a badge: weapon type 0 (and any type outside 1-7) (0x5d9108) | proven (code) |
| 269 | 144, 428, 32 x 32 | Lance | Weapon glyph, type 1 (table at main + 0x1486970, indexed by the item's type - 1) | proven (code) |
| 270 | 180, 428, 32 x 32 | Axe | Weapon glyph, type 2 | proven (code) |
| 271 | 216, 428, 32 x 32 | Bow | Weapon glyph, type 3 | proven (code) |
| 272 | 252, 428, 32 x 32 | Fist | Weapon glyph, type 4 (brawling), and units with no weapon (0x10c0c4) | proven (code) |
| 273 | 288, 428, 32 x 32 | Tome, filled (Faith) | Weapon glyph, type 6 (Faith) | proven (code) |
| 274 | 324, 428, 32 x 32 | Tome, outlined (Reason) | Weapon glyph, type 5 (Reason) | proven (code) |
| 275 | 360, 428, 32 x 32 | Tome, tagged (dark magic) | Weapon glyph, type 7 (dark magic) | proven (code) |
| 276 | 396, 428, 32 x 32 | Crystal | Weapon glyph for items with flag +0xF bit 7, whatever their type (0x5d9100); likely monster weapons (inferred) | proven (code) |
| 277 | 432, 428, 32 x 32 | Green check | Not drawn by the minimap | unknown |
| 278 | 468, 428, 32 x 32 | Red exclamation | Not drawn by the minimap | unknown |
| 279 | 992, 180, 28 x 4 | HP bar fill | A unit's HP under its badge (0x10cb2c), tinted by team: player (78, 203, 255), enemy (255, 141, 122), ally (102, 255, 82), third (255, 251, 133), else white | proven (code) |
| 280 | 852, 176, 32 x 8 | HP bar background | Black bar the fill sits in (0x10ca20) | proven (code) |

## Drawn without the atlas

- rgb(192, 96, 96): Plain quad on cells with flag +0x27 bit 0 while the minimap's toggle at +0x3d52 is on (0x10af4c); the enemy danger area (inferred)
- rgb(192, 128, 64): Plain quad on cells with flag +0x27 bit 1 (0x10b1ac). Not known

## Still open

- What cell flags +0x24 bits 5 / 6 (213, 214), unit flag +0xD7 bit 3 (the gold diamonds 243-246), the chevron 265
  and +0x27 bit 1 (the orange quad) mean; why the per-tile markers 236-240 on multi-tile units change colour.
- 232-235, 247-250, 264, 277, 278 are used elsewhere in the battle UI, not looked into.
- Which state flag picks the other minimaps 37-43 (we pick by terrain; maps 6, 7, 13, 14, 21, 22 keep their own, 18
  takes 43).
- The app can't show what it doesn't read: movement / attack / assist ranges (215, 217, 218), the danger area, fog,
  large-unit badges, barriers, the path arrow.
