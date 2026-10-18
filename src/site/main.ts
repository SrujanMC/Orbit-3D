import "./site.css";
import { validateScene } from "../scene/build";
import { scrollProgress } from "../scene/scroll";
import { Viewer } from "../runtime/viewer";

/**
 * Published-site entry point.
 *
 * Reads a scene JSON, builds the shared runtime around it, and maps page
 * scroll onto the scene's timeline. All the 3D work lives in the runtime;
 * this file only connects scroll and overlay panels to it.
 */

const SCENE_URL = new URLSearchParams(location.search).get("scene") ?? "scenes/demo.json";
const FADE = 0.06;

function fail(title: string, details: string[]): void {
  const card = document.createElement("div");
  card.className = "error-card";
  const heading = document.createElement("h3");
  heading.textContent = title;
  card.append(heading);
  if (details.length > 0) {
    const list = document.createElement("ul");
    for (const d of details) {
      const li = document.createElement("li");
      li.textContent = d;
      list.append(li);
    }
    card.append(list);
  }
  document.body.append(card);
}

function panelOpacity(p: number, from: number, to: number): number {
  if (p <= from || p >= to) return 0;
  const rise = Math.min(1, (p - from) / FADE);
  const fall = Math.min(1, (to - p) / FADE);
  return Math.max(0, Math.min(rise, fall));
}

async function boot(): Promise<void> {
  let raw: unknown;
  try {
    const res = await fetch(SCENE_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    raw = await res.json();
  } catch (err) {
    fail(`Could not load the scene at ${SCENE_URL}`, [String(err)]);
    return;
  }

  const parsed = validateScene(raw);
  if (!parsed.ok) {
    fail("Scene failed validation", parsed.errors);
    return;
  }
  const scene = parsed.scene;
  document.title = `${scene.meta.name} — Orbit`;

  const canvas = document.getElementById("stage") as HTMLCanvasElement | null;
  const track = document.getElementById("track");
  if (!canvas || !track) {
    fail("Page is missing required elements.", ["#stage or #track not found."]);
    return;
  }

  let viewer: Viewer;
  try {
    viewer = new Viewer(canvas, scene);
  } catch (err) {
    fail("WebGL is not available in this browser.", [String(err)]);
    return;
  }

  track.style.height = `${scene.scroll.length}vh`;

  const panels = Array.from(document.querySelectorAll<HTMLElement>(".panel")).map((el) => ({
    el,
    from: Number(el.dataset.from ?? 0),
    to: Number(el.dataset.to ?? 1),
  }));

  const labelEl = document.getElementById("hud-label");
  const fillEl = document.getElementById("hud-fill");
  const labels = scene.scroll.keyframes.map((k) => ({ at: k.at, label: k.label }));

  let progress = 0;
  viewer.setProgressSource(() => {
    progress = scene.scroll.enabled ? scrollProgress(track, window.innerHeight) : 0;
    return progress;
  });

  let lastLabel = "";
  viewer.start(() => {
    const p = progress;

    if (fillEl) fillEl.style.width = `${(p * 100).toFixed(2)}%`;

    let nearest = labels[0];
    for (const l of labels) {
      if (p >= l.at) nearest = l;
    }
    if (nearest && nearest.label !== lastLabel) {
      lastLabel = nearest.label;
      if (labelEl) labelEl.textContent = nearest.label;
    }

    for (const panel of panels) {
      const o = panelOpacity(p, panel.from, panel.to);
      panel.el.style.opacity = o.toFixed(3);
      panel.el.style.transform = `translate(-50%, calc(-50% + ${((1 - o) * 18).toFixed(1)}px))`;
      panel.el.classList.toggle("active", o > 0.5);
    }
  });
}

void boot();
