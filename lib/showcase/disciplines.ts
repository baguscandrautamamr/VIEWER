// Pengelompokan kategori elemen ke "disiplin" yang mudah dipahami client.
//
// Kategori di tabel `elements` isinya nama family Revit (mis. "Basic Wall",
// "M_Concrete-Rectangular-Column") atau tipe IFC mentah ("IFCWALL") kalau
// nama family kosong. Keduanya dipetakan lewat kata kunci, bukan daftar
// pasti, supaya tetap jalan untuk penamaan family yang beragam.

export type Discipline = 'structure' | 'architecture' | 'mep' | 'site' | 'other';

export const DISCIPLINE_ORDER: Discipline[] = ['structure', 'architecture', 'mep', 'site', 'other'];

const RULES: Array<{ discipline: Discipline; keys: RegExp }> = [
  {
    discipline: 'mep',
    keys: /pipe|pipa|duct|ducting|cable|tray|conduit|sprinkler|hydrant|valve|katup|pump|pompa|flow|fitting|elbow|tee|hvac|ahu|fcu|diffuser|grille|sanitary|toilet|lavatory|urinal|wc|sink|shower|light|lamp|luminaire|lampu|outlet|socket|switch|panel|electrical|elektrik|mechanical|plumbing|mep|fire|tank|tangki|chiller|cooling|exhaust|fan|kipas|boiler|generator|genset|transformer|trafo|equipment|distribution|terminal|controller|segment|airterminal/i,
  },
  {
    discipline: 'structure',
    keys: /column|kolom|beam|balok|slab|plat|footing|pondasi|foundation|pile|tiang|pancang|truss|rangka|brace|bracing|purlin|gording|girder|structural|struktur|member|plate|joist|rebar|tulangan|pedestal|sloof|tie|ring|steel|baja|concrete|beton|frame/i,
  },
  {
    discipline: 'architecture',
    keys: /wall|dinding|door|pintu|window|jendela|floor|lantai|roof|atap|ceiling|plafon|plafond|stair|tangga|railing|pagar|curtain|furniture|furnish|meja|kursi|table|chair|cabinet|lemari|casework|covering|finish|tile|keramik|parapet|canopy|kanopi|facade|fasad|louver|partition|partisi|ramp|glass|kaca|mullion|panel/i,
  },
  {
    discipline: 'site',
    keys: /site|topo|lahan|road|jalan|pavement|paving|landscape|taman|tree|pohon|parking|parkir|fence|kerb|curb/i,
  },
];

export function disciplineOf(category: string | null | undefined): Discipline {
  if (!category) return 'other';
  for (const r of RULES) if (r.keys.test(category)) return r.discipline;
  return 'other';
}

// Nama tampilan kategori: buang awalan "IFC", pecah CamelCase, ganti garis
// bawah/strip jadi spasi. "IFCFLOWTERMINAL" -> "Flow Terminal",
// "M_Concrete-Rectangular-Column" -> "M Concrete Rectangular Column".
export function humanizeCategory(category: string | null | undefined, fallback = 'Lainnya'): string {
  if (!category) return fallback;
  let s = category;
  if (/^IFC[A-Z]+$/.test(s)) {
    s = s.slice(3).toLowerCase();
    // Kata umum IFC yang biasanya bersambung tanpa pemisah.
    s = s
      .replace(/(building|element|proxy|flow|terminal|segment|fitting|controller|distribution|furnishing|curtain|wall|slab|beam|column|door|window|stair|railing|roof|covering|plate|member|footing|pile|space|opening|annotation|grid|axis|site|storey|equipment|sanitary|light|fixture|cable|carrier|duct|pipe|air|energy|conversion|storage|device|transport|discrete|accessory|virtual|ramp|flight|footing)/g, ' $1')
      .trim();
    return s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\s+/g, ' ');
  }
  return s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Nama elemen dari IFC berbentuk "Family:Type:ElementId" — bagian ElementId
// tidak berguna untuk client, dibuang.
export function humanizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = name.replace(/:\s*\d{3,}\s*$/, '').trim();
  return s || null;
}
