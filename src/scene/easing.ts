export type EasingName = "linear" | "easeInOut" | "easeOut";

const EASINGS: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
};

export function ease(name: EasingName, t: number): number {
  return (EASINGS[name] ?? EASINGS.linear)(Math.min(1, Math.max(0, t)));
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function lerpVec3(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
