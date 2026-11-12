import { useEffect, useState, type ImgHTMLAttributes, type SVGProps } from "react";
import { gameAssetUrl, gameAssetsAvailable, loadGameJson, onGameAssetsChange } from "../gameAssets";
import { reportAssetIssue } from "../requiredAssets";
import { importedMapImage, importedPortrait, portraitKeyFromUrl } from "./gameImageSources";
import "./required-assets.css";

/** An explicit missing-asset sentinel. It is deliberately text, never substitute game artwork. */
export function MissingGameAsset({ path, label = "Game image", className = "" }: { path?: string | null; label?: string; className?: string }) {
  return <span className={`game-asset-missing ${className}`.trim()} role="img" aria-label={`${label} unavailable`}
    data-asset-error="missing" title={`${label} unavailable${path ? `: ${path}` : ""}. Reprocess your game files in Settings → Game files.`}>?</span>;
}

/** Only the requested imported image; missing paths and failed loads stay explicit. */
export function GameImage({ imported, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  imported?: string | null;
}) {
  const [version, setVersion] = useState(0);
  useEffect(() => onGameAssetsChange(() => setVersion((v) => v + 1)), []);
  const [failed, setFailed] = useState("");
  const source = gameAssetsAvailable() && imported ? gameAssetUrl(imported) : null;
  const key = `${version}:${source}`;
  if (!source || failed === key) return <MissingGameAsset path={imported} label={props.alt || "Game image"} className={props.className} />;
  return <img {...props} src={source} onError={() => { setFailed(key); reportAssetIssue(imported!, "unreadable"); }} />;
}

/** CSS masks cannot receive error events, so probe the imported image before using it; "" until it has loaded. */
export function useGameImageUrl(imported: string): string {
  const [loaded, setLoaded] = useState({ path: "", url: "" });
  useEffect(() => {
    let live = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      setLoaded({ path: imported, url: "" });
      if (!gameAssetsAvailable() || !imported) return;
      const image = new Image();
      const candidate = gameAssetUrl(imported);
      image.onload = () => { if (live && current === generation) setLoaded({ path: imported, url: candidate }); };
      image.onerror = () => { if (live && current === generation) reportAssetIssue(imported, "unreadable"); };
      image.src = candidate;
    };
    load();
    const off = onGameAssetsChange(load);
    return () => { live = false; off(); };
  }, [imported]);
  return loaded.path === imported && gameAssetsAvailable() ? loaded.url : "";
}

/** SVG image counterpart for the map's extracted atlases and minimap pieces. */
export function MapImage({ href, imported: direct, ...props }: SVGProps<SVGImageElement> & { imported?: string | null }) {
  const source = typeof href === "string" ? href : "";
  const [portrait, setPortrait] = useState("");
  useEffect(() => {
    let live = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      setPortrait("");
      const key = portraitKeyFromUrl(source);
      if (!key) return;
      void loadGameJson<{ app_keys?: Record<string, string> }>("data/portraits.json").then((data) => {
        if (live && current === generation) setPortrait(importedPortrait(source, data) ?? "");
      });
    };
    load();
    const off = onGameAssetsChange(load);
    return () => { live = false; off(); };
  }, [source]);
  const imported = direct ?? (portrait || (source.startsWith("images/portraits/") ? source : null) || importedMapImage(source) || "");
  const url = useGameImageUrl(imported);
  if (url) return <image {...props} href={url} />;
  return <text x={props.x ?? 0} y={props.y ?? 0} className="game-asset-map-missing" data-asset-error="missing" aria-label="Game image unavailable"><title>{`Game image unavailable: ${direct || source || "unresolved path"}. Reprocess your game files.`}</title>?</text>;
}

/** Resolve a portrait by its bundled file name through the extracted index, refreshing after an import. */
export function PortraitImage({ bundled, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  bundled: string | null;
}) {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      setPath(null);
      void loadGameJson<{ app_keys?: Record<string, string> }>("data/portraits.json").then((data) => {
        if (live && current === generation) {
          const resolved = importedPortrait(bundled, data) ?? (bundled ? importedMapImage(bundled) : null);
          setPath(resolved);
          if (bundled && !resolved && gameAssetsAvailable()) reportAssetIssue(`portrait:${bundled}`, "missing");
        }
      });
    };
    load();
    const unsubscribe = onGameAssetsChange(load);
    return () => { live = false; unsubscribe(); };
  }, [bundled]);
  return <GameImage {...props} imported={path} />;
}
