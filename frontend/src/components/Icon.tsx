/**
 * Every icon in the app, from one pack (Phosphor Icons, MIT, in its duotone weight), by what it means rather than
 * what it looks like: pages, controls, the log's kinds of action, marks in tables. Icons are sized by the text around
 * them (1em) and drawn in its colour. Use `Icon` instead of text glyphs (▸ ✕ ⚔), so the whole app looks of a piece.
 * The list of icons is in scripts/build-icons.mjs, which builds iconPaths.ts.
 */
import { ICON_PATHS } from "./iconPaths";

export type IconName = keyof typeof ICON_PATHS;
type Weight = "duotone" | "fill";

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function Icon({ name, className, title, weight = "duotone" }: { name: IconName; className?: string; title?: string; weight?: Weight }) {
  const paths: Partial<Record<Weight, string>> = ICON_PATHS[name];
  const body = paths[weight] ?? paths.duotone;
  return (
    <svg
      className={`icon${className ? ` ${className}` : ""}`}
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      dangerouslySetInnerHTML={{ __html: title ? `<title>${escape(title)}</title>${body}` : body! }}
    />
  );
}

/** A button that is only an icon (its label says what it does, on hover and to screen readers). */
export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  primary,
  className,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  primary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`btn small icon-only${primary ? " primary" : ""}${className ? ` ${className}` : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      title={label}
      aria-label={label}
    >
      <Icon name={icon} />
    </button>
  );
}
