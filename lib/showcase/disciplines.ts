// Pengelompokan kategori elemen ke "disiplin" yang mudah dipahami client.
//
// Kategori di tabel `elements` isinya nama family Revit (mis. "Basic Wall",
// "M_Concrete-Rectangular-Column") atau tipe IFC mentah ("IFCWALL") kalau
// nama family kosong. Keduanya dipetakan lewat kata kunci, bukan daftar
// pasti, supaya tetap jalan untuk penamaan family yang beragam.
//
// MEP dipecah jadi lima sistem: elektrikal & elektronik, plumbing, HVAC,
// proses, dan pemadam kebakaran. URUTAN aturan penting: aturan yang lebih
// spesifik (pemadam, HVAC, proses) diuji lebih dulu, baru plumbing yang
// menampung pipa/pompa/katup generik, lalu elektrikal. Kata "column" dan
// "tower" sengaja tidak masuk aturan proses: di model gedung itu hampir selalu
// kolom struktur / menara arsitektur.

export type Discipline =
  | 'structure'
  | 'architecture'
  | 'electrical'
  | 'plumbing'
  | 'hvac'
  | 'process'
  | 'fire'
  | 'site'
  | 'other';

export const DISCIPLINE_ORDER: Discipline[] = [
  'structure',
  'architecture',
  'electrical',
  'plumbing',
  'hvac',
  'process',
  'fire',
  'site',
  'other',
];

// Disiplin yang termasuk rumpun MEP (dipakai untuk saran AI & ringkasan).
export const MEP_DISCIPLINES: Discipline[] = ['electrical', 'plumbing', 'hvac', 'process', 'fire'];

const RULES: Array<{ discipline: Discipline; keys: RegExp }> = [
  {
    discipline: 'fire',
    keys: /sprinkler|hydrant|hidran|fire|kebakaran|apar|extinguisher|smoke|asap|heat detector|detektor|alarm|fm[- ]?200|deluge|hose ?reel|foam|siamese|standpipe|riser/i,
  },
  {
    discipline: 'hvac',
    keys: /duct|ducting|hvac|ahu|fcu|diffuser|difuser|grille|register|damper|vav|chiller|cooling ?tower|exhaust|fan\b|kipas|blower|air ?terminal|air ?handling|ventil|refrigerant|condens|evaporat|split|cassette|thermostat|heating|boiler|air ?cond|\bac\b|louvre|louver|vrf|vrv|udara/i,
  },
  {
    // Air bersih/kotor lebih dulu, supaya "water tank" tidak dianggap proses.
    discipline: 'plumbing',
    keys: /water ?tank|tangki ?air|roof ?tank|ground ?tank|\bgwt\b|\brwt\b|water ?heater|hot ?water|cold ?water|rain ?water|air ?bersih|air ?kotor|\bstp\b|\bwtp\b|greywater|blackwater/i,
  },
  {
    discipline: 'process',
    keys: /process|proses|vessel|reactor|reaktor|exchanger|penukar|distillation|destilasi|absorber|cooling ?column|compressor|kompresor|separator|silo|hopper|conveyor|konveyor|agitator|mixer|skid|pipeline|chemical|kimia|steam|uap|\bgas\b|\boil\b|minyak|fuel|bahan bakar|tank|tangki|drum|cyclone|filter press|burner|furnace|kiln|dryer|nozzle|flare|scrubber|absorber|stripper|turbine|turbin/i,
  },
  {
    discipline: 'plumbing',
    keys: /pipe|pipa|plumbing|sanitary|saniter|toilet|lavatory|urinal|closet|\bwc\b|sink|wastafel|shower|faucet|kran|keran|drain|drainase|sewer|sewage|septic|gutter|talang|water|\bair\b|pump|pompa|valve|katup|fitting|elbow|\btee\b|reducer|flange|strainer|grease ?trap|meter air|heater/i,
  },
  {
    discipline: 'electrical',
    keys: /cable|kabel|tray|conduit|light|lamp|luminaire|lampu|outlet|socket|stop ?kontak|switch|saklar|electrical|elektrik|listrik|electronic|elektronik|panel ?listrik|\bmdp\b|\bsdp\b|lvmdp|\bdb\b|distribution ?board|switchboard|switchgear|busbar|busduct|genset|generator|transformer|trafo|\bups\b|battery|baterai|solar|\bpv\b|cctv|camera|kamera|data|telepon|telephone|network|jaringan|rack|server|speaker|sound|tata suara|access ?control|junction|mcb|mccb|receptacle|grounding|earthing|lightning|petir|\bbms\b|telecom|fiber|sensor|detector|elevator|lift|escalator|equipment|flow ?terminal|distribution ?element|controller|segment/i,
  },
  {
    discipline: 'structure',
    keys: /column|kolom|beam|balok|slab|plat|footing|pondasi|foundation|pile|tiang|pancang|truss|rangka|brace|bracing|purlin|gording|girder|structural|struktur|member|plate|joist|rebar|tulangan|pedestal|sloof|tie|ring|steel|baja|concrete|beton|frame/i,
  },
  {
    discipline: 'architecture',
    keys: /wall|dinding|door|pintu|window|jendela|floor|lantai|roof|atap|ceiling|plafon|plafond|stair|tangga|railing|pagar|curtain|furniture|furnish|meja|kursi|table|chair|cabinet|lemari|casework|covering|finish|tile|keramik|parapet|canopy|kanopi|facade|fasad|partition|partisi|ramp|glass|kaca|mullion|panel/i,
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
