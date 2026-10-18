import type { GeometryType, LightType, MaterialType, SceneObject } from "../scene/schema";
import type { SceneStore } from "./store";
import {
  button,
  checkRow,
  clear,
  colorRow,
  el,
  numberRow,
  section,
  selectRow,
  sliderRow,
  textRow,
  trim,
  vec3Row,
} from "./ui";

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

const GEOMETRY_TYPES: GeometryType[] = [
  "box",
  "sphere",
  "torus",
  "torusKnot",
  "cylinder",
  "cone",
  "icosahedron",
  "plane",
];

const MATERIAL_TYPES: MaterialType[] = ["standard", "physical", "basic"];
const LIGHT_TYPES: LightType[] = ["ambient", "hemisphere", "directional", "point", "spot"];

const ARG_LABELS: Record<GeometryType, string[]> = {
  box: ["width", "height", "depth"],
  sphere: ["radius", "width segments", "height segments"],
  torus: ["radius", "tube", "radial segments", "tubular segments"],
  torusKnot: ["radius", "tube", "tubular segments", "radial segments"],
  cylinder: ["radius top", "radius bottom", "height", "radial segments"],
  cone: ["radius", "height", "radial segments"],
  icosahedron: ["radius", "detail"],
  plane: ["width", "height"],
};

export interface InspectorHandle {
  /** Writes current scene values into controls without rebuilding the DOM. */
  refresh(): void;
}

/**
 * Property panel for the current selection (or scene-level settings when
 * nothing is selected).
 *
 * Controls are rebuilt only on selection / structure changes. Property edits
 * update values in place, so dragging a slider — which fires continuously —
 * never destroys the element under the pointer.
 */
export function renderInspector(root: HTMLElement, store: SceneStore): InspectorHandle {
  clear(root);

  const bindings: Array<{ wrap: HTMLElement; read: () => (string | number | boolean)[] }> = [];

  const bind = (wrap: HTMLElement, read: () => (string | number | boolean)[]): HTMLElement => {
    bindings.push({ wrap, read });
    return wrap;
  };

  function refresh(): void {
    for (const binding of bindings) {
      const inputs = binding.wrap.querySelectorAll<HTMLInputElement>("input");
      const values = binding.read();
      inputs.forEach((input, i) => {
        if (i >= values.length) return;
        if (document.activeElement === input) return;
        const v = values[i];
        if (input.type === "checkbox") input.checked = Boolean(v);
        else {
          input.value = String(v);
          const readout = binding.wrap.querySelector<HTMLElement>(".row-value");
          if (readout) readout.textContent = trim(Number(v));
        }
      });
    }
  }

  const selected = store.selectedObject;
  if (selected) {
    renderObject(root, store, selected, bind);
  } else {
    renderScene(root, store, bind);
  }

  return { refresh };
}

/* ------------------------------------------------------------------ *
 * Object inspector
 * ------------------------------------------------------------------ */

function renderObject(
  root: HTMLElement,
  store: SceneStore,
  obj: SceneObject,
  bind: (wrap: HTMLElement, read: () => (string | number | boolean)[]) => HTMLElement,
): void {
  const edit = (kind: "properties" | "structure" | "timeline", fn: () => void) => store.edit(kind, fn);

  root.append(
    section(
      store.mode === "preview" ? "Keyframe override" : "Selection",
      store.mode === "preview"
        ? (() => {
            const kf = store.activeKeyframeDef;
            const override = kf?.objects.find((o) => o.id === obj.id);
            const actions = el("div", { class: "btn-row" });
            actions.append(
              button(
                override ? "Re-capture pose" : "Capture pose here",
                () => store.captureObjectIntoKeyframe(obj.id),
                "btn tiny",
              ),
            );
            if (override) {
              actions.append(
                button("Clear from keyframe", () => store.clearObjectFromKeyframe(obj.id), "btn tiny ghost"),
              );
            }
            return el(
              "div",
              {},
              el("p", {
                class: "hint",
                text: override
                  ? `Overrides "${kf?.label ?? "keyframe"}" for this object. The gizmo writes here.`
                  : `No override at "${kf?.label ?? "keyframe"}". This object uses its base transform.`,
              }),
              actions,
            );
          })()
        : bind(
            textRow("Name", obj.name, (v) =>
              edit("structure", () => {
                obj.name = v;
              }),
            ),
            () => [obj.name],
          ),
      checkRow("Visible", obj.visible, (v) =>
        edit("properties", () => {
          obj.visible = v;
        }),
      ),
    ),
  );

  /* ------------------------------ transform ----------------------------- */

  const transformChildren: (HTMLElement | null)[] = [
    bind(
      vec3Row("Position", obj.transform.position, (v) =>
        edit("properties", () => {
          obj.transform.position = v;
        }),
      ),
      () => obj.transform.position,
    ),
    bind(
      vec3Row("Rotation °", obj.transform.rotation.map((r) => r * DEG), (v) =>
        edit("properties", () => {
          obj.transform.rotation = [v[0] * RAD, v[1] * RAD, v[2] * RAD];
        }),
      ),
      () => obj.transform.rotation.map((r) => Math.round(r * DEG * 1000) / 1000),
    ),
    bind(
      vec3Row("Scale", obj.transform.scale, (v) =>
        edit("properties", () => {
          obj.transform.scale = v;
        }),
      ),
      () => obj.transform.scale,
    ),
  ];

  if (store.mode === "scene") {
    const spin = obj.spin ?? [0, 0, 0];
    const spinRow = bind(
      vec3Row("Spin /s", spin, (v) => {
        obj.spin = v.some((x) => x !== 0) ? v : undefined;
        store.touch("properties");
      }, 0.01),
      () => obj.spin ?? [0, 0, 0],
    );

    const bob = obj.bob ?? { amplitude: 0, speed: 1, phase: 0 };
    const bobRow = el(
      "div",
      { class: "subgroup" },
      bind(
        numberRow(
          "Bob amplitude",
          bob.amplitude,
          (v) => {
            obj.bob = { ...(obj.bob ?? bob), amplitude: v };
            if (obj.bob.amplitude === 0 && obj.bob.speed === 0) obj.bob = undefined;
            store.touch("properties");
          },
          { step: 0.01 },
        ),
        () => [obj.bob?.amplitude ?? 0],
      ),
      bind(
        numberRow(
          "Bob speed",
          bob.speed,
          (v) => {
            obj.bob = { ...(obj.bob ?? bob), speed: v };
            store.touch("properties");
          },
          { step: 0.05 },
        ),
        () => [obj.bob?.speed ?? 1],
      ),
      bind(
        numberRow(
          "Bob phase",
          bob.phase,
          (v) => {
            obj.bob = { ...(obj.bob ?? bob), phase: v };
            store.touch("properties");
          },
          { step: 0.1 },
        ),
        () => [obj.bob?.phase ?? 0],
      ),
    );

    transformChildren.push(spinRow, bobRow);
  }

  root.append(section("Transform", ...transformChildren));

  /* ------------------------------ geometry ----------------------------- */

  const argRows = el("div", { class: "subgroup" });
  const labels = ARG_LABELS[obj.geometry.type] ?? [];
  obj.geometry.args.forEach((value, i) => {
    const step = labels[i]?.includes("segments") || labels[i] === "detail" ? 1 : 0.01;
    argRows.append(
      bind(
        numberRow(
          labels[i] ?? `arg ${i}`,
          value,
          (v) => {
            obj.geometry.args[i] = step === 1 ? Math.round(v) : v;
            store.touch("structure");
          },
          { step, min: step === 1 ? 1 : undefined },
        ),
        () => [obj.geometry.args[i]],
      ),
    );
  });

  root.append(
    section(
      "Geometry",
      selectRow("Type", obj.geometry.type, GEOMETRY_TYPES, (v) =>
        edit("structure", () => {
          obj.geometry.type = v;
        }),
      ),
      argRows,
    ),
  );

  /* ------------------------------ material ----------------------------- */

  const mat = obj.material;
  root.append(
    section(
      "Material",
      selectRow("Model", mat.type, MATERIAL_TYPES, (v) =>
        edit("structure", () => {
          mat.type = v;
        }),
      ),
      bind(
        colorRow("Color", mat.color, (v) => {
          mat.color = v;
          store.touch("properties");
        }),
        () => [mat.color],
      ),
      ...(mat.type === "basic"
        ? []
        : [
            bind(
              sliderRow(
                "Metalness",
                mat.metalness,
                (v) => {
                  mat.metalness = v;
                  store.touch("properties");
                },
                { min: 0, max: 1, step: 0.01 },
              ),
              () => [mat.metalness],
            ),
            bind(
              sliderRow(
                "Roughness",
                mat.roughness,
                (v) => {
                  mat.roughness = v;
                  store.touch("properties");
                },
                { min: 0, max: 1, step: 0.01 },
              ),
              () => [mat.roughness],
            ),
            bind(
              colorRow("Emissive", mat.emissive, (v) => {
                mat.emissive = v;
                store.touch("properties");
              }),
              () => [mat.emissive],
            ),
            bind(
              sliderRow(
                "Emissive intensity",
                mat.emissiveIntensity,
                (v) => {
                  mat.emissiveIntensity = v;
                  store.touch("properties");
                },
                { min: 0, max: 4, step: 0.01 },
              ),
              () => [mat.emissiveIntensity],
            ),
          ]),
      bind(
        sliderRow(
          "Opacity",
          mat.opacity,
          (v) => {
            mat.opacity = v;
            if (v < 1) mat.transparent = true;
            store.touch("properties");
          },
          { min: 0, max: 1, step: 0.01 },
        ),
        () => [mat.opacity],
      ),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Scene inspector
 * ------------------------------------------------------------------ */

function renderScene(
  root: HTMLElement,
  store: SceneStore,
  bind: (wrap: HTMLElement, read: () => (string | number | boolean)[]) => HTMLElement,
): void {
  const scene = store.scene;
  const env = scene.environment;

  root.append(
    section(
      "Scene",
      bind(
        textRow("Name", scene.meta.name, (v) => {
          scene.meta.name = v;
          store.touch("structure");
        }),
        () => [scene.meta.name],
      ),
    ),
  );

  root.append(
    section(
      "Environment",
      bind(
        colorRow("Background", env.background, (v) => {
          env.background = v;
          store.touch("structure");
        }),
        () => [env.background],
      ),
      checkRow("Fog", env.fog.enabled, (v) => {
        env.fog.enabled = v;
        store.touch("structure");
      }),
      bind(
        colorRow("Fog color", env.fog.color, (v) => {
          env.fog.color = v;
          store.touch("structure");
        }),
        () => [env.fog.color],
      ),
      bind(
        numberRow("Fog near", env.fog.near, (v) => {
          env.fog.near = v;
          store.touch("structure");
        }),
        () => [env.fog.near],
      ),
      bind(
        numberRow("Fog far", env.fog.far, (v) => {
          env.fog.far = v;
          store.touch("structure");
        }),
        () => [env.fog.far],
      ),
      checkRow("Ground", env.ground.enabled, (v) => {
        env.ground.enabled = v;
        store.touch("structure");
      }),
      bind(
        colorRow("Ground color", env.ground.color, (v) => {
          env.ground.color = v;
          store.touch("structure");
        }),
        () => [env.ground.color],
      ),
    ),
  );

  root.append(
    section(
      "Scroll track",
      checkRow("Enabled", scene.scroll.enabled, (v) => {
        scene.scroll.enabled = v;
        store.touch("structure");
      }),
      bind(
        numberRow(
          "Length (vh)",
          scene.scroll.length,
          (v) => {
            scene.scroll.length = Math.max(100, Math.round(v));
            store.touch("structure");
          },
          { step: 10, min: 100 },
        ),
        () => [scene.scroll.length],
      ),
      bind(
        numberRow(
          "Camera FOV",
          scene.scroll.fov,
          (v) => {
            scene.scroll.fov = Math.min(120, Math.max(10, v));
            store.touch("structure");
          },
          { step: 1, min: 10, max: 120 },
        ),
        () => [scene.scroll.fov],
      ),
      selectRow("Easing", scene.scroll.easing, ["linear", "easeInOut", "easeOut"] as const, (v) => {
        scene.scroll.easing = v;
        store.touch("structure");
      }),
    ),
  );

  /* -------------------------------- lights ------------------------------- */

  const lightBlocks: HTMLElement[] = [];
  for (const light of scene.lights) {
    const block = el("div", { class: "light-block" });
    const header = el("div", { class: "light-head" });
    header.append(
      el("span", { class: "light-name", text: light.name }),
      el("span", { class: "light-type", text: light.type }),
      button("✕", () => store.removeLight(light.id), "icon-btn danger"),
    );

    block.append(header);
    block.append(
      bind(
        colorRow("Color", light.color, (v) => {
          light.color = v;
          store.touch("structure");
        }),
        () => [light.color],
      ),
      bind(
        numberRow(
          "Intensity",
          light.intensity,
          (v) => {
            light.intensity = v;
            store.touch("structure");
          },
          { step: 0.05 },
        ),
        () => [light.intensity],
      ),
    );

    if (light.type !== "ambient") {
      block.append(
        bind(
          vec3Row("Position", light.position, (v) => {
            light.position = v;
            store.touch("structure");
          }),
          () => light.position,
        ),
      );
    }
    if (light.type === "point" || light.type === "spot") {
      block.append(
        bind(
          numberRow(
            "Distance",
            light.distance,
            (v) => {
              light.distance = v;
              store.touch("structure");
            },
            { step: 1 },
          ),
          () => [light.distance],
        ),
      );
    }
    if (light.type === "directional" || light.type === "spot") {
      block.append(
        checkRow("Cast shadow", light.castShadow, (v) => {
          light.castShadow = v;
          store.touch("structure");
        }),
      );
    }

    lightBlocks.push(block);
  }

  const addLightRow = el("div", { class: "btn-row" });
  for (const t of LIGHT_TYPES) {
    addLightRow.append(button(`+ ${t}`, () => store.addLight(t), "btn tiny ghost"));
  }

  root.append(section("Lights", addLightRow, ...lightBlocks));
}
