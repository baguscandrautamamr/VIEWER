import { DISCIPLINE_ORDER, type Discipline } from './disciplines';
import type { CameraPose, ElementInfo, TourStop } from './types';

// Pembuat tur terpandu OTOMATIS dari isi model (tanpa AI). Hasilnya dipakai
// langsung, dan bisa "diperkaya" AI (judul + narasi) lewat /api/ai mode tour —
// posisi kamera selalu dihitung di sini, AI tidak pernah mengarang koordinat.

export interface TourStrings {
  overviewTitle: string;
  overviewDesc: string;
  planTitle: string;
  planDesc: string;
  walkTitle: string;
  walkDesc: string;
  disciplineTitle: Record<Discipline, string>;
  disciplineDesc: (label: string, count: number, cats: string[]) => string;
}

export interface ModelBounds {
  min: [number, number, number];
  max: [number, number, number];
}

const EYE = 1.7;

export function boundsCenter(b: ModelBounds): [number, number, number] {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

function maxDim(b: ModelBounds) {
  return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 1;
}

// Pose isometrik yang membingkai kotak `b` dengan FOV vertikal ~50°.
export function isoPose(b: ModelBounds, dirHint: [number, number, number] = [1, 0.75, 1]): CameraPose {
  const c = boundsCenter(b);
  // Bola pembatas kotak selalu lebih besar dari isinya; dari sudut isometrik
  // model biasanya memenuhi ~75% diameter bola, jadi jaraknya dikoreksi supaya
  // model tidak tampil kecil di tengah layar.
  const r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2 || 1;
  const dist = (r * 0.78) / Math.sin((50 * Math.PI) / 360);
  const len = Math.hypot(...dirHint) || 1;
  const d = dirHint.map((v) => v / len) as [number, number, number];
  return { position: [c[0] + d[0] * dist, c[1] + d[1] * dist, c[2] + d[2] * dist], target: c };
}

export function planPose(b: ModelBounds): CameraPose {
  const c = boundsCenter(b);
  const w = b.max[0] - b.min[0];
  const d = b.max[2] - b.min[2];
  const dist = (Math.max(w, d) / 2 / Math.tan((50 * Math.PI) / 360)) * 1.15 + (b.max[1] - b.min[1]);
  // Target sedikit digeser supaya "atas" tetap terdefinisi (OrbitControls).
  return { position: [c[0], b.max[1] + dist, c[2] + 0.001], target: [c[0], b.min[1], c[2]] };
}

// Pose jalan kaki: berdiri di tepi model (sisi +Z), menghadap ke pusat.
export function entrancePose(b: ModelBounds): CameraPose {
  const c = boundsCenter(b);
  const depth = b.max[2] - b.min[2];
  const z = b.max[2] + Math.min(Math.max(depth * 0.15, 3), 25);
  const y = b.min[1] + EYE;
  return { position: [c[0], y, z], target: [c[0], y, c[2]] };
}

function unionBounds(items: ElementInfo[]): ModelBounds | null {
  if (items.length === 0) return null;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const e of items) {
    for (let i = 0; i < 3; i++) {
      if (e.min[i] < min[i]) min[i] = e.min[i];
      if (e.max[i] > max[i]) max[i] = e.max[i];
    }
  }
  return { min, max };
}

export function buildAutoTour(
  elements: ElementInfo[],
  bounds: ModelBounds,
  s: TourStrings
): TourStop[] {
  const stops: TourStop[] = [];
  stops.push({
    id: 'overview',
    title: s.overviewTitle,
    description: s.overviewDesc,
    mode: 'orbit',
    pose: isoPose(bounds),
    autoRotate: true,
  });

  // Satu pemberhentian per disiplin yang cukup besar (>= 2% elemen atau >= 20).
  const byDisc = new Map<Discipline, ElementInfo[]>();
  for (const e of elements) {
    if (!byDisc.has(e.discipline)) byDisc.set(e.discipline, []);
    byDisc.get(e.discipline)!.push(e);
  }
  const dirs: [number, number, number][] = [
    [1, 0.6, 1],
    [-1, 0.6, 1],
    [1, 0.5, -1],
    [-1, 0.7, -1],
  ];
  let di = 0;
  for (const disc of DISCIPLINE_ORDER) {
    const items = byDisc.get(disc);
    if (!items) continue;
    if (disc === 'other' && byDisc.size > 1) continue;
    if (items.length < 20 && items.length < elements.length * 0.02) continue;
    const b = unionBounds(items);
    if (!b) continue;
    const cats = new Map<string, number>();
    items.forEach((e) => cats.set(e.categoryLabel, (cats.get(e.categoryLabel) ?? 0) + 1));
    const topCats = Array.from(cats.entries())
      .sort((a, c) => c[1] - a[1])
      .slice(0, 4)
      .map(([k]) => k);
    stops.push({
      id: `disc-${disc}`,
      title: s.disciplineTitle[disc],
      description: s.disciplineDesc(s.disciplineTitle[disc], items.length, topCats),
      mode: 'orbit',
      pose: isoPose(b, dirs[di++ % dirs.length]),
      highlightCategories: Array.from(new Set(items.map((e) => e.category))),
    });
  }

  stops.push({
    id: 'walk',
    title: s.walkTitle,
    description: s.walkDesc,
    mode: 'walk',
    pose: entrancePose(bounds),
  });
  stops.push({
    id: 'plan',
    title: s.planTitle,
    description: s.planDesc,
    mode: 'orbit',
    pose: planPose(bounds),
  });
  return stops;
}

export { EYE as EYE_LEVEL, maxDim as boundsMaxDim };
