"""Opt-in real Inno/packaged tests, using only synthetic NSPs and a disposable install identity."""

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
    (qa / "base.nsp").write_bytes(b"synthetic invalid NSP")
    (qa / "prod.keys").write_text("synthetic-private-key-sentinel", encoding="utf-8")
    (qa / "existing").mkdir()
    (qa / "existing/keep.txt").write_text("keep", encoding="utf-8")
    return qa


@pytest.mark.parametrize("case", ["empty", "existing", "missing-parent", "relative", "reserved", "data", "no-nsps"])
def test_silent_destination_preflight_never_installs_or_waits_for_user(setup_qa, case):
    qa = setup_qa
    destinations = {"empty": "", "existing": str(qa / "existing"), "missing-parent": str(qa / "absent/new"),
                    "relative": "relative", "reserved": str(qa / "CON"), "data": str(qa / "data/raw"),
                    "no-nsps": str(qa / "no-nsps")}
    log = qa / f"{case}.log"
    selected = [f"/DUMP={qa}"] if case == "no-nsps" else [f"/NSP1={qa / 'base.nsp'}"]
    command = [str(qa / "setup-test.exe"), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/SP-", "/NORESTART", "/NOICONS",
               f"/DIR={qa / 'install'}", f"/LOG={log}", f"/KEYS={qa / 'prod.keys'}", *selected,
               f"/KEEPDUMPS={destinations[case]}"]
    result = subprocess.run(command, env={**os.environ, "DIVINE_PULSE_DATA_DIR": str(qa / "data")}, timeout=20)
    assert result.returncode == 7, log.read_text(encoding="utf-8-sig")
    assert not (qa / "install").exists()
    assert (qa / "existing/keep.txt").read_text() == "keep"
    assert not (qa / "absent").exists()
    assert not list(qa.glob("*.tmp"))


@pytest.mark.parametrize("retained", [False, True])
def test_real_packaged_nstool_failure_cleans_raw_files_and_only_disposable_install(setup_qa, retained):
    qa = setup_qa
    raw = qa / "new raw dump"
    install = qa / "install"
    log = qa / f"failure-{retained}.log"
    command = [str(qa / "setup-test.exe"), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/SP-", "/NORESTART", "/NOICONS",
               f"/DIR={install}", f"/LOG={log}", f"/KEYS={qa / 'prod.keys'}", f"/NSP1={qa / 'base.nsp'}"]
    if retained:
        command += [f"/KEEPDUMPS={raw}"]
    result = subprocess.run(command, env={**os.environ, "DIVINE_PULSE_DATA_DIR": str(qa / "data")}, timeout=45)
    assert result.returncode == 1, log.read_text(encoding="utf-8-sig")
    assert not raw.exists()
    import_log = (qa / "data/game-assets-import.log").read_text(encoding="utf-8")
    assert "NSTool failed on base.nsp" in import_log
    if retained:
        assert f"Raw dump destination: {raw} (kept only after a successful import)." in import_log
    else:
        assert "Raw dump destination:" not in import_log
    assert "synthetic-private-key-sentinel" not in import_log
    assert (qa / "prod.keys").read_text() == "synthetic-private-key-sentinel"
    assert (qa / "base.nsp").read_bytes() == b"synthetic invalid NSP"
    assert (qa / "existing/keep.txt").read_text() == "keep"
    # Inno defers deleting the uninstaller itself until its parent setup has exited.
    for _ in range(100):
        if not install.exists():
            break
        time.sleep(.1)
    assert not install.exists()
