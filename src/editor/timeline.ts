import type { SceneStore } from "./store";
import { button, el, textRow } from "./ui";

export interface TimelineHandle {
  refresh(): void;
}

/**
 * Scroll timeline: mode switch, scrubber, and draggable keyframe markers.
 *
 * Markers are positioned in place during a drag rather than re-rendered, so
 * the element under the pointer survives the store update it triggers.
 */
export function renderTimeline(root: HTMLElement, store: SceneStore): TimelineHandle {
  root.replaceChildren();

  const modeRow = el("div", { class: "timeline-mode" });
  const sceneBtn = button("Scene", () => store.setMode("scene"), "btn tiny");
  const previewBtn = button("Preview", () => store.setMode("preview"), "btn tiny");
  modeRow.append(sceneBtn, previewBtn);

  const scrubLabel = el("span", { class: "timeline-label", text: "0%" });
  const scrub = el("input", {
    type: "range",
    min: 0,
    max: 1,
    step: 0.001,
    value: store.previewProgress,
    class: "ctl range scrub",
  });
  scrub.addEventListener("input", () => {
    store.previewProgress = Number(scrub.value);
    store.touch("timeline");
  });

  const track = el("div", { class: "kf-track" });
  const ticks = el("div", { class: "kf-ticks" });
  track.append(ticks);

  const markerRow = el("div", { class: "kf-markers" });
  track.append(markerRow);

  const controls = el("div", { class: "timeline-controls" });
  const addBtn = button("+ Keyframe", () => store.addKeyframe(), "btn tiny");
  const removeBtn = button("Remove", () => store.removeKeyframe(store.activeKeyframe), "btn tiny ghost");
  controls.append(addBtn, removeBtn);

  const labelHost = el("div", { class: "timeline-label-host" });
  root.append(modeRow, el("div", { class: "timeline-scrub" }, scrubLabel, scrub), track, controls, labelHost);

  interface Marker {
    el: HTMLElement;
    index: number;
  }
  let markers: Marker[] = [];
  let builtCount = -1;
  let labelBinding: { wrap: HTMLElement; read: () => string[] } | null = null;

  /* ------------------------------- ticks ------------------------------- */

  for (let i = 0; i <= 10; i += 1) {
    const tick = el("div", { class: "kf-tick" });
    tick.style.left = `${i * 10}%`;
    ticks.append(tick);
  }

  /* ------------------------------ markers ------------------------------ */

  function buildMarkers(): void {
    markerRow.replaceChildren();
    markers = [];

    store.scene.scroll.keyframes.forEach((kf, index) => {
      const marker = el("div", { class: "kf-marker" });
      const dot = el("div", { class: "kf-dot" });
      const tag = el("div", { class: "kf-tag", text: kf.label });
      marker.append(dot, tag);
      marker.style.left = `${kf.at * 100}%`;

      marker.addEventListener("click", (event) => {
        if (dragging) return;
        if ((event.target as HTMLElement).closest(".kf-tag")) return;
        store.setActiveKeyframe(index);
      });

      dot.addEventListener("pointerdown", (event) => startDrag(event, index));

      markerRow.append(marker);
      markers.push({ el: marker, index });
    });

    builtCount = store.scene.scroll.keyframes.length;
    labelBinding = null;
    labelHost.replaceChildren();
  }

  function buildLabelEditor(): void {
    const kf = store.activeKeyframeDef;
    labelHost.replaceChildren();
    if (!kf) {
      labelBinding = null;
      return;
    }
    const wrap = textRow("Keyframe label", kf.label, (v) => {
      store.edit("timeline", () => {
        kf.label = v;
      });
    });
    labelBinding = { wrap, read: () => [store.activeKeyframeDef?.label ?? ""] };
    labelHost.append(wrap);
  }

  /* ------------------------------- drag ------------------------------- */

  let dragging = false;
  let dragIndex = -1;

  function startDrag(event: PointerEvent, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    dragIndex = index;
    store.setActiveKeyframe(index);
    store.pushHistory();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent): void {
    if (!dragging || dragIndex < 0) return;
    const kf = store.scene.scroll.keyframes[dragIndex];
    if (!kf) return;
    const rect = track.getBoundingClientRect();
    const at = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    kf.at = Math.round(at * 1000) / 1000;
    store.previewProgress = kf.at;
    store.dirty = true;
    syncMarkers();
    store.emit("timeline");
  }

  function endDrag(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    dragIndex = -1;
    try {
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      /* pointer already released */
    }
    store.touch("timeline");
  }

  track.addEventListener("pointermove", moveDrag);
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);

  /* ------------------------------ refresh ----------------------------- */

  function syncMarkers(): void {
    for (const marker of markers) {
      const kf = store.scene.scroll.keyframes[marker.index];
      if (!kf) continue;
      marker.el.style.left = `${kf.at * 100}%`;
      marker.el.classList.toggle("active", marker.index === store.activeKeyframe);
      const tag = marker.el.querySelector<HTMLElement>(".kf-tag");
      if (tag && tag.textContent !== kf.label) tag.textContent = kf.label;
    }
  }

  function refresh(): void {
    const count = store.scene.scroll.keyframes.length;
    if (count !== builtCount) {
      buildMarkers();
      buildLabelEditor();
    } else if (!labelBinding) {
      buildLabelEditor();
    }

    syncMarkers();

    const preview = store.mode === "preview";
    sceneBtn.classList.toggle("active", !preview);
    previewBtn.classList.toggle("active", preview);

    scrub.disabled = !preview;
    if (document.activeElement !== scrub) scrub.value = String(store.previewProgress);
    scrubLabel.textContent = `${Math.round(store.previewProgress * 100)}%`;

    removeBtn.disabled = count <= 1;

    if (labelBinding) {
      const input = labelBinding.wrap.querySelector<HTMLInputElement>("input");
      const value = labelBinding.read()[0];
      if (input && document.activeElement !== input && input.value !== value) input.value = value;
    }

    const active = store.activeKeyframeDef;
    if (active && !dragging && document.activeElement !== scrub) {
      scrub.value = String(store.previewProgress);
    }
  }

  buildMarkers();
  buildLabelEditor();
  refresh();

  return { refresh };
}
