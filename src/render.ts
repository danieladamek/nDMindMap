/**
 * Minimal dependency-free SVG renderer + force layout for nDMindMap.
 *
 * This is deliberately small — a solid, hackable starting point rather than a
 * full graph-viz engine. It:
 *   - runs a lightweight spring/repulsion simulation to place nodes,
 *   - draws labeled edges (the relation is the label),
 *   - lets you drag nodes (pinning them, which writes back x/y),
 *   - reports selection so the app shell can act on it.
 */

import type { Graph, GraphNode } from "./model.js";

const SVG_NS = "http://www.w3.org/2000/svg";

interface Sim {
  vx: Map<string, number>;
  vy: Map<string, number>;
}

export interface RendererOptions {
  onSelect?: (node: GraphNode | null) => void;
}

export class Renderer {
  private svg: SVGSVGElement;
  private edgeLayer: SVGGElement;
  private nodeLayer: SVGGElement;
  private sim: Sim = { vx: new Map(), vy: new Map() };
  private dragging: string | null = null;
  private raf = 0;
  private selected: string | null = null;
  private observer: ResizeObserver | null = null;

  constructor(private host: HTMLElement, private graph: Graph, private opts: RendererOptions = {}) {
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "ndmm-canvas");
    this.edgeLayer = document.createElementNS(SVG_NS, "g");
    this.nodeLayer = document.createElementNS(SVG_NS, "g");
    this.svg.append(this.edgeLayer, this.nodeLayer);
    host.append(this.svg);

    this.bindDrag();
    this.svg.addEventListener("pointerdown", (e) => {
      if (e.target === this.svg) this.select(null);
    });

    // Lay out once the stage actually has its size. At construction the CSS grid
    // hasn't resolved the stage height yet (it measures 0), so seeding/centring
    // now would frame the map around the wrong centre. A ResizeObserver fires
    // when the real size lands — and again if the window resizes.
    this.observer = new ResizeObserver(() => this.onResize());
    this.observer.observe(host);

    this.start();
  }

  private laidOut = false;

  private onResize(): void {
    const { width, height } = this.size();
    if (width < 10 || height < 10) return; // not really sized yet
    if (!this.laidOut) {
      this.seedPositions();
      this.warmUp();
      this.laidOut = true;
    } else {
      // Window resized after the initial layout — let gravity re-centre without
      // discarding the user's arrangement.
      this.warmUp(80);
    }
  }

  /** Give every unplaced node a starting spot near the centre. */
  private seedPositions(): void {
    const { width, height } = this.size();
    let i = 0;
    for (const n of this.graph.nodes.values()) {
      if (n.x === undefined || n.y === undefined) {
        const angle = i * 2.399963; // golden angle — avoids overlap
        const r = 40 + 12 * Math.sqrt(i);
        n.x = width / 2 + r * Math.cos(angle);
        n.y = height / 2 + r * Math.sin(angle);
      }
      this.sim.vx.set(n.id, 0);
      this.sim.vy.set(n.id, 0);
      i += 1;
    }
  }

  /**
   * Run the simulation to rest synchronously before the first paint, so the map
   * loads already framed and centred instead of animating out from a clump.
   * (requestAnimationFrame then only drives interaction, and is free to be
   * throttled when the tab is backgrounded.)
   */
  private warmUp(iterations = 400): void {
    for (let i = 0; i < iterations; i++) this.step();
  }

  private size(): { width: number; height: number } {
    const rect = this.host.getBoundingClientRect();
    return { width: rect.width || 800, height: rect.height || 600 };
  }

  private start(): void {
    const tick = () => {
      this.step();
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.observer?.disconnect();
    this.observer = null;
  }

  /** One iteration of a crude force-directed layout. */
  private step(): void {
    const nodes = [...this.graph.nodes.values()];
    const { width, height } = this.size();
    const REPULSE = 9000;
    const SPRING = 0.02;
    const REST = 130;
    const DAMP = 0.85;
    const GRAVITY = 0.9; // gentle pull toward centre so the map stays framed
    const cx = width / 2;
    const cy = height / 2;

    // Pairwise repulsion.
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = (a.x ?? 0) - (b.x ?? 0);
        let dy = (a.y ?? 0) - (b.y ?? 0);
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.random(); dy = Math.random(); d2 = dx * dx + dy * dy; }
        const f = REPULSE / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        this.sim.vx.set(a.id, (this.sim.vx.get(a.id) ?? 0) + fx);
        this.sim.vy.set(a.id, (this.sim.vy.get(a.id) ?? 0) + fy);
        this.sim.vx.set(b.id, (this.sim.vx.get(b.id) ?? 0) - fx);
        this.sim.vy.set(b.id, (this.sim.vy.get(b.id) ?? 0) - fy);
      }
    }

    // Edge springs.
    for (const e of this.graph.edges.values()) {
      const a = this.graph.nodes.get(e.source);
      const b = this.graph.nodes.get(e.target);
      if (!a || !b) continue;
      const dx = (b.x ?? 0) - (a.x ?? 0);
      const dy = (b.y ?? 0) - (a.y ?? 0);
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - REST) * SPRING;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      this.sim.vx.set(a.id, (this.sim.vx.get(a.id) ?? 0) + fx);
      this.sim.vy.set(a.id, (this.sim.vy.get(a.id) ?? 0) + fy);
      this.sim.vx.set(b.id, (this.sim.vx.get(b.id) ?? 0) - fx);
      this.sim.vy.set(b.id, (this.sim.vy.get(b.id) ?? 0) - fy);
    }

    // Centring gravity — pulls each node gently toward the middle.
    for (const n of nodes) {
      this.sim.vx.set(n.id, (this.sim.vx.get(n.id) ?? 0) + (cx - (n.x ?? 0)) * GRAVITY * 0.02);
      this.sim.vy.set(n.id, (this.sim.vy.get(n.id) ?? 0) + (cy - (n.y ?? 0)) * GRAVITY * 0.02);
    }

    // Integrate.
    for (const n of nodes) {
      if (n.id === this.dragging) { this.sim.vx.set(n.id, 0); this.sim.vy.set(n.id, 0); continue; }
      const vx = (this.sim.vx.get(n.id) ?? 0) * DAMP;
      const vy = (this.sim.vy.get(n.id) ?? 0) * DAMP;
      n.x = Math.max(30, Math.min(width - 30, (n.x ?? 0) + vx * 0.02));
      n.y = Math.max(30, Math.min(height - 30, (n.y ?? 0) + vy * 0.02));
      this.sim.vx.set(n.id, vx);
      this.sim.vy.set(n.id, vy);
    }
  }

  private draw(): void {
    // Edges.
    this.edgeLayer.replaceChildren();
    for (const e of this.graph.edges.values()) {
      const a = this.graph.nodes.get(e.source);
      const b = this.graph.nodes.get(e.target);
      if (!a || !b) continue;
      const line = document.createElementNS(SVG_NS, "line");
      line.setAttribute("x1", String(a.x));
      line.setAttribute("y1", String(a.y));
      line.setAttribute("x2", String(b.x));
      line.setAttribute("y2", String(b.y));
      line.setAttribute("class", "ndmm-edge");
      this.edgeLayer.append(line);

      const label = document.createElementNS(SVG_NS, "text");
      label.setAttribute("x", String(((a.x ?? 0) + (b.x ?? 0)) / 2));
      label.setAttribute("y", String(((a.y ?? 0) + (b.y ?? 0)) / 2 - 4));
      label.setAttribute("class", "ndmm-edge-label");
      label.textContent = e.relation;
      this.edgeLayer.append(label);
    }

    // Nodes.
    this.nodeLayer.replaceChildren();
    for (const n of this.graph.nodes.values()) {
      const g = document.createElementNS(SVG_NS, "g");
      g.setAttribute("class", "ndmm-node" + (n.id === this.selected ? " is-selected" : ""));
      g.setAttribute("transform", `translate(${n.x},${n.y})`);
      g.dataset.id = n.id;

      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("r", "22");
      g.append(circle);

      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("class", "ndmm-node-label");
      text.setAttribute("dy", "38");
      text.textContent = n.label;
      g.append(text);

      this.nodeLayer.append(g);
    }
  }

  private bindDrag(): void {
    let offX = 0;
    let offY = 0;

    this.svg.addEventListener("pointerdown", (e) => {
      const target = (e.target as Element).closest(".ndmm-node") as SVGGElement | null;
      if (!target?.dataset.id) return;
      const n = this.graph.nodes.get(target.dataset.id);
      if (!n) return;
      this.dragging = n.id;
      this.select(n.id);
      const pt = this.toLocal(e);
      offX = pt.x - (n.x ?? 0);
      offY = pt.y - (n.y ?? 0);
      this.svg.setPointerCapture(e.pointerId);
    });

    this.svg.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const n = this.graph.nodes.get(this.dragging);
      if (!n) return;
      const pt = this.toLocal(e);
      n.x = pt.x - offX;
      n.y = pt.y - offY;
    });

    const end = (e: PointerEvent) => {
      if (this.dragging) this.svg.releasePointerCapture(e.pointerId);
      this.dragging = null;
    };
    this.svg.addEventListener("pointerup", end);
    this.svg.addEventListener("pointercancel", end);
  }

  private toLocal(e: PointerEvent): { x: number; y: number } {
    const rect = this.svg.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private select(id: string | null): void {
    this.selected = id;
    this.opts.onSelect?.(id ? this.graph.nodes.get(id) ?? null : null);
  }

  /** Re-seed after a wholesale graph swap (e.g. import). */
  reset(graph: Graph): void {
    this.graph = graph;
    this.sim = { vx: new Map(), vy: new Map() };
    this.selected = null;
    this.seedPositions();
    this.warmUp();
  }
}
