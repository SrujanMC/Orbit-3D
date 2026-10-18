import { GEOMETRY_ARGS, type GeometryType } from "../scene/schema";
import type { SceneStore } from "./store";
import { button, clear, el } from "./ui";

const GEOMETRY_TYPES = Object.keys(GEOMETRY_ARGS) as GeometryType[];

/**
 * Object list with add controls. Re-rendered wholesale on structural and
 * selection changes — it holds no transient input state, so that is safe.
 */
export function renderOutline(root: HTMLElement, store: SceneStore): void {
  clear(root);

  const picker = el("select", { class: "ctl" });
  for (const t of GEOMETRY_TYPES) picker.append(el("option", { value: t, text: t }));

  const addRow = el(
    "div",
    { class: "outline-add" },
    picker,
    button("Add object", () => store.addObject(picker.value as GeometryType), "btn tiny"),
  );

  const list = el("ul", { class: "outline-list" });

  for (const obj of store.scene.objects) {
    const isSelected = obj.id === store.selectedId;
    const li = el("li", { class: `outline-item${isSelected ? " selected" : ""}` });

    const swatch = el("span", { class: "swatch" });
    swatch.style.background = obj.material.color;

    const label = el("span", { class: "outline-name", text: obj.name });

    const actions = el("span", { class: "outline-actions" });
    const dup = button("⧉", () => store.duplicateObject(obj.id), "icon-btn");
    dup.title = "Duplicate";
    const del = button("✕", () => store.removeObject(obj.id), "icon-btn danger");
    del.title = "Delete";
    actions.append(dup, del);

    li.append(swatch, label, actions);
    li.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(".icon-btn")) return;
      store.select(obj.id);
    });
    list.append(li);
  }

  if (store.scene.objects.length === 0) {
    list.append(el("li", { class: "outline-empty", text: "No objects yet." }));
  }

  const counts = el(
    "p",
    { class: "outline-count", text: `${store.scene.objects.length} objects · ${store.scene.scroll.keyframes.length} keyframes` },
  );

  root.append(addRow, list, counts);
}
