import { ease, lerp, lerpVec3, type EasingName } from "./easing";
import type { CameraPose, SceneDef, SceneObject, TransformDef } from "./schema";

/**
 * Scroll evaluator.
 *
 * Each keyframe is resolved once into a *complete* pose for every object:
 * an object the keyframe mentions is merged over its base transform; an
 * object it does not mention inherits the base transform. Sampling then
 * interpolates between two adjacent complete poses.
 *
 * This keeps authoring simple (only animate what you care about) while
 * making evaluation order-independent and cheap.
 */

export interface ResolvedPose {
  transform: TransformDef;
  opacity: number;
}

export interface ResolvedKeyframe {
  at: number;
  label: string;
  camera: CameraPose;
  /** Aligned index-for-index with `scene.objects`. */
  poses: ResolvedPose[];
}

export interface ScrollState {
  camera: CameraPose;
  poses: ResolvedPose[];
}

function basePose(obj: SceneObject): ResolvedPose {
  return {
    transform: {
      position: [...obj.transform.position],
      rotation: [...obj.transform.rotation],
      scale: [...obj.transform.scale],
    },
    opacity: obj.material.opacity,
  };
}

export function resolveKeyframes(scene: SceneDef): ResolvedKeyframe[] {
  const bases = scene.objects.map(basePose);
  const byId = new Map(scene.objects.map((o, i) => [o.id, i]));

  return [...scene.scroll.keyframes]
    .sort((a, b) => a.at - b.at)
    .map((kf) => {
      const poses = bases.map((b) => ({
        transform: {
          position: [...b.transform.position] as [number, number, number],
          rotation: [...b.transform.rotation] as [number, number, number],
          scale: [...b.transform.scale] as [number, number, number],
        },
        opacity: b.opacity,
      }));

      for (const override of kf.objects) {
        const idx = byId.get(override.id);
        if (idx === undefined) continue;
        const target = poses[idx];
        const t = override.transform;
        if (t?.position) target.transform.position = [...t.position];
        if (t?.rotation) target.transform.rotation = [...t.rotation];
        if (t?.scale) target.transform.scale = [...t.scale];
        if (typeof override.opacity === "number") target.opacity = override.opacity;
      }

      return {
        at: kf.at,
        label: kf.label,
        camera: {
          position: [...kf.camera.position] as [number, number, number],
          target: [...kf.camera.target] as [number, number, number],
        },
        poses,
      };
    });
}

export function sampleScroll(
  frames: ResolvedKeyframe[],
  objects: SceneObject[],
  progress: number,
  easing: EasingName = "easeInOut",
): ScrollState {
  const bases = objects.map(basePose);

  if (frames.length === 0) {
    return {
      camera: { position: [0, 2, 9], target: [0, 1.4, 0] },
      poses: bases,
    };
  }

  const p = Math.min(1, Math.max(0, progress));
  const first = frames[0];
  const last = frames[frames.length - 1];

  if (p <= first.at || frames.length === 1) {
    return { camera: cloneCamera(first.camera), poses: first.poses };
  }
  if (p >= last.at) {
    return { camera: cloneCamera(last.camera), poses: last.poses };
  }

  let i = 0;
  while (i < frames.length - 2 && p > frames[i + 1].at) i += 1;

  const a = frames[i];
  const b = frames[i + 1];
  const span = b.at - a.at;
  const raw = span <= 0 ? 0 : (p - a.at) / span;
  const t = ease(easing, raw);

  return {
    camera: {
      position: lerpVec3(a.camera.position, b.camera.position, t),
      target: lerpVec3(a.camera.target, b.camera.target, t),
    },
    poses: a.poses.map((pa, idx) => {
      const pb = b.poses[idx];
      return {
        transform: {
          position: lerpVec3(pa.transform.position, pb.transform.position, t),
          rotation: lerpVec3(pa.transform.rotation, pb.transform.rotation, t),
          scale: lerpVec3(pa.transform.scale, pb.transform.scale, t),
        },
        opacity: lerp(pa.opacity, pb.opacity, t),
      };
    }),
  };
}

function cloneCamera(c: CameraPose): CameraPose {
  return { position: [...c.position], target: [...c.target] };
}

/** Maps page scroll position to normalized progress along the track. */
export function scrollProgress(trackEl: HTMLElement, viewportHeight: number): number {
  const rect = trackEl.getBoundingClientRect();
  const total = rect.height - viewportHeight;
  if (total <= 0) return 0;
  const travelled = -rect.top;
  return Math.min(1, Math.max(0, travelled / total));
}
