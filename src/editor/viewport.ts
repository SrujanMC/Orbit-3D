import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { Viewer } from "../runtime/viewer";
import { readTransform } from "../scene/build";
import type { ScrollState } from "../scene/scroll";
import type { SceneStore } from "./store";

export type GizmoMode = "translate" | "rotate" | "scale";

/**
 * The editing viewport: the shared runtime plus selection, an orbit camera
 * and a transform gizmo.
 *
 * Two modes, and the difference matters:
 *  - "scene"   renders objects at their base transform and the gizmo edits
 *              that base transform. This is where you sculpt.
 *  - "preview" renders the scroll timeline at the scrub position and the
 *              gizmo edits the *active keyframe's* override.
 *
 * The camera belongs to OrbitControls in scene mode and to the timeline in
 * preview mode, which is why the runtime takes an `applyCamera` flag.
 */
export class EditorViewport {
  readonly viewer: Viewer;

  private store: SceneStore;
  private orbit: OrbitControls;
  private gizmo: TransformControls;
  private outline: THREE.BoxHelper;
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pointerDown = { x: 0, y: 0, time: 0 };
  private gizmoDragging = false;
  private raf = 0;
  private clock = new THREE.Clock();

  constructor(canvas: HTMLCanvasElement, store: SceneStore) {
    this.store = store;
    this.viewer = new Viewer(canvas, store.scene);

    this.orbit = new OrbitControls(this.viewer.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.target.set(0, 1.4, 0);
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.minDistance = 1.2;
    this.orbit.maxDistance = 80;
    this.orbit.update();

    this.gizmo = new TransformControls(this.viewer.camera, canvas);
    this.gizmo.setSize(0.85);
    this.gizmo.addEventListener("dragging-changed", (event) => {
      this.gizmoDragging = Boolean(event.value);
      this.orbit.enabled = !this.gizmoDragging;
      if (this.gizmoDragging) this.store.pushHistory();
      else this.store.touch("properties");
    });
    this.gizmo.addEventListener("objectChange", () => this.commitGizmo());
    this.viewer.scene.add(this.gizmo.getHelper());

    this.outline = new THREE.BoxHelper(new THREE.Object3D(), 0x6df0ff);
    this.outline.visible = false;
    const outlineMat = this.outline.material as THREE.LineBasicMaterial;
    outlineMat.depthTest = false;
    outlineMat.transparent = true;
    this.outline.renderOrder = 999;
    this.viewer.scene.add(this.outline);

    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointerup", this.handlePointerUp);

    this.syncGizmoTarget();
    this.loop();
  }

  /* ----------------------------- input ----------------------------- */

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY, time: performance.now() };
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (this.gizmoDragging || event.button !== 0) return;
    const moved = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
    if (moved > 4 || performance.now() - this.pointerDown.time > 700) return;
    this.pickAt(event);
  };

  private pickAt(event: PointerEvent): void {
    const rect = this.viewer.renderer.domElement.getBoundingClientRect();
    this.ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.viewer.camera);

    const candidates = [...this.viewer.meshes.values()].filter((m) => m.visible);
    const hits = this.raycaster.intersectObjects(candidates, false);
    const hit = hits[0]?.object as THREE.Mesh | undefined;
    this.store.select(hit?.userData.objectId ?? null);
  }

  /* ---------------------------- gizmo ---------------------------- */

  private commitGizmo(): void {
    const target = this.gizmo.object;
    if (!target) return;
    const id = target.userData.objectId as string | undefined;
    if (!id) return;

    const transform = readTransform(target);
    if (this.store.mode === "preview") {
      this.store.setObjectOverrideFromMesh(id, transform);
      this.viewer.refreshTimeline();
    } else {
      const obj = this.store.objectById(id);
      if (obj) obj.transform = transform;
      this.viewer.refreshTimeline();
    }
    this.store.touch("properties");
  }

  syncGizmoTarget(): void {
    const id = this.store.selectedId;
    const mesh = id ? this.viewer.meshes.get(id) : undefined;
    if (mesh) this.gizmo.attach(mesh);
    else this.gizmo.detach();
  }

  setGizmoMode(mode: GizmoMode): void {
    this.gizmo.setMode(mode);
  }

  setGizmoSpace(space: "world" | "local"): void {
    this.gizmo.setSpace(space);
  }

  toggleSnap(enabled: boolean): void {
    this.gizmo.setTranslationSnap(enabled ? 0.25 : null);
    this.gizmo.setRotationSnap(enabled ? Math.PI / 12 : null);
    this.gizmo.setScaleSnap(enabled ? 0.1 : null);
  }

  focusSelection(): void {
    const id = this.store.selectedId;
    if (!id) return;
    const mesh = id ? this.viewer.meshes.get(id) : undefined;
    if (!mesh) return;
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 2;
    this.orbit.target.copy(center);
    const dir = this.viewer.camera.position.clone().sub(center).normalize();
    this.viewer.camera.position.copy(center).addScaledVector(dir, size * 1.9);
    this.orbit.update();
  }

  /* ---------------------------- render ---------------------------- */

  /** All objects at their resting (base) transform — the scene-authoring view. */
  private baseState(): ScrollState {
    return {
      camera: { position: [0, 2, 9], target: [0, 1.4, 0] },
      poses: this.store.scene.objects.map((o) => ({
        transform: {
          position: [...o.transform.position] as [number, number, number],
          rotation: [...o.transform.rotation] as [number, number, number],
          scale: [...o.transform.scale] as [number, number, number],
        },
        opacity: o.material.opacity,
      })),
    };
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);

    const preview = this.store.mode === "preview";
    const elapsed = preview ? this.clock.getElapsedTime() : 0;
    const state = preview ? this.viewer.poseAt(this.store.previewProgress) : this.baseState();

    this.viewer.applyPose(state, elapsed, preview);
    if (!preview) this.orbit.update();

    const selected = this.store.selectedId ? this.viewer.meshes.get(this.store.selectedId) : undefined;
    if (selected && selected.visible) {
      this.outline.visible = true;
      this.outline.setFromObject(selected);
    } else {
      this.outline.visible = false;
    }

    this.viewer.renderStill();
  };

  /** Called by the shell when the store emits a change. */
  handleChange(kind: string): void {
    if (kind === "structure") {
      this.viewer.setScene(this.store.scene);
      this.viewer.refreshTimeline();
      this.syncGizmoTarget();
      return;
    }
    if (kind === "timeline") {
      this.viewer.refreshTimeline();
      return;
    }
    if (kind === "selection") {
      this.syncGizmoTarget();
      return;
    }
    if (kind === "properties") {
      const selected = this.store.selectedObject;
      if (selected) this.viewer.syncObject(selected);
      this.viewer.refreshTimeline();
      this.syncGizmoTarget();
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    const canvas = this.viewer.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    canvas.removeEventListener("pointerup", this.handlePointerUp);
    this.gizmo.detach();
    this.orbit.dispose();
    this.gizmo.dispose();
    this.viewer.dispose();
  }
}
