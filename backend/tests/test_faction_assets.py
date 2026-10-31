"""Keep the imported native faction table and generic army pennants complete."""

import pytest

from app.infrastructure.game_assets import game_assets

pytestmark = pytest.mark.needs_game_import


def test_named_and_generic_native_allegiances():
    data = game_assets().json("data/factions.json")
    characters = {row["id"]: row["allegiance"] for row in data["characters"]}
    factions = {row["id"]: row["name"] for row in data["factions"]}
    # Person IDs from fixed_persondata: lords, Agarthans, thief, Western soldier, Church knight, rogue.
    expected = {2: 1, 3: 2, 4: 3, 38: 4, 400: 9, 407: 6, 408: 0, 409: 11}
    for character, faction in expected.items():
        assert characters[character] == faction
    # 23 has no game text; the app names it itself.
    assert all(faction in factions or faction == 23 for faction in characters.values())


def test_native_army_pennants_exist():
    for name in ("army-player", "army-enemy", "army-ally", "army-third", "agarthans", "other"):
        assert game_assets().path(f"images/houses/{name}.png") is not None


def test_native_crests_keep_presence_and_both_identities():
    data = game_assets().json("data/crests-by-person.json")
    characters = {row["id"]: row["crests"] for row in data["characters"]}
    assert characters[0] == [21]
    assert characters[2] == [24, 21]
    assert characters[22] == [38, 9]
    assert not characters.get(5)
    assert all(86 not in crests for crests in characters.values())
