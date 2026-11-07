"""Focused persistence compatibility and failure-contract tests."""

import json
import pytest

from app.config import SettingsStore
from app.infrastructure.persistence import BattleStore, RunStore
from app.domain.battle import Battle
from app.domain.battle import BattleUnitStats
from app.domain.ebst import EbstConfig
from app.domain.units import Unit
from helpers.saved_data import a_battle, saved_runs


@pytest.mark.parametrize("character", [0, 1])
@pytest.mark.parametrize("scenario,expected", [(9, "dark"), (10, "dark"), (11, "green"), (83, "dark")])
def test_saved_byleth_look_recovers_from_battle_story_without_rewriting_files(tmp_path, character, scenario, expected):
    store = BattleStore(tmp_path / "battles")
    byleth = BattleUnitStats(key="renamed", name="Professor", start_level=20, level=20, start={}, now={}, character=character, look="dark")
    battle = a_battle(scenario=scenario, units=[byleth])
    store.add(battle)
    store.save_active(battle)
    files = {p: p.read_bytes() for p in store.dir.glob("*.json")}
    assert store.list(battle.run_id)[0].units[0].look == expected
    assert store.load_active(battle.run_id).units[0].look == expected
    assert all(p.read_bytes() == original for p, original in files.items())


@pytest.mark.parametrize("scenario,finished,expected", [(9, True, "dark"), (10, False, "dark"), (10, True, "green"), (11, False, "green"), (83, True, "dark")])
def test_roster_retains_post_chapter_10_state_after_reload(tmp_path, scenario, finished, expected):
    runs, battles = RunStore(tmp_path / "runs"), BattleStore(tmp_path / "battles")
    runs.battles, battles.on_change = battles, runs.refresh_route
    run = runs.create("Test")
    runs.put_unit(run.id, "professor", Unit(name="Professor", game_id=1, look="dark"))
    battle = a_battle(run_id=run.id, scenario=scenario)
    if finished:
        battles.add(battle)
    else:
        battles.save_active(battle.model_copy(update={"ended_at": None}))
    restored = RunStore(runs.dir)
    restored.battles = battles
    unit = restored.get(run.id).units["professor"]
    assert unit.look == expected


def test_apply_units_batches_writes_and_preserves_new_unit_defaults(tmp_path, monkeypatch):
    store = RunStore(tmp_path / "runs")
    run = store.create("Test")
    defaults = EbstConfig(offense="physical", defense="magical", stats=["hp", "spd"])
    store.set_ebst(run.id, defaults)
    saves = []
    save = store._save
    monkeypatch.setattr(store, "_save", lambda updated: (saves.append(updated), save(updated))[-1])

    store.apply_units(run.id, {"byleth": Unit(name="Byleth"), "dedue": Unit(name="Dedue")})

    assert len(saves) == 1
    assert store.get(run.id).units["byleth"].ebst_config() == defaults
    assert store.get(run.id).units["dedue"].ebst_config() == defaults
    store.apply_units(run.id, {"missing": None})
    assert len(saves) == 1  # Undo may delete a key that is already absent.


def test_run_list_counts_finished_battles_and_names_the_latest_chapter(tmp_path):
    runs, battles = RunStore(tmp_path / "runs"), BattleStore(tmp_path / "battles")
    runs.battles, battles.on_change = battles, runs.refresh_route
    run = runs.create("Azure Moon")
    at = "2026-10-0{}T12:00:00Z".format
    battles.add(Battle(id="a", run_id=run.id, started_at=at(1), ended_at=at(1), scenario=9, map_name="Salvation at the Chapel"))
    battles.add(Battle(id="b", run_id=run.id, started_at=at(2), ended_at=at(2), scenario=52))  # a paralogue
    battles.save_active(Battle(id="c", run_id=run.id, started_at=at(3), scenario=10, map_name="The Sealed Forest Snare"))

    [summary] = runs.list()
    assert summary.battle_count == 2
    assert summary.last_chapter.model_dump() == {"scenario": 10, "name": "The Sealed Forest Snare"}

    [fresh] = RunStore(tmp_path / "runs").list()  # no battle files to read: nothing to count
    assert (fresh.battle_count, fresh.last_chapter) == (0, None)


def test_apply_units_does_not_replace_cached_run_when_save_fails(tmp_path, monkeypatch):
    store = RunStore(tmp_path / "runs")
    run = store.create("Test")
    before = store.get(run.id)

    def fail(_run):
        raise OSError("disk full")

    monkeypatch.setattr(store, "_save", fail)
    with pytest.raises(OSError, match="disk full"):
        store.apply_units(run.id, {"byleth": Unit(name="Byleth")})

    assert store.get(run.id).model_dump() == before.model_dump()


def test_settings_memory_changes_only_after_atomic_save(tmp_path, monkeypatch):
    store = SettingsStore(tmp_path / "settings.json")
    store.update(max_recordings=2)
    before = store.get()
    saved_before = store.path.read_bytes()

    def fail_replace(_source, _target):
        raise OSError("disk full")

    monkeypatch.setattr("app.infrastructure.json_files.os.replace", fail_replace)
    with pytest.raises(OSError, match="disk full"):
        store.update(max_recordings=3)

    assert store.get() == before
    assert store.path.read_bytes() == saved_before


def test_unreadable_active_battle_is_logged_and_preserved(tmp_path, caplog):
    store = BattleStore(tmp_path / "battles")
    path = store._active_path("run")
    path.parent.mkdir(parents=True)
    original = b"not valid battle JSON"
    path.write_bytes(original)

    assert store.load_active("run") is None

    assert "Could not read active battle" in caplog.text
    assert not path.exists()
    assert path.with_suffix(".broken.json").read_bytes() == original


def test_repeated_corrupt_active_battles_preserve_each_original(tmp_path):
    store = BattleStore(tmp_path / "battles")
    path = store._active_path("run")
    path.parent.mkdir()
    path.write_text("first broken battle", "utf-8")
    assert store.load_active("run") is None
    path.write_text("second broken battle", "utf-8")
    assert store.load_active("run") is None
    assert not path.exists()
    assert path.with_suffix(".broken.json").read_text("utf-8") == "first broken battle"
    assert path.with_suffix(".broken.2.json").read_text("utf-8") == "second broken battle"


def test_repeated_corrupt_settings_preserve_each_original(tmp_path):
    path = tmp_path / "settings.json"
    path.write_text("first broken settings", "utf-8")
    SettingsStore(path)
    path.write_text("second broken settings", "utf-8")
    SettingsStore(path)
    assert path.with_suffix(".broken.json").read_text("utf-8") == "first broken settings"
    assert path.with_suffix(".broken.2.json").read_text("utf-8") == "second broken settings"


def test_saved_derived_weapon_labels_refresh_without_rewriting_original(tmp_path, roster_import):
    from app.domain.battle import Battle, BattleUnitStats, Usage
    from app.domain.inventory import InventoryItem
    from app.domain.units import now

    run_path = tmp_path / "runs"
    run_path.mkdir()
    saved = {
        "id": "run",
        "name": "Run",
        "units": {
            "lysithea": {
                "name": "Lysithea",
                "inventory": [
                    {
                        "id": 14,
                        "name": "Miasma",
                        "kind": "spell",
                        "uses": 5,
                        "weapon": "faith",
                    }
                ],
            }
        },
    }
    original = json.dumps(saved)
    (run_path / "run.json").write_text(original, "utf-8")
    assert RunStore(run_path).get("run").units["lysithea"].inventory[0].weapon == "dark"
    assert (run_path / "run.json").read_text("utf-8") == original

    battles = BattleStore(tmp_path / "battles")
    battle = Battle(
        id="b1",
        run_id="run",
        started_at=now(),
        units=[
            BattleUnitStats(
                key="lysithea",
                name="Lysithea",
                start_level=1,
                level=1,
                start={},
                now={},
                inventory=[InventoryItem(id=14, name="Miasma", kind="spell", uses=5, weapon="faith")],
                usage=[Usage(kind="spell", id=14, name="Miasma", weapon="faith")],
            )
        ],
    )
    battles.add(battle)
    before = battles._path("run").read_bytes()
    [loaded] = battles.list("run")
    assert loaded.units[0].inventory[0].weapon == "dark"
    assert loaded.units[0].usage[0].weapon == "dark"
    assert battles._path("run").read_bytes() == before


@pytest.mark.parametrize("case", sorted(saved_runs()))
def test_existing_run_fixtures_round_trip_without_losing_tracked_values(case):
    from app.infrastructure.saved_models import Run

    run = Run.model_validate(saved_runs()[case])
    reloaded = Run.model_validate_json(run.model_dump_json())
    assert reloaded.model_dump() == run.model_dump()
    assert reloaded.units.keys() == run.units.keys()


def test_saved_runs_load_from_disk_without_being_rewritten(tmp_path, roster_import):
    path = tmp_path / "runs"
    path.mkdir()
    for saved in saved_runs().values():
        (path / f"{saved['id']}.json").write_text(json.dumps(saved), "utf-8")
    before = {file.name: file.read_bytes() for file in path.iterdir()}
    store = RunStore(path)
    assert {run.id for run in store.list()} == {saved["id"] for saved in saved_runs().values()}
    full = store.get("full")
    assert full.units["alder"].skills["sword"].exp == 171
    assert full.units["alder"].effective_bonus("str") == 1 and full.units["birch"].source == "manual"
    assert store.get("old").units["cedar"].inventory == []
    assert store.get("old-icons").units["elm"].inventory[0].weapon == "dark"
    assert {file.name: file.read_bytes() for file in path.iterdir()} == before


def test_saved_battles_round_trip(tmp_path, roster_import):
    battles = BattleStore(tmp_path / "battles")
    battles.add(a_battle())
    battles.add(a_battle(battle_id="b2", ended_at=None))
    loaded = {b.id: b for b in BattleStore(tmp_path / "battles").list("full")}
    assert loaded["b1"].model_dump() == a_battle().model_dump()
    assert loaded["b2"].ended_at is None and loaded["b1"].log[1].dealt == 9
    assert Battle.model_validate_json(loaded["b1"].model_dump_json()) == loaded["b1"]


def test_unsupported_future_save_is_rejected_without_modifying_it(tmp_path):
    from pydantic import ValidationError

    path = tmp_path / "runs"
    path.mkdir()
    file = path / "future.json"
    original = '{"schema_version":999,"id":"future","name":"Future"}'
    file.write_text(original, "utf-8")
    with pytest.raises(ValidationError):
        RunStore(path).get("future")
    assert file.read_text("utf-8") == original
def test_json_backup_recovers_and_warns_once(tmp_path, monkeypatch):
    import json

    from app.infrastructure import json_files

    notices = []
    monkeypatch.setattr(json_files, "_notify", notices.append)
    path = tmp_path / "saved.json"
    json_files.atomic_write_text(path, '{"value": 1}', backup=True)
    json_files.atomic_write_text(path, '{"value": 2}', backup=True)
    path.write_text("{broken", encoding="utf-8")
    assert json_files.read_with_backup(path, json.loads) == {"value": 1}
    assert json_files.read_with_backup(path, json.loads) == {"value": 1}
    assert len(notices) == 1
    json_files.atomic_write_text(path, '{"value": 3}', backup=True)
    assert json.loads(path.with_suffix(".json.bak").read_text()) == {"value": 1}


def test_corrupt_run_recovers_backup(tmp_path, monkeypatch):
    from app.infrastructure import json_files
    from app.storage import RunStore

    notices = []
    monkeypatch.setattr(json_files, "_notify", notices.append)
    store = RunStore(tmp_path)
    run = store.create("Test")
    store.rename(run.id, "Renamed")
    (tmp_path / f"{run.id}.json").write_text("{broken", encoding="utf-8")
    recovered = RunStore(tmp_path).get(run.id)
    assert recovered.name == "Test"
    assert len(notices) == 1
