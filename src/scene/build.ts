import * as THREE from "three";
import type {
  GeometryDef,
  LightDef,
  MaterialDef,
  SceneDef,
  SceneObject,
  TransformDef,
} from "./schema";

/* ------------------------------------------------------------------ *
 * JSON -> three.js. Shared by the site runtime and the editor viewport,
 * so an object looks identical in both.
 * ------------------------------------------------------------------ */

export function buildGeometry(def: GeometryDef): THREE.BufferGeometry {
  const a = def.args;
  switch (def.type) {
    case "box":
      return new THREE.BoxGeometry(a[0], a[1], a[2]);
    case "sphere":
      return new THREE.SphereGeometry(a[0], a[1], a[2]);
    case "torus":
      return new THREE.TorusGeometry(a[0], a[1], a[2], a[3]);
    case "torusKnot":
      return new THREE.TorusKnotGeometry(a[0], a[1], a[2], a[3]);
    case "cylinder":
      return new THREE.CylinderGeometry(a[0], a[1], a[2], a[3]);
    case "cone":
      return new THREE.ConeGeometry(a[0], a[1], a[2]);
    case "icosahedron":
      return new THREE.IcosahedronGeometry(a[0], a[1]);
    case "plane":
      return new THREE.PlaneGeometry(a[0], a[1]);
    default: {
      const never: never = def.type;
      throw new Error(`Unknown geometry type: ${String(never)}`);
    }
  }
}

export function buildMaterial(def: MaterialDef): THREE.Material {
  const shared = {
    color: new THREE.Color(def.color),
    wireframe: def.wireframe,
    transparent: def.transparent,
    opacity: def.opacity,
  };

  if (def.type === "basic") {
    return new THREE.MeshBasicMaterial(shared);
  }
  if (def.type === "physical") {
    return new THREE.MeshPhysicalMaterial({
      ...shared,
      metalness: def.metalness,
      roughness: def.roughness,
      emissive: new THREE.Color(def.emissive),
      emissiveIntensity: def.emissiveIntensity,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
    });
  }
  return new THREE.MeshStandardMaterial({
    ...shared,
    metalness: def.metalness,
    roughness: def.roughness,
    emissive: new THREE.Color(def.emissive),
    emissiveIntensity: def.emissiveIntensity,
  });
}

export function buildObject(def: SceneObject): THREE.Mesh {
  const mesh = new THREE.Mesh(buildGeometry(def.geometry), buildMaterial(def.material));
  mesh.name = def.name;
  mesh.userData.objectId = def.id;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  applyTransform(mesh, def.transform);
  mesh.visible = def.visible;
  return mesh;
}

export function applyTransform(target: THREE.Object3D, t: TransformDef): void {
  target.position.set(t.position[0], t.position[1], t.position[2]);
  target.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
  target.scale.set(t.scale[0], t.scale[1], t.scale[2]);
}

export function readTransform(source: THREE.Object3D): TransformDef {
  return {
    position: [source.position.x, source.position.y, source.position.z],
    rotation: [source.rotation.x, source.rotation.y, source.rotation.z],
    scale: [source.scale.x, source.scale.y, source.scale.z],
  };
}

export function buildLight(def: LightDef): THREE.Light {
  const color = new THREE.Color(def.color);
  const pos = new THREE.Vector3(...def.position);
  let light: THREE.Light;

  switch (def.type) {
    case "ambient":
      light = new THREE.AmbientLight(color, def.intensity);
      break;
    case "hemisphere":
      light = new THREE.HemisphereLight(color, new THREE.Color("#202030"), def.intensity);
      break;
    case "directional": {
      const d = new THREE.DirectionalLight(color, def.intensity);
      d.shadow.mapSize.set(2048, 2048);
      d.shadow.camera.near = 0.5;
      d.shadow.camera.far = 60;
      const extent = 14;
      d.shadow.camera.left = -extent;
      d.shadow.camera.right = extent;
      d.shadow.camera.top = extent;
      d.shadow.camera.bottom = -extent;
      d.shadow.bias = -0.0008;
      light = d;
      break;
    }
    case "point":
      light = new THREE.PointLight(color, def.intensity, def.distance || 0);
      break;
    case "spot": {
      const s = new THREE.SpotLight(color, def.intensity, def.distance || 0, Math.PI / 6, 0.4);
      s.castShadow = def.castShadow;
      light = s;
      break;
    }
    default: {
      const never: never = def.type;
      throw new Error(`Unknown light type: ${String(never)}`);
    }
  }

  light.name = def.name;
  light.userData.lightId = def.id;
  light.position.copy(pos);
  if (def.castShadow && light instanceof THREE.DirectionalLight) {
    light.castShadow = true;
  }
  return light;
}

export function validateScene(input: unknown): { ok: true; scene: SceneDef } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const s = input as Partial<SceneDef> | null;

  if (!s || typeof s !== "object") {
    return { ok: false, errors: ["Root value is not an object."] };
  }
  if (!Array.isArray(s.objects)) errors.push("`objects` must be an array.");
  if (!s.scroll || typeof s.scroll !== "object") errors.push("`scroll` must be an object.");
  else if (!Array.isArray(s.scroll.keyframes)) errors.push("`scroll.keyframes` must be an array.");
  if (!Array.isArray(s.lights)) errors.push("`lights` must be an array.");
  if (!s.environment) errors.push("`environment` must be an object.");

  if (errors.length > 0) return { ok: false, errors };

  const scene = s as SceneDef;
  scene.objects.forEach((o, i) => {
    if (!o.id) errors.push(`objects[${i}] is missing an id.`);
    if (!o.geometry?.type) errors.push(`objects[${i}] is missing a geometry type.`);
  });
  scene.scroll.keyframes.forEach((k, i) => {
    if (typeof k.at !== "number") errors.push(`scroll.keyframes[${i}] is missing a numeric \`at\`.`);
    if (!k.camera) errors.push(`scroll.keyframes[${i}] is missing a camera pose.`);
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, scene };
}
