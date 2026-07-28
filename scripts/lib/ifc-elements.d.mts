// Tipe untuk ifc-elements.mjs supaya parser yang sama bisa dipakai dari
// komponen React (impor elemen lewat browser) TANPA menduplikasi logikanya.
// Sumber kebenaran tetap file .mjs — kalau logikanya berubah, ubah di sana.

export interface IfcElementRow {
  guid: string;
  category: string;
  name: string | null;
}

export function parseIfcElements(text: string): IfcElementRow[];
export function summarize(rows: IfcElementRow[]): [string, number][];
