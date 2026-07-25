// Bikin SQL untuk isi tabel `elements` (GlobalId -> kategori + nama) langsung
// dari file IFC. Dipakai supaya fitur "isolate per kategori" di viewer tahu
// tiap objek kategorinya apa, tanpa perlu add-in dulu.
//
// Tanpa install apa-apa selain Node. IFC itu file teks (STEP). Tiap elemen
// ber-GlobalId ditulis seperti:
//   #38221=IFCFLOWTERMINAL('3bv_6qZw58NRxJMBI9GsRV',#18,'ACT_E_LIGHTING ...:...:657214',$,...);
//                          ^GlobalId                    ^Name (3rd attr)
// Kategori diambil dari NAMA FAMILY (bagian sebelum ':' di Name) — jauh lebih
// bermakna daripada tipe IFC mentah (mis. semua "IFCFLOWTERMINAL"). Kalau Name
// kosong, fallback ke tipe IFC.
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

// #n = IFC<TYPE> ( '<22-char GlobalId>' , #owner , <Name: '...' atau $>
const re = /#\d+\s*=\s*IFC([A-Z0-9]+)\s*\(\s*'([0-9A-Za-z_$]{22})'\s*,\s*#\d+\s*,\s*(\$|'((?:[^'\\]|\\.)*)')/g;

// Buang entity yang bukan objek visual (tidak ada di GLB): tipe/definisi,
// relasi, property set, port koneksi, ruang, bukaan, anotasi, grid, spasial.
const EXCLUDE_EXACT = new Set([
  'PROJECT', 'SITE', 'BUILDING', 'BUILDINGSTOREY',
  'DISTRIBUTIONPORT', 'SPACE', 'OPENINGELEMENT', 'ANNOTATION', 'GRID',
]);
const isExcluded = (type) =>
  type.startsWith('REL') ||
  type.startsWith('PROPERTY') ||
  type.endsWith('TYPE') ||
  type.endsWith('STYLE') ||
  EXCLUDE_EXACT.has(type);

// Kategori dari Name: ambil bagian sebelum ':' pertama (nama family Revit).
function categoryFromName(rawName, type) {
  if (!rawName) return 'IFC' + type;
  const family = rawName.split(':')[0].trim();
  return family || 'IFC' + type;
}

const sqlStr = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const seen = new Set();
const rows = [];
let m;
while ((m = re.exec(text)) !== null) {
  const type = m[1];
  const guid = m[2];
  const rawName = m[4] ? m[4] : null; // isi Name kalau ada, null kalau $
  if (isExcluded(type) || seen.has(guid)) continue;
  seen.add(guid);
  rows.push({
    guid,
    category: categoryFromName(rawName, type),
    name: rawName,
  });
}

if (rows.length === 0) {
  console.error('Tidak ada elemen ber-GlobalId ketemu. Pastikan file .ifc benar.');
  process.exit(1);
}

const CHUNK = 1000;
const lines = [];
lines.push('-- Auto-generated dari ' + ifcPath + ' (' + rows.length + ' elemen)');
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
  lines.push(
    'on conflict (project_id, global_id) do update set category = excluded.category, name = excluded.name;'
  );
  lines.push('');
}

process.stdout.write(lines.join('\n') + '\n');

const cats = new Map();
rows.forEach((r) => cats.set(r.category, (cats.get(r.category) || 0) + 1));
console.error(`OK: ${rows.length} elemen, ${cats.size} kategori (family).`);
[...cats.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([c, n]) => console.error(`  ${n}\t${c}`));
