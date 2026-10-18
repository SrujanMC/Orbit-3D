/**
 * Engine smoke test.
 *
 * Exercises the scroll evaluator directly (no three.js, no DOM) so the
 * interpolation math can be checked in isolation. Run with `npm run smoke`.
 */

import demo from "../public/scenes/demo.json" with { type: "json" };
import { resolveKeyframes, sampleScroll } from "../src/scene/scroll";
import type { SceneDef } from "../src/scene/schema";

const scene = demo as unknown as SceneDef;

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const frames = resolveKeyframes(scene);
const easing = scene.scroll.easing;

/* ---------------------------- structure ---------------------------- */

check("keyframes resolve", frames.length === scene.scroll.keyframes.length);
check(
  "keyframes sorted by `at`",
  frames.every((f, i) => i === 0 || frames[i - 1].at <= f.at),
);
check(
  "every keyframe carries a pose per object",
  frames.every((f) => f.poses.length === scene.objects.length),
);

/* --------------------------- endpoints --------------------------- */

const atZero = sampleScroll(frames, scene.objects, 0, easing);
const atOne = sampleScroll(frames, scene.objects, 1, easing);
const sorted = [...frames].sort((a, b) => a.at - b.at);

check(
  "progress 0 uses the first keyframe camera",
  atZero.camera.position.every((v, i) => Math.abs(v - sorted[0].camera.position[i]) < 1e-9),
);
check(
  "progress 1 uses the last keyframe camera",
  atOne.camera.position.every((v, i) => Math.abs(v - sorted[sorted.length - 1].camera.position[i]) < 1e-9),
);

/* --------------------------- clamping --------------------------- */

const clampedLow = sampleScroll(frames, scene.objects, -5, easing);
const clampedHigh = sampleScroll(frames, scene.objects, 42, easing);
check(
  "progress below 0 clamps to first keyframe",
  clampedLow.camera.position.every((v, i) => Math.abs(v - atZero.camera.position[i]) < 1e-9),
);
check(
  "progress above 1 clamps to last keyframe",
  clampedHigh.camera.position.every((v, i) => Math.abs(v - atOne.camera.position[i]) < 1e-9),
);

/* ------------------------- sweep + sanity ------------------------- */

const STEPS = 400;
let maxCameraStep = 0;
let prev = sampleScroll(frames, scene.objects, 0, easing);
let nonFinite = 0;
let opacityOutOfRange = 0;
let poseCountMismatch = 0;

for (let s = 1; s <= STEPS; s += 1) {
  const p = s / STEPS;
  const state = sampleScroll(frames, scene.objects, p, easing);

  if (state.poses.length !== scene.objects.length) poseCountMismatch += 1;

  for (const value of state.camera.position.concat(state.camera.target)) {
    if (!Number.isFinite(value)) nonFinite += 1;
  }

  for (const pose of state.poses) {
    for (const value of [...pose.transform.position, ...pose.transform.rotation, ...pose.transform.scale]) {
      if (!Number.isFinite(value)) nonFinite += 1;
    }
    if (pose.opacity < -1e-9 || pose.opacity > 1 + 1e-9) opacityOutOfRange += 1;
  }

  const step = Math.hypot(
    state.camera.position[0] - prev.camera.position[0],
    state.camera.position[1] - prev.camera.position[1],
    state.camera.position[2] - prev.camera.position[2],
  );
  maxCameraStep = Math.max(maxCameraStep, step);
  prev = state;
}

check("all sampled values are finite", nonFinite === 0, `${nonFinite} non-finite values`);
check("opacity stays within 0..1", opacityOutOfRange === 0, `${opacityOutOfRange} out of range`);
check("pose count matches object count", poseCountMismatch === 0);
check(
  "camera moves continuously (no teleports between adjacent samples)",
  maxCameraStep < 1.0,
  `largest single-step camera move was ${maxCameraStep.toFixed(3)} units`,
);

/* --------------------- object overrides are honoured --------------------- */

const overrideObj = scene.objects.find((o) =>
  scene.scroll.keyframes.some((k) => k.objects.some((x) => x.id === o.id)),
);
if (overrideObj) {
  const kf = scene.scroll.keyframes.find((k) => k.objects.some((x) => x.id === overrideObj.id));
  const override = kf?.objects.find((x) => x.id === overrideObj.id);
  const expected = override?.transform?.position ?? overrideObj.transform.position;
  const idx = scene.objects.findIndex((o) => o.id === overrideObj.id);
  const sampled = sampleScroll(frames, scene.objects, kf!.at, easing).poses[idx].transform.position;
  check(
    `object override honoured at keyframe "${kf!.label}"`,
    expected.every((v, i) => Math.abs(v - sampled[i]) < 1e-9),
    `expected ${expected.join(",")} got ${sampled.join(",")}`,
  );

  const untouched = scene.objects.find((o) => o.id !== overrideObj.id);
  if (untouched) {
    const untIdx = scene.objects.findIndex((o) => o.id === untouched.id);
    const sampledUntouched = sampleScroll(frames, scene.objects, kf!.at, easing).poses[untIdx].transform
      .position;
    check(
      "an object with no override keeps its base transform",
      untouched.transform.position.every((v, i) => Math.abs(v - sampledUntouched[i]) < 1e-9),
    );
  }
}

/* ------------------------------ report ------------------------------ */

console.log(`\n  engine smoke test — ${scene.meta.name}`);
console.log(`  ${passed} passed, ${failures.length} failed\n`);
for (const f of failures) console.log(`  FAIL  ${f}`);
if (failures.length > 0) {
  process.exit(1);
}
console.log("  all checks passed\n");
