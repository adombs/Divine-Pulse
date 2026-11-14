/** Keep overlays inside the map viewport and show complete dedicated-log rows in a fixed video frame. */
export function fitReplayFrame(root: HTMLElement): void {
  const layer = root.querySelector<HTMLElement>(".replay-stage-overlays");
  const map = root.querySelector<HTMLElement>(".replay-stage-map");
  const svg = map?.querySelector<SVGSVGElement>("svg.minimap");
  if (layer && map && svg) {
    const frame = map.getBoundingClientRect(), image = svg.getBoundingClientRect();
    const cssScale = frame.width / Math.max(1, map.offsetWidth);
    const view = svg.viewBox.baseVal;
    const factor = Math.min(svg.clientWidth / view.width, svg.clientHeight / view.height);
    const width = view.width * factor, height = view.height * factor;
    Object.assign(layer.style, { inset: "auto", left: `${(image.left - frame.left) / cssScale - map.clientLeft + (svg.clientWidth - width) / 2}px`, top: `${(image.top - frame.top) / cssScale - map.clientTop + (svg.clientHeight - height) / 2}px`, width: `${width}px`, height: `${height}px` });
  }
  if (layer) for (const corner of layer.querySelectorAll<HTMLElement>(".replay-stage-corner")) {
    corner.style.transform = "";
    const width = Math.max(corner.scrollWidth, corner.offsetWidth);
    const height = Math.max(corner.scrollHeight, corner.offsetHeight);
    const peers = Array.from(layer.querySelectorAll<HTMLElement>(".replay-stage-corner")).filter((other) => other !== corner && other.children.length);
    const right = corner.classList.contains("top-right") || corner.classList.contains("bottom-right");
    const bottom = corner.classList.contains("bottom-left") || corner.classList.contains("bottom-right");
    const shareRow = peers.some((other) => (other.classList.contains("bottom-left") || other.classList.contains("bottom-right")) === bottom);
    const shareColumn = peers.some((other) => (other.classList.contains("top-right") || other.classList.contains("bottom-right")) === right);
    const roomW = layer.clientWidth / (shareRow ? 2 : 1) - 28;
    const roomH = layer.clientHeight / (shareColumn ? 2 : 1) - 28;
    const scale = Math.min(1, Math.max(1, roomW) / Math.max(1, width), Math.max(1, roomH) / Math.max(1, height));
    corner.style.transform = `scale(${scale})`;
  }
  const box = root.querySelector<HTMLElement>(".replay-stage-rows");
  const list = box?.querySelector<HTMLElement>(".log-list");
  if (!box || !list) return;
  // Keep the full list in normal chronological order. Anchor its bottom to the viewport,
  // then clip at a row boundary instead of hiding rows or scaling the log's layout.
  const rows = Array.from(list.children) as HTMLElement[];
  const available = Math.max(1, box.clientHeight - 4);
  let cutoff = rows.at(-1)?.offsetTop ?? 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (list.offsetHeight - rows[i].offsetTop > available) break;
    cutoff = rows[i].offsetTop;
  }
  list.style.clipPath = `inset(${Math.max(0, cutoff)}px 0 0)`;
}
