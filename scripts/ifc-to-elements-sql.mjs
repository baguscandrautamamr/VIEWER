// Bikin SQL untuk isi tabel `elements` (GlobalId -> kategori) langsung dari
// file IFC. Dipakai supaya fitur "isolate per kategori" di viewer tahu tiap
// objek kategorinya apa (misal IFCLIGHTFIXTURE), tanpa perlu add-in dulu.
//
// Tanpa install apa-apa selain Node. IFC itu file teks (STEP), tiap elemen
// ber-GlobalId ditulis seperti:  #123=IFCLIGHTFIXTURE('2vAzF5a59je...',#5,...);
// Script ini ambil tipe (kategori) + GlobalId-nya.
//
// Pemakaian:
//   node scripts/ifc-to-elements-sql.mjs <file.ifc> <project_id> > elements.sql
// lalu paste isi elements.sql ke Supabase SQL Editor -> Run.

import fs from 'node:fs';

const [, , ifcPath, projectId] = process.argv;

if (!ifcPath || !projectId) {
  console.error('Pemakaian: node scripts/ifc-to-elements-sql.mjs <file.ifc> <project_id>');
  process.exit(1);
}

const text = fs.readFileSync(ifcPath, 'utf8');

// #n = IFC<TYPE> ( '<22-char GlobalId>' ...
const re = /#\d+\s*=\s*IFC([A-Z0-9]+)\s*\(\s*'([0-9A-Za-z_$]{22})'/g;

// Tipe yang bukan objek visual — dibuang biar tabel elements bersih.
const EXCLUDE_EXACT = new Set(['PROJECT', 'SITE', 'BUILDING', 'BUILDINGSTOREY', 'PROPERTYSET']);
const isExcluded = (type) =>
  type.startsWith('REL') || type.startsWith('PROPERTY') || EXCLUDE_EXACT.has(type);

const seen = new Set();
const rows = [];
let m;
while ((m = re.exec(text)) !== null) {
  const type = m[1];
  const guid = m[2];
  if (isExcluded(type) || seen.has(guid)) continue;
  seen.add(guid);
  rows.push({ guid, category: 'IFC' + type });
}

if (rows.length === 0) {
  console.error('Tidak ada elemen ber-GlobalId ketemu. Pastikan file .ifc benar.');
  process.exit(1);
}

// GlobalId & category charset-nya aman (alnum + _ $), project_id UUID —
// jadi tidak perlu escaping quote yang ribet.
const CHUNK = 1000;
const lines = [];
lines.push('-- Auto-generated dari ' + ifcPath + ' (' + rows.length + ' elemen)');
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  lines.push('insert into elements (project_id, global_id, category) values');
  lines.push(
    chunk
      .map((r) => `  ('${projectId}', '${r.guid}', '${r.category}')`)
      .join(',\n')
  );
  lines.push('on conflict (project_id, global_id) do update set category = excluded.category;');
  lines.push('');
}

process.stdout.write(lines.join('\n') + '\n');
console.error(`OK: ${rows.length} elemen. Kategori unik: ${new Set(rows.map((r) => r.category)).size}`);
