/**
 * A unit's notes: plain text in which @ links an Archive entry. A link shows as its in-game icon and name (units by
 * name alone), opens the entry on click, and is deleted whole with Backspace. Saved as text with each link written
 * @[label](kind:id) (planner.ts).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { gameAssetsAvailable, gameAssetUrl } from "../../gameAssets";
import { useNav } from "../../nav";
import { KIND_LABEL, LINK_KINDS, linkRoute, linkToken, mentionQuery, parseNotes, searchEntries, type ArchiveEntry, type LinkKind, type NoteLink } from "../../planner";
import type { ReferenceData } from "../../reference/types";
import { EntryMenu, entryIcon } from "./entries";

const LINK_CLASS = "note-link";

/** A link as an element the caret steps over: the icon (when there is one) and the name. */
function linkElement(link: NoteLink, ref: ReferenceData | null): HTMLElement {
  const el = document.createElement("span");
  el.className = `${LINK_CLASS} kind-${link.kind}`;
  el.contentEditable = "false";
  el.dataset.kind = link.kind;
  el.dataset.id = link.id;
  el.dataset.label = link.label;
  el.title = `${KIND_LABEL[link.kind]}: open in the Archive`;
  decorate(el, ref);
  const name = document.createElement("span");
  name.className = "note-link-name";
  name.textContent = link.label;
  el.append(name);
  return el;
}

/** Puts a link's icon in (once the game's icons are there). */
function decorate(el: HTMLElement, ref: ReferenceData | null) {
  if (el.querySelector("img")) return;
  const path = entryIcon(el.dataset.kind as LinkKind, el.dataset.id ?? "", ref);
  if (!path || !gameAssetsAvailable()) return;
  const img = document.createElement("img");
  img.className = "ref-icon";
  img.alt = "";
  img.draggable = false;
  img.src = gameAssetUrl(path);
  img.onerror = () => img.remove();
  el.prepend(img);
}

/** The saved text of the editor's content. */
function serialize(root: HTMLElement): string {
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { out += (node.nodeValue ?? "").replace(/​/g, ""); return; }
    if (!(node instanceof HTMLElement)) return;
    if (node.classList.contains(LINK_CLASS)) {
      const kind = node.dataset.kind as LinkKind;
      if (LINK_KINDS.includes(kind)) out += linkToken({ kind, id: node.dataset.id ?? "", label: node.dataset.label ?? "" });
      return;
    }
    if (node.tagName === "BR") { if (!node.dataset.end) out += "\n"; return; }
    // A pasted or browser-made block starts a new line.
    const block = node.tagName === "DIV" || node.tagName === "P";
    if (block && out && !out.endsWith("\n")) out += "\n";
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out;
}

/** The editor's content for saved text, with the closing <br> that lets an empty last line show. */
function render(root: HTMLElement, text: string, ref: ReferenceData | null) {
  root.replaceChildren(...parseNotes(text).map((p) => ("link" in p ? linkElement(p.link, ref) : document.createTextNode(p.text))));
  ensureEnd(root);
}

function ensureEnd(root: HTMLElement) {
  const last = root.lastChild;
  if (last instanceof HTMLElement && last.dataset.end) return;
  root.querySelectorAll("br[data-end]").forEach((b) => b.remove());
  const end = document.createElement("br");
  end.dataset.end = "1";
  root.append(end);
}

interface Mention { node: Text; start: number; end: number; query: string; anchor: DOMRect }

export function NotesEditor({
  value,
  onChange,
  entries,
  data: ref,
  label,
}: {
  value: string;
  onChange: (text: string) => void;
  entries: ArchiveEntry[];
  data: ReferenceData | null;
  label: string;
}) {
  const nav = useNav();
  const root = useRef<HTMLDivElement>(null);
  const [mention, setMention] = useState<Mention | null>(null);
  const [active, setActive] = useState(0);
  const [empty, setEmpty] = useState(!value);
  const items = useMemo(() => (mention ? searchEntries(entries, mention.query) : []), [entries, mention]);

  // The saved text is drawn once; after that the editor holds it, and every change is passed up.
  useLayoutEffect(() => {
    if (root.current) render(root.current, value, ref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Icons can arrive after the text (the Archive and the game's icons load on their own).
  useEffect(() => {
    root.current?.querySelectorAll<HTMLElement>(`.${LINK_CLASS}`).forEach((el) => decorate(el, ref));
  }, [ref, entries]);

  const changed = () => {
    const el = root.current;
    if (!el) return;
    ensureEnd(el);
    const text = serialize(el);
    setEmpty(!text);
    onChange(text);
    findMention();
  };

  /** The @ being typed at the caret, if any. */
  const findMention = () => {
    const sel = window.getSelection();
    const node = sel?.anchorNode;
    if (!sel || !sel.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE || !root.current?.contains(node)) return setMention(null);
    const offset = sel.anchorOffset;
    const before = (node.nodeValue ?? "").slice(0, offset).split("\n").pop() ?? "";
    const query = mentionQuery(before);
    if (query === null) return setMention(null);
    const range = document.createRange();
    range.setStart(node, offset - query.length - 1);
    range.setEnd(node, offset - query.length);
    const anchor = range.getBoundingClientRect();
    setMention((m) => {
      if (m?.query !== query) setActive(0);
      return { node: node as Text, start: offset - query.length - 1, end: offset, query, anchor };
    });
  };

  const pick = (entry: ArchiveEntry) => {
    const m = mention;
    const el = root.current;
    if (!m || !el) return;
    const range = document.createRange();
    range.setStart(m.node, m.start);
    range.setEnd(m.node, Math.min(m.end, m.node.length));
    range.deleteContents();
    const link = linkElement({ kind: entry.kind, id: entry.id, label: entry.label }, ref);
    const space = document.createTextNode(" ");
    range.insertNode(space);
    range.insertNode(link);
    const sel = window.getSelection();
    const caret = document.createRange();
    caret.setStart(space, 1);
    caret.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(caret);
    el.focus();
    setMention(null);
    changed();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (mention) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((a) => (a + step + items.length) % Math.max(items.length, 1));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && items[active]) {
        e.preventDefault();
        pick(items[active]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMention(null);
        return;
      }
    }
    // A new line is a line break in the text, never a new block.
    if (e.key === "Enter") {
      e.preventDefault();
      document.execCommand("insertText", false, "\n");
    }
  };

  return (
    <div className="notes-editor">
      <div
        ref={root}
        className={`notes-text${empty ? " empty" : ""}`}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label={label}
        data-placeholder="Type @ to link a unit, class, item…"
        spellCheck
        onInput={changed}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) findMention(); }}
        onMouseUp={findMention}
        onBlur={() => setMention(null)}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
        }}
        onDrop={(e) => e.preventDefault()}
        onClick={(e) => {
          const link = (e.target as HTMLElement).closest<HTMLElement>(`.${LINK_CLASS}`);
          if (link) nav.go(linkRoute({ kind: link.dataset.kind as LinkKind, id: link.dataset.id ?? "" }));
        }}
      />
      {mention && (
        <EntryMenu
          id="notes-mentions"
          anchor={mention.anchor}
          items={items}
          active={active}
          onHover={setActive}
          onPick={pick}
          data={ref}
          showKind
          empty={entries.length ? "No matches" : "The Archive is still loading"}
        />
      )}
    </div>
  );
}
