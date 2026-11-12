# ruff: noqa: F811
"""The scanner keeping Unit.in_army from the game's roster flags: who the Roster shows follows the game's memory."""

import struct
from dataclasses import replace

from app.domain.membership import on_roster
from app.gamemem.fe3h import DEAD, IN_ARMY, SLOT_SIZE, _FLAGS
from helpers.synthetic_roster import SLOT_OF
from test_memory_mode import scanner, units  # noqa: F401  (the fixture)


def _flags(sc, character: int, *, set_bits: int = 0, clear_bits: int = 0):
    at = SLOT_OF[character] * SLOT_SIZE + _FLAGS
    flags = struct.unpack_from("<I", sc.memory.roster, at)[0]
    struct.pack_into("<I", sc.memory.roster, at, (flags | set_bits) & ~clear_bits)


def _ticks(sc, n=3):
    for _ in range(n):
        sc._tick()


def test_a_unit_that_leaves_the_army_alive_goes_off_the_roster_and_returns_with_its_history(scanner):
    _ticks(scanner)
    assert all(u.in_army for u in units(scanner).values())
    _flags(scanner, 22, clear_bits=IN_ARMY)
    _ticks(scanner)
    got = units(scanner)
    assert "lysithea" in got and got["lysithea"].in_army is False and not on_roster(got["lysithea"])
    assert sum(map(on_roster, got.values())) == 14
    assert scanner.store.list()[0].unit_count == 14
    stored = got["lysithea"].model_dump(exclude={"in_army", "updated_at"})
    _flags(scanner, 22, set_bits=IN_ARMY)
    _ticks(scanner)
    back = units(scanner)["lysithea"]
    assert back.in_army is True and on_roster(back)
    assert back.model_dump(exclude={"in_army", "updated_at"}) == stored
    assert scanner.store.list()[0].unit_count == 15


def test_a_dead_unit_stays_on_the_roster_whether_or_not_it_is_in_the_army(scanner):
    _ticks(scanner)
    _flags(scanner, 22, set_bits=DEAD, clear_bits=IN_ARMY)
    _ticks(scanner)
    lysithea = units(scanner)["lysithea"]
    assert lysithea.in_army is False and lysithea.death is not None and on_roster(lysithea)
    assert scanner.store.list()[0].unit_count == 15


def test_membership_only_changes_on_a_complete_read_between_battles(scanner, monkeypatch):
    _ticks(scanner)
    _flags(scanner, 22, clear_bits=IN_ARMY)
    scanner.memory.in_battle = (19,)  # a battle is on: the roster is not the army's
    _ticks(scanner)
    assert units(scanner)["lysithea"].in_army is True
    scanner.memory.in_battle = ()
    read = scanner.memory.read
    monkeypatch.setattr(scanner.memory, "read", lambda: replace(read(), roster=bytes(10)))  # a partial read
    _ticks(scanner)
    assert units(scanner)["lysithea"].in_army is True
    monkeypatch.setattr(scanner.memory, "read", read)
    _ticks(scanner)
    assert units(scanner)["lysithea"].in_army is False
