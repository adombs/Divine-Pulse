"""What a read of the game costs. A battle is read ten times a second, so each read has to stay cheap: these count the
slow things (file checks, name searches, rebuilding a sample nothing changed in) instead of timing them, so they
don't depend on the machine."""

import threading

import pytest

from app import names
from app.bonuses import BonusTable
from app.classes import tidy_class
from app.config import BONUSES_FILE
from app.gamemem.units import GameData
from app.infrastructure import game_assets, game_tables
from app.infrastructure.game_assets import GameAssets
from helpers.synthetic_roster import SLOT_OF
from test_memory_mode import FakeMemory, LYSITHEA_SLOT, MAG, FakePoolUnit, scanner  # noqa: F401


@pytest.fixture
def stamp_reads(monkeypatch):
    """How many times the table files' modification times were read."""
    reads = []
    original = GameAssets._read_data_stamp

    def counting(self, manifest, language):
        reads.append(language)
        return original(self, manifest, language)

    monkeypatch.setattr(GameAssets, "_read_data_stamp", counting)
    return reads


def test_table_files_are_checked_once_a_second_not_on_every_lookup(fake_import, monkeypatch, stamp_reads):
    monkeypatch.setattr(game_assets, "DATA_STAMP_TTL_S", 1000.0)
    game_tables.generation()
    for _ in range(50):
        game_tables.generation()
    assert len(stamp_reads) == 1
    monkeypatch.setattr(game_assets, "DATA_STAMP_TTL_S", 0.0)  # a second later
    game_tables.generation()
    assert len(stamp_reads) == 2


def test_a_new_import_or_language_is_noticed_at_once(fake_import, monkeypatch, stamp_reads):
    monkeypatch.setattr(game_assets, "DATA_STAMP_TTL_S", 1000.0)
    language = ["ENG_U"]
    fake_import.language = lambda: language[0]
    before = game_tables.generation()
    language[0] = "GER"
    assert game_tables.generation() != before and len(stamp_reads) == 2
    manifest = fake_import.root / "manifest.json"
    manifest.write_text(manifest.read_text("utf-8") + "\n", encoding="utf-8")  # a reimport rewrites it
    assert game_tables.generation() != before and len(stamp_reads) == 3


def test_a_read_looks_the_tables_up_once(fake_import, monkeypatch):
    looks = []
    original = game_tables._generation
    monkeypatch.setattr(game_tables, "_generation", lambda: looks.append(1) or original())
    with game_tables.pinned():
        for _ in range(20):
            game_tables.generation()
        with game_tables.pinned():  # blocks nest: the outer one counts
            game_tables.generation()
    assert len(looks) == 1
    game_tables.generation()
    game_tables.generation()
    assert len(looks) == 3  # outside a block every lookup checks


def test_a_pinned_generation_is_only_this_threads(fake_import):
    seen = []
    with game_tables.pinned():
        pinned = game_tables.generation()
        thread = threading.Thread(target=lambda: seen.append(game_tables.generation()))
        thread.start()
        thread.join()
    assert seen == [pinned]  # the same here, since nothing changed; the pin itself isn't shared
    assert getattr(game_tables._pin, "generation", None) is None


def test_the_next_read_sees_what_changed_during_the_last(fake_import):
    before = game_tables.memory()["items"]["1000"]
    with game_tables.pinned():
        (fake_import.root / "data/items.json").write_text("{broken", encoding="utf-8")
        assert game_tables.memory()["items"]["1000"] == before  # this read keeps the tables it started with
    with pytest.raises(game_assets.GameAssetError, match="data/items.json"):
        game_tables.memory()


def test_an_ability_name_is_matched_once(roster_import, monkeypatch):
    matched = []
    original = names.snap
    monkeypatch.setattr(names, "snap", lambda *args: matched.append(args[0]) or original(*args))
    data = GameData.load()
    ability = next(name for name in data.abilities if name)
    first = data.known_ability(ability)
    for _ in range(10):
        assert data.known_ability(ability) == first
    assert matched == [ability]
    GameData.load().known_ability(ability)  # another import or language is another GameData
    assert matched == [ability, ability]


def test_a_class_name_and_a_bonus_name_are_matched_once(roster_import, monkeypatch):
    matched = []
    original = names.best_match
    monkeypatch.setattr(names, "best_match", lambda *args: matched.append(args[0]) or original(*args))
    for _ in range(10):
        tidy_class("Mercenari")
    assert matched == ["Mercenari"]
    bonuses = BonusTable.load(BONUSES_FILE)
    matched.clear()
    for _ in range(10):
        bonuses.compute(["Not An Ability At All"])
    assert matched == ["Not An Ability At All"]


def reads_built(scanner, monkeypatch):  # noqa: F811
    built = []
    original = scanner._build_sample
    monkeypatch.setattr(scanner, "_build_sample", lambda *args: built.append(1) or original(*args))
    return built


def test_a_battle_nothing_changed_in_is_not_rebuilt(scanner, monkeypatch):  # noqa: F811
    scanner.memory.in_battle = (19, 22)
    scanner.memory.battle_units = lambda: [FakePoolUnit(217, 16, 77)]
    built = reads_built(scanner, monkeypatch)
    for _ in range(4):  # the second read applies the roster, which saves the run
        scanner._tick()
    assert len(built) >= 1
    settled = len(built)
    for _ in range(10):
        scanner._tick()
    assert len(built) == settled and scanner.current_battle() is not None


def test_a_change_in_the_game_or_the_run_rebuilds_the_battle_sample(scanner, monkeypatch):  # noqa: F811
    from app.domain.units import Unit

    pool = [FakePoolUnit(217, 16, 77)]
    scanner.memory.in_battle = (19, 22)
    scanner.memory.battle_units = lambda: pool
    built = reads_built(scanner, monkeypatch)
    for _ in range(4):
        scanner._tick()
    settled = len(built)

    from dataclasses import replace

    pool[0] = replace(pool[0], hp=3)  # a unit on the map lost HP
    scanner._tick()
    assert len(built) == settled + 1

    scanner.memory.roster[LYSITHEA_SLOT * 0x24C + MAG] += 1  # a level up
    scanner._tick()
    assert len(built) == settled + 2

    scanner.store.put_unit(scanner.run_id, "lysithea", Unit(name="Lysi", game_id=22))  # the player renamed a unit
    scanner._tick()
    assert len(built) == settled + 3
    assert SLOT_OF[22] == LYSITHEA_SLOT
