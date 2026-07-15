/**
 * The visual-channel vocabulary — shared by the renderer (which draws it) and the
 * inspector (which edits it). A node's type / shape / color / size ride as
 * **reserved attribute keys** (`type`, `shape`, `color`, `size`), so they persist
 * in `.ndmm.md` with no format change and stay swappable. `pinned` is also
 * reserved (layout uses it). Everything else in `attrs` is a free-form dimension.
 */

import type { GraphNode, Scalar } from "./model.js";

export type Shape = "rounded" | "rect" | "pill" | "ellipse" | "diamond";

export const SHAPES: { value: Shape; label: string }[] = [
  { value: "rounded", label: "Rounded" },
  { value: "rect", label: "Rectangle" },
  { value: "pill", label: "Pill" },
  { value: "ellipse", label: "Ellipse" },
  { value: "diamond", label: "Diamond" },
];

/** Palette. Empty value = "unassigned / aesthetic default" (theme decides). */
export const COLORS: { value: string; label: string }[] = [
  { value: "", label: "Default" },
  { value: "#6aa9ff", label: "Blue" },
  { value: "#b98cff", label: "Violet" },
  { value: "#4fd6a8", label: "Green" },
  { value: "#ffb86b", label: "Amber" },
  { value: "#ff8a8a", label: "Red" },
  { value: "#8a93a6", label: "Slate" },
];

export type SizeKey = "s" | "m" | "l";
export const SIZES: Record<SizeKey, number> = { s: 0.85, m: 1, l: 1.3 };

/** Reserved keys never shown in the free-form attribute editor. */
export const RESERVED_ATTRS = new Set(["pinned", "type", "shape", "color", "size"]);

export function nodeShape(n: GraphNode): Shape {
  const s = n.attrs.shape;
  return typeof s === "string" && SHAPES.some((x) => x.value === s) ? (s as Shape) : "rounded";
}

export function nodeColor(n: GraphNode): string {
  return typeof n.attrs.color === "string" ? n.attrs.color : "";
}

export function nodeSizeKey(n: GraphNode): SizeKey {
  const s = n.attrs.size;
  return s === "s" || s === "l" ? s : "m";
}

export function nodeScale(n: GraphNode): number {
  return SIZES[nodeSizeKey(n)];
}

export function nodeType(n: GraphNode): string {
  return typeof n.attrs.type === "string" ? n.attrs.type : "";
}

/** Free-form (non-reserved) attributes as [key, value] pairs. */
export function customAttrs(n: GraphNode): [string, Scalar][] {
  return Object.entries(n.attrs).filter(([k]) => !RESERVED_ATTRS.has(k));
}

/** Black or white text for legibility on a given fill (YIQ luminance). */
export function contrastText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "";
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255, g = (int >> 8) & 255, b = int & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 >= 140 ? "#14161b" : "#ffffff";
}
