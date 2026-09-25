/*
 * The official ShelraCode mark: a prompt chevron and a cursor, as drawn in the favicon
 * (public/brand/shelra-icon.svg, 64x64 grid). The viewBox is cropped to the drawn shape, square caps and
 * miter tip included, so it lines up with text. It takes the current colour.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="12.5 14.5 37 35" className={className} aria-hidden="true" focusable="false">
      <path
        d="M17 19 L33 32 L17 45"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <rect x="35" y="41" width="14" height="6" fill="currentColor" />
    </svg>
  );
}
