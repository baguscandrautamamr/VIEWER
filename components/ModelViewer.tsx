'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { subscribeToProjectUpdates, unsubscribe } from '@/lib/realtime';
import { getSupabase } from '@/lib/supabase';
import { locales, type Locale } from '@/lib/i18n';
import { resolveModelIdentity } from '@/lib/modelIdentity.mjs';
import MarkupOverlay from './MarkupOverlay';
import SelectionTree, { type TreeCategory } from './SelectionTree';

interface ModelViewerProps {
  projectId: string;
  initialGlbUrl: string;
  locale?: Locale;
  // Preset kamera dari klik sheet: top/bottom/front/back/left/right/iso.
  cameraPreset?: string | null;
  onElementSelect?: (globalId: string | null) => void;
}

type IsolateMode = 'object' | 'category';
// Tool navigasi aktif (satu waktu satu tool), mirip Navisworks.
type Tool = 'orbit' | 'pan' | 'measure' | 'walk';

const DIMMED_OPACITY = 0.12;
const HIGHLIGHT_DURATION_MS = 3000;
const NOTICE_DURATION_MS = 5000;
const DEFAULT_CATEGORY = 'Default';
// Palet warna untuk menandai objek terpilih (merah…putih, urut seperti emoji
// di dock). Sifatnya sementara — hanya di layar ini, tidak masuk database.
const PAINT_COLORS = [0xef4444, 0xf97316, 0xeab308, 0x22c55e, 0x3b82f6, 0xa855f7, 0xffffff];
// Lama animasi kamera mendekat ke objek (detik). Sengaja bukan lompatan:
// kalau kamera melompat tiap klik, mata cepat lelah & kehilangan orientasi.
const FLY_DURATION = 0.6;
// Ambang "sudah kelihatan": bagian tinggi layar yang ditutupi elemen terpilih.
// Di atas ini kamera DIAM saat objek diklik — mendekat hanya kalau elemennya
// tampil kecil atau berada di luar layar. Gaya Navisworks: klik ≠ pindah kamera.
const MIN_SCREEN_COVERAGE = 0.25;
// Warna kotak penanda elemen terpilih.
const SELECTION_BOX_COLOR = 0x22d3ee;
// Di bawah opacity ini sebuah objek dianggap "tembus pandang": masih bisa
// dipilih, tapi tidak boleh merebut klik dari objek padat di belakangnya.
const SHEER_OPACITY = 0.35;
// Kategori yang bukan benda fisik (garis grid, volume ruang, bukaan, anotasi).
// Geometrinya ikut terekspor ke GLB dan menghalangi klik, padahal di layar
// nyaris tak terlihat — jadi diperlakukan sama seperti objek tembus pandang:
// boleh dipilih, tapi paling belakang. Nama kategorinya diisi parser IFC
// (`scripts/lib/ifc-elements.mjs`, konstanta NON_PHYSICAL).
const NON_PHYSICAL_CATEGORIES = new Set([
  'IFCSPACE',
  'IFCOPENINGELEMENT',
  'IFCANNOTATION',
  'IFCGRID',
  'IFCGRIDAXIS',
]);
// Sensitivitas menoleh (radian per piksel geseran mouse).
const LOOK_SENSITIVITY = 0.005; // Shift + klik kiri
const LOOK_SENSITIVITY_SLOW = 0.002; // roda tengah di mode Diam — sengaja pelan

// Intensitas dasar tiap lampu pada kecerahan 1×. Slider mengalikan nilai ini.
const BASE_LIGHT = { ambient: 1.0, hemi: 0.9, key: 1.1, fill: 0.45 };
// Warna latar viewer per pilihan. `null` = ikut tema halaman (transparan).
const BG_COLORS: Record<string, number | null> = {
  theme: null,
  light: 0xf5f6f7,
  white: 0xffffff,
  dark: 0x1e2126,
};
type BgMode = keyof typeof BG_COLORS;
const DISPLAY_PREFS_KEY = 'rwv_display';

export default function ModelViewer({
  projectId,
  initialGlbUrl,
  locale = 'id',
  cameraPreset = null,
  onElementSelect,
}: ModelViewerProps) {
  // Pembungkus terluar viewer — yang dijadikan layar penuh (ikut membawa
  // semua overlay: dock, panel, hint).
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const walkControlsRef = useRef<PointerLockControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  // 6 bidang potong (section box). Urutan: X+, X−, Y+, Y−, Z+, Z−.
  const clipPlanesRef = useRef<THREE.Plane[]>([
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
    new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), 0),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  ]);
  const modelRootRef = useRef<THREE.Object3D | null>(null);
  const modelSizeRef = useRef<THREE.Vector3>(new THREE.Vector3(1, 1, 1));
  const meshesByGlobalId = useRef<Map<string, THREE.Mesh>>(new Map());
  const originalMaterials = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());
  const categoryByGlobalId = useRef<Map<string, string>>(new Map());
  // GlobalId -> nama elemen yang bisa dibaca manusia (dari tabel `elements`).
  const nameByGlobalId = useRef<Map<string, string>>(new Map());
  const embeddedByGlobalId = useRef<Map<string, { name: string | null; category: string | null }>>(new Map());
  // Indeks cadangan: ElementId Revit (ekor angka pada Name IFC) -> kategori &
  // nama. Dipakai untuk objek GLB yang dinamai angka, bukan GlobalId.
  const elementByElementId = useRef<Map<string, { category: string | null; name: string | null }>>(
    new Map()
  );
  const modeRef = useRef<IsolateMode>('object');
  const isolateOnRef = useRef(false);
  const dimMaterialRef = useRef<THREE.Material | null>(null);
  // Mesh yang terakhir diklik.
  const selectedMeshRef = useRef<THREE.Mesh | null>(null);
  // Kotak penanda elemen terpilih (gaya Navisworks). Ditaruh di scene, BUKAN di
  // dalam model, supaya tidak ikut kena raycast maupun forEachMesh.
  const selectionBoxRef = useRef<THREE.Box3Helper | null>(null);
  // Titik klik terakhir + urutan objek yang sedang dipilih di titik itu, supaya
  // Shift + klik berulang bisa menembus objek yang bertumpuk.
  const pickRef = useRef<{ x: number; y: number; index: number } | null>(null);
  // Warna manual per GlobalId. Materialnya dipegang di sini (bukan di mesh)
  // supaya warnanya BERTAHAN saat isolate: `restoreMesh` mengembalikan material
  // warna ini, bukan material asli, selama entri-nya masih ada.
  const colorMatByGid = useRef<Map<string, THREE.MeshStandardMaterial>>(new Map());

  // --- Animasi kamera (auto-fokus saat objek dipilih) ---
  // Tween kamera yang sedang berjalan; dijalankan di animate loop, dibatalkan
  // begitu user menyentuh mouse/keyboard supaya tidak berebut kendali.
  const flyRef = useRef<{
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    t: number;
  } | null>(null);

  // --- Tool aktif ---
  const toolRef = useRef<Tool>('orbit');

  // --- Measure (ukur jarak) ---
  const measurePtsRef = useRef<THREE.Vector3[]>([]);
  const measureGroupRef = useRef<THREE.Group | null>(null);
  const measureLabelElRef = useRef<HTMLDivElement | null>(null);

  // --- Walkthrough ---
  const walkingRef = useRef(false);
  const walkKeysRef = useRef({ f: false, b: false, l: false, r: false, up: false, down: false });
  const walkSpeedRef = useRef(5);
  // Pengali kecepatan gerak (diatur slider). Dipakai handler animate (ref) +
  // state untuk UI.
  const speedMultRef = useRef(1);
  const clockRef = useRef<THREE.Clock>(new THREE.Clock());
  // Navigasi keyboard di mode 3D biasa (orbit): W/S maju-mundur, A/D kiri-kanan,
  // Q naik, E turun — kamera & target OrbitControls digeser bersama (fly-through).
  const orbitKeysRef = useRef({ f: false, b: false, l: false, r: false, up: false, down: false });

  // --- Mode Diam & kontrol pandangan (Shift) ---
  // Mode Diam: model tidak bisa diputar tak sengaja oleh klik kiri, dan inersia
  // dimatikan supaya berhenti seketika. Zoom, geser, keyboard tetap jalan;
  // memutar tetap bisa lewat Shift + roda tengah.
  const lockOnRef = useRef(false);
  // Status tombol Shift. Dilacak lewat keydown/keyup, BUKAN dibaca saat klik:
  // OrbitControls memasang handler pointerdown-nya lebih dulu, jadi pemetaan
  // tombol mouse harus sudah benar sebelum tombol ditekan.
  const shiftDownRef = useRef(false);
  // Drag "menoleh". freeLook = roda tengah di mode Diam (kiri/kanan + atas/
  // bawah, pelan); selain itu Shift + klik kiri (kiri/kanan saja).
  const lookDragRef = useRef<{ x: number; y: number; freeLook: boolean } | null>(null);

  // --- Tampilan (kecerahan & latar) ---
  const lightsRef = useRef<{
    ambient: THREE.AmbientLight;
    hemi: THREE.HemisphereLight;
    key: THREE.DirectionalLight;
    fill: THREE.DirectionalLight;
  } | null>(null);
  const brightnessRef = useRef(1);
  const bgModeRef = useRef<BgMode>('theme');

  const [mode, setMode] = useState<IsolateMode>('object');
  // Isolate mulai MATI: klik objek cuma memberi kotak penanda, model lain tetap
  // utuh supaya konteks sekelilingnya kelihatan (gaya Navisworks). Nyalakan
  // tombol Isolate kalau memang ingin sisanya diredupkan.
  const [isolateOn, setIsolateOn] = useState(false);
  const [selected, setSelected] = useState<{
    globalId: string;
    category: string | null;
    name: string | null;
    color: number | null;
    // Urutan objek yang dipilih di titik klik ini (1 dari n) — dipakai untuk
    // memberi tahu bahwa masih ada objek lain di baliknya (Shift + klik).
    pickIndex?: number;
    pickCount?: number;
  } | null>(null);
  const [liveUpdateMessage, setLiveUpdateMessage] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [unmappedMeshes, setUnmappedMeshes] = useState(0);
  const [markupOn, setMarkupOn] = useState(false);
  const [sectionOn, setSectionOn] = useState(false);
  const [clip, setClip] = useState({ xMin: 1, xMax: 1, yMin: 1, yMax: 1, zMin: 1, zMax: 1 });

  const [tool, setToolState] = useState<Tool>('orbit');
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeData, setTreeData] = useState<TreeCategory[]>([]);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [measureDist, setMeasureDist] = useState<number | null>(null);
  // Selisih per sumbu dalam konvensi Revit/IFC (z = tinggi), diisi setelah
  // titik kedua diklik.
  const [measureDelta, setMeasureDelta] = useState<{ x: number; y: number; z: number } | null>(null);
  const [walking, setWalking] = useState(false);
  const [speedMult, setSpeedMult] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [lockOn, setLockOn] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [brightness, setBrightness] = useState(1);
  const [bgMode, setBgMode] = useState<BgMode>('theme');
  const [helpOpen, setHelpOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Pesan sekilas di pojok kanan bawah (mis. cara mengembalikan objek yang
  // baru disembunyikan) — supaya tidak ada objek yang "hilang" tanpa jalan pulang.
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const t = locales[locale].viewer;
  const tt = locales[locale].tree;

  function changeMode(next: IsolateMode) {
    modeRef.current = next;
    setMode(next);
  }

  function toggleIsolate() {
    const next = !isolateOnRef.current;
    isolateOnRef.current = next;
    setIsolateOn(next);
    // Langsung berlaku ke elemen yang sedang terpilih — kalau harus diklik
    // ulang dulu, tombolnya terasa tidak bereaksi.
    const mesh = selectedMeshRef.current;
    if (!next) resetIsolation();
    else if (mesh) {
      if (modeRef.current === 'category') isolateByCategory(mesh);
      else isolateGid((mesh.userData.globalId as string) || '');
    }
  }

  function showNotice(message: string) {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_DURATION_MS);
  }

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    };
  }, []);

  // Warna manual yang sedang dipakai objek ini (null = warna asli).
  function paintOf(gid: string): number | null {
    const mat = colorMatByGid.current.get(gid);
    return mat ? mat.color.getHex() : null;
  }

  // Tentukan fungsi tiap tombol mouse dari kombinasi tool + Shift + mode Diam.
  // Dipanggil ulang setiap salah satunya berubah, SEBELUM tombol mouse ditekan.
  function updateMouseButtons() {
    const controls = controlsRef.current;
    if (!controls) return;
    const shift = shiftDownRef.current;

    controls.mouseButtons.LEFT = shift
      ? null // Shift + klik kiri dipakai untuk menoleh (ditangani manual)
      : toolRef.current === 'pan'
        ? THREE.MOUSE.PAN
        : lockOnRef.current
          ? null // mode Diam: klik kiri tidak memutar model
          : THREE.MOUSE.ROTATE;

    // Shift + roda tengah = orbit; tanpa Shift roda tengah tetap zoom.
    controls.mouseButtons.MIDDLE = shift ? THREE.MOUSE.ROTATE : THREE.MOUSE.DOLLY;
    // Saat Shift ditahan, scroll dipakai untuk menengadah/menunduk, bukan zoom.
    controls.enableZoom = !shift;
    controls.enableDamping = !lockOnRef.current;
  }

  // Terapkan kecerahan & warna latar ke scene. Dibaca dari ref supaya bisa
  // dipanggil dari dalam efek mount (yang tidak melihat perubahan state).
  function applyDisplay() {
    const lights = lightsRef.current;
    const b = brightnessRef.current;
    if (lights) {
      lights.ambient.intensity = BASE_LIGHT.ambient * b;
      lights.hemi.intensity = BASE_LIGHT.hemi * b;
      lights.key.intensity = BASE_LIGHT.key * b;
      lights.fill.intensity = BASE_LIGHT.fill * b;
    }
    const scene = sceneRef.current;
    if (scene) {
      const color = BG_COLORS[bgModeRef.current];
      scene.background = color === null ? null : new THREE.Color(color);
    }
  }

  function changeBrightness(v: number) {
    brightnessRef.current = v;
    setBrightness(v);
    applyDisplay();
    savePrefs(v, bgModeRef.current);
  }

  function changeBg(mode: BgMode) {
    bgModeRef.current = mode;
    setBgMode(mode);
    applyDisplay();
    savePrefs(brightnessRef.current, mode);
  }

  // Simpan pilihan tampilan di browser supaya tidak balik ke awal tiap refresh.
  function savePrefs(b: number, mode: BgMode) {
    try {
      localStorage.setItem(DISPLAY_PREFS_KEY, JSON.stringify({ brightness: b, bg: mode }));
    } catch {
      /* localStorage diblokir (mode privat) — abaikan, cuma preferensi */
    }
  }

  // Muat preferensi tampilan sebelum scene dibangun.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISPLAY_PREFS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { brightness?: number; bg?: string };
      if (typeof saved.brightness === 'number') {
        const b = Math.min(Math.max(saved.brightness, 0.4), 2.5);
        brightnessRef.current = b;
        setBrightness(b);
      }
      if (saved.bg && saved.bg in BG_COLORS) {
        bgModeRef.current = saved.bg as BgMode;
        setBgMode(saved.bg as BgMode);
      }
      applyDisplay();
    } catch {
      /* preferensi rusak / tidak bisa dibaca — pakai default */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Layar penuh pada pembungkus viewer, bukan seluruh halaman — supaya dock,
  // panel, dan hint tetap ikut tampil. Canvas menyesuaikan sendiri lewat
  // ResizeObserver yang sudah ada.
  function toggleFullscreen() {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  }

  // Ikuti perubahan dari mana pun (tombol, tombol Esc, atau F11 browser).
  useEffect(() => {
    function onChange() {
      setFullscreen(document.fullscreenElement === rootRef.current);
    }
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  function toggleLock() {
    const next = !lockOnRef.current;
    lockOnRef.current = next;
    setLockOn(next);
    updateMouseButtons();
  }

  // Putar arah pandang kamera DI TEMPAT (posisi kamera tidak pindah): vektor
  // arah pandang diputar, lalu target OrbitControls ditaruh di ujungnya supaya
  // orbit berikutnya berpusat di titik yang baru dilihat.
  function lookAround(yaw: number, pitch: number) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const dir = controls.target.clone().sub(camera.position);
    const dist = dir.length();
    if (dist < 1e-6) return;
    dir.normalize();

    const up = new THREE.Vector3(0, 1, 0);
    if (yaw) dir.applyAxisAngle(up, yaw);

    if (pitch) {
      const right = new THREE.Vector3().crossVectors(dir, up).normalize();
      if (right.lengthSq() > 1e-8) {
        const next = dir.clone().applyAxisAngle(right, pitch);
        // Jangan sampai melewati tegak lurus (kamera terbalik).
        const angleFromUp = next.angleTo(up);
        if (angleFromUp > 0.05 && angleFromUp < Math.PI - 0.05) dir.copy(next);
      }
    }

    controls.target.copy(camera.position).addScaledVector(dir, dist);
    controls.update();
  }

  // Pilih tool navigasi. Mengatur perilaku mouse OrbitControls (pan/rotate),
  // dan masuk/keluar mode walkthrough (pointer lock).
  function selectTool(next: Tool) {
    if (toolRef.current === 'walk' && next !== 'walk') {
      walkControlsRef.current?.unlock();
    }
    toolRef.current = next;
    setToolState(next);
    updateMouseButtons();
    if (next === 'walk') {
      setMarkupOn(false);
      enterWalk();
    }
  }

  function enterWalk() {
    const wc = walkControlsRef.current;
    const controls = controlsRef.current;
    if (!wc) return;
    if (controls) controls.enabled = false;
    walkingRef.current = true;
    setWalking(true);
    try {
      wc.lock();
    } catch {
      /* pointer lock ditolak browser — abaikan */
    }
  }

  // Ambil kategori + nama tiap elemen dari Supabase (anon, dibatasi RLS).
  //
  // Objek di GLB dinamai GlobalId (IfcConvert dijalankan dengan
  // --use-element-guids), jadi nama yang bisa dibaca manusia HANYA ada di
  // tabel ini. Kalau tabel kosong, viewer terpaksa menampilkan GlobalId dan
  // semua elemen jatuh ke kategori "Default" — isi lewat tombol impor di
  // halaman Kelola.
  //
  // TIDAK SEMUA objek GLB dinamai GlobalId. Sebagian (sering fitting seperti
  // tee/bend cable tray) bernama ANGKA — itu ElementId Revit, bukan GlobalId,
  // jadi pencarian ke tabel `elements` meleset dan elemennya tampil sebagai
  // "Tanpa kategori" walaupun datanya ada. Untungnya ElementId itu ikut
  // tertulis di ekor Name IFC (`Family:Type:1073322`), jadi dibuat indeks
  // cadangan: ekor angka -> kategori & nama. Lihat `altKeyOf`.
  //
  // WAJIB paginasi: Supabase membatasi jumlah baris per permintaan (bawaannya
  // 1000). Model besar gampang punya puluhan ribu elemen, dan tanpa paginasi
  // sisanya hilang DIAM-DIAM — tabel terisi penuh, tapi elemen yang barisnya
  // ada di belakang tetap tampil sebagai GlobalId di kategori "Default".
  useEffect(() => {
    let active = true;

    (async () => {
      const PAGE = 1000;
      const MAX_PAGES = 500; // pengaman: berhenti di 500rb baris
      const cats = new Map<string, string>();
      const names = new Map<string, string>();
      const alts = new Map<string, { category: string | null; name: string | null }>();
      let from = 0;

      for (let page = 0; page < MAX_PAGES; page++) {
        const { data, error } = await getSupabase()
          .from('elements')
          .select('global_id, category, name')
          .eq('project_id', projectId)
          .order('global_id', { ascending: true })
          .range(from, from + PAGE - 1);

        if (!active) return;
        if (error) {
          console.error('Gagal memuat nama elemen:', error.message);
          break;
        }
        if (!data || data.length === 0) break; // halaman kosong = sudah habis

        data.forEach((row) => {
          const gid = row.global_id as string;
          const cat = (row.category as string) || null;
          const nm = (row.name as string) || null;
          if (cat) cats.set(gid, cat);
          if (nm) names.set(gid, nm);
          // Indeks cadangan lewat ElementId Revit (lihat komentar di atas).
          const alt = nm ? /:(\d{3,})\s*$/.exec(nm)?.[1] : null;
          if (alt) alts.set(alt, { category: cat, name: nm });
        });
        // Maju sebanyak baris yang BENAR-BENAR diterima — batas server bisa
        // lebih kecil dari PAGE, dan kalau maju sebesar PAGE barisnya terlewat.
        from += data.length;
      }

      if (!active) return;
      categoryByGlobalId.current = cats;
      nameByGlobalId.current = names;
      elementByElementId.current = alts;
      buildTree(); // data dari DB baru datang -> susun ulang tree
      // Info elemen yang sedang terpilih ikut diperbarui supaya namanya muncul.
      setSelected((cur) => (cur ? { ...cur, name: names.get(cur.globalId) ?? cur.name } : cur));
    })();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Setup scene sekali saat mount.
  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      5000
    );
    camera.position.set(10, 10, 10);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;
    updateMouseButtons(); // pemetaan awal tombol mouse (tool/Shift/mode Diam)

    const walkControls = new PointerLockControls(camera, renderer.domElement);
    walkControlsRef.current = walkControls;
    walkControls.addEventListener('unlock', () => {
      walkingRef.current = false;
      setWalking(false);
      if (controlsRef.current) controlsRef.current.enabled = !markupOn;
      if (toolRef.current === 'walk') {
        toolRef.current = 'orbit';
        setToolState('orbit');
      }
    });

    // Pencahayaan meniru tampilan "Shaded" Revit: dominan cahaya menyebar
    // (ambient + hemisphere) supaya permukaan rata & terang, ditambah 1 lampu
    // arah sebagai pembentuk volume dan 1 lampu isi dari sisi berlawanan
    // supaya sisi yang membelakangi cahaya tidak jadi gelap pekat.
    const ambient = new THREE.AmbientLight(0xffffff, BASE_LIGHT.ambient);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xc8c8c8, BASE_LIGHT.hemi);
    const keyLight = new THREE.DirectionalLight(0xffffff, BASE_LIGHT.key);
    keyLight.position.set(5, 10, 7);
    const fillLight = new THREE.DirectionalLight(0xffffff, BASE_LIGHT.fill);
    fillLight.position.set(-6, 4, -8);
    scene.add(ambient, hemi, keyLight, fillLight);
    lightsRef.current = { ambient, hemi, key: keyLight, fill: fillLight };
    applyDisplay();

    loadModel(scene, initialGlbUrl);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    let downX = 0;
    let downY = 0;
    let moved = false;
    // Drag "menoleh" dipasang di WINDOW, bukan di canvas. Tombol tengah rawan
    // direbut browser (autoscroll) dan pointer capture canvas bisa dilepas
    // OrbitControls saat pointerup-nya sendiri — dengan listener window,
    // gerakan tetap terbaca sampai tombol benar-benar dilepas.
    let lookListenersOn = false;
    function startLookDrag(event: PointerEvent, freeLook: boolean) {
      lookDragRef.current = { x: event.clientX, y: event.clientY, freeLook };
      if (lookListenersOn) return;
      window.addEventListener('pointermove', handleLookMove);
      window.addEventListener('pointerup', handleLookEnd);
      window.addEventListener('pointercancel', handleLookEnd);
      lookListenersOn = true;
    }
    function handleLookMove(event: PointerEvent) {
      const look = lookDragRef.current;
      if (!look) return;
      // Tombol sudah dilepas di luar jendela -> hentikan, jangan tersangkut.
      if (event.buttons === 0) {
        handleLookEnd();
        return;
      }
      const dx = event.clientX - look.x;
      const dy = event.clientY - look.y;
      look.x = event.clientX;
      look.y = event.clientY;
      // Geser kanan -> menoleh kanan (putar searah jarum jam dilihat dari
      // atas, jadi negatif terhadap sumbu Y). Geser atas (dy negatif) ->
      // menengadah. Sumbu vertikal hanya untuk free look roda tengah.
      const sens = look.freeLook ? LOOK_SENSITIVITY_SLOW : LOOK_SENSITIVITY;
      lookAround(-dx * sens, look.freeLook ? -dy * sens : 0);
    }
    function handleLookEnd() {
      lookDragRef.current = null;
      if (!lookListenersOn) return;
      window.removeEventListener('pointermove', handleLookMove);
      window.removeEventListener('pointerup', handleLookEnd);
      window.removeEventListener('pointercancel', handleLookEnd);
      lookListenersOn = false;
    }

    function handlePointerDown(event: PointerEvent) {
      downX = event.clientX;
      downY = event.clientY;
      moved = false;
      // Begitu user memegang kendali, animasi kamera berhenti — kalau tidak,
      // tween dan gerakan tangan saling tarik-menarik. Seleksi lewat klik tetap
      // bisa memulai animasi baru, karena `click` menyusul setelah pointerup.
      flyRef.current = null;
      // Dua cara menoleh dengan klik kiri, keduanya sudah dilepas dari
      // OrbitControls lewat updateMouseButtons() supaya tidak bentrok:
      //   - Shift + klik kiri        -> kiri/kanan saja
      //   - klik kiri di mode Diam   -> bebas kiri/kanan + atas/bawah, pelan
      // Tool Geser (pan) dikecualikan: di sana klik kiri memang untuk menggeser.
      if (event.button !== 0 || walkingRef.current) return;
      const shiftLook = event.shiftKey;
      const lockLook = lockOnRef.current && !event.shiftKey && toolRef.current !== 'pan';
      if (shiftLook || lockLook) startLookDrag(event, lockLook);
    }
    function handlePointerMove(event: PointerEvent) {
      if (Math.abs(event.clientX - downX) > 4 || Math.abs(event.clientY - downY) > 4) {
        moved = true;
      }
    }
    // Autoscroll (ikon panah 4 arah) di Chrome/Firefox dipicu oleh mousedown
    // tombol tengah; kalau muncul, ia merebut gerakan mouse berikutnya.
    function handleNativeMouseDown(event: MouseEvent) {
      if (event.button === 1) event.preventDefault();
    }
    function handleAuxClick(event: MouseEvent) {
      if (event.button === 1) event.preventDefault();
    }

    // Shift + scroll = menengadah / menunduk. Zoom sudah dimatikan selama Shift
    // ditahan (lihat updateMouseButtons), jadi tidak ikut memperbesar.
    function handleWheel(event: WheelEvent) {
      flyRef.current = null; // zoom manual membatalkan animasi auto-fokus
      if (!event.shiftKey || walkingRef.current) return;
      event.preventDefault();
      lookAround(0, -Math.sign(event.deltaY) * 0.04);
    }

    // Lacak Shift supaya pemetaan tombol mouse sudah benar sebelum diklik.
    function handleShift(event: KeyboardEvent) {
      const down = event.type === 'keydown';
      if (event.key !== 'Shift' || shiftDownRef.current === down) return;
      shiftDownRef.current = down;
      updateMouseButtons();
    }
    // Kalau fokus pindah dari halaman saat tombol ditahan, keyup tidak pernah
    // sampai — reset semuanya supaya kontrol tidak tersangkut (mis. kamera
    // terus berjalan sendiri karena W dianggap masih ditekan).
    function handleBlur() {
      [walkKeysRef.current, orbitKeysRef.current].forEach((k) => {
        k.f = k.b = k.l = k.r = k.up = k.down = false;
      });
      if (!shiftDownRef.current) return;
      shiftDownRef.current = false;
      updateMouseButtons();
    }

    function handleClick(event: MouseEvent) {
      // Geseran = memutar / menoleh, bukan memilih.
      if (moved) return;
      const activeTool = toolRef.current;
      if (activeTool === 'walk') return;

      const rect = container.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const root = modelRootRef.current;
      const intersects = raycaster.intersectObjects(root ? [root] : scene.children, true);

      if (activeTool === 'measure') {
        const hit = intersects.find((i) => (i.object as THREE.Mesh).visible !== false) ?? intersects[0];
        if (hit) addMeasurePoint(hit.point.clone());
        return;
      }

      // Semua objek yang tertembus sinar di titik ini, urut dari yang terdekat.
      // Objek tersembunyi dilewati; satu elemen cuma dihitung sekali walaupun
      // geometrinya terpecah beberapa mesh.
      //
      // Objek PADAT diutamakan, objek tembus pandang ditaruh di belakang. Sinar
      // raycaster tidak peduli material: elemen kaca/volume ruang yang di layar
      // hampir tidak terlihat tetap tertembus lebih dulu dan "memakan" klik
      // yang sebenarnya diarahkan ke kolom di belakangnya. Yang benar-benar
      // tidak terlihat (opacity ~0) tidak bisa diklik sama sekali.
      const solid: THREE.Mesh[] = [];
      const sheer: THREE.Mesh[] = [];
      const seen = new Set<string>();
      for (const it of intersects) {
        const mesh = it.object as THREE.Mesh;
        if (mesh.visible === false) continue;
        const key = (mesh.userData.globalId as string) || `#${mesh.id}`;
        if (seen.has(key)) continue;
        const weight = pickWeight(mesh);
        if (weight === 0) continue; // tak terlihat sama sekali — jangan bisa diklik
        seen.add(key);
        (weight === 2 ? solid : sheer).push(mesh);
      }
      const candidates = [...solid, ...sheer];

      if (candidates.length === 0) {
        pickRef.current = null;
        clearSelection();
        return;
      }

      // Shift + klik DI TITIK YANG SAMA = maju ke objek berikutnya di belakang
      // yang sekarang. Ini jalan keluar saat objek yang diincar terhalang objek
      // lain (sering: elemen besar tak terlihat yang menutupi kolom).
      //
      // Aman berdampingan dengan "Shift + geser = menoleh": yang itu berakhir
      // dengan moved = true dan sudah keluar di baris pertama.
      const prev = pickRef.current;
      const samePoint =
        prev && Math.abs(prev.x - event.clientX) <= 8 && Math.abs(prev.y - event.clientY) <= 8;
      const index = event.shiftKey && samePoint ? (prev!.index + 1) % candidates.length : 0;

      const target = candidates[index];
      pickRef.current = { x: event.clientX, y: event.clientY, index };

      const gid = (target.userData.globalId as string) || null;
      selectedMeshRef.current = target;
      if (isolateOnRef.current) {
        if (modeRef.current === 'category') isolateByCategory(target);
        else isolateGid(gid ?? '');
      }
      setSelected({
        globalId: gid ?? '—',
        category: categoryOf(target),
        name: gid ? nameOf(gid) : null,
        color: gid ? paintOf(gid) : null,
        pickIndex: index + 1,
        pickCount: candidates.length,
      });
      onElementSelect?.(gid?.startsWith('unmapped:') ? null : gid);
      const box = boxOfGid(gid ?? '', target);
      showSelectionBox(box);
      // Objek yang dipilih lewat Shift sengaja tidak memicu kamera bergerak —
      // user sedang memilah di titik yang sama, kamera bergeser malah bikin
      // titik itu meleset dari kursor.
      if (!event.shiftKey) focusOnBox(box);
    }
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('mousedown', handleNativeMouseDown);
    renderer.domElement.addEventListener('auxclick', handleAuxClick);
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });
    renderer.domElement.addEventListener('click', handleClick);
    window.addEventListener('keydown', handleShift);
    window.addEventListener('keyup', handleShift);
    window.addEventListener('blur', handleBlur);

    // Pemetaan tombol gerak (sama untuk orbit & walkthrough):
    //   W/S atau ↑/↓ = maju/mundur, A/D atau ←/→ = kiri/kanan,
    //   Q / Space / PageUp = naik, E / PageDown = turun.
    // Shift SENGAJA tidak dipakai di sini: dia modifier untuk orbit/menoleh
    // (roda tengah, scroll, klik kiri). Kalau ikut dipetakan sebagai "turun",
    // menahan Shift bikin kamera meluncur turun terus.
    function setMoveKey(
      target: { f: boolean; b: boolean; l: boolean; r: boolean; up: boolean; down: boolean },
      e: KeyboardEvent,
      down: boolean
    ): boolean {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          target.f = down;
          return true;
        case 'KeyS':
        case 'ArrowDown':
          target.b = down;
          return true;
        case 'KeyA':
        case 'ArrowLeft':
          target.l = down;
          return true;
        case 'KeyD':
        case 'ArrowRight':
          target.r = down;
          return true;
        case 'KeyQ':
        case 'Space':
        case 'PageUp':
          target.up = down;
          return true;
        case 'KeyE':
        case 'PageDown':
          target.down = down;
          return true;
        default:
          return false;
      }
    }
    // Abaikan tombol saat user sedang mengetik (mis. kolom cari Selection Tree),
    // supaya huruf W/A/S/D tidak ikut menggerakkan kamera.
    function isTyping(): boolean {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      );
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isTyping()) return;
      const target = walkingRef.current ? walkKeysRef.current : orbitKeysRef.current;
      if (setMoveKey(target, e, true)) {
        flyRef.current = null; // gerak manual membatalkan animasi auto-fokus
        e.preventDefault();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      // Selalu lepaskan di kedua set supaya tak ada tombol "nyangkut".
      const a = setMoveKey(walkKeysRef.current, e, false);
      const b = setMoveKey(orbitKeysRef.current, e, false);
      if (a || b) e.preventDefault();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    function animate() {
      requestAnimationFrame(animate);
      const dt = clockRef.current.getDelta();
      if (walkingRef.current && walkControlsRef.current) {
        const wc = walkControlsRef.current;
        const k = walkKeysRef.current;
        const step = walkSpeedRef.current * speedMultRef.current * dt;
        if (k.f) wc.moveForward(step);
        if (k.b) wc.moveForward(-step);
        if (k.l) wc.moveRight(-step);
        if (k.r) wc.moveRight(step);
        if (k.up) camera.position.y += step;
        if (k.down) camera.position.y -= step;
      } else {
        // Navigasi keyboard di mode orbit: geser kamera + target bersama sesuai
        // arah pandang, jadi orbit tetap berfungsi (gaya fly-through).
        const k = orbitKeysRef.current;
        if (controls.enabled && (k.f || k.b || k.l || k.r || k.up || k.down)) {
          const step = walkSpeedRef.current * speedMultRef.current * dt;
          const forward = new THREE.Vector3();
          camera.getWorldDirection(forward);
          // Jalan RATA seperti walkthrough: buang komponen vertikal arah
          // pandang, supaya W tidak menukik ke bawah saat kamera menunduk.
          forward.y = 0;
          if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1); // kamera tegak lurus
          forward.normalize();
          const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
          const move = new THREE.Vector3();
          if (k.f) move.add(forward);
          if (k.b) move.addScaledVector(forward, -1);
          if (k.r) move.add(right);
          if (k.l) move.addScaledVector(right, -1);
          if (k.up) move.y += 1;
          if (k.down) move.y -= 1;
          if (move.lengthSq() > 0) {
            move.normalize().multiplyScalar(step);
            camera.position.add(move);
            controls.target.add(move);
          }
        }
        // Animasi auto-fokus. Posisi & target di-set langsung lalu
        // controls.update() dipanggil seperti biasa — OrbitControls menghitung
        // ulang offset dari keduanya, jadi tidak berebut dengan tween ini.
        const fly = flyRef.current;
        if (fly) {
          fly.t = Math.min(fly.t + dt, FLY_DURATION);
          const p = fly.t / FLY_DURATION;
          // easeInOutCubic: berangkat & mendarat pelan, tengahnya cepat.
          const k = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
          camera.position.lerpVectors(fly.fromPos, fly.toPos, k);
          controls.target.lerpVectors(fly.fromTarget, fly.toTarget, k);
          if (fly.t >= FLY_DURATION) flyRef.current = null;
        }
        controls.update();
      }
      updateOverlays();
      renderer.render(scene, camera);
    }
    animate();

    function handleResize() {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    }
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

    const channel = subscribeToProjectUpdates(projectId, (version) => {
      setLiveUpdateMessage(t.liveUpdate);
      loadModel(scene, `/api/model/${version.id}`, version.changed_global_ids);
      setTimeout(() => setLiveUpdateMessage(null), HIGHLIGHT_DURATION_MS);
    });

    return () => {
      handleLookEnd(); // lepas listener window kalau masih ada drag berjalan
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('mousedown', handleNativeMouseDown);
      renderer.domElement.removeEventListener('auxclick', handleAuxClick);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      renderer.domElement.removeEventListener('click', handleClick);
      window.removeEventListener('keydown', handleShift);
      window.removeEventListener('keyup', handleShift);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      unsubscribe(channel);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, initialGlbUrl]);

  // Dipanggil tiap frame: (1) jaga ukuran titik ukur tetap konstan di layar
  // (tidak ikut membesar saat kamera mendekat), (2) proyeksikan label jarak
  // ke titik tengah garis. Karena jalan di animate loop, posisi selalu
  // ter-update saat kamera bergerak (label tidak hilang lagi).
  function updateOverlays() {
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!camera || !container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;

    // Skala marker ukur supaya radiusnya ~7px di layar berapapun jaraknya.
    const group = measureGroupRef.current;
    if (group && group.children.length) {
      const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);
      const targetPx = 7;
      group.children.forEach((c) => {
        if (!(c as THREE.Mesh).userData?.measureMarker) return;
        const dist = camera.position.distanceTo(c.position);
        const r = (targetPx * tanHalfFov * dist) / (h / 2);
        c.scale.setScalar(r);
      });
    }

    const label = measureLabelElRef.current;
    const pts = measurePtsRef.current;
    if (label && pts.length === 2) {
      const mid = pts[0].clone().add(pts[1]).multiplyScalar(0.5);
      const v = mid.project(camera);
      const behind = v.z > 1 || v.z < -1;
      label.style.display = behind ? 'none' : '';
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      label.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
    } else if (label) {
      label.style.display = 'none';
    }
  }

  function applyCameraPreset(preset: string) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const key = preset.split('#')[0];
    const size = modelSizeRef.current;
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const d = maxDim * 1.9;
    const table: Record<string, [number, number, number]> = {
      top: [0.001, d, 0.001],
      bottom: [0.001, -d, 0.001],
      front: [0, d * 0.15, d],
      back: [0, d * 0.15, -d],
      left: [-d, d * 0.15, 0],
      right: [d, d * 0.15, 0],
      iso: [d, d * 0.8, d],
    };
    const p = table[key] ?? table.iso;
    flyRef.current = null; // preset kamera menang atas animasi yang berjalan
    camera.position.set(p[0], p[1], p[2]);
    controls.target.set(0, 0, 0);
    controls.update();
  }

  useEffect(() => {
    if (cameraPreset) applyCameraPreset(cameraPreset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraPreset]);

  function loadModel(scene: THREE.Scene, glbUrl: string, highlightIds: string[] = []) {
    setLoadState('loading');
    setUnmappedMeshes(0);
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    loader.setDRACOLoader(dracoLoader);
    loader.load(
      glbUrl,
      (gltf) => {
        if (modelRootRef.current) scene.remove(modelRootRef.current);
        meshesByGlobalId.current.clear();
        embeddedByGlobalId.current.clear();
        originalMaterials.current.clear();
        // Model diganti -> mesh lama dibuang, warna manual ikut hangus.
        colorMatByGid.current.forEach((mat) => mat.dispose());
        colorMatByGid.current.clear();
        selectedMeshRef.current = null;
        showSelectionBox(null); // mesh lama sudah dibuang, kotaknya ikut hilang

        let unmapped = 0;
        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const identity = resolveModelIdentity(child, gltf.scene, gltf.parser);
            // Unknown batches/meshes get a local selection key, never a made-up IFC identity.
            const globalId = identity?.globalId ?? `unmapped:${child.uuid}`;
            if (identity) embeddedByGlobalId.current.set(globalId, identity);
            else unmapped++;
            child.userData.globalId = globalId;
            meshesByGlobalId.current.set(globalId, child);
            originalMaterials.current.set(child, child.material);
            if (highlightIds.includes(globalId)) flashHighlight(child);
          }
        });
        setUnmappedMeshes(unmapped);

        scene.add(gltf.scene);
        modelRootRef.current = gltf.scene;
        frameCameraToObject(gltf.scene);
        setHiddenCategories(new Set());
        setHiddenIds(new Set());
        buildTree();
        setLoadState('ready');
        dracoLoader.dispose();
      },
      undefined,
      (err) => {
        console.error('Gagal load GLB:', glbUrl, err);
        setLoadState('error');
        dracoLoader.dispose();
      }
    );
  }

  // Susun data Selection Tree dari mesh yang sudah dimuat, dikelompokkan per
  // kategori (gabungan data DB `elements` + fallback nama mesh IfcConvert).
  function buildTree() {
    const root = modelRootRef.current;
    if (!root) return;
    const byCat = new Map<string, Map<string, string>>(); // cat -> (gid -> name)
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const gid = (child.userData.globalId as string) || child.name || '';
      if (!gid) return;
      const cat = categoryOf(child) ?? DEFAULT_CATEGORY;
      if (!byCat.has(cat)) byCat.set(cat, new Map());
      const inner = byCat.get(cat)!;
      // Utamakan nama dari tabel `elements`; `child.name` isinya GlobalId.
      if (!inner.has(gid)) inner.set(gid, nameOf(gid) ?? (child.name || (gid.startsWith('unmapped:') ? 'Objek tanpa identitas' : gid)));
    });
    const cats: TreeCategory[] = Array.from(byCat.entries())
      .map(([category, inner]) => ({
        category,
        elements: Array.from(inner.entries()).map(([globalId, name]) => ({ globalId, name })),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
    setTreeData(cats);
  }

  // Tombol Fokus: kalau ada elemen terpilih, dekati elemen itu (dipaksa, walau
  // sudah kelihatan — user memang minta); kalau tidak ada, bingkai ulang
  // seluruh model.
  function focusModel() {
    const mesh = selectedMeshRef.current;
    if (mesh) {
      focusOnBox(boxOfGid((mesh.userData.globalId as string) || '', mesh), true);
      return;
    }
    if (modelRootRef.current) frameCameraToObject(modelRootRef.current);
  }

  // --- Kotak penanda elemen terpilih ---
  // Kotak meliputi SELURUH mesh milik elemen itu, bukan cuma yang kena klik.
  function boxOfGid(gid: string, fallback?: THREE.Mesh | null): THREE.Box3 {
    const box = new THREE.Box3();
    forEachMeshOfGid(gid, (mesh) => box.expandByObject(mesh));
    if (box.isEmpty() && fallback) box.setFromObject(fallback);
    return box;
  }

  function showSelectionBox(box: THREE.Box3 | null) {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!box || box.isEmpty()) {
      if (selectionBoxRef.current) selectionBoxRef.current.visible = false;
      return;
    }
    let helper = selectionBoxRef.current;
    if (!helper) {
      helper = new THREE.Box3Helper(box.clone(), new THREE.Color(SELECTION_BOX_COLOR));
      // Tembus pandang supaya kotaknya tetap terlihat walau elemennya berada di
      // balik dinding — sama seperti penanda titik ukur.
      const mat = helper.material as THREE.LineBasicMaterial;
      mat.depthTest = false;
      mat.transparent = true;
      helper.renderOrder = 998;
      scene.add(helper);
      selectionBoxRef.current = helper;
    } else {
      helper.box.copy(box);
    }
    helper.visible = true;
  }

  // Dipanggil setiap visibilitas berubah: kotak penanda ikut hilang kalau
  // elemennya disembunyikan (kotak melayang tanpa isi bikin bingung), dan
  // muncul lagi begitu elemennya ditampilkan kembali.
  function syncSelectionBox() {
    const mesh = selectedMeshRef.current;
    if (!mesh || mesh.visible === false) {
      showSelectionBox(null);
      return;
    }
    showSelectionBox(boxOfGid((mesh.userData.globalId as string) || '', mesh));
  }

  function clearSelection() {
    resetIsolation();
    selectedMeshRef.current = null;
    pickRef.current = null;
    setSelected(null);
    showSelectionBox(null);
    onElementSelect?.(null);
  }

  // Mulai animasi kamera. Dijalankan frame demi frame di animate loop, bukan
  // dengan memindahkan kamera seketika.
  function flyTo(toPos: THREE.Vector3, toTarget: THREE.Vector3) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    flyRef.current = {
      fromPos: camera.position.clone(),
      toPos: toPos.clone(),
      fromTarget: controls.target.clone(),
      toTarget: toTarget.clone(),
      t: 0,
    };
  }

  // "Sudah kelihatan jelas" = ada di dalam frustum kamera DAN tingginya di
  // layar melewati MIN_SCREEN_COVERAGE. Dua-duanya perlu: elemen besar yang
  // berada di belakang kamera tetap harus didekati, dan elemen di tengah layar
  // yang cuma sebesar titik juga masih perlu didekati.
  function isWellVisible(sphere: THREE.Sphere): boolean {
    const camera = cameraRef.current;
    if (!camera) return false;
    camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );
    if (!frustum.intersectsSphere(sphere)) return false;
    const dist = camera.position.distanceTo(sphere.center);
    if (dist < 1e-6) return true; // kamera tepat di dalam objek
    // Tinggi separuh layar pada jarak itu; bandingkan dengan jari-jari objek.
    const halfHeight = dist * Math.tan(((camera.fov * Math.PI) / 180) / 2);
    return sphere.radius / halfHeight >= MIN_SCREEN_COVERAGE;
  }

  // Kamera hanya bergerak kalau perlu — persis permintaannya: sudah dekat =
  // diam, jauh = mendekat. "Sudah dekat" diukur dari seberapa besar elemen
  // tampil di layar (MIN_SCREEN_COVERAGE), bukan dari jarak mentah, karena
  // jarak 10 m itu dekat untuk atap tapi jauh untuk sekrup.
  //
  // `force` dipakai tombol Fokus: di sana user memang minta kamera bergerak.
  function focusOnBox(box: THREE.Box3, force = false) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls || box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center.clone();

    // Jarak supaya objek pas di layar. Dihitung dari FOV & aspect (bola
    // pembatas, jadi tidak tergantung arah objek menghadap) — bukan kelipatan
    // ukuran objek. Rumus lama `maxDim * 2.5` justru ZOOM OUT untuk objek besar:
    // atap yang membentang 60 m membuat kamera ditarik ke 150 m, lebih jauh
    // daripada posisi user sebelum mengklik.
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const fit = (sphere.radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.15;

    if (!force && isWellVisible(sphere)) return; // sudah kelihatan jelas — jangan diusik

    // Klik objek harus MENDEKAT, tidak pernah menjauh: jarak dibatasi jarak
    // kamera sekarang. Untuk objek raksasa hasilnya kamera tinggal berpindah
    // pusat ke objek itu (seperti pan), bukan melompat mundur.
    const current = camera.position.distanceTo(controls.target);
    const dist = Math.max(Math.min(fit, current), camera.near * 20);

    // Arah pandang DIPERTAHANKAN — kamera cuma meluncur mendekat dari sisi yang
    // sedang dilihat. Kalau arahnya ikut dipaksa ke isometrik, tiap klik
    // membuat pandangan berputar dan orientasi user hilang.
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-8) dir.set(1, 0.8, 1);
    dir.normalize();
    flyTo(center.clone().addScaledVector(dir, dist), center);
  }

  function applyClipping() {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const s = modelSizeRef.current;
    const hx = s.x / 2 || 1;
    const hy = s.y / 2 || 1;
    const hz = s.z / 2 || 1;
    const [pXmax, pXmin, pYmax, pYmin, pZmax, pZmin] = clipPlanesRef.current;
    pXmax.constant = hx * clip.xMax;
    pXmin.constant = hx * clip.xMin;
    pYmax.constant = hy * clip.yMax;
    pYmin.constant = hy * clip.yMin;
    pZmax.constant = hz * clip.zMax;
    pZmin.constant = hz * clip.zMin;
    renderer.clippingPlanes = sectionOn ? clipPlanesRef.current : [];
  }

  useEffect(() => {
    applyClipping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionOn, clip, loadState]);

  function resetSection() {
    setClip({ xMin: 1, xMax: 1, yMin: 1, yMax: 1, zMin: 1, zMax: 1 });
  }

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.enabled = !markupOn && !walkingRef.current;
  }, [markupOn]);

  function frameCameraToObject(object: THREE.Object3D) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    object.position.sub(center);
    modelSizeRef.current = size.clone();

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 1.8;
    flyRef.current = null; // "Fokus" ke seluruh model membatalkan animasi berjalan
    walkSpeedRef.current = maxDim * 0.4; // kecepatan jalan relatif ukuran model
    camera.near = Math.max(maxDim / 1000, 0.01);
    camera.far = maxDim * 100;
    camera.position.set(dist, dist * 0.8, dist);
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
  }

  // Seberapa layak sebuah mesh "dimaksud" saat diklik, dinilai dari material
  // ASLINYA (bukan material saat ini — isolate menggantinya dengan material
  // redup yang transparan, dan itu bukan cerminan tampilan model sebenarnya):
  //   2 = padat, inilah yang biasanya dimaksud user
  //   1 = tembus pandang (kaca, volume ruang) — masih bisa dipilih, tapi
  //       belakangan, jangan sampai merebut klik dari objek padat di belakangnya
  //   0 = tidak terlihat sama sekali -> tidak bisa diklik
  function pickWeight(mesh: THREE.Mesh): 0 | 1 | 2 {
    const cat = categoryOf(mesh);
    if (cat && NON_PHYSICAL_CATEGORIES.has(cat.toUpperCase())) return 1;
    const source = originalMaterials.current.get(mesh) ?? mesh.material;
    const mats = Array.isArray(source) ? source : [source];
    let best: 0 | 1 | 2 = 0;
    for (const m of mats) {
      if (!m || m.visible === false) continue;
      const mat = m as THREE.Material & { opacity?: number };
      const opacity = mat.opacity ?? 1;
      if (mat.transparent && opacity <= 0.02) continue; // tak terlihat
      if (mat.transparent && opacity < SHEER_OPACITY) best = best === 2 ? 2 : 1;
      else return 2;
    }
    return best;
  }

  // Semua primitive milik satu elemen berbagi identitas dari node IFC induk.
  function forEachMeshOfGid(gid: string, cb: (mesh: THREE.Mesh) => void) {
    if (!gid) return;
    forEachMesh((mesh) => {
      if ((mesh.userData.globalId as string) === gid) cb(mesh);
    });
  }

  function forEachMesh(cb: (mesh: THREE.Mesh) => void) {
    const root = modelRootRef.current;
    if (!root) return;
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) cb(child);
    });
  }

  // Nama elemen yang bisa dibaca manusia. Sumbernya tabel `elements`; kalau
  // belum diimpor, `child.name` isinya cuma GlobalId sehingga tidak berguna
  // untuk ditampilkan — kembalikan null supaya pemanggil bisa memilih fallback.
  function nameOf(gid: string): string | null {
    const embedded = embeddedByGlobalId.current.get(gid)?.name;
    if (embedded) return embedded;
    const direct = nameByGlobalId.current.get(gid);
    if (direct) return direct;
    const alt = altKeyOf(gid);
    return (alt && elementByElementId.current.get(alt)?.name) || null;
  }

  // Nama objek GLB yang berupa ANGKA adalah ElementId Revit, bukan GlobalId —
  // itu kunci untuk indeks cadangan. GlobalId panjangnya selalu 22 karakter,
  // jadi dikecualikan supaya GUID yang kebetulan diawali angka tidak salah
  // dijodohkan. Akhiran non-angka (mis. "1073322_1" untuk objek yang
  // geometrinya terpecah) ikut diterima.
  function altKeyOf(id: string): string | null {
    if (!id || id.length === 22) return null;
    return /^(\d{3,})(?:[^0-9].*)?$/.exec(id)?.[1] ?? null;
  }

  function categoryOf(mesh: THREE.Mesh): string | null {
    const gid = (mesh.userData.globalId as string) || '';
    const embedded = embeddedByGlobalId.current.get(gid)?.category;
    if (embedded) return embedded;
    const fromDb = categoryByGlobalId.current.get(gid);
    if (fromDb) return fromDb;
    const alt = altKeyOf(gid);
    const fromAlt = alt && elementByElementId.current.get(alt)?.category;
    if (fromAlt) return fromAlt;
    const name = mesh.name || '';
    if (name.includes(':')) return name.split(':')[0].trim() || null;
    return null;
  }

  // Isolate per ELEMEN, bukan per mesh: elemen yang terpecah beberapa primitive
  // harus menyala utuh, bukan cuma potongan yang kena klik.
  function isolateGid(gid: string) {
    forEachMesh((mesh) => {
      if ((mesh.userData.globalId as string) === gid) restoreMesh(mesh);
      else dimMesh(mesh);
    });
  }

  function isolateByCategory(target: THREE.Mesh) {
    const targetCat = categoryOf(target);
    if (!targetCat) {
      isolateGid((target.userData.globalId as string) || '');
      return;
    }
    forEachMesh((mesh) => {
      if (categoryOf(mesh) === targetCat) restoreMesh(mesh);
      else dimMesh(mesh);
    });
  }

  function resetIsolation() {
    forEachMesh((mesh) => restoreMesh(mesh));
  }

  // "Kembalikan seperti semula" = warna manual kalau ada, baru material asli.
  // Urutan ini yang membuat warna bertahan setelah isolate dimatikan/direset.
  function restoreMesh(mesh: THREE.Mesh) {
    const gid = (mesh.userData.globalId as string) || '';
    const painted = colorMatByGid.current.get(gid);
    if (painted) {
      mesh.material = painted;
      return;
    }
    const original = originalMaterials.current.get(mesh);
    if (original) mesh.material = original;
  }

  // --- Warna objek terpilih (sementara, tidak tersimpan ke database) ---
  function applyColor(color: number) {
    const gid = selected?.globalId;
    if (!gid || gid === '—') return;
    let mat = colorMatByGid.current.get(gid);
    if (mat) {
      mat.color.setHex(color);
    } else {
      mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05 });
      colorMatByGid.current.set(gid, mat);
    }
    // Satu GlobalId bisa punya lebih dari satu mesh -> telusuri, jangan pakai
    // meshesByGlobalId (map itu cuma menyimpan satu mesh per id).
    forEachMesh((mesh) => {
      if ((mesh.userData.globalId as string) === gid) mesh.material = mat!;
    });
    setSelected((cur) => (cur ? { ...cur, color } : cur));
  }

  function resetColor() {
    const gid = selected?.globalId;
    if (!gid) return;
    const mat = colorMatByGid.current.get(gid);
    if (!mat) return;
    colorMatByGid.current.delete(gid);
    forEachMesh((mesh) => {
      if ((mesh.userData.globalId as string) === gid) restoreMesh(mesh);
    });
    mat.dispose();
    setSelected((cur) => (cur ? { ...cur, color: null } : cur));
  }

  // Sembunyikan objek terpilih (seperti Hide di Navisworks). Isolate ikut
  // dilepas — kalau tidak, yang tersisa di layar cuma model redup tanpa objek
  // yang jadi pusat perhatian. Centangnya hilang di panel Struktur, jadi objek
  // selalu punya jalan pulang: centang lagi, atau tombol "Semua".
  function hideSelected() {
    const gid = selected?.globalId;
    if (!gid || gid === '—') return;
    setElementVisible(gid, false);
    clearSelection();
    showNotice(t.hideObjectNotice);
  }

  function dimMesh(mesh: THREE.Mesh) {
    if (!dimMaterialRef.current) {
      dimMaterialRef.current = new THREE.MeshStandardMaterial({
        color: 0x888888,
        transparent: true,
        opacity: DIMMED_OPACITY,
        depthWrite: false,
      });
    }
    mesh.material = dimMaterialRef.current;
  }

  function flashHighlight(mesh: THREE.Mesh) {
    const highlightMaterial = new THREE.MeshStandardMaterial({
      color: 0xffc107,
      emissive: 0xffc107,
      emissiveIntensity: 0.5,
    });
    const original = mesh.material;
    mesh.material = highlightMaterial;
    setTimeout(() => {
      mesh.material = original;
    }, HIGHLIGHT_DURATION_MS);
  }

  // --- Measure (ukur jarak) ---
  function ensureMeasureGroup(): THREE.Group {
    if (!measureGroupRef.current && sceneRef.current) {
      const g = new THREE.Group();
      sceneRef.current.add(g);
      measureGroupRef.current = g;
    }
    return measureGroupRef.current!;
  }

  function addMeasurePoint(p: THREE.Vector3) {
    if (measurePtsRef.current.length >= 2) clearMeasure();
    measurePtsRef.current.push(p);
    const g = ensureMeasureGroup();
    // Sphere radius 1 unit; skala sebenarnya diatur tiap frame di updateOverlays
    // supaya ukurannya konstan di layar (tidak kegedean saat dekat objek).
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, depthTest: false })
    );
    marker.userData.measureMarker = true;
    marker.renderOrder = 999;
    marker.position.copy(p);
    marker.scale.setScalar(0.0001); // sementara, sebelum frame pertama menskalakan
    g.add(marker);

    if (measurePtsRef.current.length === 2) {
      const geom = new THREE.BufferGeometry().setFromPoints(measurePtsRef.current);
      const line = new THREE.Line(
        geom,
        new THREE.LineBasicMaterial({ color: 0x22d3ee, depthTest: false })
      );
      line.renderOrder = 999;
      g.add(line);
      const [a, b] = measurePtsRef.current;
      setMeasureDist(a.distanceTo(b));
      // Selisih per sumbu, dipetakan ke konvensi Revit/IFC (Z = tinggi).
      // GLB hasil IfcConvert Y-up, IFC Z-up: sumbu vertikal scene (y) adalah
      // Z bagi user. Tandanya tidak dipakai, jadi urusan Y vs −Y tidak masalah.
      setMeasureDelta({
        x: Math.abs(b.x - a.x),
        y: Math.abs(b.z - a.z),
        z: Math.abs(b.y - a.y),
      });
    } else {
      setMeasureDist(null);
      setMeasureDelta(null);
    }
  }

  function clearMeasure() {
    const g = measureGroupRef.current;
    if (g) {
      g.children.slice().forEach((c) => {
        g.remove(c);
        const m = c as THREE.Mesh | THREE.Line;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    }
    measurePtsRef.current = [];
    setMeasureDist(null);
    setMeasureDelta(null);
  }

  // --- Selection Tree callbacks ---
  function selectElementById(gid: string) {
    const mesh = meshesByGlobalId.current.get(gid);
    if (!mesh) return;
    selectedMeshRef.current = mesh;
    if (isolateOnRef.current) {
      if (modeRef.current === 'category') isolateByCategory(mesh);
      else isolateGid(gid);
    }
    setSelected({ globalId: gid, category: categoryOf(mesh), name: nameOf(gid), color: paintOf(gid) });
    onElementSelect?.(gid.startsWith('unmapped:') ? null : gid);
    // Sama seperti klik di 3D: kotak penanda, dan kamera mendekat hanya kalau
    // elemennya belum kelihatan jelas — dipilih dari panel biasanya memang
    // belum kelihatan, jadi di sini kamera hampir selalu bergerak.
    const box = boxOfGid(gid, mesh);
    showSelectionBox(box);
    focusOnBox(box);
  }

  function selectCategory(cat: string) {
    const mesh = meshesByGlobalId.current.get(
      treeData.find((c) => c.category === cat)?.elements[0]?.globalId ?? ''
    );
    if (isolateOnRef.current && mesh) isolateByCategory(mesh);
    if (mesh) {
      selectedMeshRef.current = mesh;
      const gid = mesh.userData.globalId as string;
      setSelected({ globalId: gid, category: cat, name: nameOf(gid), color: paintOf(gid) });
      showSelectionBox(boxOfGid(gid, mesh));
    }
  }

  function setElementVisible(gid: string, visible: boolean) {
    forEachMeshOfGid(gid, (mesh) => {
      mesh.visible = visible;
    });
    syncSelectionBox();
    setHiddenIds((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(gid);
      else next.add(gid);
      return next;
    });
  }

  function setCategoryVisible(cat: string, visible: boolean) {
    forEachMesh((mesh) => {
      if ((categoryOf(mesh) ?? DEFAULT_CATEGORY) === cat) mesh.visible = visible;
    });
    syncSelectionBox();
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (visible) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  function showAll() {
    forEachMesh((mesh) => {
      mesh.visible = true;
    });
    syncSelectionBox();
    setHiddenCategories(new Set());
    setHiddenIds(new Set());
  }

  // Kebalikan showAll: sembunyikan semuanya supaya user tinggal mencentang satu
  // kategori yang mau dilihat — cara tercepat mengisolasi satu disiplin di
  // antara puluhan ribu objek.
  //
  // Yang ditandai cukup daftar KATEGORI-nya (bukan puluhan ribu GlobalId):
  // di panel Struktur, elemen sudah terhitung tersembunyi kalau kategorinya
  // tersembunyi. `hiddenIds` dikosongkan supaya sekali kategori dicentang,
  // semua isinya langsung ikut tampil.
  function hideAll() {
    forEachMesh((mesh) => {
      mesh.visible = false;
    });
    syncSelectionBox();
    setHiddenCategories(new Set(treeData.map((c) => c.category)));
    setHiddenIds(new Set());
  }

  const btnBase = 'rounded px-2 py-1 text-xs transition-colors';
  const dockBtn = (active: boolean) =>
    `flex h-9 w-9 items-center justify-center rounded border text-base transition-colors ${
      active ? 'border-accent bg-accent text-black' : 'border-white/20 bg-black/50 text-white hover:bg-black/70'
    }`;

  // Hint singkat satu baris. Daftar pintasan lengkap ada di panel "?" supaya
  // tidak memenuhi layar.
  const toolHint =
    tool === 'pan'
      ? t.panHint
      : tool === 'measure'
        ? t.measureHint
        : tool === 'walk'
          ? t.walkHint
          : lockOn
            ? t.lockOnHint
            : t.isolateHint;
  // Bagian bawah-tengah dipakai bergantian oleh toolbar coret, legenda
  // walkthrough, dan hasil ukur — hint disembunyikan supaya tidak bertumpuk.
  const showHint = !markupOn && !walking && measureDist == null;

  return (
    <div ref={rootRef} className="relative h-full w-full overflow-hidden bg-background">
      <div ref={containerRef} className="h-full w-full" />
      {loadState === 'ready' && unmappedMeshes > 0 && (
        <div role="status" className="absolute bottom-10 left-16 right-4 z-20 rounded bg-amber-950/90 p-2 text-xs text-amber-100">
          {locale === 'id'
            ? `${unmappedMeshes} mesh/kelompok belum memiliki identitas elemen. Konversi ulang dari IFC dengan GUID dan tanpa GPU instancing untuk memilih setiap objek dengan benar.`
            : `${unmappedMeshes} meshes/batches have no element identity. Re-export IFC with GUIDs and without GPU instancing for correct per-element selection.`}
        </div>
      )}

      {/* Panel Selection Tree (kiri, collapsible). */}
      <aside
        className={`absolute left-0 top-0 z-30 h-full overflow-hidden border-r border-white/10 bg-black/70 backdrop-blur transition-all duration-300 ${
          treeOpen ? 'w-64' : 'w-0'
        }`}
      >
        {treeOpen && (
          <div className="relative h-full">
            <button
              onClick={() => setTreeOpen(false)}
              className="absolute right-1 top-1.5 z-10 rounded px-1.5 text-sm text-white/60 hover:text-white"
              aria-label="close"
            >
              ✕
            </button>
            <SelectionTree
              categories={treeData}
              strings={tt}
              hiddenCategories={hiddenCategories}
              hiddenIds={hiddenIds}
              selectedId={selected?.globalId ?? null}
              onSelectElement={selectElementById}
              onSelectCategory={selectCategory}
              onToggleCategory={setCategoryVisible}
              onToggleElement={setElementVisible}
              onShowAll={showAll}
              onHideAll={hideAll}
            />
          </div>
        )}
      </aside>

      {/* Dock tool navigasi/anotasi (kiri, geser saat tree dibuka). */}
      <div
        className="absolute top-3 z-30 flex flex-col gap-1 transition-all duration-300"
        style={{ left: treeOpen ? '17rem' : '0.75rem' }}
      >
        <button onClick={() => setTreeOpen((v) => !v)} className={dockBtn(treeOpen)} title={t.tree}>
          ☰
        </button>
        <div className="my-0.5 h-px w-9 bg-white/10" />
        <button onClick={() => selectTool('orbit')} className={dockBtn(tool === 'orbit')} title={t.orbit}>
          ⟲
        </button>
        <button onClick={() => selectTool('pan')} className={dockBtn(tool === 'pan')} title={t.pan}>
          ✋
        </button>
        <button onClick={() => selectTool('measure')} className={dockBtn(tool === 'measure')} title={t.measure}>
          📏
        </button>
        <button onClick={() => selectTool('walk')} className={dockBtn(tool === 'walk')} title={t.walk}>
          🚶
        </button>
        <div className="my-0.5 h-px w-9 bg-white/10" />
        <button
          onClick={() => setSpeedOpen((v) => !v)}
          className={dockBtn(speedOpen)}
          title={`${t.speed} (${speedMult.toFixed(1)}×)`}
        >
          ⚡
        </button>
        {speedOpen && (
          <div className="mt-1 w-36 rounded border border-white/20 bg-black/70 p-2 text-white backdrop-blur">
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="opacity-70">{t.speed}</span>
              <span className="font-semibold text-accent">{speedMult.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={3}
              step={0.1}
              value={speedMult}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                speedMultRef.current = v;
                setSpeedMult(v);
              }}
              className="w-full accent-accent"
            />
          </div>
        )}

        {/* Tampilan: kecerahan & warna latar. */}
        <button
          onClick={() => setDisplayOpen((v) => !v)}
          className={dockBtn(displayOpen)}
          title={t.display}
        >
          💡
        </button>
        {displayOpen && (
          <div className="mt-1 w-40 rounded border border-white/20 bg-black/70 p-2 text-white backdrop-blur">
            <div className="mb-1 flex items-center justify-between text-[11px]">
              <span className="opacity-70">{t.brightness}</span>
              <span className="font-semibold text-accent">{brightness.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min={0.4}
              max={2.5}
              step={0.1}
              value={brightness}
              onChange={(e) => changeBrightness(parseFloat(e.target.value))}
              className="w-full accent-accent"
            />
            <div className="mb-1 mt-2 text-[11px] opacity-70">{t.background}</div>
            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  ['theme', t.bgTheme],
                  ['light', t.bgLight],
                  ['white', t.bgWhite],
                  ['dark', t.bgDark],
                ] as [BgMode, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => changeBg(id)}
                  className={`rounded px-1.5 py-1 text-[10px] transition-colors ${
                    bgMode === id ? 'bg-accent text-black' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={toggleFullscreen}
          className={dockBtn(fullscreen)}
          title={fullscreen ? t.fullscreenExit : t.fullscreen}
        >
          {fullscreen ? '⤡' : '⛶'}
        </button>

        {/* Daftar pintasan — disembunyikan supaya tidak memenuhi layar. */}
        <button onClick={() => setHelpOpen((v) => !v)} className={dockBtn(helpOpen)} title={t.shortcuts}>
          ?
        </button>
        {helpOpen && (
          <div className="mt-1 w-56 rounded border border-white/20 bg-black/70 p-2 text-[10px] leading-relaxed text-white backdrop-blur">
            <div className="mb-1 text-[11px] font-medium">{t.shortcuts}</div>
            <div className="opacity-80">{t.navKeys}</div>
            <div className="mt-1 opacity-80">{t.shiftKeys}</div>
          </div>
        )}
      </div>

      {/* Hint tool aktif — satu baris ringkas di bawah, supaya tidak menabrak
          deretan tombol di kanan atas. */}
      {showHint && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 max-w-[60%] -translate-x-1/2 truncate rounded bg-black/45 px-2 py-0.5 text-center text-[10px] text-white opacity-75 backdrop-blur">
          {toolHint}
        </div>
      )}

      {/* Kontrol mode isolate + tampilan (kanan atas). */}
      <div className="absolute right-3 top-3 z-30 flex max-w-[70%] flex-wrap items-center justify-end gap-2">
        <button
          onClick={toggleIsolate}
          className={`${btnBase} border border-white/20 backdrop-blur ${
            isolateOn ? 'bg-accent text-black' : 'bg-black/50 text-white'
          }`}
          title={t.isolateTip}
        >
          {t.isolate}
        </button>
        <div
          className={`flex overflow-hidden rounded border border-white/20 bg-black/50 backdrop-blur ${
            isolateOn ? '' : 'opacity-40'
          }`}
        >
          <button
            onClick={() => changeMode('object')}
            disabled={!isolateOn}
            className={`${btnBase} ${mode === 'object' ? 'bg-accent text-black' : 'text-white'}`}
          >
            {t.modeObject}
          </button>
          <button
            onClick={() => changeMode('category')}
            disabled={!isolateOn}
            className={`${btnBase} ${mode === 'category' ? 'bg-accent text-black' : 'text-white'}`}
          >
            {t.modeCategory}
          </button>
        </div>
        <button
          onClick={focusModel}
          className={`${btnBase} border border-white/20 bg-black/50 text-white backdrop-blur`}
        >
          {t.focus}
        </button>
        <button
          onClick={toggleLock}
          className={`${btnBase} border border-white/20 backdrop-blur ${
            lockOn ? 'bg-accent text-black' : 'bg-black/50 text-white'
          }`}
          title={t.lockHint}
        >
          {t.lock}
        </button>
        <button
          onClick={() => setSectionOn((v) => !v)}
          className={`${btnBase} border border-white/20 backdrop-blur ${
            sectionOn ? 'bg-accent text-black' : 'bg-black/50 text-white'
          }`}
        >
          {t.section}
        </button>
        <button
          onClick={() => setMarkupOn((v) => !v)}
          className={`${btnBase} border border-white/20 backdrop-blur ${
            markupOn ? 'bg-accent text-black' : 'bg-black/50 text-white'
          }`}
        >
          {t.markup}
        </button>
        <button
          onClick={clearSelection}
          className={`${btnBase} border border-white/20 bg-black/50 text-white backdrop-blur`}
        >
          {t.resetView}
        </button>
      </div>

      {/* Panel section box: 6 slider (X/Y/Z, + & −). */}
      {sectionOn && (
        <div className="absolute right-3 top-14 z-30 w-56 rounded border border-white/20 bg-black/60 p-3 text-white backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">{t.section}</span>
            <button onClick={resetSection} className="text-[11px] opacity-70 hover:opacity-100">
              {t.resetView}
            </button>
          </div>
          {(
            [
              ['xMax', 'X +'],
              ['xMin', 'X −'],
              ['yMax', 'Y +'],
              ['yMin', 'Y −'],
              ['zMax', 'Z +'],
              ['zMin', 'Z −'],
            ] as [keyof typeof clip, string][]
          ).map(([field, label]) => (
            <label key={field} className="mb-1.5 flex items-center gap-2 text-[11px]">
              <span className="w-8 shrink-0 opacity-70">{label}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={clip[field]}
                onChange={(e) => setClip((c) => ({ ...c, [field]: parseFloat(e.target.value) }))}
                className="w-full accent-accent"
              />
            </label>
          ))}
        </div>
      )}

      {/* Readout hasil ukur — tetap tampil walau kamera digerakkan (bukan
          hanya saat tool measure aktif) selama masih ada hasil. */}
      {measureDist != null && (
        <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded border border-white/20 bg-black/70 px-3 py-1.5 text-xs text-white backdrop-blur">
          <div className="flex items-center justify-center">
            <span>
              {t.measureResult}:{' '}
              <span className="font-semibold text-cyan-300">{measureDist.toFixed(2)} m</span>
            </span>
            <button onClick={clearMeasure} className="ml-3 opacity-70 underline hover:opacity-100">
              {t.measureClear}
            </button>
          </div>
          {/* Selisih per sumbu — muncul begitu titik kedua diklik. */}
          {measureDelta && (
            <div
              className="mt-1 flex items-center justify-center gap-3 border-t border-white/15 pt-1 text-[11px]"
              title={t.measureAxisHint}
            >
              {(
                [
                  ['X', measureDelta.x],
                  ['Y', measureDelta.y],
                  ['Z', measureDelta.z],
                ] as [string, number][]
              ).map(([axis, v]) => (
                <span key={axis}>
                  <span className="opacity-50">{axis}</span>{' '}
                  <span className="font-semibold text-cyan-300">{v.toFixed(2)}</span>
                </span>
              ))}
              <span className="opacity-50">m</span>
            </div>
          )}
        </div>
      )}

      {/* Label jarak melayang di titik tengah garis ukur. */}
      <div
        ref={measureLabelElRef}
        className="pointer-events-none absolute left-0 top-0 z-20 rounded bg-cyan-500 px-1.5 py-0.5 text-[11px] font-semibold text-black shadow"
        style={{ display: 'none' }}
      >
        {measureDist != null ? `${measureDist.toFixed(2)} m` : ''}
      </div>

      {/* Legenda kontrol saat mode walkthrough. */}
      {walking && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded border border-white/20 bg-black/70 px-3 py-1.5 text-[11px] text-white backdrop-blur">
          {t.walkControls}
        </div>
      )}

      {/* Overlay status load. */}
      {loadState !== 'ready' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={`rounded px-4 py-2 text-sm ${
              loadState === 'error' ? 'bg-red-500/15 text-red-400' : 'bg-black/50 text-white backdrop-blur'
            }`}
          >
            {loadState === 'error' ? t.loadError : t.loading}
          </div>
        </div>
      )}

      {/* Info + aksi elemen terpilih. Ikut bergeser saat panel Struktur dibuka
          — keduanya di sisi kiri, kalau tidak digeser kotaknya tertutup panel. */}
      {selected && (
        <div
          className="absolute bottom-3 z-30 w-52 rounded bg-black/70 px-2 py-1.5 text-[11px] leading-tight text-white backdrop-blur transition-all duration-300"
          style={{ left: treeOpen ? '17rem' : '0.75rem' }}
        >
          <div className="flex items-baseline gap-1">
            <span className="truncate font-medium" title={selected.category ?? t.noCategory}>
              {selected.category ?? t.noCategory}
            </span>
            {/* Masih ada objek lain di titik klik yang sama — beri tahu, kalau
                tidak user tidak akan tahu Shift bisa menembusnya. */}
            {selected.pickCount != null && selected.pickCount > 1 && (
              <span
                className="ml-auto shrink-0 rounded bg-white/15 px-1 text-[9px] text-white/80"
                title={t.pickCycle}
              >
                {selected.pickIndex}/{selected.pickCount} ⇧
              </span>
            )}
            <span
              className={`shrink-0 text-[9px] opacity-40 ${
                selected.pickCount != null && selected.pickCount > 1 ? '' : 'ml-auto'
              }`}
              title={selected.globalId}
            >
              {selected.globalId}
            </span>
          </div>
          {selected.name && (
            <div className="truncate text-[10px] opacity-70" title={selected.name}>
              {selected.name}
            </div>
          )}

          {/* Warna & sembunyi dalam satu baris — sementara, hanya di layar ini. */}
          <div className="mt-1 flex items-center gap-0.5 border-t border-white/10 pt-1">
            {PAINT_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => applyColor(c)}
                title={t.color}
                className={`h-3 w-3 shrink-0 rounded-full border transition-transform hover:scale-125 ${
                  selected.color === c ? 'border-white ring-1 ring-white' : 'border-white/30'
                }`}
                style={{ backgroundColor: `#${c.toString(16).padStart(6, '0')}` }}
              />
            ))}
            <button
              onClick={resetColor}
              disabled={selected.color == null}
              title={t.colorReset}
              className="shrink-0 text-xs opacity-70 hover:opacity-100 disabled:opacity-25"
            >
              ↺
            </button>
            <button
              onClick={hideSelected}
              title={t.hideObjectNotice}
              className="ml-auto shrink-0 rounded border border-white/20 bg-white/10 px-1.5 py-px text-[10px] transition-colors hover:bg-white/20"
            >
              {t.hideObject}
            </button>
          </div>
        </div>
      )}

      {liveUpdateMessage && (
        <div className="absolute bottom-3 right-3 z-30 rounded bg-black/70 px-3 py-1 text-xs text-white">
          {liveUpdateMessage}
        </div>
      )}

      {/* Pesan sekilas (mis. cara mengembalikan objek yang disembunyikan). */}
      {notice && (
        <div
          className={`absolute right-3 z-30 max-w-[16rem] rounded border border-white/20 bg-black/75 px-3 py-1.5 text-[11px] leading-snug text-white backdrop-blur ${
            liveUpdateMessage ? 'bottom-12' : 'bottom-3'
          }`}
        >
          {notice}
        </div>
      )}

      {/* Layer coret-coret (canvas overlay screen space). */}
      <MarkupOverlay
        active={markupOn}
        strings={locales[locale].markup}
        getViewerCanvas={() => rendererRef.current?.domElement ?? null}
      />
    </div>
  );
}
