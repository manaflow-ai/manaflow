#!/usr/bin/env node
// Cross-platform generation of Electron app icons for macOS, Windows, and Linux.
// - Reads the largest PNG from assets/cmux-logos/cmux.iconset as the source.
// - Produces build/icon.icns, build/icon.ico, and build/icon.png.

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

// png2icons is a pure JS converter (no native deps) that can create .icns and .ico
// from a large PNG source.
import png2icons from "png2icons";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, "..", "");
const projectDir = path.resolve(__dirname, "..", "");
const assetsIconsetDir = path.resolve(projectDir, "assets", "cmux-logos", "cmux.iconset");
const buildDir = path.resolve(projectDir, "build");

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findLargestPng(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const pngs = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith("_dark.png"))
    .map((e) => path.join(dir, e.name));
  if (pngs.length === 0) throw new Error(`No PNG files found in ${dir}`);

  let largest = pngs[0];
  let largestSize = 0;
  for (const p of pngs) {
    const { size } = await fs.stat(p);
    if (size > largestSize) {
      largest = p;
      largestSize = size;
    }
  }
  return largest;
}

async function main() {
  await ensureDir(buildDir);

  const icnsPath = path.join(buildDir, "icon.icns");
  const icoPath = path.join(buildDir, "icon.ico");
  const pngPath = path.join(buildDir, "icon.png");

  // If all outputs already exist, skip work to keep this "build once".
  const already =
    (await fileExists(icnsPath)) && (await fileExists(icoPath)) && (await fileExists(pngPath));
  if (already) {
    console.log("icons: already present; skipping generation");
    return;
  }

  // Source PNGs live in the iconset; pick the largest as the source for conversion.
  const srcPng = await findLargestPng(assetsIconsetDir);
  const buf = await fs.readFile(srcPng);

  // Generate ICNS (macOS)
  if (!(await fileExists(icnsPath))) {
    const icns = png2icons.createICNS(buf, png2icons.BICUBIC, 0, false);
    if (!icns || !icns.length) throw new Error("Failed to generate ICNS icon");
    await fs.writeFile(icnsPath, icns);
    console.log(`icons: wrote ${path.relative(projectDir, icnsPath)}`);
  }

  // Generate ICO (Windows)
  if (!(await fileExists(icoPath))) {
    const ico = png2icons.createICO(buf, png2icons.BICUBIC, 0, false);
    if (!ico || !ico.length) throw new Error("Failed to generate ICO icon");
    await fs.writeFile(icoPath, ico);
    console.log(`icons: wrote ${path.relative(projectDir, icoPath)}`);
  }

  // Linux PNG: prefer the 512x512 image from the iconset if available, otherwise fall back to largest.
  if (!(await fileExists(pngPath))) {
    const preferred512 = path.join(assetsIconsetDir, "icon_512x512_dark.png");
    const srcForPng = (await fileExists(preferred512)) ? preferred512 : srcPng;
    const pngBuf = await fs.readFile(srcForPng);
    await fs.writeFile(pngPath, pngBuf);
    console.log(`icons: wrote ${path.relative(projectDir, pngPath)}`);
  }
}

main().catch((err) => {
  console.error("icons: generation failed", err);
  process.exit(1);
});
