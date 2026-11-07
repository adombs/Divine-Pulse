"""Opt-in real Inno/packaged tests, using a disposable install identity."""

import os
from pathlib import Path
import shutil
import subprocess
import time
import uuid

import pytest

PROGRAM = os.environ.get("DIVINE_PULSE_TEST_PACKAGED_DIR", "")
pytestmark = pytest.mark.skipif(os.name != "nt" or not PROGRAM,
                               reason="Build Windows first and set DIVINE_PULSE_TEST_PACKAGED_DIR")


@pytest.fixture(scope="module")
def setup_qa(tmp_path_factory):
    root = Path(__file__).resolve().parents[2]
    qa = tmp_path_factory.mktemp("installer-retention")
    program = Path(PROGRAM).resolve()
    assert (program / "Divine Pulse.exe").is_file()
    iscc = shutil.which("iscc") or str(Path(os.environ["LOCALAPPDATA"]) / "Programs/Inno Setup 6/ISCC.exe")
    assert Path(iscc).is_file(), "Inno Setup 6 is required for the opted-in packaging check"
    identity = str(uuid.uuid4())
    script = (root / "packaging/installer.iss").read_text(encoding="utf-8")
    replacements = {
        '#define AppName "Divine Pulse"': f'#define AppName "Divine Pulse Retention Test {identity}"',
        "6A55F447-4189-4E8F-8B54-2AA0ECF2A043": identity,
        "DefaultDirName={localappdata}\\Programs\\{#AppName}": f"DefaultDirName={qa / 'install'}",
        "OutputDir=..\\release": f"OutputDir={qa}",
        "OutputBaseFilename=Divine-Pulse-{#AppVersion}-setup": "OutputBaseFilename=setup-test",
        "..\\backend\\app\\data\\icon.ico": str(root / "backend/app/data/icon.ico"),
        "..\\build\\dist\\Divine Pulse\\*": str(program / "*"),
    }
    for before, after in replacements.items():
        assert before in script
        script = script.replace(before, after)
    source = qa / "installer.iss"
    source.write_text(script, encoding="utf-8")
    subprocess.run([iscc, "/Q", "/DAppVersion=0.0.0", str(source)], check=True, timeout=90)
    return qa


def test_setup_and_silent_uninstall_do_not_touch_existing_data(setup_qa):
    qa = setup_qa
    install = qa / "install"
    data = qa / "data"
    data.mkdir()
    save = data / "existing-run.json"
    save.write_text("synthetic save", encoding="utf-8")
    env = {**os.environ, "DIVINE_PULSE_DATA_DIR": str(data)}
    command = [str(qa / "setup-test.exe"), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/SP-", "/NORESTART", "/NOICONS",
               f"/DIR={install}", f"/LOG={qa / 'setup.log'}"]
    subprocess.run(command, env=env, check=True, timeout=120)
    assert (install / "Divine Pulse.exe").is_file()
    assert list(data.iterdir()) == [save]
    [uninstaller] = install.glob("unins*.exe")
    subprocess.run([str(uninstaller), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"],
                   env=env, check=True, timeout=120)
    assert save.read_text(encoding="utf-8") == "synthetic save"
    for _ in range(100):
        if not (install / "Divine Pulse.exe").exists():
            break
        time.sleep(.1)
    assert not (install / "Divine Pulse.exe").exists()
