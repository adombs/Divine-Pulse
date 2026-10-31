# Native inventory icons

The inventory renderer at main `0x5D2950` passes the result of the sprite selector at `0x5D2A20` to the global rectangle draw routine. That sprite ID indexes a 16-byte record in the rectangle table at main `0xD52D60`; the records used here point into texture 2 of atlas 6026. The importer reads the table from the player's ExeFS in memory (nothing is written for it), crops the used tiles to `images/icons/items-native/<sprite hex>.png`, and writes `data/exe/item-icons.json`, which maps each weapon, spell, equipment and item ID to its sprite ID; the selector's sprites are IDs `0x1D4`-`0x225`.

Weapon, equipment, consumable, and spell rows intentionally share an image when the game's selector returns the same ID. For example, Aegis Shield, Ochain Shield, Thyrsus, and Iron Shield select `0x1EA`, `0x1E6`, `0x1EC`, and `0x1D4`, respectively; Iron Sword and Training Sword share `0x1FC`, while Thunderbrand selects `0x215`.

The item-row table includes Dragon Signs whose selector returns `0x7A + crest ID`; those records are on another atlas texture (texture 1) and are not part of the texture-2 native icon set, though the importer also crops them to `items-native/07a..08f.png`. Brokenness is based on live durability, so named weapons use their intact sprite except the game's explicit `Broken …` template rows.
