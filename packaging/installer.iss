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
  SourcePage: TWizardPage;
  NspPage: TInputFileWizardPage;
  KeepPage: TWizardPage;
  KeepDumps: TNewCheckBox;
  DumpDestination: TNewEdit;
  DumpDestinationLabel, DumpHelp: TNewStaticText;
  DumpBrowse: TNewButton;
  NspSelectPage: TWizardPage;
  NspList: TNewListBox;
  ReviewPage: TWizardPage;
  ReviewList: TNewMemo;
  UseDump, UseNsps: TRadioButton;
  HasImport, Stopped, WantNsps: Boolean;

function GetFileAttributes(FileName: String): LongWord;
  external 'GetFileAttributesW@kernel32.dll stdcall';

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

procedure AddNspClick(Sender: TObject);
var
  FileName: String;
begin
  FileName := '';
  if GetOpenFileName('Choose a Three Houses NSP', FileName, GamePage.Values[0],
      'NSP files|*.nsp', 'nsp') and (NspList.Items.IndexOf(FileName) < 0) then
    NspList.Items.Add(FileName);
end;

procedure RemoveNspClick(Sender: TObject);
begin
  if NspList.ItemIndex >= 0 then NspList.Items.Delete(NspList.ItemIndex);
end;

procedure KeepDumpsClick(Sender: TObject);
begin
  DumpDestinationLabel.Visible := KeepDumps.Checked;
  DumpDestination.Visible := KeepDumps.Checked;
  DumpBrowse.Visible := KeepDumps.Checked;
  DumpHelp.Visible := KeepDumps.Checked;
end;

procedure DumpBrowseClick(Sender: TObject);
var
  Parent: String;
begin
  Parent := ExtractFileDir(DumpDestination.Text);
  if BrowseForFolder('Choose a parent folder for the new raw dump folder:', Parent, False) then
    DumpDestination.Text := AddBackslash(Parent) + 'Divine Pulse Dump';
end;

// Probe only a fresh temporary child in the parent. Never create or clear the destination here.
function DumpDestinationError(Destination: String): String;
var
  Parent, Probe, Part, Remaining: String;
  I: Integer;
  Created: Boolean;
begin
  Result := '';
  if (Destination = '') or (ExtractFileDrive(Destination) = '') or
      (CompareText(Destination, ExpandFileName(Destination)) <> 0) then begin
    Result := 'Enter a full path to a new folder inside an existing parent folder.';
    Exit;
  end;
  Remaining := Copy(Destination, Length(ExtractFileDrive(Destination)) + 2, MaxInt);
  while Remaining <> '' do begin
    I := Pos('\', Remaining);
    if I = 0 then I := Length(Remaining) + 1;
    Part := Copy(Remaining, 1, I - 1);
    Delete(Remaining, 1, I);
    if (Part = '') or (Part = '.') or (Part = '..') or
        (Copy(Part, Length(Part), 1) = '.') or (Trim(Part) <> Part) then begin
      Result := 'Choose a valid new folder name without trailing spaces or dots.';
      Exit;
    end;
    for I := 1 to Length(Part) do
      if (Pos(Part[I], '<>:"|?*') > 0) or (Ord(Part[I]) < 32) then begin
        Result := 'Choose a valid new folder name without < > : " | ? or *.';
        Exit;
      end;
    Part := Uppercase(Copy(Part, 1, Pos('.', Part + '.') - 1));
    if (Part = 'CON') or (Part = 'PRN') or (Part = 'AUX') or (Part = 'NUL') or
        ((Length(Part) = 4) and ((Copy(Part, 1, 3) = 'COM') or (Copy(Part, 1, 3) = 'LPT')) and
        (Pos(Part[4], '123456789') > 0)) then begin
      Result := 'Choose a folder name that is not reserved by Windows.';
      Exit;
    end;
  end;
  if DirExists(Destination) or FileExists(Destination) then begin
    Result := 'This destination already exists. Add a new child folder name; setup never reuses an existing folder.';
    Exit;
  end;
  if (Pos(Lowercase(AddBackslash(AppDir)), Lowercase(AddBackslash(Destination))) = 1) or
      (Pos(Lowercase(AddBackslash(DataFolder)), Lowercase(AddBackslash(Destination))) = 1) then begin
    Result := 'Save raw dumps outside the application installation and data folders.';
    Exit;
  end;
  Parent := ExtractFileDir(Destination);
  if not DirExists(Parent) then begin
    Result := 'The parent folder must already exist. Browse to it, then add a new folder name.';
    Exit;
  end;
  Remaining := Parent;
  while Remaining <> '' do begin
    if GetFileAttributes(Remaining) and FILE_ATTRIBUTE_REPARSE_POINT <> 0 then begin
      Result := 'Choose a destination outside linked folders or junctions.';
      Exit;
    end;
    Part := ExtractFileDir(Remaining);
    if Part = Remaining then Break;
    Remaining := Part;
  end;
  Probe := '';
  Created := False;
  try
    Probe := GenerateUniqueName(Parent, '.tmp');
    if Probe <> '' then Created := CreateDir(Probe);
    if not Created then begin
      Result := 'Setup cannot write to this parent folder. Choose a writable folder.';
    end;
  except
    Result := 'Setup cannot write to this parent folder. Choose a writable folder.';
  end;
  if Created then RemoveDir(Probe);
end;

procedure InitializeWizard;
var
  AddButton, RemoveButton: TNewButton;
  TemporaryHelp: TNewStaticText;
begin
  SourcePage := CreateCustomPage(wpSelectDir, 'Game files',
    'Choose how you will provide your Fire Emblem: Three Houses game files.');
  UseDump := TRadioButton.Create(SourcePage);
  UseDump.Parent := SourcePage.Surface;
  UseDump.Caption := 'Extracted RomFS and ExeFS folders';
  UseDump.SetBounds(0, ScaleY(12), SourcePage.SurfaceWidth, ScaleY(24));
  UseNsps := TRadioButton.Create(SourcePage);
  UseNsps.Parent := SourcePage.Surface;
  UseNsps.Caption := 'Select my NSP files';
  UseNsps.SetBounds(0, ScaleY(44), SourcePage.SurfaceWidth, ScaleY(24));
  GamePage := CreateInputDirPage(SourcePage.ID, 'Extracted game files', 'Choose your extracted game files',
    'Choose the folder containing your RomFS and ExeFS, update 1.2.0, and any DLC you own.', False, '');
  GamePage.Add('Folder containing the extracted game files:');
  GamePage.Values[0] := LastDump;
  NspSelectPage := CreateCustomPage(GamePage.ID, 'Choose NSP files',
    'Add your Three Houses base game, update 1.2.0, and any DLC files. Only the files listed here will be imported.');
  NspList := TNewListBox.Create(NspSelectPage);
  NspList.Parent := NspSelectPage.Surface;
  NspList.SetBounds(0, 0, NspSelectPage.SurfaceWidth, ScaleY(170));
  AddButton := TNewButton.Create(NspSelectPage);
  AddButton.Parent := NspSelectPage.Surface;
  AddButton.SetBounds(0, ScaleY(178), ScaleX(110), ScaleY(25));
  AddButton.Caption := 'Add NSP...';
  AddButton.OnClick := @AddNspClick;
  RemoveButton := TNewButton.Create(NspSelectPage);
  RemoveButton.Parent := NspSelectPage.Surface;
  RemoveButton.SetBounds(ScaleX(118), ScaleY(178), ScaleX(110), ScaleY(25));
  RemoveButton.Caption := 'Remove selected';
  RemoveButton.OnClick := @RemoveNspClick;
  ReviewPage := CreateCustomPage(NspSelectPage.ID, 'Review game files',
    'Review what setup found. Your files will be checked when they are imported.');
  ReviewList := TNewMemo.Create(ReviewPage);
  ReviewList.Parent := ReviewPage.Surface;
  ReviewList.SetBounds(0, 0, ReviewPage.SurfaceWidth, ReviewPage.SurfaceHeight);
  ReviewList.ReadOnly := True;
  ReviewList.ScrollBars := ssVertical;
  ReviewList.WordWrap := True;
  NspPage := CreateInputFilePage(ReviewPage.ID, 'Open NSP files', 'Choose your keys file',
    'Setup includes NSTool. To open your NSP files, choose your own prod.keys file.');
  NspPage.Add('Your prod.keys file:', 'Key files|*.keys|All files|*.*', '.keys');
  KeepPage := CreateCustomPage(NspPage.ID, 'Save raw game files',
    'Choose whether to keep the files extracted from your NSPs.');
  KeepDumps := TNewCheckBox.Create(KeepPage);
  KeepDumps.Parent := KeepPage.Surface;
  KeepDumps.SetBounds(0, ScaleY(12), KeepPage.SurfaceWidth, ScaleY(24));
  KeepDumps.Caption := 'Save raw files extracted from NSPs';
  KeepDumps.Checked := False;
  KeepDumps.OnClick := @KeepDumpsClick;
  TemporaryHelp := TNewStaticText.Create(KeepPage);
  TemporaryHelp.Parent := KeepPage.Surface;
  TemporaryHelp.SetBounds(0, ScaleY(38), KeepPage.SurfaceWidth, ScaleY(20));
  TemporaryHelp.Caption := 'Leave unchecked to remove raw files after importing.';
  DumpDestinationLabel := TNewStaticText.Create(KeepPage);
  DumpDestinationLabel.Parent := KeepPage.Surface;
  DumpDestinationLabel.SetBounds(0, ScaleY(60), KeepPage.SurfaceWidth, ScaleY(20));
  DumpDestinationLabel.Caption := 'New folder for the raw files:';
  DumpDestination := TNewEdit.Create(KeepPage);
  DumpDestination.Parent := KeepPage.Surface;
  DumpDestination.SetBounds(0, ScaleY(84), KeepPage.SurfaceWidth - ScaleX(92), ScaleY(23));
  DumpDestination.Text := ExpandConstant('{userdocs}\Divine Pulse Dump');
  DumpDestinationLabel.FocusControl := DumpDestination;
  DumpBrowse := TNewButton.Create(KeepPage);
  DumpBrowse.Parent := KeepPage.Surface;
  DumpBrowse.SetBounds(KeepPage.SurfaceWidth - ScaleX(84), ScaleY(83), ScaleX(84), ScaleY(25));
  DumpBrowse.Caption := 'Browse...';
  DumpBrowse.OnClick := @DumpBrowseClick;
  DumpHelp := TNewStaticText.Create(KeepPage);
  DumpHelp.Parent := KeepPage.Surface;
  DumpHelp.SetBounds(0, ScaleY(122), KeepPage.SurfaceWidth, ScaleY(90));
  DumpHelp.WordWrap := True;
  DumpHelp.Caption := 'Choose a new child folder inside an existing writable folder. Existing folders are never reused.' + #13#10#13#10 +
    'Unchecked: raw files are temporary. Checked: raw files are kept only after a successful import. Your NSPs and keys stay where they are.';
  // Windows accessibility names edits from the preceding label in the window order.
  DumpDestination.BringToFront;
  DumpDestinationLabel.BringToFront;
  KeepDumpsClick(nil);
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

procedure DescribeGameFiles(Folder: String; Lines: TStrings);
var
  I: Integer;
begin
  Lines.Clear;
  if not WantNsps then begin
    Lines.Add('Selected folder: ' + Folder);
    Lines.Add('');
    Lines.Add('Found extracted game files.');
    if HasNsp(Folder) then
      Lines.Add('NSP files were also found. Setup will use the extracted game files.');
    Lines.Add('');
    ListDumpParts(Folder, Lines);
    Lines.Add('');
    Lines.Add('Setup will check the game, update and any DLC when importing.');
  end else begin
    Lines.Add('Selected NSP files:');
    Lines.Add('');
    for I := 0 to NspList.Items.Count - 1 do
      Lines.Add('NSP: ' + NspList.Items[I]);
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
  if CurPageID = SourcePage.ID then HasImport := HasGameFiles
  else if CurPageID = ReviewPage.ID then
    DescribeGameFiles(GamePage.Values[0], ReviewList.Lines);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  // Native input pages also validate their controls when silent. Use only the command-line preflight then.
  Result := WizardSilent and ((PageID = SourcePage.ID) or (PageID = GamePage.ID) or
    (PageID = NspSelectPage.ID) or (PageID = ReviewPage.ID) or
    (PageID = NspPage.ID) or (PageID = KeepPage.ID));
  if Result then Exit;
  Result := ((PageID = GamePage.ID) and WantNsps) or
    ((PageID = NspSelectPage.ID) and not WantNsps) or
    ((PageID = NspPage.ID) and not WantNsps) or
    ((PageID = KeepPage.ID) and not WantNsps);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  Folder, Error: String;
begin
  Result := True;
  // Silent setup advances these pages too. Its inputs are validated in PrepareToInstall.
  if WizardSilent then Exit;
  if CurPageID = KeepPage.ID then begin
    if KeepDumps.Checked then begin
      Error := DumpDestinationError(DumpDestination.Text);
      if Error <> '' then begin
        MsgBox(Error, mbError, MB_OK);
        WizardForm.ActiveControl := DumpDestination;
        Result := False;
      end;
    end;
    Exit;
  end;
  if CurPageID = SourcePage.ID then begin
    if not UseDump.Checked and not UseNsps.Checked then begin
      MsgBox('Choose either extracted game files or NSP files.', mbError, MB_OK);
      Result := False;
    end else WantNsps := UseNsps.Checked;
    Exit;
  end;
  if CurPageID = NspSelectPage.ID then begin
    if NspList.Items.Count = 0 then begin
      MsgBox('Please add your Three Houses NSP files.', mbError, MB_OK);
      Result := False;
    end;
    Exit;
  end;
  if CurPageID = NspPage.ID then begin
    if not FileExists(NspPage.Values[0]) then begin
      MsgBox('Please choose your prod.keys file. Check that the file still exists.', mbError, MB_OK);
      Result := False;
    end;
    Exit;
  end;
  if CurPageID <> GamePage.ID then Exit;
  Folder := GamePage.Values[0];
  if not DirExists(Folder) then begin
    MsgBox('Please choose a folder that exists on your computer.', mbError, MB_OK);
    Result := False;
  end else if not LooksLikeDump(Folder) then begin
    MsgBox('Setup could not find extracted game files in this folder. Please choose the folder containing your RomFS and ExeFS.', mbError, MB_OK);
    Result := False;
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  I: Integer;
  NspPath: String;
begin
  Result := '';
  if WizardSilent then begin
    HasImport := HasGameFiles;
    if (ExpandConstant('{param:DUMP|}') = '') and (ExpandConstant('{param:NSP1|}') = '') then
      Result := 'Provide extracted files with /DUMP="<folder>" or select NSPs with /NSP1="<file>".'
    else if ExpandConstant('{param:NSP1|}') <> '' then begin
      if not FileExists(ExpandConstant('{param:KEYS|}')) then
        Result := 'NSP extraction requires /KEYS="<prod.keys>".';
      for I := 1 to 16 do begin
        NspPath := ExpandConstant('{param:NSP' + IntToStr(I) + '|}');
        if (NspPath <> '') and not FileExists(NspPath) then
          Result := 'A selected NSP file does not exist: ' + NspPath;
      end;
    end else if (ExpandConstant('{param:DUMP|}') <> '') and HasNsp(ExpandConstant('{param:DUMP|}')) and
      not LooksLikeDump(ExpandConstant('{param:DUMP|}')) then
      Result := 'Select NSP files with /NSP1="<file>" and /NSP2="<file>" (up to /NSP16).';
    if ExpandConstant('{param:KEEPDUMPS|}') <> '' then begin
      if ExpandConstant('{param:NSP1|}') = '' then
        Result := '/KEEPDUMPS="<new folder>" requires /NSP1="<file>".'
      else if Result = '' then
        Result := DumpDestinationError(ExpandConstant('{param:KEEPDUMPS|}'));
    end;
    for I := 1 to ParamCount do
      if (CompareText(ParamStr(I), '/KEEPDUMPS') = 0) or
          (CompareText(ParamStr(I), '/KEEPDUMPS=') = 0) then
        Result := '/KEEPDUMPS requires a full path to a new folder.';
  end else if WantNsps and KeepDumps.Checked then begin
    Result := DumpDestinationError(DumpDestination.Text);
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
  Code, I: Integer;
  Success, Retry, UsingNsps: Boolean;
begin
  if CurStep <> ssPostInstall then Exit;
  if WizardSilent then begin
    Folder := ExpandConstant('{param:DUMP|}');
    Nstool := ExpandConstant('{param:NSTOOL|}');
    Keys := ExpandConstant('{param:KEYS|}');
    if (Folder = '') and (ExpandConstant('{param:NSP1|}') <> '') then
      Folder := ExtractFileDir(ExpandConstant('{param:NSP1|}'));
  end else if WantNsps then Folder := ExtractFileDir(NspList.Items[0])
  else Folder := GamePage.Values[0];
  if not WizardSilent then begin
    Nstool := '';
    Keys := NspPage.Values[0];
  end;
  if Nstool = '' then Nstool := ExpandConstant('{app}\tools\nstool.exe');
  repeat
    UsingNsps := (not WizardSilent and WantNsps) or
      (WizardSilent and (ExpandConstant('{param:NSP1|}') <> ''));
    if UsingNsps then begin
      if not WizardSilent and (NspList.Items.Count = 0) then StopSetup('To select NSP files, restart setup.');
      if not FileExists(Keys) then begin
        if WizardSilent then StopSetup('Your prod.keys is required.');
        if not GetOpenFileName('Choose your prod.keys', Keys, '',
            'Key files|*.keys|All files|*.*', 'keys') then StopSetup('Your prod.keys is required.');
      end;
    end;
    ShowBusy('Importing your game files...');
    Params := '--import-game-files "' + Folder + '"';
    if UsingNsps then begin
      if WizardSilent then begin
        for I := 1 to 16 do begin
          Reason := ExpandConstant('{param:NSP' + IntToStr(I) + '|}');
          if Reason <> '' then Params := Params + ' --nsp "' + Reason + '"';
        end;
      end else
        for I := 0 to NspList.Items.Count - 1 do
          Params := Params + ' --nsp "' + NspList.Items[I] + '"';
    end;
    if Nstool <> '' then Params := Params + ' --nstool "' + Nstool + '"';
    if Keys <> '' then Params := Params + ' --keys "' + Keys + '"';
    if UsingNsps then begin
      if WizardSilent then begin
        Reason := ExpandConstant('{param:KEEPDUMPS|}');
        if Reason <> '' then Params := Params + ' --keep-dumps "' + Reason + '"';
      end else if KeepDumps.Checked then
        Params := Params + ' --keep-dumps "' + DumpDestination.Text + '"';
    end;
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
      if UsingNsps then
        StopSetup(Reason + #13#10#13#10 + 'Restart setup to choose NSP files again.');
      Retry := MsgBox('Setup could not import your game files: ' + Reason + #13#10#13#10 +
        'Choose Retry to select another folder, or Cancel to stop setup.', mbError, MB_RETRYCANCEL) = IDRETRY;
      if Retry then
        Retry := BrowseForFolder('Choose the folder with your game files:', Folder, False);
      if Retry and not LooksLikeDump(Folder) then
        StopSetup('To select NSP files, restart setup.');
      if Retry then WantNsps := False;
      if Retry then Retry := ConfirmRetryFolder(Folder);
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
