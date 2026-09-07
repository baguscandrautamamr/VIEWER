import { ACTION_PROTOCOL } from './aiActions';
import type { AiContext } from './types';

// Penyusun prompt untuk /api/ai. Dipisah dari route supaya mudah diuji &
// dibaca. Konteks model dikirim RINGKAS (kategori + jumlah + contoh nama):
// model besar bisa punya puluhan ribu elemen, tidak mungkin dikirim semua.

export type AiMode = 'chat' | 'explain' | 'tour';

function fmt(n: number) {
  return Number.isFinite(n) ? n.toFixed(2).replace(/\.?0+$/, '') : '?';
}

export function contextToText(ctx: AiContext): string {
  const lines: string[] = [];
  lines.push(`Project: ${ctx.projectName}`);
  lines.push(
    `Ukuran model (m): panjang X ${fmt(ctx.modelSize[0])} × lebar ${fmt(ctx.modelSize[2])} × tinggi ${fmt(ctx.modelSize[1])}`
  );
  lines.push(`Total elemen: ${ctx.elementCount}`);
  const disc = Object.entries(ctx.disciplines)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}=${n}`)
    .join(', ');
  if (disc) lines.push(`Per disiplin: ${disc}`);
  lines.push(`Mode kamera sekarang: ${ctx.mode}`);
  if (ctx.tourTitles.length) lines.push(`Pemberhentian tur: ${ctx.tourTitles.map((t, i) => `${i + 1}. ${t}`).join(' | ')}`);
  lines.push('');
  lines.push('Kategori (kategori mentah | label | disiplin | jumlah | contoh nama):');
  for (const c of ctx.categories) {
    lines.push(`- ${c.category} | ${c.label} | ${c.discipline} | ${c.count} | ${c.samples.join('; ')}`);
  }
  if (ctx.selected) {
    const s = ctx.selected;
    lines.push('');
    lines.push('ELEMEN YANG SEDANG DIPILIH USER:');
    lines.push(`- Nama: ${s.name}`);
    lines.push(`- Kategori: ${s.categoryLabel} (${s.category}), disiplin ${s.discipline}`);
    lines.push(`- GlobalId: ${s.gid}`);
    lines.push(
      `- Dimensi (m): ${fmt(s.size[0])} × ${fmt(s.size[2])} × tinggi ${fmt(s.size[1])}; elevasi dasar +${fmt(s.min[1])} m dari dasar model`
    );
    if (s.neighbors.length) lines.push(`- Elemen di sekitarnya: ${s.neighbors.join('; ')}`);
  }
  return lines.join('\n');
}

export function systemPrompt(mode: AiMode, ctx: AiContext): string {
  const lang = ctx.locale === 'en' ? 'English' : 'Bahasa Indonesia';
  const base = `Kamu adalah asisten presentasi untuk model bangunan 3D (BIM dari Revit) yang sedang ditampilkan ke client di web viewer. Jawab dalam ${lang}, ramah, ringkas, dan mudah dipahami orang non-teknis. Pakai HANYA data pada konteks di bawah; jangan mengarang angka, nama ruangan, atau spesifikasi yang tidak ada di konteks — kalau tidak tahu, katakan tidak ada datanya. Angka jumlah elemen selalu ambil dari konteks. Gunakan poin-poin pendek bila perlu; hindari tabel panjang.`;

  if (mode === 'explain') {
    return `${base}

Tugas: jelaskan elemen yang sedang dipilih untuk client. Sertakan: (1) apa fungsinya di bangunan ini, (2) apa yang bisa dibaca dari dimensi/posisinya, (3) hal yang perlu diperhatikan client (mis. hubungannya dengan elemen sekitar). Tiga sampai lima kalimat, tanpa judul, tanpa aksi.

KONTEKS MODEL:
${contextToText(ctx)}`;
  }

  if (mode === 'tour') {
    return `${base}

Tugas: tulis narasi tur terpandu. Kamu diberi daftar pemberhentian (urutan & isinya sudah ditentukan viewer, JANGAN diubah urutan/jumlahnya). Untuk tiap pemberhentian tulis judul singkat (maks 5 kata) dan narasi 1–3 kalimat yang menarik untuk client, berdasarkan konteks model. Balas HANYA JSON valid berbentuk {"stops":[{"id":"...","title":"...","description":"..."}]} tanpa teks lain, tanpa markdown.

KONTEKS MODEL:
${contextToText(ctx)}`;
  }

  return `${base}
${ACTION_PROTOCOL}

KONTEKS MODEL:
${contextToText(ctx)}`;
}
