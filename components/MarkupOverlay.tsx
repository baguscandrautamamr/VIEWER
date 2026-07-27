'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface MarkupStrings {
  pen: string;
  arrow: string;
  text: string;
  undo: string;
  clear: string;
  save: string;
  textPrompt: string;
  frozen: string;
}

type Tool = 'pen' | 'arrow' | 'text';

type Shape =
  | { kind: 'pen'; color: string; points: { x: number; y: number }[] }
  | { kind: 'arrow'; color: string; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'text'; color: string; x: number; y: number; text: string };

const COLORS = ['#ef4444', '#ffc107', '#3b82f6', '#22c55e', '#ffffff'];
const LINE_WIDTH = 3;
const FONT = '600 16px system-ui, sans-serif';

// Layer coret-coret di atas viewer 3D (screen space). Saat aktif, orbit 3D
// dibekukan oleh ModelViewer supaya gambar tetap pas dengan tampilan — pola
// yang sama seperti markup di PDF/Bluebeam.
export default function MarkupOverlay({
  active,
  strings,
  getViewerCanvas,
}: {
  active: boolean;
  strings: MarkupStrings;
  getViewerCanvas: () => HTMLCanvasElement | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const shapesRef = useRef<Shape[]>([]);
  const draftRef = useRef<Shape | null>(null);
  const drawingRef = useRef(false);
  // Dipakai cuma untuk memaksa render ulang tombol (undo/clear aktif-nonaktif).
  const [, setVersion] = useState(0);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  // Editing teks inline: input muncul di titik klik, ketik langsung di 3D
  // (tanpa pop-up prompt). `x`/`y` = posisi baseline teks di kanvas.
  const [editing, setEditing] = useState<{ x: number; y: number } | null>(null);
  const [editValue, setEditValue] = useState('');

  const bump = () => setVersion((v) => v + 1);

  const drawShape = useCallback((ctx: CanvasRenderingContext2D, s: Shape) => {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (s.kind === 'pen') {
      if (s.points.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x, s.points[0].y);
      s.points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.stroke();
      return;
    }

    if (s.kind === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      // Kepala panah
      const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
      const head = 14;
      ctx.beginPath();
      ctx.moveTo(s.x2, s.y2);
      ctx.lineTo(s.x2 - head * Math.cos(angle - Math.PI / 6), s.y2 - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(s.x2 - head * Math.cos(angle + Math.PI / 6), s.y2 - head * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
      return;
    }

    ctx.font = FONT;
    ctx.fillText(s.text, s.x, s.y);
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    shapesRef.current.forEach((s) => drawShape(ctx, s));
    if (draftRef.current) drawShape(ctx, draftRef.current);
  }, [drawShape]);

  // Samakan ukuran canvas dengan container (dan ikut saat sidebar buka/tutup).
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = parent!.clientWidth * dpr;
      canvas!.height = parent!.clientHeight * dpr;
      canvas!.style.width = parent!.clientWidth + 'px';
      canvas!.style.height = parent!.clientHeight + 'px';
      redraw();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [redraw]);

  function posOf(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  // Commit teks yang sedang diketik jadi shape permanen di kanvas.
  function commitText() {
    if (editing && editValue.trim()) {
      shapesRef.current.push({ kind: 'text', color, x: editing.x, y: editing.y, text: editValue });
      redraw();
      bump();
    }
    setEditing(null);
    setEditValue('');
  }

  // Fokuskan input SETELAH event pointer selesai. Tanpa delay, mousedown pada
  // canvas mencuri fokus tepat setelah input muncul -> tak bisa mengetik.
  useEffect(() => {
    if (!editing) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [editing]);

  // Kalau markup dimatikan atau ganti tool, simpan teks yang sedang diketik.
  useEffect(() => {
    if ((!active || tool !== 'text') && editing) commitText();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tool]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const { x, y } = posOf(e);

    if (tool === 'text') {
      // Klik di titik lain saat sedang mengetik = simpan teks lama dulu, lalu
      // buka editor baru di titik yang diklik.
      if (editing && editValue.trim()) {
        shapesRef.current.push({ kind: 'text', color, x: editing.x, y: editing.y, text: editValue });
        redraw();
        bump();
      }
      setEditing({ x, y });
      setEditValue('');
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    draftRef.current =
      tool === 'pen'
        ? { kind: 'pen', color, points: [{ x, y }] }
        : { kind: 'arrow', color, x1: x, y1: y, x2: x, y2: y };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || !draftRef.current) return;
    const { x, y } = posOf(e);
    const d = draftRef.current;
    if (d.kind === 'pen') d.points.push({ x, y });
    else if (d.kind === 'arrow') {
      d.x2 = x;
      d.y2 = y;
    }
    redraw();
  }

  function onPointerUp() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const d = draftRef.current;
    draftRef.current = null;
    // Buang coretan sangat pendek (kemungkinan cuma klik tak sengaja).
    const keep =
      d &&
      (d.kind === 'pen'
        ? d.points.length > 2
        : d.kind === 'arrow'
          ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > 8
          : true);
    if (d && keep) shapesRef.current.push(d);
    redraw();
    bump();
  }

  function undo() {
    shapesRef.current.pop();
    redraw();
    bump();
  }

  function clearAll() {
    shapesRef.current = [];
    redraw();
    bump();
  }

  // Gabungkan render 3D + coretan jadi satu PNG lalu unduh.
  function savePng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const ctx = out.getContext('2d');
    if (!ctx) return;

    const viewer = getViewerCanvas();
    if (viewer) ctx.drawImage(viewer, 0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);

    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `markup-${Date.now()}.png`;
    a.click();
  }

  const hasShapes = shapesRef.current.length > 0;
  const btn = 'rounded px-2 py-1 text-xs transition-colors';

  return (
    <>
      <canvas
        ref={canvasRef}
        onPointerDown={active ? onPointerDown : undefined}
        onPointerMove={active ? onPointerMove : undefined}
        onPointerUp={active ? onPointerUp : undefined}
        onPointerCancel={active ? onPointerUp : undefined}
        className={`absolute inset-0 z-20 ${
          active ? 'cursor-crosshair' : 'pointer-events-none'
        }`}
      />

      {/* Input teks inline: ketik langsung di titik klik pada 3D (tanpa prompt).
          Enter = simpan, Esc = batal, klik di luar = simpan otomatis. */}
      {active && editing && (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              commitText();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setEditing(null);
              setEditValue('');
            }
          }}
          placeholder={strings.textPrompt}
          style={{
            position: 'absolute',
            left: editing.x,
            top: editing.y - 16,
            font: FONT,
            color,
            caretColor: color,
          }}
          className="z-30 min-w-[8rem] rounded border border-dashed border-current bg-white/70 px-1 outline-none placeholder:text-black/40 dark:bg-black/40 dark:placeholder:text-white/40"
        />
      )}

      {active && (
        <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 flex-wrap items-center gap-2 rounded border border-white/20 bg-black/70 px-3 py-2 backdrop-blur">
          <div className="flex overflow-hidden rounded border border-white/20">
            {(
              [
                ['pen', strings.pen],
                ['arrow', strings.arrow],
                ['text', strings.text],
              ] as [Tool, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTool(id)}
                className={`${btn} ${tool === id ? 'bg-accent text-black' : 'text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                aria-label={c}
                style={{ background: c }}
                className={`h-5 w-5 rounded-full border-2 ${
                  color === c ? 'border-white' : 'border-transparent'
                }`}
              />
            ))}
          </div>

          <button
            onClick={undo}
            disabled={!hasShapes}
            className={`${btn} border border-white/20 text-white disabled:opacity-40`}
          >
            {strings.undo}
          </button>
          <button
            onClick={clearAll}
            disabled={!hasShapes}
            className={`${btn} border border-white/20 text-white disabled:opacity-40`}
          >
            {strings.clear}
          </button>
          <button
            onClick={savePng}
            className={`${btn} border border-white/20 bg-white/10 text-white`}
          >
            {strings.save}
          </button>
        </div>
      )}
    </>
  );
}
