/**
 * The visual-channel vocabulary — shared by the renderer (which draws it) and the
 * inspector (which edits it). A node's type / shape / color / size ride as
 * **reserved attribute keys** (`type`, `shape`, `color`, `size`), so they persist
 * in `.ndmm.md` with no format change and stay swappable. `pinned` is also
 * reserved (layout uses it). Everything else in `attrs` is a free-form dimension.
 */

import type { Graph, GraphNode, Scalar } from "./model.js";

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

// --- global attribution (channel ↔ dimension binding) -----------------------

/** Read a node's value along a bound dimension ("type" or an attribute key). */
export function dimensionValue(n: GraphNode, source: string): Scalar | undefined {
  const v = source === "type" ? n.attrs.type : n.attrs[source];
  return v === "" ? undefined : v;
}

/** One legend row: a dimension value and the channel value it maps to. */
export interface LegendEntry {
  value: string;
  channelValue: string;
}

const BOUND_PALETTE = COLORS.filter((c) => c.value).map((c) => c.value);
const BOUND_SHAPES: Shape[] = SHAPES.map((s) => s.value);
const SIZE_ORDER: SizeKey[] = ["s", "m", "l"];

/**
 * Resolves each node's *effective* visual channels: a bound channel derives its
 * value from the node's position along the bound dimension (distinct values are
 * assigned palette entries in first-seen node order — stable for a given doc);
 * an unbound channel falls through to the node's own aesthetic attr.
 *
 * Rebuilt per draw — O(nodes), cheap, and always in sync with the graph.
 */
export class ChannelResolver {
  private colorMap = new Map<string, string>();
  private shapeMap = new Map<string, Shape>();
  private sizeMap = new Map<string, SizeKey>();
  private numericSize: { min: number; max: number } | null = null;

  constructor(private graph: Graph) {
    const b = graph.bindings;
    if (b.color) this.assign(b.color, this.colorMap, BOUND_PALETTE);
    if (b.shape) this.assign(b.shape, this.shapeMap, BOUND_SHAPES);
    if (b.size) this.buildSize(b.size);
  }

  /** Map each distinct value of `source` to the next entry in `palette` (cycling). */
  private assign<T>(source: string, map: Map<string, T>, palette: readonly T[]): void {
    for (const n of this.graph.nodes.values()) {
      const v = dimensionValue(n, source);
      if (v === undefined) continue;
      const key = String(v);
      if (!map.has(key)) map.set(key, palette[map.size % palette.length]);
    }
  }

  /** Size: all-numeric values bucket into s/m/l by range; otherwise cycle. */
  private buildSize(source: string): void {
    const values: Scalar[] = [];
    for (const n of this.graph.nodes.values()) {
      const v = dimensionValue(n, source);
      if (v !== undefined) values.push(v);
    }
    if (values.length && values.every((v) => typeof v === "number")) {
      const nums = values as number[];
      this.numericSize = { min: Math.min(...nums), max: Math.max(...nums) };
    } else {
      for (const v of values) {
        const key = String(v);
        if (!this.sizeMap.has(key)) this.sizeMap.set(key, SIZE_ORDER[this.sizeMap.size % SIZE_ORDER.length]);
      }
    }
  }

  color(n: GraphNode): string {
    const src = this.graph.bindings.color;
    if (!src) return nodeColor(n);
    const v = dimensionValue(n, src);
    return v === undefined ? "" : this.colorMap.get(String(v)) ?? "";
  }

  shape(n: GraphNode): Shape {
    const src = this.graph.bindings.shape;
    if (!src) return nodeShape(n);
    const v = dimensionValue(n, src);
    return v === undefined ? "rounded" : this.shapeMap.get(String(v)) ?? "rounded";
  }

  sizeKey(n: GraphNode): SizeKey {
    const src = this.graph.bindings.size;
    if (!src) return nodeSizeKey(n);
    const v = dimensionValue(n, src);
    if (v === undefined) return "m";
    if (this.numericSize) {
      const { min, max } = this.numericSize;
      if (max === min) return "m";
      const t = ((v as number) - min) / (max - min);
      return t < 1 / 3 ? "s" : t < 2 / 3 ? "m" : "l";
    }
    return this.sizeMap.get(String(v)) ?? "m";
  }

  scale(n: GraphNode): number {
    return SIZES[this.sizeKey(n)];
  }

  /** Legend data for every bound channel (empty when nothing is bound). */
  legend(): { channel: "color" | "shape" | "size"; source: string; entries: LegendEntry[] }[] {
    const out: { channel: "color" | "shape" | "size"; source: string; entries: LegendEntry[] }[] = [];
    const b = this.graph.bindings;
    if (b.color) out.push({ channel: "color", source: b.color, entries: [...this.colorMap].map(([value, c]) => ({ value, channelValue: c })) });
    if (b.shape) out.push({ channel: "shape", source: b.shape, entries: [...this.shapeMap].map(([value, s]) => ({ value, channelValue: s })) });
    if (b.size) {
      const entries: LegendEntry[] = this.numericSize
        ? [{ value: `${this.numericSize.min}`, channelValue: "s" }, { value: `${this.numericSize.max}`, channelValue: "l" }]
        : [...this.sizeMap].map(([value, s]) => ({ value, channelValue: s }));
      out.push({ channel: "size", source: b.size, entries });
    }
    return out;
  }
}
