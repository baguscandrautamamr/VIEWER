import type { TourStop } from './types';

// Baca/tulis tur tersimpan lewat /api/tour. Bentuk di server (baris tabel)
// dipetakan ke TourStop yang dipakai viewer.

interface StopRow {
  id?: string;
  title: string;
  description: string;
  mode: 'orbit' | 'walk' | 'plan' | 'static';
  pose: { position: [number, number, number]; target: [number, number, number] };
  highlight: { gids?: string[]; categories?: string[] } | null;
}

function rowToStop(r: StopRow, i: number): TourStop {
  return {
    id: r.id ?? `saved-${i}`,
    title: r.title,
    description: r.description ?? '',
    mode: r.mode === 'walk' ? 'walk' : r.mode === 'static' ? 'static' : 'orbit',
    plan: r.mode === 'plan',
    pose: r.pose,
    highlightGids: r.highlight?.gids?.length ? r.highlight.gids : undefined,
    highlightCategories: r.highlight?.categories?.length ? r.highlight.categories : undefined,
    custom: true,
  };
}

export function stopToRow(s: TourStop): StopRow {
  return {
    title: s.title,
    description: s.description,
    mode: s.plan ? 'plan' : s.mode,
    pose: s.pose,
    highlight: { gids: s.highlightGids, categories: s.highlightCategories },
  };
}

export async function fetchSavedTour(projectId: string, token: string): Promise<TourStop[]> {
  const res = await fetch(`/api/tour?projectId=${encodeURIComponent(projectId)}&token=${encodeURIComponent(token)}`);
  if (!res.ok) return [];
  const j = (await res.json()) as { stops?: StopRow[] };
  return (j.stops ?? []).map(rowToStop);
}

export async function saveTour(projectId: string, token: string, stops: TourStop[]): Promise<void> {
  const res = await fetch('/api/tour', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, token, stops: stops.map(stopToRow) }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `${res.status}`);
  }
}
