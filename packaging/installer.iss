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
  NspPage: TInputFileWizardPage;
  ReviewPage: TWizardPage;
  ReviewList: TNewMemo;
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
  GamePage := CreateInputDirPage(wpSelectDir, 'Game files', 'Choose your game files',
    'Choose your own Fire Emblem: Three Houses game files, including update 1.2.0. DLC is optional. Nothing is uploaded.', False, '');
  GamePage.Add('Choose the folder with your extracted game files or NSP files:');
  GamePage.Values[0] := LastDump;
  KeepFiles := TRadioButton.Create(GamePage);
  KeepFiles.Parent := GamePage.Surface;
  KeepFiles.Caption := 'Keep my current game files';
  KeepFiles.SetBounds(0, ScaleY(100), GamePage.SurfaceWidth, ScaleY(20));
  ImportFiles := TRadioButton.Create(GamePage);
  ImportFiles.Parent := GamePage.Surface;
  ImportFiles.Caption := 'Import game files from the selected folder';
  ImportFiles.SetBounds(0, ScaleY(124), GamePage.SurfaceWidth, ScaleY(20));
  ReviewPage := CreateCustomPage(GamePage.ID, 'Review game files',
    'Review what setup found. Your files will be checked when they are imported.');
  ReviewList := TNewMemo.Create(ReviewPage);
  ReviewList.Parent := ReviewPage.Surface;
  ReviewList.SetBounds(0, 0, ReviewPage.SurfaceWidth, ReviewPage.SurfaceHeight);
  ReviewList.ReadOnly := True;
  ReviewList.ScrollBars := ssVertical;
  ReviewList.WordWrap := True;
  NspPage := CreateInputFilePage(ReviewPage.ID, 'Open NSP files', 'Choose the files needed to open your NSPs',
    'To open NSP files, setup needs NSTool and your own prod.keys file. Choose each file below.');
  NspPage.Add('NSTool program (nstool.exe):', 'Executable files|*.exe|All files|*.*', '.exe');
  NspPage.Add('Your prod.keys file:', 'Key files|*.keys|All files|*.*', '.keys');
end;

function LooksLikeDump(Folder: String): Boolean;
var
  FindRec: TFindRec;
  Child: String;
begin
  Result := FileExists(AddBackslash(Folder) + 'DATA0.bin') and
    FileExists(AddBackslash(Folder) + 'DATA1.bin') and DirExists(AddBackslash(Folder) + 'nx');
  if Result then Exit;
  if FindFirst(AddBackslash(Folder) + '*', FindRec) then begin
    try
      repeat
        if (FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0) and
           (FindRec.Name <> '.') and (FindRec.Name <> '..') and
           (FindRec.Attributes and FILE_ATTRIBUTE_REPARSE_POINT = 0) then begin
          Child := AddBackslash(Folder) + FindRec.Name;
          if LooksLikeDump(Child) then begin
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

function HasNsp(Folder: String): Boolean;
var
  FindRec: TFindRec;
begin
  Result := False;
  if FindFirst(AddBackslash(Folder) + '*.nsp', FindRec) then begin
    try
      repeat
        if FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY = 0 then begin
          Result := True;
          Break;
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
  if Result then Exit;
  if FindFirst(AddBackslash(Folder) + '*', FindRec) then begin
    try
      repeat
        if (FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0) and
           (FindRec.Name <> '.') and (FindRec.Name <> '..') and
           (FindRec.Attributes and FILE_ATTRIBUTE_REPARSE_POINT = 0) then begin
          if HasNsp(AddBackslash(Folder) + FindRec.Name) then begin
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

// This is a preview of file names and paths, not a validation of their contents or version.
procedure ListDumpParts(Folder: String; Lines: TStrings);
var
  FindRec: TFindRec;
  Child, Name: String;
begin
  if FileExists(AddBackslash(Folder) + 'DATA0.bin') and
     FileExists(AddBackslash(Folder) + 'DATA1.bin') then
    Lines.Add('Game files: ' + Folder);
  if FileExists(AddBackslash(Folder) + 'main') then
    Lines.Add('Possible game program file: ' + AddBackslash(Folder) + 'main');
  if FindFirst(AddBackslash(Folder) + '*', FindRec) then begin
    try
      repeat
        Name := FindRec.Name;
        if (FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0) and
           (Name <> '.') and (Name <> '..') and
           (FindRec.Attributes and FILE_ATTRIBUTE_REPARSE_POINT = 0) then begin
          Child := AddBackslash(Folder) + Name;
          if CompareText(Copy(Name, 1, 5), 'patch') = 0 then
            Lines.Add('Possible update files: ' + Child)
          else if CompareText(Name, 'nx') <> 0 then
            ListDumpParts(Child, Lines);
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
end;

procedure ListNsps(Folder: String; Lines: TStrings);
var
  FindRec: TFindRec;
begin
  if FindFirst(AddBackslash(Folder) + '*.nsp', FindRec) then begin
    try
      repeat
        if FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY = 0 then
          Lines.Add('NSP: ' + AddBackslash(Folder) + FindRec.Name);
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
  if FindFirst(AddBackslash(Folder) + '*', FindRec) then begin
    try
      repeat
        if (FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0) and
           (FindRec.Name <> '.') and (FindRec.Name <> '..') and
           (FindRec.Attributes and FILE_ATTRIBUTE_REPARSE_POINT = 0) then
          ListNsps(AddBackslash(Folder) + FindRec.Name, Lines);
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
end;

procedure DescribeGameFiles(Folder: String; Lines: TStrings);
begin
  Lines.Clear;
  Lines.Add('Selected folder: ' + Folder);
  Lines.Add('');
  if LooksLikeDump(Folder) then begin
    Lines.Add('Found extracted game files.');
    if HasNsp(Folder) then
      Lines.Add('NSP files were also found. Setup will use the extracted game files.');
    Lines.Add('');
    ListDumpParts(Folder, Lines);
    Lines.Add('');
    Lines.Add('Setup will check the game, update and any DLC when importing.');
  end else begin
    Lines.Add('Found NSP files.');
    Lines.Add('');
    ListNsps(Folder, Lines);
    Lines.Add('');
    Lines.Add('Setup will identify the game, update and any DLC when opening these files.');
  end;
end;

function ConfirmRetryFolder(Folder: String): Boolean;
var
  Form: TSetupForm;
  Memo: TNewMemo;
  ConfirmButton, CancelButton: TNewButton;
begin
  Form := CreateCustomForm(ScaleX(500), ScaleY(340), False, True);
  try
    Form.Caption := 'Review game files';
    Form.ClientWidth := ScaleX(500);
    Form.ClientHeight := ScaleY(340);
    Form.Position := poScreenCenter;
    Memo := TNewMemo.Create(Form);
    Memo.Parent := Form;
    Memo.SetBounds(ScaleX(12), ScaleY(12), ScaleX(476), ScaleY(270));
    Memo.ReadOnly := True;
    Memo.ScrollBars := ssVertical;
    Memo.WordWrap := True;
    DescribeGameFiles(Folder, Memo.Lines);
    ConfirmButton := TNewButton.Create(Form);
    ConfirmButton.Parent := Form;
    ConfirmButton.SetBounds(ScaleX(300), ScaleY(300), ScaleX(90), ScaleY(26));
    ConfirmButton.Caption := 'Import';
    ConfirmButton.ModalResult := mrOk;
    ConfirmButton.Default := True;
    CancelButton := TNewButton.Create(Form);
    CancelButton.Parent := Form;
    CancelButton.SetBounds(ScaleX(398), ScaleY(300), ScaleX(90), ScaleY(26));
    CancelButton.Caption := 'Cancel';
    CancelButton.ModalResult := mrCancel;
    CancelButton.Cancel := True;
    Result := Form.ShowModal = mrOk;
  finally
    Form.Free;
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = GamePage.ID then begin
    HasImport := HasGameFiles;
    KeepFiles.Visible := HasImport;
    ImportFiles.Visible := HasImport;
    if HasImport and not ImportFiles.Checked then KeepFiles.Checked := True;
  end else if CurPageID = ReviewPage.ID then
    DescribeGameFiles(GamePage.Values[0], ReviewList.Lines);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := ((PageID = ReviewPage.ID) and HasImport and KeepFiles.Checked) or
    ((PageID = NspPage.ID) and
    ((HasImport and KeepFiles.Checked) or not HasNsp(GamePage.Values[0]) or
     LooksLikeDump(GamePage.Values[0])));
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Folder: String;
begin
  Result := True;
  if CurPageID = NspPage.ID then begin
    if not FileExists(NspPage.Values[0]) or not FileExists(NspPage.Values[1]) then begin
      MsgBox('Please choose your NSTool program and prod.keys file. Check that both files still exist.', mbError, MB_OK);
      Result := False;
    end;
    Exit;
  end;
  if (CurPageID <> GamePage.ID) or (HasImport and KeepFiles.Checked) then Exit;
  Folder := GamePage.Values[0];
  if not DirExists(Folder) then begin
    MsgBox('Please choose a folder that exists on your computer.', mbError, MB_OK);
    Result := False;
  end else if not LooksLikeDump(Folder) and not HasNsp(Folder) then begin
    MsgBox('Setup could not find extracted game files or NSP files in this folder. Please choose the folder containing your game files.', mbError, MB_OK);
    Result := False;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if WizardSilent then begin
    HasImport := HasGameFiles;
    if (ExpandConstant('{param:DUMP|}') = '') and not HasImport then
      Result := 'Divine Pulse needs your game files; supply /DUMP="<folder>".'
    else if (ExpandConstant('{param:DUMP|}') <> '') and HasNsp(ExpandConstant('{param:DUMP|}')) and
      not LooksLikeDump(ExpandConstant('{param:DUMP|}')) and
      ((not FileExists(ExpandConstant('{param:NSTOOL|}'))) or
       (not FileExists(ExpandConstant('{param:KEYS|}')))) then
      Result := 'NSP extraction requires /NSTOOL="<nstool.exe>" and /KEYS="<prod.keys>".';
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
  Folder, Reason, Nstool, Keys, Params: String;
  Lines: TArrayOfString;
  Code: Integer;
  Success, Retry: Boolean;
begin
  if CurStep <> ssPostInstall then Exit;
  if WizardSilent then begin
    Folder := ExpandConstant('{param:DUMP|}');
    Nstool := ExpandConstant('{param:NSTOOL|}');
    Keys := ExpandConstant('{param:KEYS|}');
  end
  else if HasImport and KeepFiles.Checked then Folder := ''
  else Folder := GamePage.Values[0];
  if not WizardSilent then begin
    Nstool := NspPage.Values[0];
    Keys := NspPage.Values[1];
  end;
  if Folder = '' then begin
    ShowBusy('Checking your game files...');
    Success := ValidImport;
    ShowResult(Success);
    if Success then Exit;
    Reason := 'Your current game files are missing or incomplete.';
    if WizardSilent then StopSetup(Reason);
    Folder := GamePage.Values[0];
    if (MsgBox(Reason + #13#10#13#10 + 'Choose OK to import them again, or Cancel to stop setup.',
        mbError, MB_OKCANCEL) <> IDOK) or
       not BrowseForFolder('Choose the folder with your game files:', Folder, False) then StopSetup(Reason);
    if not ConfirmRetryFolder(Folder) then StopSetup(Reason);
  end;
  repeat
    if HasNsp(Folder) and not LooksLikeDump(Folder) and not WizardSilent then begin
      if not FileExists(Nstool) and not GetOpenFileName('Choose your NSTool program', Nstool, '',
          'Executable files|*.exe|All files|*.*', 'exe') then StopSetup('NSTool is required.');
      if not FileExists(Keys) and not GetOpenFileName('Choose your prod.keys', Keys, '',
          'Key files|*.keys|All files|*.*', 'keys') then StopSetup('Your prod.keys is required.');
    end;
    ShowBusy('Importing your game files...');
    Params := '--import-game-files "' + Folder + '"';
    if Nstool <> '' then Params := Params + ' --nstool "' + Nstool + '"';
    if Keys <> '' then Params := Params + ' --keys "' + Keys + '"';
    if not Exec(ExpandConstant('{app}\{#AppExe}'), Params,
        '', SW_HIDE, ewWaitUntilTerminated, Code) then Code := -1;
    Success := Code = 0;
    ShowResult(Success);
    if Success then Exit;
    Reason := 'Setup could not start importing your game files.';
    if LoadStringsFromFile(DataFolder + '\game-assets-import.log', Lines) then
      if GetArrayLength(Lines) > 0 then Reason := Lines[GetArrayLength(Lines) - 1];
    Retry := False;
    if not WizardSilent then begin
      Retry := MsgBox('Setup could not import your game files: ' + Reason + #13#10#13#10 +
        'Choose Retry to select another folder, or Cancel to stop setup.', mbError, MB_RETRYCANCEL) = IDRETRY;
      if Retry then
        Retry := BrowseForFolder('Choose the folder with your game files:', Folder, False);
      if Retry then Retry := ConfirmRetryFolder(Folder);
      if Retry and HasNsp(Folder) and not LooksLikeDump(Folder) then begin
        Nstool := '';
        Keys := '';
      end;
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
