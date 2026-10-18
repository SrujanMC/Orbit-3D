/** Tiny DOM helpers. Keeps the panels readable without pulling in a framework. */

type Props = Record<string, unknown> & { class?: string; text?: string };

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props,
  ...children: (Node | string | number | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === "class") node.className = String(value);
      else if (key === "text") node.textContent = String(value);
      else if (key === "style") Object.assign(node.style, value as object);
      else if (key.startsWith("data-")) node.setAttribute(key, String(value));
      else if (key in node) (node as unknown as Props)[key] = value;
      else node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === "number" ? String(child) : child);
  }
  return node;
}

export function clear(node: HTMLElement): void {
  node.replaceChildren();
}

export interface RowOptions {
  label: string;
  onChange: (value: never) => void;
  step?: number;
  min?: number;
  max?: number;
  hint?: string;
}

/** Labelled numeric input that commits on change/blur rather than per keystroke. */
export function numberRow(
  label: string,
  value: number,
  onChange: (v: number) => void,
  opts: { step?: number; min?: number; max?: number } = {},
): HTMLElement {
  const input = el("input", {
    type: "number",
    value: trim(value),
    step: opts.step ?? 0.01,
    min: opts.min,
    max: opts.max,
    class: "ctl",
  });
  const commit = () => {
    const parsed = Number(input.value);
    if (Number.isFinite(parsed)) onChange(parsed);
    else input.value = trim(value);
  };
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  return el("label", { class: "row" }, el("span", { class: "row-label", text: label }), input);
}

export function vec3Row(
  label: string,
  value: readonly number[],
  onChange: (v: [number, number, number]) => void,
  step = 0.01,
): HTMLElement {
  const out: [number, number, number] = [value[0], value[1], value[2]];
  const inputs = [0, 1, 2].map((i) => {
    const input = el("input", { type: "number", value: trim(value[i]), step, class: "ctl axis" });
    const commit = () => {
      const parsed = Number(input.value);
      if (Number.isFinite(parsed)) {
        out[i] = parsed;
        onChange([out[0], out[1], out[2]]);
      }
    };
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    return input;
  });
  return el(
    "div",
    { class: "row row-vec" },
    el("span", { class: "row-label", text: label }),
    el("div", { class: "vec" }, ...inputs),
  );
}

export function textRow(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const input = el("input", { type: "text", value, class: "ctl" });
  input.addEventListener("change", () => onChange(input.value));
  return el("label", { class: "row" }, el("span", { class: "row-label", text: label }), input);
}

export function colorRow(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const input = el("input", { type: "color", value, class: "ctl color" });
  input.addEventListener("input", () => onChange(input.value));
  return el("label", { class: "row" }, el("span", { class: "row-label", text: label }), input);
}

export function sliderRow(
  label: string,
  value: number,
  onChange: (v: number) => void,
  opts: { min?: number; max?: number; step?: number } = {},
): HTMLElement {
  const readout = el("span", { class: "row-value", text: trim(value) });
  const input = el("input", {
    type: "range",
    value,
    min: opts.min ?? 0,
    max: opts.max ?? 1,
    step: opts.step ?? 0.01,
    class: "ctl range",
  });
  input.addEventListener("input", () => {
    const v = Number(input.value);
    readout.textContent = trim(v);
    onChange(v);
  });
  return el(
    "label",
    { class: "row row-slider" },
    el("span", { class: "row-label", text: label }),
    input,
    readout,
  );
}

export function selectRow<T extends string>(
  label: string,
  value: T,
  options: readonly T[],
  onChange: (v: T) => void,
): HTMLElement {
  const select = el("select", { class: "ctl" });
  for (const opt of options) {
    select.append(el("option", { value: opt, text: opt, selected: opt === value }));
  }
  select.addEventListener("change", () => onChange(select.value as T));
  return el("label", { class: "row" }, el("span", { class: "row-label", text: label }), select);
}

export function checkRow(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el("input", { type: "checkbox", checked: value, class: "ctl check" });
  input.addEventListener("change", () => onChange(input.checked));
  return el("label", { class: "row row-check" }, el("span", { class: "row-label", text: label }), input);
}

export function button(label: string, onClick: () => void, cls = "btn"): HTMLButtonElement {
  const b = el("button", { type: "button", class: cls, text: label });
  b.addEventListener("click", onClick);
  return b;
}

export function section(title: string, ...children: (Node | null)[]): HTMLElement {
  return el(
    "section",
    { class: "section" },
    el("h3", { class: "section-title", text: title }),
    ...children.filter((c): c is Node => c !== null),
  );
}

/** Trims float noise so inputs don't show 0.30000000000000004. */
export function trim(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 1000) / 1000);
}
