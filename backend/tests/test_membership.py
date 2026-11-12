"""Who is in the army (Unit.in_army) and who the Roster shows (domain/membership.py)."""

from app.domain import membership
from app.domain.runs import Run
from app.domain.units import Death, Unit

UNITS = {
    "byleth": Unit(name="Byleth", game_id=0),
    "raphael": Unit(name="Raphael", game_id=20),
    "lorenz": Unit(name="Lorenz", game_id=19, in_army=False),
    "hand": Unit(name="Made By Hand"),
}


def test_a_unit_that_left_the_army_is_off_the_roster_and_one_that_returned_is_on_it_again():
    changed = membership.detect(UNITS, {0, 19})
    assert set(changed) == {"raphael", "lorenz"}
    assert changed["raphael"].in_army is False and changed["lorenz"].in_army is True


def test_nothing_changes_when_the_army_is_as_recorded():
    assert membership.detect({k: u for k, u in UNITS.items() if k != "lorenz"}, {0, 20}) == {}


def test_units_with_no_game_id_are_left_alone():
    assert "hand" not in membership.detect(UNITS, set())


def test_leaving_keeps_everything_stored_on_the_unit():
    unit = Unit(name="Raphael", game_id=20, ebst_offense="physical")
    gone = membership.detect({"raphael": unit}, set())["raphael"]
    assert gone.model_dump(exclude={"in_army"}) == unit.model_dump(exclude={"in_army"})
    back = membership.detect({"raphael": gone}, {20})["raphael"]
    assert back == unit


def test_the_roster_is_the_army_and_the_dead():
    alive_out = Unit(name="A", game_id=1, in_army=False)
    dead_out = Unit(name="B", game_id=2, in_army=False, death=Death())
    marked_dead = Unit(name="C", game_id=3, in_army=False, death=Death(manual=True))
    assert [membership.on_roster(u) for u in (UNITS["byleth"], alive_out, dead_out, marked_dead)] == [True, False, True, True]


def test_runs_saved_before_it_load_in_the_army():
    run = Run.model_validate({"id": "run", "name": "Run", "units": {"raphael": {"name": "Raphael", "game_id": 20}}})
    assert run.units["raphael"].in_army is True
