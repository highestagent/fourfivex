"use client";

import { useEffect, useRef } from "react";

/**
 * Money as dots. A group of dots sits packed in a hexagon at one place and can fly to another,
 * changing colour on the way. One dot is a fixed amount, so the picture is the outcome:
 * you can count what leaves and what arrives.
 */
export type DotGroup = {
  id: string;
  n: number;
  a: [number, number];
  b: [number, number];
  ca: string;
  cb: string;
  /** Which end the dots should be at. */
  at: 0 | 1;
  /** Jump to the target without animating. */
  snap?: boolean;
  dur?: number;
  delay?: number;
  arc?: number;
  /** Slot offsets, so a group can occupy the outer rings of a larger cluster. */
  offA?: number;
  offB?: number;
  /** Invisible at the start, appearing as they leave. */
  fadeIn?: boolean;
};

export type Ghost = { at: [number, number]; n: number };

const DIRS: [number, number][] = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];
const SQ = Math.sqrt(3) / 2;
const SLOTS: [number, number][] = [[0, 0]];
let rings = 0;

/** Hexagonal packing, spiralling outward from the centre. */
function ensure(n: number) {
  while (SLOTS.length < n) {
    rings++;
    let q = DIRS[4][0] * rings;
    let r = DIRS[4][1] * rings;
    for (let side = 0; side < 6; side++) {
      for (let j = 0; j < rings; j++) {
        SLOTS.push([q + r / 2, SQ * r]);
        q += DIRS[side][0];
        r += DIRS[side][1];
      }
    }
  }
}

function rgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const hash = (i: number) => {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

type Props = {
  w: number;
  h: number;
  groups: DotGroup[];
  ghosts?: Ghost[];
  gap?: number;
  r?: number;
  className?: string;
};

export function Dots({ w, h, groups, ghosts, gap = 10, r = 3.5, className = "" }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const model = useRef({
    groups,
    ghosts: ghosts ?? [],
    t: new Map<string, number>(),
    target: new Map<string, number>(),
    since: new Map<string, number>(),
    raf: 0,
    last: 0,
  });
  const frame = useRef<(ts: number) => void>(() => {});

  useEffect(() => {
    const m = model.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = () => {
      const c = canvas.current;
      if (!c) return;
      const ctx = c.getContext("2d");
      if (!ctx || !c.clientWidth) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.round(c.clientWidth * dpr);
      const H = Math.round(((c.clientWidth * h) / w) * dpr);
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      const s = W / w;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = "#dadade";
      for (const g of m.ghosts) {
        ensure(g.n);
        for (let i = 0; i < g.n; i++) {
          ctx.beginPath();
          ctx.arc(g.at[0] + SLOTS[i][0] * gap, g.at[1] + SLOTS[i][1] * gap, r * 0.78, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      for (const g of m.groups) {
        const offA = g.offA ?? 0;
        const offB = g.offB ?? 0;
        ensure(g.n + Math.max(offA, offB));
        const t = m.t.get(g.id) ?? g.at;
        const ca = rgb(g.ca);
        const cb = rgb(g.cb);
        const arc = g.arc ?? 46;
        const stagger = 0.5;
        for (let i = 0; i < g.n; i++) {
          // The outermost dots leave first and settle in the centre of the destination.
          const order = g.n > 1 ? (g.n - 1 - i) / (g.n - 1) : 0;
          const e = ease(clamp((t - order * stagger) / (1 - stagger)));
          const sa = SLOTS[i + offA];
          const sb = SLOTS[g.n - 1 - i + offB];
          const ax = g.a[0] + sa[0] * gap;
          const ay = g.a[1] + sa[1] * gap;
          const bx = g.b[0] + sb[0] * gap;
          const by = g.b[1] + sb[1] * gap;
          const mx = (ax + bx) / 2;
          const my = (ay + by) / 2 - arc * (0.7 + 0.6 * hash(i + 1));
          const u = 1 - e;
          const x = u * u * ax + 2 * u * e * mx + e * e * bx;
          const y = u * u * ay + 2 * u * e * my + e * e * by;
          const alpha = g.fadeIn ? clamp(e * 5) : 1;
          if (alpha <= 0) continue;
          ctx.fillStyle = `rgba(${Math.round(ca[0] + (cb[0] - ca[0]) * e)},${Math.round(
            ca[1] + (cb[1] - ca[1]) * e,
          )},${Math.round(ca[2] + (cb[2] - ca[2]) * e)},${alpha})`;
          ctx.beginPath();
          ctx.arc(x, y, r * (1 + 0.22 * Math.sin(Math.PI * e)), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    frame.current = (ts: number) => {
      const dt = m.last ? Math.min(48, ts - m.last) : 16;
      m.last = ts;
      let moving = false;
      for (const g of m.groups) {
        const t = m.t.get(g.id) ?? g.at;
        if (t === g.at) continue;
        moving = true;
        if (reduced) {
          m.t.set(g.id, g.at);
          continue;
        }
        if (ts - (m.since.get(g.id) ?? 0) < (g.delay ?? 0)) continue;
        const step = dt / (g.dur ?? 1600);
        m.t.set(g.id, g.at > t ? Math.min(1, t + step) : Math.max(0, t - step));
      }
      draw();
      m.raf = moving ? requestAnimationFrame(frame.current) : 0;
      if (!moving) m.last = 0;
    };

    const ro = new ResizeObserver(draw);
    if (canvas.current) ro.observe(canvas.current);
    draw();
    return () => {
      ro.disconnect();
      cancelAnimationFrame(m.raf);
      m.raf = 0;
    };
  }, [w, h, gap, r]);

  // Take the latest groups and start moving toward their targets.
  useEffect(() => {
    const m = model.current;
    m.groups = groups;
    m.ghosts = ghosts ?? [];
    const now = performance.now();
    for (const g of groups) {
      if (!m.t.has(g.id) || g.snap) m.t.set(g.id, g.at);
      if (m.target.get(g.id) !== g.at) {
        m.target.set(g.id, g.at);
        m.since.set(g.id, now);
      }
    }
    if (!m.raf) m.raf = requestAnimationFrame(frame.current);
  });

  return (
    <canvas
      ref={canvas}
      className={`block w-full ${className}`}
      style={{ aspectRatio: `${w} / ${h}` }}
      aria-hidden="true"
    />
  );
}
