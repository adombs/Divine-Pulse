import { useEffect, useState } from "react";
import { availableGameLanguages, gameLanguage, languages, loadGameLanguage, onGameLanguageChange, setGameLanguage, type GameLanguage } from "../gameLanguage";

export function LanguageSelect() {
  const [, refresh] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const unsubscribe = onGameLanguageChange(() => refresh((n) => n + 1));
    void loadGameLanguage();
    return unsubscribe;
  }, []);
  return <label className="field-label">Game language <select value={gameLanguage()} disabled={!availableGameLanguages().length} onChange={(e) => {
    setError("");
    void setGameLanguage(e.target.value as GameLanguage).catch(() => setError("Could not save game language"));
  }}>{availableGameLanguages().map((code) => <option key={code} value={code}>{languages[code]}</option>)}</select>{error && <span className="form-error">{error}</span>}</label>;
}
