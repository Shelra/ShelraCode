/**
 * WebP copies of the site's PNG images, which the pages serve instead of the PNGs.
 *
 *   bun run images        (from frontend/; re-run after re-capturing the TUI with scripts/ui-demo)
 *
 * The PNGs stay the sources. Terminal captures are flat colour, so lossless WebP is exact and the smallest
 * option (tui-hero: 92 KB PNG → 30 KB); the shader stills are soft gradients behind the WebGL canvas, so they
 * use lossy quality 80. The social image stays PNG, which every link preview reads. sharp comes with Next.js.
 */
import { readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const images = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "public", "images");

const lossless = [/^tui-.*\.png$/, /^6mcf62RlDfRfU61Yg5vb2pefpi4\.png$/]; // captures and the noise tile
const skip = [/^og-/]; // social previews need PNG

let before = 0;
let after = 0;
for (const name of readdirSync(images).filter((file) => file.endsWith(".png"))) {
  if (skip.some((pattern) => pattern.test(name))) continue;
  const source = resolve(images, name);
  const target = source.replace(/\.png$/, ".webp");
  const options = lossless.some((pattern) => pattern.test(name))
    ? { lossless: true, effort: 6 }
    : { quality: 80, effort: 6 };
  const { size } = await sharp(source).webp(options).toFile(target);
  const original = statSync(source).size;
  before += original;
  after += size;
  console.log(`${name.padEnd(40)} ${Math.round(original / 1024)} KB → ${Math.round(size / 1024)} KB`);
}
console.log(`total ${Math.round(before / 1024)} KB → ${Math.round(after / 1024)} KB`);
