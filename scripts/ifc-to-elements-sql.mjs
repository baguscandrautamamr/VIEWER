// Bikin SQL untuk isi tabel `elements` (GlobalId -> kategori + nama) dari file
// IFC, untuk di-paste manual ke Supabase SQL Editor. Alternatif dari
// push-model.mjs (yang push otomatis). Logika parsing ada di lib/ifc-elements.
//
// Pemakaian:
//   node scripts/ifc-to-elements-sql.mjs <file.ifc> <project_id> > elements.sql

import fs from 'node:fs';
import { parseIfcElements, summarize } from './lib/ifc-elements.mjs';

const [, , ifcPath, projectId] = process.argv;

if (!ifcPath || !projectId) {
  console.error('Pemakaian: node scripts/ifc-to-elements-sql.mjs <file.ifc> <project_id>');
  process.exit(1);
}

const rows = parseIfcElements(fs.readFileSync(ifcPath, 'utf8'));

if (rows.length === 0) {
  console.error('Tidak ada elemen ber-GlobalId ketemu. Pastikan file .ifc benar.');
  process.exit(1);
}

const sqlStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const CHUNK = 1000;
const lines = [`-- Auto-generated dari ${ifcPath} (${rows.length} elemen)`];
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  lines.push('insert into elements (project_id, global_id, category, name) values');
  lines.push(
    chunk
      .map(
        (r) =>
          `  (${sqlStr(projectId)}, ${sqlStr(r.guid)}, ${sqlStr(r.category)}, ${
            r.name ? sqlStr(r.name) : 'null'
          })`
      )
      .join(',\n')
  );
  lines.push('on conflict (project_id, global_id) do update set category = excluded.category, name = excluded.name;');
  lines.push('');
}

process.stdout.write(lines.join('\n') + '\n');

console.error(`OK: ${rows.length} elemen, ${summarize(rows).length} kategori.`);
summarize(rows).forEach(([c, n]) => console.error(`  ${n}\t${c}`));
