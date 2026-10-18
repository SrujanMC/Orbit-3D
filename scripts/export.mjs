#!/usr/bin/env node
/**
 * Exports a deployable static bundle.
 *
 *   npm run build                       # produces dist/
 *   npm run export                      # ships the demo scene
 *   npm run export -- my-scene.json     # ships a scene you saved from the editor
 *
 * The exported folder is self-contained: drop it on any static host. The
 * bundled site reads its scene from `scenes/demo.json` inside the output, so
 * exporting is just "copy the build, then write the scene into it".
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const sceneArg = process.argv[2] ?? "public/scenes/demo.json";
const outArg = process.argv[3] ?? "out";
const distDir = "dist";

if (!existsSync(distDir)) {
  console.error(`No ${distDir}/ found. Run \`npm run build\` first.`);
  process.exit(1);
}

if (!existsSync(sceneArg)) {
  console.error(`Scene not found: ${sceneArg}`);
  process.exit(1);
}

const raw = await readFile(sceneArg, "utf8");
let scene;
try {
  scene = JSON.parse(raw);
} catch (err) {
  console.error(`Scene is not valid JSON: ${String(err)}`);
  process.exit(1);
}

for (const field of ["objects", "lights", "environment", "scroll"]) {
  if (!(field in scene)) {
    console.error(`Scene is missing required field "${field}" — refusing to export.`);
    process.exit(1);
  }
}

await rm(outArg, { recursive: true, force: true });
await mkdir(outArg, { recursive: true });
await cp(distDir, outArg, { recursive: true });

const target = path.join(outArg, "scenes");
await mkdir(target, { recursive: true });
await writeFile(path.join(target, "demo.json"), JSON.stringify(scene, null, 2), "utf8");

console.log(`Exported "${scene.meta?.name ?? "scene"}" to ${outArg}/`);
console.log(`  objects   : ${scene.objects.length}`);
console.log(`  lights    : ${scene.lights.length}`);
console.log(`  keyframes : ${scene.scroll.keyframes?.length ?? 0}`);
console.log(`\nServe it with any static host, for example: npx serve ${outArg}`);
