import pytest

from app.infrastructure.installation import NO, YES, prepare_installation
from app.infrastructure.settings import SettingsStore


@pytest.mark.parametrize(
    ("answers", "keep_records", "keep_assets", "replace"),
    [([YES, YES], True, True, False), ([YES, NO, NO], True, True, True), ([NO, NO, YES], False, False, False)],
)
def test_first_launch_retains_only_selected_data(tmp_path, answers, keep_records, keep_assets, replace):
    settings = SettingsStore(tmp_path / "settings.json")
    settings.update(active_run_id="saved", max_recordings=8)
    assets = tmp_path / "game-assets"
    for name in ("runs", "battles", "webview", "game-assets", "game-assets.importing"):
        folder = tmp_path / name
        folder.mkdir()
        (folder / "existing").touch()
    decisions = iter(answers)

    assert prepare_installation(settings, assets, "new", lambda _: next(decisions))
    assert (tmp_path / "runs" / "existing").exists() == keep_records
    assert (tmp_path / "battles" / "existing").exists() == keep_records
    assert (assets / "existing").exists() == keep_assets
    assert not (tmp_path / "webview").exists()
    assert not (tmp_path / "game-assets.importing").exists()
    assert settings.get().replace_import is replace
    assert settings.get().active_run_id == ("saved" if keep_records else None)
    assert settings.get().max_recordings == 3
    assert prepare_installation(settings, assets, "new", lambda _: pytest.fail("setup already completed"))


def test_cancelling_asset_choice_also_cancels_record_cleanup(tmp_path):
    settings = SettingsStore(tmp_path / "settings.json")
    settings.update(active_run_id="saved")
    runs = tmp_path / "runs"
    runs.mkdir()
    (runs / "saved.json").touch()
    assets = tmp_path / "game-assets"
    assets.mkdir()
    decisions = iter((NO, 2))

    assert not prepare_installation(settings, assets, "new", lambda _: next(decisions))
    assert (runs / "saved.json").is_file()
    assert assets.is_dir()
    assert settings.get().installation_version is None
