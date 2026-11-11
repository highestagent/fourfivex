"use client";

import { useEffect, useRef } from "react";

const COLS = 29;
const ROWS = 9;
const W = 360;
const H = 132;

const hash = (c: number, r: number) => {
  const s = Math.sin(c * 127.1 + r * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * A field of dots standing for a balance. `preview` shades how much would be put to work,
 * `solid` shows how much is. Both ease toward their targets.
 */
export function DotMatrix({ solid, preview, className = "" }: { solid: number; preview: number; className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const model = useRef({ solid: 0, preview: 0, ts: solid, tp: preview, raf: 0, last: 0 });
  const frame = useRef<(t: number) => void>(() => {});

  useEffect(() => {
    const m = model.current;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = () => {
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx || !c.clientWidth) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = Math.round(c.clientWidth * dpr);
      const ch = Math.round(((c.clientWidth * H) / W) * dpr);
      if (c.width !== cw || c.height !== ch) {
        c.width = cw;
        c.height = ch;
      }
      const s = cw / W;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const dx = W / COLS;
      const dy = H / ROWS;
      for (let r = 0; r < ROWS; r++) {
        for (let col = 0; col < COLS; col++) {
          const x = dx * (col + 0.5) + (r % 2 ? dx / 2 : 0) - dx / 4;
          const y = dy * (r + 0.5);
          const ex = (x - W / 2) / (W / 2);
          const ey = (y - H / 2) / (H / 2);
          const fade = Math.max(0, Math.min(1, 1.35 - (ex * ex + ey * ey) * 1.15));
          if (fade <= 0.02) continue;
          const rank = (col / (COLS - 1)) * 0.8 + hash(col, r) * 0.2;
          let color = "218,218,222";
          let size = 1.9;
          if (rank < m.solid) {
            color = hash(r, col) > 0.72 ? "138,165,243" : "37,83,230";
            size = 2.5;
          } else if (rank < m.preview) {
            color = "172,190,246";
            size = 2.3;
          }
          ctx.fillStyle = `rgba(${color},${fade})`;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    frame.current = (t: number) => {
      const dt = m.last ? Math.min(48, t - m.last) : 16;
      m.last = t;
      const k = reduced ? 1 : 1 - Math.exp(-dt / 320);
      m.solid += (m.ts - m.solid) * k;
      m.preview += (m.tp - m.preview) * k;
      const moving = Math.abs(m.ts - m.solid) > 0.002 || Math.abs(m.tp - m.preview) > 0.002;
      if (!moving) {
        m.solid = m.ts;
        m.preview = m.tp;
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
  }, []);

  useEffect(() => {
    const m = model.current;
    m.ts = solid;
    m.tp = preview;
    if (!m.raf) m.raf = requestAnimationFrame(frame.current);
  }, [solid, preview]);

  return (
    <canvas
      ref={canvas}
      className={`block w-full ${className}`}
      style={{ aspectRatio: `${W} / ${H}` }}
      aria-hidden="true"
    />
  );
}
