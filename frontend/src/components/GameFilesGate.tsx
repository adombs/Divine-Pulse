import { useEffect, useState } from "react";
import { api } from "../api";
import { AboutSection } from "./SettingsPage";
import { GameFilesSection } from "./game-files/GameFilesSection";
import { Modal } from "./Modal";
import type { ToastState } from "./Toasts";
import { Toasts } from "./Toasts";
import "./game-files-gate.css";

export function GameFilesGate({ toasts }: { toasts: ToastState }) {
  const [desktop, setDesktop] = useState(false);
  const [about, setAbout] = useState(false);
  useEffect(() => { void api.about().then((info) => setDesktop(info.desktop)).catch(() => {}); }, []);
  return <main className="game-files-gate">
    <div className="game-files-gate-content">
      <header className="game-files-gate-banner">
        <img src="/brand/home-lockup-cream.png" alt="Divine Pulse" />
      </header>
      <section className="game-files-gate-sheet" aria-label="Import game files">
        <GameFilesSection desktop={desktop} />
        <button type="button" className="link-btn game-files-gate-about" onClick={() => setAbout(true)}>About</button>
      </section>
    </div>
    <Modal open={about} onClose={() => setAbout(false)} title="About"><AboutSection toasts={toasts} /></Modal>
    <Toasts state={toasts} />
  </main>;
}
