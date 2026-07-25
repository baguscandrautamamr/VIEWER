// Parser IFC -> daftar elemen visual {guid, category, name}.
// Dipakai bareng oleh ifc-to-elements-sql.mjs (generate SQL) dan
// push-model.mjs (push langsung ke Supabase).
//
// IFC itu file teks (STEP). Tiap elemen ber-GlobalId ditulis seperti:
//   #38221=IFCFLOWTERMINAL('3bv_6qZw58NRxJMBI9GsRV',#18,'ACT_E_LIGHTING ...:...:657214',$,...);
//                          ^GlobalId                    ^Name (atribut ke-3)
// Kategori diambil dari NAMA FAMILY (bagian sebelum ':' di Name) — jauh lebih
// bermakna daripada tipe IFC mentah. Kalau Name kosong, fallback ke tipe IFC.

// #n = IFC<TYPE> ( '<22-char GlobalId>' , #owner , <Name: '...' atau $>
const RE = /#\d+\s*=\s*IFC([A-Z0-9]+)\s*\(\s*'([0-9A-Za-z_$]{22})'\s*,\s*#\d+\s*,\s*(\$|'((?:[^'\\]|\\.)*)')/g;

// Buang entity yang bukan objek visual (tidak ada di GLB): tipe/definisi,
// relasi, property set, port koneksi, ruang, bukaan, anotasi, grid, spasial.
const EXCLUDE_EXACT = new Set([
  'PROJECT', 'SITE', 'BUILDING', 'BUILDINGSTOREY',
  'DISTRIBUTIONPORT', 'SPACE', 'OPENINGELEMENT', 'ANNOTATION', 'GRID',
]);

function isExcluded(type) {
  return (
    type.startsWith('REL') ||
    type.startsWith('PROPERTY') ||
    type.endsWith('TYPE') ||
    type.endsWith('STYLE') ||
    EXCLUDE_EXACT.has(type)
  );
}

function categoryFromName(rawName, type) {
  if (!rawName) return 'IFC' + type;
  const family = rawName.split(':')[0].trim();
  return family || 'IFC' + type;
}

export function parseIfcElements(text) {
  const seen = new Set();
  const rows = [];
  let m;
  while ((m = RE.exec(text)) !== null) {
    const type = m[1];
    const guid = m[2];
    const rawName = m[4] ? m[4] : null;
    if (isExcluded(type) || seen.has(guid)) continue;
    seen.add(guid);
    rows.push({ guid, category: categoryFromName(rawName, type), name: rawName });
  }
  return rows;
}

// Ringkasan kategori untuk log.
export function summarize(rows) {
  const cats = new Map();
  rows.forEach((r) => cats.set(r.category, (cats.get(r.category) || 0) + 1));
  return [...cats.entries()].sort((a, b) => b[1] - a[1]);
}
