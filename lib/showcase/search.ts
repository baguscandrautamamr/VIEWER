import type { ElementInfo } from './types';

// Pencarian elemen/kategori yang toleran: dipakai Navigator (ketikan user)
// dan untuk menerjemahkan `query` dari aksi AI ke elemen nyata.

function norm(s: string) {
  return s.toLowerCase().replace(/[_\-:./]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function score(hay: string, q: string): number {
  if (!q) return 0;
  const h = norm(hay);
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  if (h.includes(q)) return 60;
  // Semua kata query muncul (urutan bebas).
  const words = q.split(' ').filter(Boolean);
  if (words.length > 1 && words.every((w) => h.includes(w))) return 50;
  // Sebagian kata cocok.
  const hit = words.filter((w) => w.length > 2 && h.includes(w)).length;
  return hit > 0 ? 20 + (hit / words.length) * 20 : 0;
}

export interface SearchHit {
  element: ElementInfo;
  score: number;
}

export function searchElements(elements: ElementInfo[], query: string, limit = 200): SearchHit[] {
  const q = norm(query);
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const e of elements) {
    const s = Math.max(score(e.name, q), score(e.categoryLabel, q) - 5, score(e.category, q) - 10);
    if (s > 0) hits.push({ element: e, score: s });
  }
  hits.sort((a, b) => b.score - a.score || b.element.radius - a.element.radius);
  return hits.slice(0, limit);
}

// Untuk aksi AI: putuskan apakah query itu KATEGORI (banyak elemen sejenis)
// atau satu ELEMEN. Kembalikan daftar gid yang harus disorot + elemen utama.
export function resolveQuery(
  elements: ElementInfo[],
  query: string
): { gids: string[]; primary: ElementInfo | null; isCategory: boolean } {
  const q = norm(query);
  if (!q) return { gids: [], primary: null, isCategory: false };
  // 1) cocokkan ke kategori dulu.
  const catScores = new Map<string, number>();
  for (const e of elements) {
    if (catScores.has(e.category)) continue;
    catScores.set(e.category, Math.max(score(e.categoryLabel, q), score(e.category, q)));
  }
  let bestCat: string | null = null;
  let bestCatScore = 0;
  catScores.forEach((s, c) => {
    if (s > bestCatScore) {
      bestCatScore = s;
      bestCat = c;
    }
  });
  const hits = searchElements(elements, query, 400);
  const bestEl = hits[0] ?? null;
  if (bestCat && bestCatScore >= 50 && bestCatScore >= (bestEl?.score ?? 0) - 10) {
    const gids = elements.filter((e) => e.category === bestCat).map((e) => e.gid);
    const primary = elements.find((e) => e.category === bestCat) ?? null;
    return { gids, primary, isCategory: true };
  }
  if (!bestEl) return { gids: [], primary: null, isCategory: false };
  // Elemen bernama sama (family/type sama) disorot bersama supaya "tunjukkan
  // pompa" menyorot semua pompa, bukan cuma satu.
  const sameName = hits.filter((h) => h.score >= bestEl.score - 5 && h.element.name === bestEl.element.name);
  return {
    gids: (sameName.length > 1 ? sameName : [bestEl]).map((h) => h.element.gid),
    primary: bestEl.element,
    isCategory: false,
  };
}
