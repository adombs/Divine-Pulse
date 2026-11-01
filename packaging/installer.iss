; Inno Setup script for the Divine Pulse installer. Built by tools/build_windows.ps1 when Inno Setup 6
; (iscc.exe) is installed; the version comes from the build script (/DAppVersion=...).
;
; Installs for the current user only (no administrator prompt) into %LOCALAPPDATA%\Programs\Divine Pulse.
; Runs, battles and settings live separately in %LOCALAPPDATA%\Divine Pulse. Uninstalling closes a running tracker and
; asks whether to delete them too (the default is to keep them); a silent uninstall always keeps them.

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
  GamePage: TInputDirWizardPage;
  KeepFiles, ImportFiles: TRadioButton;
  HasImport, Stopped: Boolean;

// The install folder as chosen so far. {app} can't be used before the folder page is done (InitializeWizard
// reads the last dump folder), so read the wizard's own value.
function AppDir: String;
begin
  Result := RemoveBackslashUnlessRoot(WizardDirValue);
end;

function DataFolder: String;
begin
  Result := GetEnv('DIVINE_PULSE_DATA_DIR');
  if Result = '' then begin
    if DirExists(AppDir + '\data') then
      Result := AppDir + '\data'
    else
      Result := ExpandConstant('{localappdata}\Divine Pulse');
  end;
end;

function HasGameFiles: Boolean;
begin
  Result := FileExists(DataFolder + '\game-assets\manifest.json');
end;

// Hashes every imported file, and Exec disables the wizard while it waits, so run this only from the install step,
// with its status showing. The installed program must be this version's: before 0.10.5 it ignored the flag and
// started the whole app, which never exits.
function ValidImport: Boolean;
var
  Code: Integer;
  Exe: String;
begin
  Result := False;
  Exe := AppDir + '\{#AppExe}';
  if not HasGameFiles or not FileExists(Exe) then Exit;
  if Exec(Exe, '--check-game-files', '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Result := Code = 0;
end;

function LastDump: String;
var
  Raw: AnsiString;
  S, C, Hex: String;
  I, N: Integer;
begin
  Result := '';
  if not LoadStringFromFile(DataFolder + '\settings.json', Raw) then Exit;
  S := String(Raw);
  I := Pos('"last_dump"', S);
  if I = 0 then Exit;
  I := I + Length('"last_dump"');
  while (I <= Length(S)) and (S[I] <> ':') do I := I + 1;
  I := I + 1;
  while (I <= Length(S)) and (S[I] <= ' ') do I := I + 1;
  if (I > Length(S)) or (S[I] <> '"') then Exit;
  I := I + 1;
  while I <= Length(S) do begin
    C := S[I];
    if C = '"' then Exit;
    if C = '\' then begin
      I := I + 1;
      if I > Length(S) then Break;
      C := S[I];
      if C = 'u' then begin
        Hex := Copy(S, I + 1, 4);
        N := StrToIntDef('$' + Hex, 0);
        C := Chr(N);
        I := I + 4;
      end;
    end;
    Result := Result + C;
    I := I + 1;
  end;
  Result := '';
end;

procedure InitializeWizard;
begin
  GamePage := CreateInputDirPage(wpSelectDir, 'Game files', 'Import your game files',
    'The app needs your own game files: the game with update 1.2.0. DLC is optional. Nothing is uploaded.', False, '');
  GamePage.Add('FE3H 1.2.0 dump folder:');
  GamePage.Values[0] := LastDump;
  KeepFiles := TRadioButton.Create(GamePage);
  KeepFiles.Parent := GamePage.Surface;
  KeepFiles.Caption := 'Keep my current game files';
  KeepFiles.SetBounds(0, ScaleY(100), GamePage.SurfaceWidth, ScaleY(20));
  ImportFiles := TRadioButton.Create(GamePage);
  ImportFiles.Parent := GamePage.Surface;
  ImportFiles.Caption := 'Import again from this folder';
  ImportFiles.SetBounds(0, ScaleY(124), GamePage.SurfaceWidth, ScaleY(20));
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = GamePage.ID then begin
    HasImport := HasGameFiles;
    KeepFiles.Visible := HasImport;
    ImportFiles.Visible := HasImport;
    if HasImport and not ImportFiles.Checked then KeepFiles.Checked := True;
  end;
end;

function LooksLikeDump(Folder: String; Depth: Integer): Boolean;
var
  FindRec: TFindRec;
  Child: String;
begin
  Result := FileExists(AddBackslash(Folder) + 'DATA0.bin') and
    FileExists(AddBackslash(Folder) + 'DATA1.bin') and DirExists(AddBackslash(Folder) + 'nx');
  if Result or (Depth = 0) then Exit;
  if FindFirst(AddBackslash(Folder) + '*', FindRec) then begin
    try
      repeat
        if (FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0) and
           (FindRec.Name <> '.') and (FindRec.Name <> '..') then begin
          Child := AddBackslash(Folder) + FindRec.Name;
          if LooksLikeDump(Child, Depth - 1) then begin
            Result := True;
            Break;
          end;
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Folder: String;
begin
  Result := True;
  if (CurPageID <> GamePage.ID) or (HasImport and KeepFiles.Checked) then Exit;
  Folder := GamePage.Values[0];
  if not DirExists(Folder) then begin
    MsgBox('Choose an existing game dump folder.', mbError, MB_OK);
    Result := False;
  end else if not LooksLikeDump(Folder, 5) then begin
    MsgBox('This folder does not appear to contain a game RomFS dump.', mbError, MB_OK);
    Result := False;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if WizardSilent then begin
    HasImport := HasGameFiles;
    if (ExpandConstant('{param:DUMP|}') = '') and not HasImport then
      Result := 'Divine Pulse needs your game files; supply /DUMP="<folder>".';
  end;
end;

procedure CurInstallProgressChanged(CurProgress, MaxProgress: Integer);
begin
  if MaxProgress > 0 then
    WizardForm.ProgressGauge.Position :=
      Round((CurProgress / MaxProgress) * WizardForm.ProgressGauge.Max * 0.9);
end;

procedure ShowBusy(Status: String);
begin
  WizardForm.StatusLabel.Caption := Status;
  WizardForm.ProgressGauge.Style := npbstMarquee;
  WizardForm.StatusLabel.Update;
end;

procedure ShowResult(Success: Boolean);
begin
  WizardForm.ProgressGauge.Style := npbstNormal;
  if Success then
    WizardForm.ProgressGauge.Position := WizardForm.ProgressGauge.Max
  else
    WizardForm.ProgressGauge.Position := 0;
end;

procedure StopSetup(Reason: String);
var
  UninstallCode: Integer;
begin
  if not (HasImport and ValidImport) then
    Exec(ExpandConstant('{app}\unins000.exe'), '/VERYSILENT /SUPPRESSMSGBOXES', '',
      SW_HIDE, ewWaitUntilTerminated, UninstallCode);
  Stopped := True;
  RaiseException('Divine Pulse needs your game files. ' + Reason);
end;

// A silent install that stopped must not report success to whatever ran it.
function GetCustomSetupExitCode: Integer;
begin
  if Stopped then Result := 1 else Result := 0;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Folder, Reason: String;
  Lines: TArrayOfString;
  Code: Integer;
  Success, Retry: Boolean;
begin
  if CurStep <> ssPostInstall then Exit;
  if WizardSilent then Folder := ExpandConstant('{param:DUMP|}')
  else if HasImport and KeepFiles.Checked then Folder := ''
  else Folder := GamePage.Values[0];
  if Folder = '' then begin
    ShowBusy('Checking your game files...');
    Success := ValidImport;
    ShowResult(Success);
    if Success then Exit;
    Reason := 'Your current game files are damaged or incomplete.';
    if WizardSilent then StopSetup(Reason);
    Folder := GamePage.Values[0];
    if (MsgBox(Reason + #13#10#13#10 + 'Choose OK to import them again, or Cancel to stop setup.',
        mbError, MB_OKCANCEL) <> IDOK) or
       not BrowseForFolder('Choose your FE3H 1.2.0 dump folder:', Folder, False) then StopSetup(Reason);
  end;
  repeat
    ShowBusy('Importing your game files...');
    if not Exec(ExpandConstant('{app}\{#AppExe}'), '--import-game-files "' + Folder + '"',
        '', SW_HIDE, ewWaitUntilTerminated, Code) then Code := -1;
    Success := Code = 0;
    ShowResult(Success);
    if Success then Exit;
    Reason := 'The import could not be started.';
    if LoadStringsFromFile(DataFolder + '\game-assets-import.log', Lines) then
      if GetArrayLength(Lines) > 0 then Reason := Lines[GetArrayLength(Lines) - 1];
    Retry := False;
    if not WizardSilent then begin
      Retry := MsgBox('Game files could not be imported: ' + Reason + #13#10#13#10 +
        'Choose Retry to select another folder, or Cancel to stop setup.', mbError, MB_RETRYCANCEL) = IDRETRY;
      if Retry then
        Retry := BrowseForFolder('Choose your FE3H 1.2.0 dump folder:', Folder, False);
    end;
    if not Retry then StopSetup(Reason);
  until Success;
end;

// ---- Uninstalling ----

var
  DataToDelete: String;

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
  if MsgBox('Also delete your saved data?' + #13#10#13#10 +
      'Your runs, battles, settings and imported game files are in:' + #13#10 + Folder + #13#10#13#10 +
      'Choose Yes to delete them for good, or No to keep them for a later install.',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
    DataToDelete := Folder;
end;

// The tracker stays in the tray with its window closed, holding its files open.
procedure CloseTracker;
var
  Code: Integer;
begin
  if Exec(ExpandConstant('{app}\{#AppExe}'), '--quit', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0) then Exit;
  if not UninstallSilent then
    MsgBox('Divine Pulse is still running and could not be closed.' + #13#10#13#10 +
      'Right-click its tray icon and choose Quit, then choose OK.', mbInformation, MB_OK);
end;

// A few tries: the window's WebView2 processes outlive the tracker by a moment, and they hold files in this folder.
procedure DeleteSavedData;
var
  I: Integer;
begin
  if DataToDelete = '' then Exit;
  for I := 1 to 20 do begin
    DelTree(DataToDelete, True, True, True);
    if not DirExists(DataToDelete) then Break;
    Sleep(500);
  end;
  if DirExists(DataToDelete) then
    MsgBox('Some of your saved data could not be deleted. You can delete this folder yourself:' + #13#10 + DataToDelete,
      mbError, MB_OK);
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
