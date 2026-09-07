import type { Discipline } from './disciplines';

// Satu elemen model (bisa terdiri dari beberapa mesh Three.js).
export interface ElementInfo {
  gid: string;
  name: string; // sudah dirapikan, tanpa ekor ElementId
  rawName: string | null;
  category: string; // kategori mentah (family Revit / tipe IFC)
  categoryLabel: string;
  discipline: Discipline;
  // Kotak batas (koordinat scene, model sudah di-center ke origin).
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  size: [number, number, number];
  radius: number;
  meshCount: number;
}

export interface CategorySummary {
  category: string;
  label: string;
  discipline: Discipline;
  count: number;
  samples: string[]; // contoh nama elemen (maks 4)
}

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

export type ViewMode = 'orbit' | 'walk';

export interface TourStop {
  id: string;
  title: string;
  description: string;
  mode: ViewMode;
  pose: CameraPose;
  // Elemen yang disorot selama berhenti di sini (opsional).
  highlightCategories?: string[];
  highlightGids?: string[];
  autoRotate?: boolean;
  // Tampak atas (denah): kamera lurus ke bawah, putaran dikunci.
  plan?: boolean;
  // Dibuat manual lewat editor tur (tersimpan di DB), bukan tur otomatis.
  custom?: boolean;
}

// Aksi yang boleh diminta AI ke viewer. Diparse dari teks balasan.
export type AiAction =
  | { type: 'focus'; query: string }
  | { type: 'highlight'; query: string }
  | { type: 'mode'; mode: ViewMode | 'plan' }
  | { type: 'labels'; on: boolean }
  | { type: 'tour'; stop?: number }
  | { type: 'reset' }
  | { type: 'clear' };

// Konteks ringkas yang dikirim ke AI setiap permintaan.
export interface AiContext {
  projectName: string;
  locale: 'id' | 'en';
  elementCount: number;
  modelSize: [number, number, number]; // X, Y(tinggi), Z dalam meter
  categories: CategorySummary[];
  disciplines: Record<string, number>;
  selected: (ElementInfo & { neighbors: string[] }) | null;
  mode: ViewMode;
  tourTitles: string[];
}
