import * as THREE from "three";
import { buildLight, buildObject } from "../scene/build";
import type { SceneDef, SceneObject } from "../scene/schema";
import { resolveKeyframes, sampleScroll, type ResolvedKeyframe, type ScrollState } from "../scene/scroll";

/**
 * The shared renderer. The published site and the editor viewport both
 * drive this class, which is why an object cannot look different in the
 * two places.
 */

export interface FrameInfo {
  elapsed: number;
  /** Resolved scroll pose for this frame, or null when scroll is disabled. */
  state: ScrollState | null;
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly meshes = new Map<string, THREE.Mesh>();

  private frames: ResolvedKeyframe[] = [];
  private objects: SceneObject[] = [];
  private def: SceneDef;
  private lightNodes: THREE.Light[] = [];
  private ground: THREE.Mesh | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  private onFrame?: (info: FrameInfo) => void;
  private resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, def: SceneDef) {
    this.def = def;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(def.scroll.fov || 45, 1, 0.1, 300);
    this.camera.position.set(0, 2, 9);

    this.buildEnvironment();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
  }

  /* ---------------------------------------------------------------- */

  private buildEnvironment(): void {
    const env = this.def.environment;
    this.scene.background = new THREE.Color(env.background);

    if (env.fog.enabled) {
      this.scene.fog = new THREE.Fog(new THREE.Color(env.fog.color), env.fog.near, env.fog.far);
    }

    if (env.ground.enabled) {
      const g = new THREE.Mesh(
        new THREE.PlaneGeometry(env.ground.size, env.ground.size),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(env.ground.color),
          roughness: 0.9,
          metalness: 0.1,
        }),
      );
      g.rotation.x = -Math.PI / 2;
      g.position.y = env.ground.y;
      g.receiveShadow = true;
      g.name = "__ground";
      this.scene.add(g);
      this.ground = g;
    }

    for (const ld of this.def.lights) {
      const light = buildLight(ld);
      this.scene.add(light);
      this.lightNodes.push(light);
    }

    this.rebuildObjects();
    this.frames = resolveKeyframes(this.def);
  }

  /** Re-resolves keyframes after timeline or transform edits. */
  refreshTimeline(): void {
    this.objects = this.def.objects;
    this.frames = resolveKeyframes(this.def);
  }

  /**
   * Applies an edited object definition. Rebuilds the mesh only when the
   * geometry or material *type* changed; otherwise updates in place so
   * dragging a colour slider doesn't churn GPU resources.
   */
  syncObject(def: SceneObject): void {
    const mesh = this.meshes.get(def.id);
    if (!mesh) return;

    const geoKey = `${def.geometry.type}:${def.geometry.args.join(",")}`;
    const matKey = def.material.type;

    if (mesh.userData.geoKey !== geoKey || mesh.userData.matKey !== matKey) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      const old = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(old)) old.forEach((m) => m.dispose());
      else old.dispose();

      const fresh = buildObject(def);
      this.stamp(fresh, def, geoKey, matKey);
      this.scene.add(fresh);
      this.meshes.set(def.id, fresh);
      return;
    }

    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.color.set(def.material.color);
    if ("metalness" in mat) mat.metalness = def.material.metalness;
    if ("roughness" in mat) mat.roughness = def.material.roughness;
    if (mat.emissive) mat.emissive.set(def.material.emissive);
    mat.emissiveIntensity = def.material.emissiveIntensity;
    mat.wireframe = def.material.wireframe;
    mat.opacity = def.material.opacity;
    mat.transparent = def.material.transparent || def.material.opacity < 1;
    mat.needsUpdate = true;
    mesh.name = def.name;
    mesh.visible = def.visible;
  }

  private stamp(mesh: THREE.Mesh, def: SceneObject, geoKey: string, matKey: string): void {
    mesh.userData.objectId = def.id;
    mesh.userData.geoKey = geoKey;
    mesh.userData.matKey = matKey;
  }

  /** Rebuilds meshes from the current definition, preserving names/ids. */
  rebuildObjects(): void {
    for (const mesh of this.meshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
    }
    this.meshes.clear();

    this.objects = this.def.objects;
    for (const obj of this.objects) {
      const mesh = buildObject(obj);
      this.stamp(mesh, obj, `${obj.geometry.type}:${obj.geometry.args.join(",")}`, obj.material.type);
      this.scene.add(mesh);
      this.meshes.set(obj.id, mesh);
    }
  }

  setScene(def: SceneDef): void {
    this.def = def;
    for (const l of this.lightNodes) this.scene.remove(l);
    this.lightNodes = [];
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
      (this.ground.material as THREE.Material).dispose();
      this.ground = null;
    }
    const bg = this.scene.background;
    if (bg instanceof THREE.Texture) bg.dispose();
    this.scene.background = null;
    this.scene.fog = null;

    this.buildEnvironment();
    this.camera.fov = def.scroll.fov || 45;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------------------------------------------------------- */

  private applyState(state: ScrollState, elapsed: number, applyCamera: boolean): void {
    if (applyCamera) {
      this.camera.position.set(...state.camera.position);
      this.camera.lookAt(new THREE.Vector3(...state.camera.target));
    }

    state.poses.forEach((pose, idx) => {
      const def = this.objects[idx];
      if (!def) return;
      const mesh = this.meshes.get(def.id);
      if (!mesh) return;

      mesh.position.set(...pose.transform.position);
      mesh.rotation.set(...pose.transform.rotation);
      mesh.scale.set(...pose.transform.scale);

      // Continuous motion layered on top of the scroll pose.
      if (def.spin) {
        mesh.rotation.x += def.spin[0] * elapsed;
        mesh.rotation.y += def.spin[1] * elapsed;
        mesh.rotation.z += def.spin[2] * elapsed;
      }
      if (def.bob) {
        mesh.position.y += Math.sin(elapsed * def.bob.speed + def.bob.phase) * def.bob.amplitude;
      }

      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.opacity !== pose.opacity) {
        mat.opacity = pose.opacity;
        mat.transparent = pose.opacity < 1;
        mat.depthWrite = pose.opacity >= 1;
        mat.needsUpdate = true;
      }
    });
  }

  /** Computes the scroll state for a progress value without rendering. */
  poseAt(progress: number): ScrollState {
    return sampleScroll(this.frames, this.objects, progress, this.def.scroll.easing);
  }

  /**
   * @param applyCamera false lets an external controller (the editor's orbit
   *   camera) own the view while object poses are still applied.
   */
  applyPose(state: ScrollState, elapsed = 0, applyCamera = true): void {
    this.applyState(state, elapsed, applyCamera);
  }

  renderStill(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /* ---------------------------------------------------------------- */

  start(onFrame?: (info: FrameInfo) => void): void {
    this.onFrame = onFrame;
    this.clock.start();
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const elapsed = this.clock.getElapsedTime();
      const state = this.poseAt(this.progressSource?.() ?? 0);
      this.applyState(state, elapsed, true);
      this.onFrame?.({ elapsed, state });
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private progressSource?: () => number;

  /** The site sets this to read real scroll; the editor pins it. */
  setProgressSource(fn: (() => number) | undefined): void {
    this.progressSource = fn;
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  resize(): void {
    const parent = this.renderer.domElement.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    });
    this.renderer.dispose();
  }
}
