'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseIfcElements, type IfcElementRow } from '@/scripts/lib/ifc-elements.mjs';

// Impor nama & kategori elemen dari file IFC — tanpa Command Prompt.
//
// File IFC-nya TIDAK di-upload. Dibaca bertahap (streaming) di browser, lalu
// yang dikirim ke server cuma daftar {guid, category, name} — biasanya beberapa
// ratus KB walau file IFC-nya ratusan MB. Jadi tidak kena limit body Vercel
// dan prosesnya cepat karena tidak ada convert sama sekali.

export interface ImportStrings {
  title: string;
  hint: string;
  button: string;
  reading: string;
  saving: string;
  done: string;
  noElements: string;
  pickFile: string;
}

// Kirim per batch supaya request tidak kebesaran untuk model dengan puluhan
// ribu elemen (limit body serverless Vercel ~4.5MB).
const BATCH = 2000;
// Ukuran potongan teks yang diproses sekaligus saat membaca berkas.
const READ_CHUNK = 4 * 1024 * 1024;

export default function ImportElements({
  projectId,
  strings,
}: {
  projectId: string;
  strings: ImportStrings;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState('');

  async function onImport() {
    setErr('');
    setStatus(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setErr(strings.pickFile);
      return;
    }

    setBusy(true);
    setPct(0);
    try {
      setStatus(strings.reading);
      const rows = await readIfc(file, (p) => setPct(Math.round(p * 90)));

      if (rows.length === 0) {
        setErr(strings.noElements);
        return;
      }

      setStatus(strings.saving);
      for (let i = 0; i < rows.length; i += BATCH) {
        const res = await fetch('/api/elements', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId, rows: rows.slice(i, i + BATCH) }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Gagal menyimpan (${res.status})`);
        }
        setPct(90 + Math.round(((i + BATCH) / rows.length) * 10));
      }

      const cats = new Set(rows.map((r) => r.category)).size;
      setStatus(strings.done.replace('{n}', String(rows.length)).replace('{c}', String(cats)));
      setPct(100);
      if (fileRef.current) fileRef.current.value = '';
      router.refresh(); // peringatan "belum diimpor" ikut hilang
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Impor gagal');
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-foreground/10 p-4">
      <h2 className="mb-1 text-sm font-medium">{strings.title}</h2>
      <p className="mb-3 text-xs opacity-60">{strings.hint}</p>
      <input
        ref={fileRef}
        type="file"
        accept=".ifc"
        className="block w-full text-xs file:mr-3 file:rounded file:border-0 file:bg-foreground file:px-3 file:py-1.5 file:text-background"
      />
      <button
        onClick={onImport}
        disabled={busy}
        className="mt-3 rounded bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
      >
        {busy ? strings.reading : strings.button}
      </button>

      {busy && (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded bg-foreground/10">
            <div className="h-full bg-foreground transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 text-xs opacity-60">
            {status} {pct > 0 && `${pct}%`}
          </p>
        </div>
      )}
      {!busy && status && <p className="mt-2 text-xs text-green-500">{status}</p>}
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}

// Baca file IFC bertahap dan kumpulkan elemennya.
//
// Dipotong per beberapa MB supaya file besar tidak perlu masuk memori
// sekaligus. Satu entity IFC bisa terbelah di batas potongan, jadi teks yang
// belum utuh DIBAWA ke potongan berikutnya — kalau langsung diproses lalu
// dibuang, elemen di perbatasan hilang diam-diam.
//
// Pembatasnya baris baru, bukan ';': file STEP menulis satu entity per baris,
// sedangkan ';' bisa muncul di dalam teks nama (mis. "Ruang; Kantor") dan
// akan memotong entity di tengah.
async function readIfc(
  file: File,
  onProgress: (fraction: number) => void
): Promise<IfcElementRow[]> {
  const rows: IfcElementRow[] = [];
  const seen = new Set<string>();

  const collect = (text: string) => {
    for (const row of parseIfcElements(text)) {
      if (seen.has(row.guid)) continue;
      seen.add(row.guid);
      rows.push(row);
    }
  };

  const decoder = new TextDecoder('utf-8');
  let carry = '';

  for (let start = 0; start < file.size; start += READ_CHUNK) {
    const end = Math.min(start + READ_CHUNK, file.size);
    const buf = await file.slice(start, end).arrayBuffer();
    // stream: true supaya karakter multi-byte yang terpotong di batas buffer
    // tidak jadi karakter rusak.
    const text = carry + decoder.decode(buf, { stream: end < file.size });

    if (end >= file.size) {
      collect(text); // potongan terakhir: proses semuanya
      carry = '';
    } else {
      const cut = text.lastIndexOf('\n');
      if (cut >= 0) {
        collect(text.slice(0, cut + 1));
        carry = text.slice(cut + 1);
      } else {
        carry = text; // belum ada baris utuh — tunda, jangan dibuang
      }
    }

    onProgress(end / file.size);
    // Beri napas ke browser supaya progress bar ikut bergerak & tab tidak beku.
    await new Promise((r) => setTimeout(r, 0));
  }

  if (carry) collect(carry);
  return rows;
}
