# ShelraCode brand kit

The official mark is a prompt chevron and a cursor (`>_`), green on the site's near-black. These files are
served by the website at `https://www.shelra.dev/brand/<file>` and live in the repository at
`frontend/public/brand/`.

| File | What it is | Use it on |
| --- | --- | --- |
| `shelra-icon.svg` | The mark on its dark square (the favicon) | App icons, avatars, social profiles |
| `shelra-icon-512.png`, `shelra-icon-1024.png` | The same, rendered | Where an SVG is not accepted |
| `shelra-mark.svg`, `shelra-mark-512.png` | The mark alone, green, transparent | Dark backgrounds |
| `shelra-mark-black.svg`, `shelra-mark-black-512.png` | The mark alone, near-black, transparent | Light backgrounds |
| `shelra-logo.svg`, `shelra-logo.png` | The mark and "shelra", green and light grey, transparent | Dark backgrounds |
| `shelra-logo-black.svg`, `shelra-logo-black.png` | The mark and "shelra", near-black, transparent | Light backgrounds |
| `shelra-logo-on-dark.png` | The logo on the site's background, 1600x600 | Banners, headers, slides |

- **Colours:** green `#00ff88`, near-black `#080808`, light grey `#f0f0f0`. No gradients.
- **Type:** the name is Geist Mono Medium (weight 500) with -0.04em letter-spacing, outlined in the SVGs, so
  they need no font installed.
- **Clear space:** keep at least the width of the cursor bar free around the logo.
- **Proportions:** the mark is as tall as the name's ascenders (`h`, `l`) and sits 0.36em before it. Do not
  stretch, recolour, outline or add effects.

The SVGs are the sources. After changing one, run `bun run brand` in `frontend/`: it renders the PNGs here and
the site's icons from `shelra-icon.svg` (`src/app/favicon.ico`, `public/images/favicon.svg`, `icon-192.png`,
`apple-icon.png`). The site draws the logo itself (`src/components/ui/Wordmark.tsx`, `LogoMark.tsx`) with the
same proportions.
