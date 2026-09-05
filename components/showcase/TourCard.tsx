'use client';

import type { TourStop } from '@/lib/showcase/types';
import { CloseButton, Eyebrow, Icons, Panel, type ShowcaseStrings } from './ui';

// Kartu tur terpandu (bawah-tengah, seperti "Guided plant tour" di video):
// nomor + judul + narasi, tombol sebelumnya/berikutnya, indikator progres.
export default function TourCard({
  stops,
  index,
  moving,
  strings: s,
  aiState,
  aiEnabled,
  onPrev,
  onNext,
  onExit,
  onAiNarrate,
}: {
  stops: TourStop[];
  index: number;
  moving: boolean;
  strings: ShowcaseStrings;
  aiState: 'idle' | 'busy' | 'done' | 'error';
  aiEnabled: boolean;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
  onAiNarrate: () => void;
}) {
  const stop = stops[index];
  if (!stop) return null;
  const last = index >= stops.length - 1;
  return (
    <Panel className="sc-tour">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow className="flex items-center gap-1.5">
          <span className="text-[color:var(--sc-accent)]">{Icons.route}</span>
          {s.tourTitle}
        </Eyebrow>
        <div className="flex items-center gap-2">
          {aiEnabled && (
            <button
              type="button"
              onClick={onAiNarrate}
              disabled={aiState === 'busy' || aiState === 'done'}
              className="sc-chip"
              title={s.tourAi}
            >
              <span className="text-[color:var(--sc-accent)]">{Icons.spark}</span>
              {aiState === 'busy' ? s.tourAiBusy : aiState === 'done' ? s.tourAiDone : s.tourAi}
            </button>
          )}
          <CloseButton onClick={onExit} label={s.tourExit} />
        </div>
      </div>
      <div className="sc-tour-progress" aria-hidden>
        {stops.map((st, i) => (
          <span key={st.id} className={i <= index ? 'is-done' : ''} />
        ))}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="sc-mono text-[color:var(--sc-accent)]">{String(index + 1).padStart(2, '0')}</span>
        <h3 className="text-[15px] font-semibold leading-tight text-white">{stop.title}</h3>
      </div>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/75">{stop.description}</p>
      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={onPrev} disabled={index === 0} className="sc-link">
          {Icons.arrowLeft}
          {s.tourPrev}
        </button>
        <span className="sc-mono text-white/40">
          {moving ? s.tourMoving : `${index + 1} / ${stops.length}`}
        </span>
        <button type="button" onClick={last ? onExit : onNext} className="sc-link is-accent">
          {last ? s.tourExit : s.tourNext}
          {last ? Icons.x : Icons.arrowRight}
        </button>
      </div>
    </Panel>
  );
}
