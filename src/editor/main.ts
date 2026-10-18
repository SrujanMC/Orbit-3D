import "./editor.css";
import { validateScene } from "../scene/build";
import { createKeyframe, createLight, createObject, type SceneDef } from "../scene/schema";
import { renderInspector, type InspectorHandle } from "./inspector";
import { renderOutline } from "./outline";
import { SceneStore } from "./store";
import { renderTimeline, type TimelineHandle } from "./timeline";
import { button, el } from "./ui";
import { EditorViewport, type GizmoMode } from "./viewport";

const AUTOSAVE_KEY = "orbit3d.scene.v1";
const params = new URLSearchParams(location.search);

function blankScene(): SceneDef {
  const hero = createObject("torusKnot", [0, 1.5, 0], "#b39dff");
  hero.spin = [0, 0.16, 0];

  const first = createKeyframe(0, "Establish");
  first.camera = { position: [0, 3.2, 13.5], target: [0, 1.5, 0] };
  first.objects.push({
    id: hero.id,
    transform: { position: [0, 1.5, 0], rotation: [0.4, 0, 0.1], scale: [1, 1, 1] },
    opacity: 1,
  });

  const last = createKeyframe(1, "Resolve");
  last.camera = { position: [0, 5.4, 15], target: [0, 1.6, 0] };
  last.objects.push({
    id: hero.id,
    transform: { position: [0, 1.6, 0], rotation: [1.6, 6.4, 0], scale: [1, 1, 1] },
    opacity: 1,
  });

  return {
    meta: { name: "Untitled Scene", version: 1 },
    environment: {
      background: "#07060f",
      fog: { enabled: true, color: "#07060f", near: 14, far: 46 },
      ground: { enabled: true, color: "#0d0b1a", size: 80, y: -1.6 },
    },
    lights: [createLight("ambient"), createLight("directional", [6, 11, 7])],
    objects: [hero],
    scroll: { enabled: true, length: 400, fov: 45, easing: "easeInOut", keyframes: [first, last] },
  };
}

async function loadInitialScene(): Promise<SceneDef> {
  const fromUrl = params.get("scene");
  if (fromUrl) {
    const res = await fetch(fromUrl, { cache: "no-cache" });
    const parsed = validateScene(await res.json());
    if (parsed.ok) return parsed.scene;
  }

  const saved = localStorage.getItem(AUTOSAVE_KEY);
  if (saved) {
    try {
      const parsed = validateScene(JSON.parse(saved));
      if (parsed.ok) return parsed.scene;
    } catch {
      /* fall through to the demo scene */
    }
  }

  try {
    const res = await fetch("scenes/demo.json", { cache: "no-cache" });
    const parsed = validateScene(await res.json());
    if (parsed.ok) return parsed.scene;
  } catch {
    /* fall through to a blank scene */
  }

  return blankScene();
}

function download(filename: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function main(): Promise<void> {
  const canvas = document.getElementById("viewport") as HTMLCanvasElement;
  const outlineHost = document.getElementById("panel-outline") as HTMLElement;
  const inspectorHost = document.getElementById("panel-inspector") as HTMLElement;
  const timelineHost = document.getElementById("panel-timeline") as HTMLElement;
  const toolbar = document.getElementById("toolbar") as HTMLElement;
  const statusEl = document.getElementById("status") as HTMLElement;

  const store = new SceneStore(await loadInitialScene());
  const viewport = new EditorViewport(canvas, store);

  let inspector: InspectorHandle = renderInspector(inspectorHost, store);
  let timeline: TimelineHandle = renderTimeline(timelineHost, store);
  renderOutline(outlineHost, store);

  /* ------------------------------ toolbar ----------------------------- */

  const gizmoButtons = new Map<GizmoMode, HTMLButtonElement>();
  const gizmoRow = el("div", { class: "tool-group" });
  (["translate", "rotate", "scale"] as GizmoMode[]).forEach((mode) => {
    const b = button(mode[0].toUpperCase() + mode.slice(1), () => setGizmo(mode), "btn tiny");
    gizmoButtons.set(mode, b);
    gizmoRow.append(b);
  });

  function setGizmo(mode: GizmoMode): void {
    viewport.setGizmoMode(mode);
    for (const [key, btn] of gizmoButtons) btn.classList.toggle("active", key === mode);
  }

  let localSpace = false;
  const spaceBtn = button("Local", () => {
    localSpace = !localSpace;
    viewport.setGizmoSpace(localSpace ? "local" : "world");
    spaceBtn.classList.toggle("active", localSpace);
  }, "btn tiny");

  let snapOn = false;
  const snapBtn = button("Snap", () => {
    snapOn = !snapOn;
    viewport.toggleSnap(snapOn);
    snapBtn.classList.toggle("active", snapOn);
  }, "btn tiny");

  const focusBtn = button("Focus", () => viewport.focusSelection(), "btn tiny");
  const undoBtn = button("Undo", () => store.undo(), "btn tiny ghost");
  const redoBtn = button("Redo", () => store.redo(), "btn tiny ghost");
  const saveBtn = button("Save", () => saveScene(), "btn tiny");
  const newBtn = button("New", () => store.replaceScene(blankScene()), "btn tiny ghost");
  const demoBtn = button("Load demo", () => void loadDemo(), "btn tiny ghost");
  const fileInput = el("input", { type: "file", accept: ".json,application/json", class: "hidden-file" });
  const openBtn = button("Open…", () => fileInput.click(), "btn tiny ghost");

  toolbar.append(
    gizmoRow,
    el("div", { class: "tool-divider" }),
    spaceBtn,
    snapBtn,
    focusBtn,
    el("div", { class: "tool-divider" }),
    undoBtn,
    redoBtn,
    el("div", { class: "tool-divider" }),
    openBtn,
    demoBtn,
    newBtn,
    saveBtn,
    fileInput,
  );

  function saveScene(): void {
    download(`${store.scene.meta.name.replace(/\s+/g, "-").toLowerCase()}.json`, store.serialize());
    store.dirty = false;
    updateStatus();
  }

  async function loadDemo(): Promise<void> {
    const res = await fetch("scenes/demo.json", { cache: "no-cache" });
    const parsed = validateScene(await res.json());
    if (parsed.ok) {
      store.replaceScene(parsed.scene);
      setGizmo("translate");
    }
  }

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const parsed = validateScene(JSON.parse(await file.text()));
      if (parsed.ok) store.replaceScene(parsed.scene);
      else window.alert(`Scene rejected:\n\n${parsed.errors.join("\n")}`);
    } catch (err) {
      window.alert(`Could not parse that file: ${String(err)}`);
    }
    fileInput.value = "";
  });

  /* ------------------------------- status ----------------------------- */

  function updateStatus(): void {
    const lines = [
      store.scene.meta.name,
      `${store.scene.objects.length} objects`,
      store.mode === "preview" ? `keyframe ${store.activeKeyframe + 1}/${store.scene.scroll.keyframes.length}` : "scene mode",
      store.dirty ? "unsaved" : "saved",
    ];
    statusEl.textContent = lines.join("  ·  ");
    undoBtn.disabled = !store.canUndo;
    redoBtn.disabled = !store.canRedo;
  }

  /* ----------------------------- autosave ----------------------------- */

  let autosaveTimer = 0;
  function scheduleAutosave(): void {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, store.serialize());
      } catch {
        /* storage full or blocked — the file save path still works */
      }
    }, 700);
  }

  /* ------------------------------ wiring ------------------------------ */

  store.subscribe((kind) => {
    viewport.handleChange(kind);

    if (kind === "structure" || kind === "selection") {
      inspector = renderInspector(inspectorHost, store);
      renderOutline(outlineHost, store);
      timeline.refresh();
    } else if (kind === "timeline") {
      timeline.refresh();
      inspector.refresh();
    } else {
      inspector.refresh();
    }

    updateStatus();
    scheduleAutosave();
  });

  /* ---------------------------- shortcuts ---------------------------- */

  window.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.isContentEditable)) {
      return;
    }
    const meta = event.ctrlKey || event.metaKey;

    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) store.redo();
      else store.undo();
      return;
    }
    if (meta && event.key.toLowerCase() === "y") {
      event.preventDefault();
      store.redo();
      return;
    }
    if (meta && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveScene();
      return;
    }
    if (meta && event.key.toLowerCase() === "d") {
      event.preventDefault();
      if (store.selectedId) store.duplicateObject(store.selectedId);
      return;
    }

    switch (event.key.toLowerCase()) {
      case "q":
        setGizmo("translate");
        break;
      case "w":
        setGizmo("rotate");
        break;
      case "e":
        setGizmo("scale");
        break;
      case "f":
        viewport.focusSelection();
        break;
      case "k":
        store.addKeyframe();
        break;
      case "delete":
      case "backspace":
        if (store.selectedId) {
          event.preventDefault();
          store.removeObject(store.selectedId);
        }
        break;
      default:
        break;
    }
  });

  setGizmo("translate");
  updateStatus();

  window.addEventListener("beforeunload", (event) => {
    if (!store.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

void main();
