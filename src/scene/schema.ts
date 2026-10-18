/**
 * Scene schema — the single source of truth.
 *
 * Both the published site and the editor render this exact structure.
 * There is deliberately no translation layer between them: whatever the
 * editor writes is byte-for-byte what the site reads.
 */

export type Vec3 = [number, number, number];

export type GeometryType =
  | "box"
  | "sphere"
  | "torus"
  | "torusKnot"
  | "cylinder"
  | "cone"
  | "icosahedron"
  | "plane";

export interface GeometryDef {
  type: GeometryType;
  args: number[];
}

export type MaterialType = "standard" | "physical" | "basic";

export interface MaterialDef {
  type: MaterialType;
  color: string;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
  wireframe: boolean;
  transparent: boolean;
  opacity: number;
}

export interface TransformDef {
  position: Vec3;
  /** Euler angles in radians. */
  rotation: Vec3;
  scale: Vec3;
}

export interface SceneObject {
  id: string;
  name: string;
  geometry: GeometryDef;
  material: MaterialDef;
  transform: TransformDef;
  visible: boolean;
  /** Continuous rotation, radians/second. Runs independently of scroll. */
  spin?: Vec3;
  /** Sine bobbing, world units. Runs independently of scroll. */
  bob?: { amplitude: number; speed: number; phase: number };
}

export type LightType = "ambient" | "hemisphere" | "directional" | "point" | "spot";

export interface LightDef {
  id: string;
  name: string;
  type: LightType;
  color: string;
  intensity: number;
  position: Vec3;
  /** Point/spot falloff distance. 0 means infinite. */
  distance: number;
  castShadow: boolean;
}

export interface CameraPose {
  position: Vec3;
  /** Look-at point. A 3D web page is really a camera choreography problem. */
  target: Vec3;
}

export interface ObjectPoseOverride {
  id: string;
  transform?: Partial<TransformDef>;
  opacity?: number;
}

export interface SceneKeyframe {
  /** Normalized scroll progress in 0..1. */
  at: number;
  label: string;
  camera: CameraPose;
  objects: ObjectPoseOverride[];
}

export interface EnvironmentDef {
  background: string;
  fog: { enabled: boolean; color: string; near: number; far: number };
  ground: { enabled: boolean; color: string; size: number; y: number };
}

export interface ScrollDef {
  enabled: boolean;
  /** Scroll track height in viewport heights. 400 === four screens of scrolling. */
  length: number;
  fov: number;
  /** Easing applied within each segment: linear | easeInOut | easeOut. */
  easing: "linear" | "easeInOut" | "easeOut";
  keyframes: SceneKeyframe[];
}

export interface SceneDef {
  meta: { name: string; version: number };
  environment: EnvironmentDef;
  lights: LightDef[];
  objects: SceneObject[];
  scroll: ScrollDef;
}

export const SCENE_VERSION = 1;

/* ------------------------------------------------------------------ *
 * Factories
 * ------------------------------------------------------------------ */

export const GEOMETRY_ARGS: Record<GeometryType, number[]> = {
  box: [1, 1, 1],
  sphere: [0.6, 48, 32],
  torus: [0.6, 0.22, 24, 96],
  torusKnot: [0.55, 0.17, 160, 24],
  cylinder: [0.4, 0.4, 1, 48],
  cone: [0.6, 1.2, 48],
  icosahedron: [0.7, 1],
  plane: [4, 4],
};

let counter = 0;
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

export function defaultTransform(position: Vec3 = [0, 1, 0]): TransformDef {
  return { position, rotation: [0, 0, 0], scale: [1, 1, 1] };
}

export function createObject(
  type: GeometryType,
  position: Vec3 = [0, 1, 0],
  color = "#8b7bf7",
): SceneObject {
  return {
    id: nextId("obj"),
    name: type.charAt(0).toUpperCase() + type.slice(1),
    geometry: { type, args: [...GEOMETRY_ARGS[type]] },
    material: {
      type: "standard",
      color,
      metalness: 0.55,
      roughness: 0.28,
      emissive: "#000000",
      emissiveIntensity: 1,
      wireframe: false,
      transparent: false,
      opacity: 1,
    },
    transform: defaultTransform(position),
    visible: true,
  };
}

export function createLight(type: LightType, position: Vec3 = [4, 8, 6]): LightDef {
  return {
    id: nextId("light"),
    name: type.charAt(0).toUpperCase() + type.slice(1),
    type,
    color: "#ffffff",
    intensity: type === "ambient" ? 0.35 : type === "point" ? 60 : 1.6,
    position,
    distance: 0,
    castShadow: type === "directional",
  };
}

export function createKeyframe(at: number, label: string): SceneKeyframe {
  return {
    at,
    label,
    camera: { position: [0, 2, 9], target: [0, 1.4, 0] },
    objects: [],
  };
}
