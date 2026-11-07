; Inno Setup script for the Divine Pulse installer. Built by tools/build.py when Inno Setup 6
; (iscc.exe) is installed; the version comes from the build script (/DAppVersion=...).
;
; Installs for the current user only (no administrator prompt) into %LOCALAPPDATA%\Programs\Divine Pulse.
; User data lives separately in %LOCALAPPDATA%\Divine Pulse. Interactive uninstall asks whether to keep run and
; battle records. Silent uninstall preserves user data.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#define AppName "Divine Pulse"
#define AppExe "Divine Pulse.exe"

[Setup]
AppId={{6A55F447-4189-4E8F-8B54-2AA0ECF2A043}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
; Always the default folder and Start menu group, whatever an earlier install used.
UsePreviousAppDir=no
UsePreviousGroup=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\release
OutputBaseFilename=Divine-Pulse-{#AppVersion}-setup
SetupIconFile=..\backend\app\data\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Close a running tracker before replacing its files.
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "..\build\dist\Divine Pulse\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Start {#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
var
  DataToClean: String;
  KeepRecords: Boolean;

// The folder the program saves to, found the way it finds it. Empty when DIVINE_PULSE_DATA_DIR names one: that can be
// any folder at all, so it isn't for the uninstaller to delete.
function SavedDataFolder: String;
begin
  if GetEnv('DIVINE_PULSE_DATA_DIR') <> '' then
    Result := ''
  else if DirExists(ExpandConstant('{app}\data')) then
    Result := ExpandConstant('{app}\data')
  else
    Result := ExpandConstant('{localappdata}\Divine Pulse');
end;

// Never asked when silent: setup itself uninstalls silently when it stops, and that must not touch anyone's data.
procedure AskAboutSavedData;
var
  Folder: String;
begin
  Folder := SavedDataFolder;
  if UninstallSilent or (Folder = '') or not DirExists(Folder) then Exit;
  KeepRecords := MsgBox('Keep your runs and battle history?' + #13#10#13#10 +
      'Choose Yes to keep those records or No to delete them. Imported files, raw recordings and settings will be removed.',
      mbConfirmation, MB_YESNO) = IDYES;
  DataToClean := Folder;
end;

// Close the application before uninstalling.
procedure CloseTracker;
var
  Code: Integer;
begin
  if Exec(ExpandConstant('{app}\{#AppExe}'), '--quit', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0) then Exit;
  if not UninstallSilent then
    MsgBox('Divine Pulse is still running and could not be closed.' + #13#10#13#10 +
      'Close the Divine Pulse window, then choose OK.', mbInformation, MB_OK);
end;

// A few tries: the window's WebView2 processes outlive the tracker by a moment, and they hold files in this folder.
procedure DeleteSavedData;
var
  I: Integer;
  WindowData: String;
begin
  if DataToClean = '' then Exit;
  if not KeepRecords then begin
    DelTree(DataToClean + '\runs', True, True, True);
    DelTree(DataToClean + '\battles', True, True, True);
  end;
  DelTree(DataToClean + '\game-assets', True, True, True);
  DelTree(DataToClean + '\game-assets.importing', True, True, True);
  DelTree(DataToClean + '\game-assets.previous', True, True, True);
  DelTree(DataToClean + '\battle-recordings', True, True, True);
  DelTree(DataToClean + '\pairing-checks', True, True, True);
  DeleteFile(DataToClean + '\settings.json');
  DeleteFile(DataToClean + '\settings.json.bak');
  DeleteFile(DataToClean + '\game-assets-import.log');
  DeleteFile(DataToClean + '\tracker.log');
  DeleteFile(DataToClean + '\tracker.log.1');
  DeleteFile(DataToClean + '\tracker.log.2');
  WindowData := DataToClean + '\webview';
  for I := 1 to 20 do begin
    if not DirExists(WindowData) then Break;
    DelTree(WindowData, True, True, True);
    Sleep(500);
  end;
  if DirExists(WindowData) then
    MsgBox('The window cache could not be deleted. You can remove it after closing Divine Pulse:' + #13#10 + WindowData,
      mbError, MB_OK);
  RemoveDir(DataToClean);
  RemoveDir(ExpandConstant('{app}'));
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then begin
    AskAboutSavedData;
    CloseTracker;
  end else if CurUninstallStep = usPostUninstall then
    DeleteSavedData;
end;
