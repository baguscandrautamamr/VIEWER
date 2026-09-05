'use client';

import { useState } from 'react';
import type { TourStop } from '@/lib/showcase/types';
import { CloseButton, Eyebrow, Icons, Panel, tpl, type ShowcaseStrings } from './ui';

// Editor tur terpandu (panel kanan, hanya untuk admin): simpan pandangan
// kamera saat ini sebagai pemberhentian, atur urutan, hapus, lalu simpan ke
// database. Pengambilan pose kamera & sorotan dilakukan pemanggil
// (ShowcaseViewer) lewat `captureCurrent`, panel ini cuma mengelola daftarnya.
export default function TourEditor({
  strings: s,
  stops,
  dirty,
  saving,
  savedNotice,
  highlightCount,
  onCaptureCurrent,
  onUpdatePose,
  onChange,
  onGoto,
  onSeedAuto,
  onSave,
  onClose,
}: {
  strings: ShowcaseStrings;
  stops: TourStop[];
  dirty: boolean;
  saving: boolean;
  savedNotice: string | null;
  highlightCount: number;
  onCaptureCurrent: (title: string, description: string) => void;
  onUpdatePose: (index: number) => void;
  onChange: (stops: TourStop[]) => void;
  onGoto: (index: number) => void;
  onSeedAuto: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [editing, setEditing] = useState<number | null>(null);

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= stops.length) return;
    const next = stops.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  function remove(i: number) {
    onChange(stops.filter((_, k) => k !== i));
  }
  function patch(i: number, p: Partial<TourStop>) {
    onChange(stops.map((st, k) => (k === i ? { ...st, ...p } : st)));
  }
  function submitNew() {
    if (!title.trim()) return;
    onCaptureCurrent(title.trim(), desc.trim());
    setTitle('');
    setDesc('');
    setAdding(false);
  }

  return (
    <Panel className="sc-side">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Eyebrow className="flex items-center gap-1.5">
            <span className="text-[color:var(--sc-accent)]">{Icons.route}</span>
            {s.tourEditTitle}
          </Eyebrow>
          <p className="mt-1 text-[11.5px] leading-snug text-white/55">{s.tourEditHint}</p>
        </div>
        <CloseButton onClick={onClose} />
      </div>

      {!adding ? (
        <button type="button" onClick={() => setAdding(true)} className="sc-btn sc-btn-primary mt-3 w-full">
          {Icons.camera}
          {s.tourAddCurrent}
        </button>
      ) : (
        <div className="sc-tag mt-3 flex flex-col gap-1.5">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={s.tourStopTitle}
            className="sc-field"
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNew();
              if (e.key === 'Escape') setAdding(false);
            }}
          />
          <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={s.tourStopDesc} rows={2} className="sc-field" />
          {highlightCount > 0 && <span className="text-[10.5px] text-white/45">{tpl(s.tourHighlightNote, { n: highlightCount })}</span>}
          <div className="flex gap-1.5">
            <button type="button" onClick={submitNew} disabled={!title.trim()} className="sc-btn sc-btn-primary flex-1">
              {s.tourAdd}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="sc-btn">
              {s.tourCancel}
            </button>
          </div>
        </div>
      )}

      <div className="sc-scroll mt-3 flex-1">
        {stops.length === 0 && <p className="py-4 text-[12px] text-white/50">{s.tourEmpty}</p>}
        {stops.map((st, i) => (
          <div key={st.id} className="sc-stop">
            <div className="flex items-start gap-2">
              <span className="sc-mono mt-0.5 text-[color:var(--sc-accent)]">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0 flex-1">
                {editing === i ? (
                  <>
                    <input value={st.title} onChange={(e) => patch(i, { title: e.target.value })} className="sc-field" />
                    <textarea value={st.description} onChange={(e) => patch(i, { description: e.target.value })} rows={2} className="sc-field mt-1" />
                  </>
                ) : (
                  <button type="button" className="block w-full text-left" onClick={() => setEditing(i)}>
                    <span className="block truncate text-[12.5px] text-white/90">{st.title}</span>
                    <span className="block truncate text-[10.5px] text-white/45">
                      {st.plan ? 'plan' : st.mode}
                      {st.highlightGids?.length ? ` · ${st.highlightGids.length} ✦` : ''}
                      {st.highlightCategories?.length ? ` · ${st.highlightCategories.length} cat` : ''}
                      {st.description ? ` · ${st.description}` : ''}
                    </span>
                  </button>
                )}
              </div>
            </div>
            <div className="mt-1 flex flex-wrap gap-1 pl-6">
              <button type="button" className="sc-chip" onClick={() => onGoto(i)}>
                {Icons.eye} {s.tourGoto}
              </button>
              <button type="button" className="sc-chip" onClick={() => onUpdatePose(i)} title={s.tourUpdatePose}>
                {Icons.camera} {s.tourUpdatePose}
              </button>
              <button type="button" className="sc-chip" onClick={() => move(i, -1)} disabled={i === 0} aria-label={s.tourMoveUp}>
                {Icons.chevronUp}
              </button>
              <button type="button" className="sc-chip" onClick={() => move(i, 1)} disabled={i === stops.length - 1} aria-label={s.tourMoveDown}>
                {Icons.chevronDown}
              </button>
              <button type="button" className="sc-chip" onClick={() => remove(i)} aria-label={s.tourDelete}>
                {Icons.x}
              </button>
              {editing === i && (
                <button type="button" className="sc-chip is-on" onClick={() => setEditing(null)}>
                  OK
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        <div className="flex gap-1.5">
          <button type="button" onClick={onSeedAuto} className="sc-btn flex-1">
            {Icons.spark} {s.tourSeedAuto}
          </button>
          <button type="button" onClick={() => onChange([])} disabled={stops.length === 0} className="sc-btn">
            {s.tourClearAll}
          </button>
        </div>
        <button type="button" onClick={onSave} disabled={saving || !dirty} className="sc-btn sc-btn-primary w-full">
          {saving ? s.tourSaving : s.tourSave}
        </button>
        <div className="text-center text-[10.5px] text-white/45">{savedNotice ?? (dirty ? s.tourUnsaved : '')}</div>
      </div>
    </Panel>
  );
}
