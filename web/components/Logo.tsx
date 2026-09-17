/**
 * The mark: a disc with a bite taken out of it, and two crumbs.
 *
 * It is one shape, monochrome, and it inherits currentColor, so it works on
 * ink or on paper without a second version. `id` exists because two copies on
 * one page would otherwise share the mask id and the second would render
 * uncut.
 */
export function Logo({ size = 28, id = 'nibble-mark' }: { size?: number; id?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} fill="currentColor" aria-hidden="true">
      <mask id={id}>
        <rect width="64" height="64" fill="#fff" />
        <circle cx="54" cy="12" r="17" fill="#000" />
      </mask>
      <circle cx="30" cy="34" r="23" mask={`url(#${id})`} />
      <circle cx="56" cy="46" r="5" />
    </svg>
  );
}

/** The same mark at menu-bar weight, for the demo's title bar. */
export function TrayGlyph({ className, id = 'nibble-tray' }: { className?: string; id?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="currentColor" aria-hidden="true">
      <mask id={id}>
        <rect width="64" height="64" fill="#fff" />
        <circle cx="53" cy="13" r="15" fill="#000" />
      </mask>
      <circle cx="30" cy="34" r="24" mask={`url(#${id})`} />
      <circle cx="58" cy="44" r="4" />
    </svg>
  );
}
