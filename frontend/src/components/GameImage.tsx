import { useEffect, useState, type ImgHTMLAttributes, type ReactNode, type SVGProps } from "react";
import { gameAssetUrl, gameAssetsAvailable, loadGameJson, onGameAssetsChange } from "../gameAssets";
import { importedMapImage, importedPortrait, portraitKeyFromUrl } from "./gameImageSources";

/** The imported image, or `fallback` (nothing by default) when there is no import or it lacks this file. */
export function GameImage({ imported, fallback = null, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  imported?: string | null; fallback?: ReactNode;
}) {
  const [version, setVersion] = useState(0);
  useEffect(() => onGameAssetsChange(() => setVersion((v) => v + 1)), []);
  const [failed, setFailed] = useState("");
  const source = gameAssetsAvailable() && imported ? gameAssetUrl(imported) : null;
  const key = `${version}:${source}`;
  if (!source || failed === key) return <>{fallback}</>;
  return <img {...props} src={source} onError={() => setFailed(key)} />;
}

/** CSS masks cannot receive error events, so probe the imported image before using it; "" until it has loaded. */
export function useGameImageUrl(imported: string): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let live = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      setUrl("");
      if (!gameAssetsAvailable() || !imported) return;
      const image = new Image();
      const candidate = gameAssetUrl(imported);
      image.onload = () => { if (live && current === generation) setUrl(candidate); };
      image.src = candidate;
    };
    load();
    const off = onGameAssetsChange(load);
    return () => { live = false; off(); };
  }, [imported]);
  return url;
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
  const imported = portrait || (source.startsWith("images/portraits/") ? source : null) || importedMapImage(source) || "";
  const directUrl = useGameImageUrl(direct ?? "");
  const url = useGameImageUrl(imported);
  return directUrl || url ? <image {...props} href={directUrl || url} /> : null;
}

/** Resolve a portrait by its bundled file name through the extracted index, refreshing after an import. */
export function PortraitImage({ bundled, fallback, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  bundled: string | null; fallback: ReactNode;
}) {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      setPath(null);
      void loadGameJson<{ app_keys?: Record<string, string> }>("data/portraits.json").then((data) => {
        if (live && current === generation) setPath(importedPortrait(bundled, data) ?? (bundled ? importedMapImage(bundled) : null));
      });
    };
    load();
    const unsubscribe = onGameAssetsChange(load);
    return () => { live = false; unsubscribe(); };
  }, [bundled]);
  return <GameImage {...props} imported={path} fallback={fallback} />;
}
