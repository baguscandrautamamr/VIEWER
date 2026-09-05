import type { AiAction } from './types';

// Protokol aksi AI -> viewer.
//
// Model diminta menulis aksi sebagai baris `[[action:{...json...}]]` di dalam
// teks balasannya. Dipilih format teks sederhana (bukan tool use API) supaya
// jalan di semua model/proxy yang kompatibel Messages API — termasuk model
// non-Claude lewat proxy seperti vikey — dan tetap bisa di-stream.
const ACTION_RE = /\[\[action:(\{[\s\S]*?\})\]\]/g;

export function parseAiActions(text: string): { clean: string; actions: AiAction[] } {
  const actions: AiAction[] = [];
  const clean = text
    .replace(ACTION_RE, (_m, json: string) => {
      try {
        const a = JSON.parse(json);
        const parsed = normalize(a);
        if (parsed) actions.push(parsed);
      } catch {
        // JSON rusak: abaikan, jangan bikin UI error.
      }
      return '';
    })
    // Buang potongan aksi yang belum selesai di-stream supaya tidak sempat
    // tampil mentah di layar.
    .replace(/\[\[action:[^\]]*$/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { clean, actions };
}

function normalize(a: unknown): AiAction | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const type = String(o.type ?? '');
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  switch (type) {
    case 'focus':
    case 'goto':
      return str('query') ? { type: 'focus', query: str('query') } : null;
    case 'highlight':
      return str('query') ? { type: 'highlight', query: str('query') } : null;
    case 'mode': {
      const m = str('mode');
      return m === 'walk' || m === 'orbit' || m === 'plan' ? { type: 'mode', mode: m } : null;
    }
    case 'labels':
      return { type: 'labels', on: o.on !== false && o.on !== 'false' && o.on !== 'off' };
    case 'tour':
      return { type: 'tour', stop: typeof o.stop === 'number' ? o.stop : undefined };
    case 'reset':
      return { type: 'reset' };
    case 'clear':
      return { type: 'clear' };
    default:
      return null;
  }
}

// Petunjuk protokol untuk system prompt (dipakai di server).
export const ACTION_PROTOCOL = `
Kamu bisa MENGGERAKKAN viewer 3D dengan menulis aksi di baris tersendiri, format persis:
[[action:{"type":"focus","query":"<nama elemen / kategori>"}]]   -> kamera terbang ke elemen/kategori & menyorotnya
[[action:{"type":"highlight","query":"<kategori / kata kunci>"}]] -> sorot semua elemen yang cocok (warna hijau), kamera tetap
[[action:{"type":"mode","mode":"walk"|"orbit"|"plan"}]]           -> ganti mode: jalan kaki (eye level), orbit, atau denah dari atas
[[action:{"type":"labels","on":true|false}]]                       -> tampilkan/sembunyikan label nama elemen
[[action:{"type":"tour"}]]                                          -> mulai tur terpandu
[[action:{"type":"reset"}]]                                         -> kembali ke tampilan awal
[[action:{"type":"clear"}]]                                         -> hapus semua sorotan
Gunakan aksi hanya bila relevan dengan permintaan (mis. "tunjukkan", "lihat", "sorot", "pergi ke", "mode jalan"). Maksimal 2 aksi per balasan. Query harus memakai nama/kategori yang ADA di konteks.`;
