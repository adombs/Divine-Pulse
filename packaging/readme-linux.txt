Divine Pulse {version}
=====================

Install
  Unpack the archive and run "Divine Pulse" in the folder, or run ./install.sh in
  it to copy the program to ~/.local/opt/divine-pulse and add it to your
  applications menu (no administrator rights needed).

First launch
  Open it. Everything it needs is in the folder. If it doesn't open, start it from
  a terminal to see why.

Import your game
  In the app, import an extracted game folder, or select NSPs and your prod.keys
  (NSP import needs NSTool: https://github.com/jakcron/nstool/releases/latest,
  ubuntu_x86_64; leave it in Downloads or put it on your PATH). Include the base
  game and update 1.2.0. Create or load a run and start the game in Eden or Ryubing.

Your data
  Your runs, battles and settings are saved in ~/.local/share/Divine Pulse
  (Settings > About > Open), or in a "data" folder next to the program if you
  create one.

Updating
  Quit the app and run the newer version's ./install.sh, or replace the program's
  folder. Your data folder is kept.

Removing
  Run ./install.sh --uninstall, or delete the program's folder. Export any records
  you want to keep, then delete ~/.local/share/Divine Pulse to remove your runs,
  battle history, imported game files and settings too.

Requirements
  64-bit Linux with glibc 2.35 or newer (Ubuntu 22.04, Debian 12, Fedora 36,
  SteamOS 3.5 or newer) and a desktop session (X11 or Wayland), and Eden with
  fastmem enabled, or Ryubing (or Ryujinx), running Fire Emblem: Three Houses
  v1.2.0. The game is read without root and without changing any system setting.
  AppImage, Flatpak and native copies of the emulators work.

Player guide: https://github.com/adombs/Divine-Pulse#readme
