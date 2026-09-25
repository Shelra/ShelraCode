/**
 * The brand kit and the site's icons, rendered from the SVG sources in public/brand.
 *
 *   bun run brand        (from frontend/)
 *
 * public/brand holds the vector sources (the mark from the favicon; the logo with "shelra" outlined from
 * Geist Mono Medium, so it needs no font) and gets their PNG renders. The site's icons are written from the
 * same icon source: src/app/favicon.ico (16, 32, 48 and 256 px), public/images/favicon.svg, icon-192.png
 * and apple-icon.png. sharp comes with Next.js. See public/brand/README.md for what each file is for.
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const brand = resolve(root, "public", "brand");
const images = resolve(root, "public", "images");
const BASE = "#080808";

const source = (name: string) => readFileSync(resolve(brand, name));

// The SVG's own width in pixels, to render it at the density that gives the wanted size without resampling.
function svgWidth(svg: Buffer): number {
  const match = /<svg[^>]*\swidth="([\d.]+)"/.exec(svg.toString("utf8"));
  if (!match) throw new Error("The SVG has no width attribute.");
  return Number(match[1]);
}

async function render(svg: Buffer, width: number): Promise<Buffer> {
  const density = (72 * width) / svgWidth(svg);
  return sharp(svg, { density }).resize({ width }).png({ compressionLevel: 9 }).toBuffer();
}

async function write(name: string, svg: Buffer, width: number, dir = brand) {
  const png = await render(svg, width);
  writeFileSync(resolve(dir, name), png);
  const { height } = await sharp(png).metadata();
  console.log(`${name}: ${width}x${height}`);
}

// An ICO whose entries are PNGs (read by every browser and by Windows since Vista).
async function ico(svg: Buffer, sizes: number[]): Promise<Buffer> {
  const pngs = await Promise.all(sizes.map((size) => render(svg, size)));
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(pngs[i].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([header, ...pngs]);
}

const icon = source("shelra-icon.svg");
const mark = source("shelra-mark.svg");
const markBlack = source("shelra-mark-black.svg");
const logo = source("shelra-logo.svg");
const logoBlack = source("shelra-logo-black.svg");

// The kit.
await write("shelra-icon-512.png", icon, 512);
await write("shelra-icon-1024.png", icon, 1024);
await write("shelra-mark-512.png", mark, 512);
await write("shelra-mark-black-512.png", markBlack, 512);
await write("shelra-logo.png", logo, 1600);
await write("shelra-logo-black.png", logoBlack, 1600);

// The logo on the site's background with room around it (banners, avatars that crop to a wide box).
const logoPng = await render(logo, 1200);
const { height: logoHeight = 0 } = await sharp(logoPng).metadata();
const canvas = { width: 1600, height: 600 };
await sharp({ create: { ...canvas, channels: 4, background: BASE } })
  .composite([{ input: logoPng, left: (canvas.width - 1200) / 2, top: Math.round((canvas.height - logoHeight) / 2) }])
  .png({ compressionLevel: 9 })
  .toFile(resolve(brand, "shelra-logo-on-dark.png"));
console.log(`shelra-logo-on-dark.png: ${canvas.width}x${canvas.height}`);

// The site's icons, from the same source.
copyFileSync(resolve(brand, "shelra-icon.svg"), resolve(images, "favicon.svg"));
await write("icon-192.png", icon, 192, images);
await write("apple-icon.png", icon, 180, images);
writeFileSync(resolve(root, "src", "app", "favicon.ico"), await ico(icon, [16, 32, 48, 256]));
console.log("favicon.ico: 16, 32, 48, 256");
