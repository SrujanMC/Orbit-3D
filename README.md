# Orbit — scroll-driven 3D sites with a scene editor

An original WebGL site runtime plus a scene editor. Author a 3D scene on a
timeline, then publish it as static files.

**Everything here is original work.** The project was prompted by looking at how
a commercial 3D site builder is put together, but no code, copy, design, or
asset from any existing site is reproduced. The brand name and marketing copy
are placeholders — replace them.

```
D:\projects\orbit3d\
```

## The core idea: one scene, two renderers

A scene is a single JSON document. The **published site** and the **editor**
both read that same document through the same runtime (`src/runtime/viewer.ts`),
so there is no export/import translation step that can drift. What you see in
the editor is what ships.

```
scene.json ──┬──> site runtime   (scroll drives the timeline)
             └──> editor runtime (gizmo + orbit camera drive the scene)
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server. Opens the editor at `/editor.html`. |
| `npm run smoke` | Engine smoke test — 13 checks on the scroll evaluator. No browser needed. |
| `npm run build` | Type-check, then build `dist/`. |
| `npm run export` | Copy `dist/` + a scene into `out/` — a deployable static bundle. |
| `npm run export -- my-scene.json` | Export a scene you saved from the editor. |

## Layout

```
index.html              published site (scroll-driven)
editor.html             editor shell
public/scenes/demo.json the demo scene

src/scene/schema.ts     the scene format — types, factories, defaults
src/scene/build.ts      JSON -> three.js objects + scene validation
src/scene/scroll.ts     keyframe resolution and interpolation
src/scene/easing.ts     easing + lerp helpers
src/runtime/viewer.ts   the shared renderer (site and editor both use this)

src/site/               marketing page: scroll -> timeline, overlay panels
src/editor/store.ts     scene state, selection, undo/redo
src/editor/viewport.ts  orbit camera, transform gizmo, picking, outline
src/editor/inspector.ts property panel
src/editor/outline.ts   object list
src/editor/timeline.ts  keyframe track + scrubber
src/editor/ui.ts        small DOM control helpers

scripts/smoke.ts        engine test
scripts/export.mjs      static bundle exporter
```

## Scene format

```jsonc
{
  "meta": { "name": "Orbit Demo", "version": 1 },
  "environment": {
    "background": "#07060f",
    "fog":  { "enabled": true, "color": "#07060f", "near": 14, "far": 46 },
    "ground": { "enabled": true, "color": "#0d0b1a", "size": 80, "y": -1.6 }
  },
  "lights": [ /* ambient | hemisphere | directional | point | spot */ ],
  "objects": [
    {
      "id": "obj_knot",
      "name": "Hero Knot",
      "geometry": { "type": "torusKnot", "args": [1.05, 0.3, 220, 32] },
      "material": { "type": "physical", "color": "#b39dff", "metalness": 0.9, "roughness": 0.14 },
      "transform": { "position": [0, 1.5, 0], "rotation": [0.4, 0, 0.1], "scale": [1, 1, 1] },
      "visible": true,
      "spin": [0, 0.16, 0],                                  // radians/second, scroll-independent
      "bob":  { "amplitude": 0.18, "speed": 1.5, "phase": 0 } // sine offset on Y
    }
  ],
  "scroll": {
    "enabled": true,
    "length": 420,          // scroll track height, in viewport heights
    "fov": 45,
    "easing": "easeInOut",
    "keyframes": [
      {
        "at": 0,                              // normalized scroll progress 0..1
        "label": "Establish",
        "camera": { "position": [0, 3.2, 13.5], "target": [0, 1.5, 0] },
        "objects": [                          // only objects you want to move
          { "id": "obj_knot", "transform": { "position": [0, 1.5, 0], "scale": [0.85, 0.85, 0.85] }, "opacity": 0.9 }
        ]
      }
    ]
  }
}
```

### How keyframes resolve

Each keyframe is resolved once into a **complete** pose for every object:

- an object the keyframe mentions is merged over its **base transform**
- an object it does not mention **keeps its base transform**

Sampling then interpolates between two adjacent complete poses. This means you
only animate what you care about, and evaluation order can't matter. It also
means adding an object never retroactively breaks existing keyframes.

## Editor

Three panels around a viewport, with a timeline underneath.

**Two modes, and the difference matters:**

| Mode | Objects render at | The gizmo edits |
| --- | --- | --- |
| **Scene** | their base transform | the object's base transform |
| **Preview** | the scroll timeline at the scrub position | the *active keyframe's* override for that object |

So sculpting a shape and choreographing the camera are separate operations, and
editing a keyframe can never accidentally change your model.

Keyboard: `Q`/`W`/`E` gizmo mode · `F` focus selection · `K` add keyframe ·
`Ctrl+Z` / `Ctrl+Shift+Z` undo/redo · `Ctrl+S` save · `Ctrl+D` duplicate ·
`Delete` remove.

Work is autosaved to `localStorage` and restored on reload. `Load demo` resets
to the shipped scene.

## Notes on the implementation

- **No framework.** The editor UI is plain DOM with a small helper (`ui.ts`).
  The only runtime dependency is `three`.
- **Property edits update in place.** The inspector records bindings and
  refreshes values rather than rebuilding the DOM, so dragging a slider — which
  fires continuously — never destroys the element under the pointer. The
  timeline does the same for keyframe markers during a drag.
- **`Viewer.syncObject`** rebuilds a mesh only when the geometry or material
  *type* changes, so colour/roughness edits don't churn GPU resources.
- **`applyPose(state, elapsed, applyCamera)`** — the editor passes `false` in
  scene mode so the orbit camera owns the view while object poses still apply.
- **Undo/redo** is JSON snapshots taken at gesture boundaries, not per frame.

## Tested

- `tsc --noEmit` clean under `strict` + `noUnusedLocals` + `verbatimModuleSyntax`
- `npm run smoke` — 13/13: keyframe ordering, pose-per-object coverage,
  endpoint identity at progress 0 and 1, clamping outside 0..1, 400-sample
  sweep for finiteness and opacity range, camera continuity (no teleports),
  override honoured at its keyframe, unmentioned objects keeping base transforms
- `vite build` — 23 modules, `viewer` chunk 561 kB / 141 kB gzipped (that's
  three.js itself)
- `npm run export` — produces a working static bundle

Not verified: actual WebGL rendering. That needs a real browser.

## Next steps worth doing

- **GLTF model loading.** Currently primitives only. Add a `model` geometry type
  and an asset loader — this is the biggest single capability gap.
- **Asset pipeline.** Nothing manages textures or models yet; a `public/assets`
  convention plus a manifest would be the natural next layer.
- **Timeline keyframe easing per segment** (currently one easing for the whole
  track).
- **Export the editor bundle too**, or make the exported folder optionally
  editable in place.
- **Post-processing** (bloom would suit the emissive materials already in the
  demo scene).
