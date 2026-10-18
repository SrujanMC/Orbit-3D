import {
  createKeyframe,
  createLight,
  createObject,
  type GeometryType,
  type LightType,
  type SceneDef,
  type SceneKeyframe,
  type SceneObject,
  type TransformDef,
  type Vec3,
} from "../scene/schema";

export type ChangeKind = "structure" | "properties" | "selection" | "timeline";

/**
 * "scene"   — objects render at their base transform; the gizmo edits the scene.
 * "preview" — the scroll timeline drives the objects; the gizmo edits the
 *             active keyframe's override for the selected object.
 */
export type EditorMode = "scene" | "preview";

export class SceneStore {
  scene: SceneDef;
  selectedId: string | null = null;
  mode: EditorMode = "scene";
  activeKeyframe = 0;
  previewProgress = 0;
  dirty = false;

  private listeners = new Set<(kind: ChangeKind) => void>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private readonly limit = 80;

  constructor(scene: SceneDef) {
    this.scene = scene;
  }

  /* ------------------------------ events ------------------------------ */

  subscribe(fn: (kind: ChangeKind) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(kind: ChangeKind): void {
    for (const fn of this.listeners) fn(kind);
  }

  /* ----------------------------- history ----------------------------- */

  private snapshot(): string {
    return JSON.stringify({ scene: this.scene, selectedId: this.selectedId });
  }

  pushHistory(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.snapshot());
    this.restore(previous);
    this.emit("structure");
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
    this.emit("structure");
  }

  private restore(json: string): void {
    const parsed = JSON.parse(json) as { scene: SceneDef; selectedId: string | null };
    this.scene = parsed.scene;
    this.selectedId = parsed.selectedId;
    this.dirty = true;
    this.clampKeyframe();
  }

  /** Mutate, record history, and notify. */
  edit(kind: ChangeKind, fn: () => void): void {
    this.pushHistory();
    fn();
    this.touch(kind);
  }

  touch(kind: ChangeKind): void {
    this.dirty = true;
    if (kind === "structure" || kind === "timeline") this.clampKeyframe();
    this.emit(kind);
  }

  replaceScene(scene: SceneDef): void {
    this.pushHistory();
    this.scene = scene;
    this.selectedId = null;
    this.activeKeyframe = 0;
    this.previewProgress = 0;
    this.dirty = false;
    this.emit("structure");
  }

  /* ---------------------------- selection ---------------------------- */

  select(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit("selection");
  }

  get selectedObject(): SceneObject | null {
    if (!this.selectedId) return null;
    return this.scene.objects.find((o) => o.id === this.selectedId) ?? null;
  }

  objectById(id: string): SceneObject | undefined {
    return this.scene.objects.find((o) => o.id === id);
  }

  /* ---------------------------- structure ---------------------------- */

  addObject(type: GeometryType, position?: Vec3): void {
    this.edit("structure", () => {
      const obj = createObject(type, position ?? [0, 1, 0]);
      this.scene.objects.push(obj);
      this.selectedId = obj.id;
    });
  }

  duplicateObject(id: string): void {
    const source = this.objectById(id);
    if (!source) return;
    this.edit("structure", () => {
      const copy: SceneObject = JSON.parse(JSON.stringify(source));
      copy.id = `${source.id}_copy_${Date.now().toString(36)}`;
      copy.name = `${source.name} copy`;
      copy.transform.position[0] += 1.4;
      this.scene.objects.push(copy);
      this.selectedId = copy.id;
    });
  }

  removeObject(id: string): void {
    this.edit("structure", () => {
      this.scene.objects = this.scene.objects.filter((o) => o.id !== id);
      for (const kf of this.scene.scroll.keyframes) {
        kf.objects = kf.objects.filter((o) => o.id !== id);
      }
      if (this.selectedId === id) this.selectedId = null;
    });
  }

  addLight(type: LightType): void {
    this.edit("structure", () => {
      this.scene.lights.push(createLight(type));
    });
  }

  removeLight(id: string): void {
    this.edit("structure", () => {
      this.scene.lights = this.scene.lights.filter((l) => l.id !== id);
    });
  }

  /* ---------------------------- timeline ----------------------------- */

  private clampKeyframe(): void {
    const n = this.scene.scroll.keyframes.length;
    if (n === 0) {
      this.activeKeyframe = 0;
      return;
    }
    this.activeKeyframe = Math.min(Math.max(0, this.activeKeyframe), n - 1);
  }

  get activeKeyframeDef(): SceneKeyframe | null {
    return this.scene.scroll.keyframes[this.activeKeyframe] ?? null;
  }

  sortedKeyframeIndices(): number[] {
    return this.scene.scroll.keyframes
      .map((k, i) => ({ at: k.at, i }))
      .sort((a, b) => a.at - b.at)
      .map((x) => x.i);
  }

  setActiveKeyframe(index: number): void {
    this.activeKeyframe = index;
    const kf = this.activeKeyframeDef;
    if (kf) this.previewProgress = kf.at;
    this.emit("timeline");
  }

  /** Captures the current base pose of an object as a keyframe override. */
  captureObjectIntoKeyframe(objectId: string): void {
    const obj = this.objectById(objectId);
    const kf = this.activeKeyframeDef;
    if (!obj || !kf) return;
    this.edit("timeline", () => {
      const existing = kf.objects.find((o) => o.id === objectId);
      const transform: TransformDef = JSON.parse(JSON.stringify(obj.transform));
      if (existing) {
        existing.transform = transform;
        existing.opacity = obj.material.opacity;
      } else {
        kf.objects.push({ id: objectId, transform, opacity: obj.material.opacity });
      }
    });
  }

  clearObjectFromKeyframe(objectId: string): void {
    const kf = this.activeKeyframeDef;
    if (!kf) return;
    this.edit("timeline", () => {
      kf.objects = kf.objects.filter((o) => o.id !== objectId);
    });
  }

  /** Writes a transform into every keyframe so a preview-mode edit sticks. */
  setObjectOverrideFromMesh(objectId: string, transform: TransformDef): void {
    const kf = this.activeKeyframeDef;
    const obj = this.objectById(objectId);
    if (!kf || !obj) return;
    const existing = kf.objects.find((o) => o.id === objectId);
    const copy: TransformDef = JSON.parse(JSON.stringify(transform));
    if (existing) {
      existing.transform = copy;
    } else {
      kf.objects.push({ id: objectId, transform: copy });
    }
    // Keep the base transform in step when editing keyframe 1, so the object's
    // resting pose matches where the author put it.
    if (this.activeKeyframe === 0) {
      obj.transform = JSON.parse(JSON.stringify(copy));
    }
  }

  addKeyframe(): void {
    this.edit("timeline", () => {
      const count = this.scene.scroll.keyframes.length;
      const at = count === 0 ? 0 : Math.min(0.95, 0.5 + count * 0.01);
      const kf = createKeyframe(at, `Keyframe ${count + 1}`);
      const previous = this.activeKeyframeDef;
      if (previous) {
        kf.camera = JSON.parse(JSON.stringify(previous.camera));
        kf.objects = JSON.parse(JSON.stringify(previous.objects));
      }
      this.scene.scroll.keyframes.push(kf);
      const sorted = this.sortedKeyframeIndices();
      this.activeKeyframe = sorted[sorted.length - 1];
      this.previewProgress = kf.at;
    });
  }

  removeKeyframe(index: number): void {
    if (this.scene.scroll.keyframes.length <= 1) return;
    this.edit("timeline", () => {
      this.scene.scroll.keyframes.splice(index, 1);
      this.activeKeyframe = Math.max(0, Math.min(this.activeKeyframe, this.scene.scroll.keyframes.length - 1));
    });
  }

  setMode(mode: EditorMode): void {
    this.mode = mode;
    this.emit("properties");
  }

  serialize(): string {
    return JSON.stringify(this.scene, null, 2);
  }
}
