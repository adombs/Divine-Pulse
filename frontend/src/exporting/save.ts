/**
 * Saving an export (a replay's video, the team's images) where the user picks. In the desktop app the window's own
 * dialog picks the place (desktop.py `ExportDialogs`): one file is saved as, several go into a chosen folder. The
 * bytes go over in pieces, so a long video doesn't have to cross the bridge as one string. In a browser (development)
 * the browser downloads them.
 */
export type MediaKind = "mp4" | "png";

interface Bridge {
  begin_media_save?: (kind: MediaKind, filenames: string[]) => Promise<string | null>;
  write_media_chunk?: (token: string, index: number, base64: string) => Promise<boolean>;
  finish_media_save?: (token: string) => Promise<string[]>;
  cancel_media_save?: (token: string) => Promise<boolean>;
}

const CHUNK = 3 * 1024 * 1024;

const bridge = (): Bridge | undefined => (window as Window & { pywebview?: { api?: Bridge } }).pywebview?.api;

/** Whether saving asks the desktop window (otherwise the browser downloads). */
export const savesNatively = () => !!bridge()?.begin_media_save;

/** A file name without the characters Windows refuses. */
export const safeFilename = (name: string) => name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "") || "Divine Pulse";

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/**
 * Saves the files; with more than one, the user picks a folder for them all. Returns where they went (in a browser,
 * their names), or null when the user cancelled.
 */
export async function saveFiles(kind: MediaKind, files: { name: string; blob: Blob }[]): Promise<string[] | null> {
  const api = bridge();
  if (!api?.begin_media_save || !api.write_media_chunk || !api.finish_media_save) {
    for (const file of files) {
      const url = URL.createObjectURL(file.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
    return files.map((f) => f.name);
  }
  const token = await api.begin_media_save(kind, files.map((f) => f.name));
  if (!token) return null;
  try {
    for (const [index, file] of files.entries()) {
      const bytes = new Uint8Array(await file.blob.arrayBuffer());
      for (let at = 0; at < bytes.length; at += CHUNK) {
        await api.write_media_chunk(token, index, base64(bytes.subarray(at, at + CHUNK)));
      }
    }
    return await api.finish_media_save(token);
  } catch (error) {
    await api.cancel_media_save?.(token).catch(() => undefined);
    throw error;
  }
}
