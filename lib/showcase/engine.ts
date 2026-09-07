import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { resolveModelIdentity } from '@/lib/modelIdentity.mjs';
import { disciplineOf, humanizeCategory, humanizeName, type Discipline } from './disciplines';
import type { ElementNames } from './elementNames';
import { EYE_LEVEL, entrancePose, isoPose, planPose, type ModelBounds } from './tour';
import type { CameraPose, ElementInfo, ViewMode } from './types';

// Mesin viewer presentasi (gaya "Plant / Field" seperti di video referensi):
// tampilan monokrom abu-abu dengan sorotan hijau limau, lantai grid + bayangan
// lembut, mode ORBIT dan mode JALAN (eye level 1,7 m, WASD, seret untuk
// menoleh), label elemen, minimap, tur kamera beranimasi.
//
// PERFORMA — ini yang membedakan dari viewer teknis:
//  * Model Revit besar punya puluhan ribu elemen; kalau tiap elemen jadi mesh
//    sendiri, tiap frame = puluhan ribu draw call dan navigasi tersendat apa
//    pun GPU-nya. Karena itu geometri disatukan — TAPI dengan dua jalur:
//      - Geometri yang dipakai BERULANG (tipe family yang sama muncul puluhan
//        kali) dirender sebagai InstancedMesh: geometrinya disimpan SEKALI,
//        tiap elemen hanya menyumbang satu matriks 4×4 + satu warna.
//      - Geometri yang unik digabung jadi buffer besar per petak.
//    Ini WAJIB: menyalin geometri berulang ke buffer gabungan pernah membuat
//    model 3,5 juta segitiga mengembang jadi 34 juta segitiga / 78 juta vertex
//    (~3,2 GB) sehingga browser kehilangan konteks WebGL dan layar jadi kosong.
//  * Penggabungan dilakukan SEKALI dan BERTAHAP (dicicil per frame dengan
//    anggaran waktu), jadi halaman tidak pernah membeku dan progresnya
//    kelihatan. Nama elemen yang datang belakangan dari database hanya
//    memperbarui teks — geometri tidak disusun ulang.
//  * Warna per-VERTEX (Uint8 RGBA, 4 byte): sorotan/seleksi/gaya tidak
//    mengganti material, cukup menulis ulang rentang vertex milik elemen itu.
//  * Geometri dipecah jadi PETAK (tile) berdasarkan posisi di denah, jadi
//    petak yang di luar layar dilewati GPU (frustum culling) — penting saat
//    berjalan di dalam bangunan besar. Jumlah draw call tetap belasan.
//  * Memilih objek TIDAK memakai BVH. Membangun BVH untuk model puluhan juta
//    segitiga memblokir halaman bermenit-menit ("Halaman tidak merespons").
//    Gantinya: sinar diuji ke KOTAK BATAS tiap elemen (data yang memang sudah
//    ada, ~0,2 ms untuk puluhan ribu elemen), lalu segitiga hanya diuji pada
//    segelintir elemen kandidat terdekat. Hasilnya sama persis, tanpa
//    pembangunan indeks yang mahal dan tanpa memori tambahan.
//  * Shadow map STATIS: lampu & model tidak bergerak, jadi bayangan dirender
//    sekali (autoUpdate=false), bukan tiap frame.
//
// Sengaja TIDAK memakai React di sini: semua yang berjalan tiap frame (label,
// minimap, tween kamera) dikerjakan langsung ke DOM/canvas supaya React tidak
// re-render 60×/detik. React (ShowcaseViewer.tsx) cukup mendengarkan event.

export type Style = 'mono' | 'original';

export interface EngineStats {
  fps: number;
  eyeHeight: number; // tinggi kamera dari dasar model (m)
  position: [number, number, number];
  mode: ViewMode;
  triangles: number; // segitiga yang digambar
  uniqueTriangles: number; // segitiga unik (geometri berulang dihitung sekali)
  instanced: number; // jumlah kelompok geometri berulang
  // true kalau mesin menurunkan kualitas sendiri karena model terlalu berat.
  lightened: boolean;
}

export interface HoverInfo {
  gid: string;
  x: number;
  y: number;
}

export interface LoadProgress {
  // 0–100 gabungan (unduh + siapkan). `bytes` diisi kalau server tidak
  // mengirim Content-Length, supaya UI bisa menampilkan MB alih-alih persen
  // palsu yang terlihat macet.
  value: number;
  stage: 'download' | 'prepare';
  bytes?: number;
  total?: number;
}

// Ruang yang ditempati panel UI (piksel). Label & tooltip menghindarinya.
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

// Potongan (section box). Setiap sumbu punya bidang + (maks) dan − (min),
// nilai 0..1 relatif terhadap setengah ukuran model: 1 = bidang tepat di tepi
// model (tidak memotong apa pun), 0 = bidang di tengah (memotong separuh).
export interface SectionClip {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

type Events = {
  select: string | null;
  hover: HoverInfo | null;
  stats: EngineStats;
  progress: LoadProgress;
  ready: void;
  error: string;
  mode: ViewMode;
  tweenEnd: void;
  userInput: void;
};

const DEFAULT_CATEGORY = 'Default';
const NON_PHYSICAL = new Set(['IFCSPACE', 'IFCOPENINGELEMENT', 'IFCANNOTATION', 'IFCGRID', 'IFCGRIDAXIS', 'IFCSITE']);
const SHEER_OPACITY = 0.35;
const LABEL_MAX = 12;
const LABEL_CANDIDATES = 90;
const MINIMAP_RECTS = 900;
// Anggaran waktu per potongan penggabungan (ms). Penggabungan dijadwalkan
// SENDIRI (setTimeout), bukan dari render loop: di mesin/GPU lambat satu frame
// bisa makan ratusan ms, dan kalau penggabungan menumpang frame, prosesnya
// merayap. Selama menyiapkan model, menggambar sengaja direm (lihat
// MERGE_RENDER_EVERY_MS) supaya hampir semua waktu dipakai menyiapkan.
const MERGE_BUDGET_MS = 8;
// Material sumber GLTF: warna + tekstur opsional. Tekstur tidak dipakai
// (viewer memakai warna vertex/instans), hanya jadi penanda untuk meredam.
type SurfaceMaterial = (THREE.MeshStandardMaterial & { map?: THREE.Texture | null }) | undefined;
const WHITE = new THREE.Color(0xffffff);
const MERGE_RENDER_EVERY_MS = 260;
// Di atas ambang ini bayangan dimatikan otomatis: lintasan bayangan
// menggandakan kerja vertex, dan pada model sebesar ini itu yang bikin
// navigasi tersendat. Bisa dinyalakan lagi dari panel Tampilan.
// Turun dari 6 juta: laporan lapangan "3D berat saat navigasi" datang pada
// model yang belum menyentuh ambang lama, dan bayangan adalah biaya terbesar
// yang bisa dilepas tanpa mengubah bentuk tampilan.
const HEAVY_TRIANGLES = 3_000_000;
// Kandidat yang diuji per klik (setelah diurutkan berdasarkan jarak kotak).
const PICK_CANDIDATES = 128;
// Elemen dengan segitiga sebanyak ini tidak diuji per segitiga — jarak dari
// kotak batasnya sudah cukup akurat dan jauh lebih murah.
const PICK_EXACT_MAX_TRIS = 60_000;
// Klik juga diberi tenggat. Dulu hanya hover yang dibatasi (6 ms) sementara
// klik berjalan sampai selesai — di model besar, klik di titik yang sial
// (menembus tumpukan kotak batas besar) membekukan frame ratusan ms.
// 24 ms tetap terasa instan, tapi membatasi kerja per klik.
const PICK_CLICK_BUDGET_MS = 24;
// Jaring pengaman kualitas: FPS digambar di bawah ini berturut-turut
// menurunkan kualitas bertahap (bayangan dulu, lalu resolusi). Dulu ambangnya
// 20 FPS & butuh 3 sampel — di 25–35 FPS ("patah-patah tapi tidak pernah
// < 20") dia diam saja. Sekarang turun bertahap mulai dari sini.
const SLOW_FPS = 45;
const PARTIAL_UPLOAD_MAX = 300;

const COLORS = {
  mono: 0xd8dcdf,
  monoGlass: 0xc2d3de,
  highlight: 0x9fdc46,
  selected: 0xd6ff5a,
  ground: 0xe7eaed,
  grid1: 0xbcc5cc,
  grid2: 0xd2d8dd,
  fog: 0xdfe5ea,
};
const MONO_GLASS_ALPHA = 82; // 0–255
const HIGHLIGHT_GLASS_ALPHA = 153;

// Di mana geometri sebuah elemen berada.
//   kind 0 = disalin ke buffer gabungan (petak) `this.parts[part]`
//   kind 1 = satu instans pada `this.instGroups[group]`
type Placement =
  | { kind: 0; part: number; vStart: number; vCount: number; tStart: number; tCount: number }
  | { kind: 1; group: number; instance: number };

interface ElementRecord extends ElementInfo {
  eid: number;
  ranges: Placement[];
  hasRealName: boolean;
  sheer: boolean;
  embeddedName: string | null;
  embeddedCategory: string | null;
}

interface MergedPart {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  color: THREE.BufferAttribute; // Uint8 RGBA (normalized) — warna tampil
  baseOriginal: Uint8Array; // warna material asli per vertex
  sheer: boolean;
  min: THREE.Vector3;
  max: THREE.Vector3;
}

// Satu geometri berulang + satu material -> satu InstancedMesh.
interface InstGroup {
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry; // atribut dipakai bersama geometri sumber
  base: THREE.Color; // warna material asli (sama untuk semua instans)
  sheer: boolean;
  tris: number; // segitiga per instans
  matrices: THREE.Matrix4[]; // untuk uji sinar saat memilih objek
  filled: number;
}

// Satu penempatan yang menunggu diproses (disalin atau dijadikan instans).
interface Piece {
  rec: ElementRecord;
  instanced: boolean;
  part: number; // slot petak (kind 0) — diisi setelah slot dibuat
  groupIds: number[]; // indeks InstGroup (kind 1)
  geometry: THREE.BufferGeometry | null;
  matrix: THREE.Matrix4;
  vCount: number;
  groups: { start: number; count: number; color: [number, number, number, number] }[];
}

function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function u8(hex: number): [number, number, number] {
  const c = new THREE.Color(hex);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

export class ShowcaseEngine {
  readonly container: HTMLElement;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;

  elements: ElementInfo[] = [];
  bounds: ModelBounds = { min: [-1, -1, -1], max: [1, 1, 1] };
  groundY = 0;
  mode: ViewMode = 'orbit';
  style: Style = 'mono';
  labelsOn = false;
  walkSpeed = 3; // m/s
  planActive = false;
  sectionOn = false;
  sectionClip: SectionClip = { xMin: 1, xMax: 1, yMin: 1, yMax: 1, zMin: 1, zMax: 1 };

  private records = new Map<string, ElementRecord>();
  private recordList: ElementRecord[] = [];
  // Kotak batas tiap elemen dalam satu array datar (6 angka per elemen) —
  // dipakai uji sinar saat memilih objek, tanpa alokasi objek per klik.
  private recordBoxes = new Float32Array(0);
  private parts: MergedPart[] = [];
  private instGroups: InstGroup[] = [];
  private triangles = 0; // segitiga yang benar-benar digambar
  private uniqueTriangles = 0; // segitiga unik (tanpa pengulangan instans)
  private slowFrames = 0;
  private autoLightened = false;
  private modelGroup: THREE.Group | null = null;
  private names: ElementNames | null = null;
  private highlighted = new Set<string>();
  private selectedGid: string | null = null;
  private listeners = new Map<keyof Events, Set<(p: never) => void>>();
  private disposed = false;
  private insets: Insets = { left: 16, right: 16, top: 70, bottom: 90 };

  private matOpaque = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.02 });
  private matSheer = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.4,
    transparent: true,
    depthWrite: false,
  });
  // Untuk InstancedMesh warna datang dari instanceColor (per instans), bukan
  // per vertex — jadi materialnya terpisah dan berwarna putih.
  private matInst = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0.02 });
  private matInstSheer = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.4,
    transparent: true,
    opacity: MONO_GLASS_ALPHA / 255,
    depthWrite: false,
  });
  // 6 bidang potong (section box), urutan: X+, X−, Y+, Y−, Z+, Z−. Dipasang
  // PER MATERIAL (bukan global) supaya lantai & grid tidak ikut terpotong.
  private clipPlanes: THREE.Plane[] = [
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
    new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), 0),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  ];
  private clipMaterials: THREE.Material[] = [];
  // Bingkai kotak potong di 3D (gaya section box Navisworks/Mode teknis):
  // garis tepi + sudut tebal, mengikuti posisi 6 slider. Dipasang ke scene
  // (bukan modelGroup) supaya luput dari raycast pemilihan.
  private sectionBox: THREE.LineSegments | null = null;
  private cMono = u8(COLORS.mono);
  private cMonoGlass = u8(COLORS.monoGlass);
  private cHighlight = u8(COLORS.highlight);
  private cSelected = u8(COLORS.selected);

  private ground: THREE.Mesh | null = null;
  private grid: THREE.GridHelper | null = null;
  private keyLight: THREE.DirectionalLight;
  private shadowsWanted = true;

  // --- penggabungan bertahap ---
  private mergeChannel: MessageChannel | null = null;
  private lastMergeRender = 0;
  private merge: {
    token: number;
    pieces: Piece[];
    pi: number;
    vertexCursor: number;
    groupCursor: number;
    indexCursor: number;
    paintCursor: number;
    vOff: number[];
    iOff: number[];
    geomUse: Map<THREE.BufferGeometry, number>;
  } | null = null;
  private loadToken = 0;

  // --- kamera / animasi ---
  private tween: { from: CameraPose; to: CameraPose; t: number; dur: number; onDone?: () => void } | null = null;
  private yaw = 0;
  private pitch = 0;
  private eyeOffset = EYE_LEVEL;
  private keys = new Set<string>();
  private drag: { x: number; y: number; moved: boolean; button: number } | null = null;
  private downAt = { x: 0, y: 0 };
  private clock = new THREE.Clock();
  private raf = 0;
  private renderDirty = true;
  private renderedPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
  private renderedQuaternion = new THREE.Quaternion();
  private renderedFrames = 0;
  private renderedTime = 0;
  private frames = 0;
  private lastStats = 0;
  private lastHover = 0;
  private raycaster = new THREE.Raycaster();
  private hoverGid: string | null = null;
  // Buffer pakai-ulang untuk uji sinar (hindari alokasi tiap klik/hover).
  private tmpA = new THREE.Vector3();
  private tmpB = new THREE.Vector3();
  private tmpC = new THREE.Vector3();
  private tmpHit = new THREE.Vector3();
  private tmpMat = new THREE.Matrix4();
  private tmpRay = new THREE.Ray();
  private pickCands: number[] = [];

  // --- label & minimap (DOM langsung) ---
  private labelLayer: HTMLDivElement;
  private labelPool: HTMLDivElement[] = [];
  private labelCandidates: ElementRecord[] = [];
  private minimap: HTMLCanvasElement | null = null;
  private minimapRects: { x: number; z: number; w: number; d: number; gid: string }[] = [];
  private minimapMarkers: { x: number; z: number; label: string }[] = [];
  private lastMinimap = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 5000);
    this.camera.position.set(30, 20, 30);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    // Antialias MSAA dimatikan: pada canvas besar biayanya besar, padahal
    // model sudah digabung & monokrom — tepi bergigi nyaris tidak terlihat,
    // sedangkan 4× MSAA + DPR tinggi adalah biaya per frame yang paling
    // terasa saat navigasi. Pixel ratio juga dibatasi lebih rendah (1,25):
    // layar retina dengan DPR 2–3 berarti 4–9× piksel yang harus di-shading,
    // tidak sepadan untuk presentasi.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // statis — lihat catatan di atas
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'sc-label-layer';
    container.appendChild(this.labelLayer);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // jangan tembus lantai
    this.controls.addEventListener('start', () => {
      this.cancelTween();
      this.controls.autoRotate = false;
      this.emit('userInput', undefined);
    });

    // Pencahayaan lembut: hemisphere langit-tanah + key light bayangan + fill.
    const hemi = new THREE.HemisphereLight(0xf4f7fa, 0xb9c0c6, 1.15);
    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    this.keyLight.position.set(40, 80, 30);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.bias = -0.0008;
    this.keyLight.shadow.normalBias = 0.03;
    const fill = new THREE.DirectionalLight(0xdde8f0, 0.5);
    fill.position.set(-50, 30, -40);
    this.scene.add(hemi, ambient, this.keyLight, this.keyLight.target, fill);
    this.scene.fog = new THREE.Fog(COLORS.fog, 400, 1500);

    // Kalau browser sampai melepas konteks WebGL (mis. alokasi buffer gagal
    // karena model terlalu berat), layar jadi kosong tanpa penjelasan. Tangkap
    // dan laporkan supaya UI bisa memberi tahu + menawarkan Mode teknis.
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.error('WebGL context lost');
      this.emit('error', 'context-lost');
    });

    this.bindInput();
    this.loop();
  }

  // ------------------------------------------------------------------ events
  on<K extends keyof Events>(ev: K, cb: (p: Events[K]) => void): () => void {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev)!.add(cb as (p: never) => void);
    return () => this.listeners.get(ev)?.delete(cb as (p: never) => void);
  }
  private emit<K extends keyof Events>(ev: K, p: Events[K]) {
    this.listeners.get(ev)?.forEach((cb) => (cb as (p: Events[K]) => void)(p));
  }

  setInsets(i: Insets) {
    this.insets = i;
  }

  // ------------------------------------------------------------------ load
  load(url: string) {
    const token = ++this.loadToken;
    this.releaseMergeSources();
    this.merge = null;
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    loader.setDRACOLoader(draco);
    this.emit('progress', { value: 0, stage: 'download' });
    loader.load(
      url,
      (gltf) => {
        draco.dispose();
        if (this.disposed || token !== this.loadToken) {
          this.disposeSource(gltf.scene, true);
          return;
        }
        try {
          this.installModel(gltf.scene, gltf.parser, token);
        } catch (err) {
          console.error('Gagal menyiapkan model:', err);
          this.emit('error', 'prepare');
        } finally {
          // Viewer gabungan memakai warna vertex, tidak pernah tekstur sumber.
          this.disposeSource(gltf.scene, false);
        }
      },
      (ev) => {
        if (this.disposed || token !== this.loadToken) return;
        // Tanpa Content-Length (stream dari Drive/Storage) persentase tidak
        // bisa dihitung — kirim jumlah byte supaya UI menampilkan MB.
        if (ev.total > 0) this.emit('progress', { value: (ev.loaded / ev.total) * 55, stage: 'download', bytes: ev.loaded, total: ev.total });
        else this.emit('progress', { value: 0, stage: 'download', bytes: ev.loaded });
      },
      (err) => {
        draco.dispose();
        if (this.disposed || token !== this.loadToken) return;
        console.error('Gagal load GLB:', url, err);
        this.emit('error', 'load');
      }
    );
  }

  private installModel(root: THREE.Object3D, parser: { associations: Map<unknown, unknown>; json: unknown }, token: number) {
    this.clearModel();

    // Center model ke origin (model IFC sering berkoordinat jauh dari 0).
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.position.sub(center);
    root.updateMatrixWorld(true);
    const size = box.getSize(new THREE.Vector3());
    const half = size.clone().multiplyScalar(0.5);
    this.bounds = { min: [-half.x, -half.y, -half.z], max: [half.x, half.y, half.z] };
    this.groundY = -half.y;

    this.buildGround();
    this.fitLights();

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    this.camera.near = Math.max(maxDim / 2000, 0.05);
    this.camera.far = Math.max(maxDim * 20, 500);
    this.camera.updateProjectionMatrix();
    (this.scene.fog as THREE.Fog).near = maxDim * 3;
    (this.scene.fog as THREE.Fog).far = maxDim * 9;
    this.walkSpeed = THREE.MathUtils.clamp(maxDim / 25, 2, 12);

    // Kamera ditaruh jauh dulu; animasi masuknya baru dijalankan setelah model
    // lengkap (kalau dijalankan sekarang, animasinya patah-patah karena
    // menggambar sedang direm demi penggabungan).
    const far = isoPose(this.bounds, [1.6, 1.6, 1.6]);
    const target = isoPose(this.bounds);
    far.position = far.position.map((v, i) => v + (v - target.position[i]) * 0.8) as [number, number, number];
    this.setPoseImmediate(far);

    this.beginMerge(root, parser, token);
  }

  // Pass 1 (murah): kumpulkan penempatan, putuskan mana yang jadi INSTANS
  // (geometri berulang) dan mana yang digabung, lalu siapkan buffer.
  private beginMerge(root: THREE.Object3D, parser: { associations: Map<unknown, unknown>; json: unknown }, token: number) {
    const pieces: Piece[] = [];
    const counts = new Map<number, { v: number; i: number }>(); // slot petak -> jumlah
    const white = new THREE.Color(0xffffff);

    // Berapa kali tiap geometri dipakai? Ini kunci: geometri yang dipakai
    // berulang TIDAK boleh disalin berkali-kali ke buffer gabungan.
    const useCount = new Map<THREE.BufferGeometry, number>();
    const meshes: { mesh: THREE.Mesh; gid: string; matrix: THREE.Matrix4 }[] = [];
    const instMatrix = new THREE.Matrix4();
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const geometry = child.geometry as THREE.BufferGeometry;
      if (!geometry?.getAttribute('position')) return;
      const inst = child as THREE.InstancedMesh;
      if (inst.isInstancedMesh) {
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, instMatrix);
          meshes.push({
            mesh: child,
            gid: `unmapped:${child.uuid}#${i}`,
            matrix: new THREE.Matrix4().multiplyMatrices(child.matrixWorld, instMatrix),
          });
          useCount.set(geometry, (useCount.get(geometry) ?? 0) + 1);
        }
        return;
      }
      let gid = child.userData.globalId as string | undefined;
      if (!gid) {
        const identity = resolveModelIdentity(child, root, parser as never);
        gid = identity?.globalId ?? `unmapped:${child.uuid}`;
        child.userData.globalId = gid;
        if (identity) child.userData.identity = identity;
      }
      meshes.push({ mesh: child, gid, matrix: child.matrixWorld.clone() });
      useCount.set(geometry, (useCount.get(geometry) ?? 0) + 1);
    });

    // Ukuran grid petak: sekitar 1.500 potongan per petak, maksimum 6×6.
    const b = this.bounds;
    const spanX = b.max[0] - b.min[0] || 1;
    const spanZ = b.max[2] - b.min[2] || 1;
    const grid = THREE.MathUtils.clamp(Math.ceil(Math.sqrt(meshes.length / 1500)), 1, 6);
    const centroid = new THREE.Vector3();
    const sample = new THREE.Vector3();

    // Kelompok instans: satu per (geometri, grup material).
    const groupKey = new Map<string, number>();
    const instCount = new Map<number, number>();

    for (const { mesh, gid, matrix } of meshes) {
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const pos = geometry.getAttribute('position');
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();

      let rec = this.records.get(gid);
      if (!rec) {
        const emb = mesh.userData.identity as { name: string | null; category: string | null } | undefined;
        rec = this.makeRecord(gid, emb?.name ?? null, emb?.category ?? null);
        rec.sheer = this.isSheerMaterial(mesh.material);
        this.records.set(gid, rec);
        rec.eid = this.recordList.length;
        this.recordList.push(rec);
      }

      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const indexTotal = geometry.index ? geometry.index.count : pos.count;
      const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: indexTotal, materialIndex: 0 }];
      const uses = useCount.get(geometry) ?? 1;
      // Dijadikan instans kalau dipakai berulang — ambangnya rendah untuk
      // geometri besar, karena di situ penggandaan paling mahal.
      const instanced = uses >= 4 || (uses >= 2 && indexTotal / 3 > 2000);

      // Grup material yang memakai material sama digabung jadi SATU kelompok
      // instans. Tanpa ini satu kotak dengan enam grup jadi enam draw call.
      const byMaterial = new Map<string, { m: SurfaceMaterial; groups: typeof groups }>();
      const outGroups: Piece['groups'] = [];
      const groupIds: number[] = [];
      for (const g of groups) {
        const gCount = g.count === Infinity ? indexTotal - g.start : Math.min(g.count, indexTotal - g.start);
        if (gCount <= 0) continue;
        const m = (mats[g.materialIndex ?? 0] ?? mats[0]) as SurfaceMaterial;
        if (instanced) {
          const key = m?.uuid ?? 'x';
          let bucket = byMaterial.get(key);
          if (!bucket) {
            bucket = { m, groups: [] };
            byMaterial.set(key, bucket);
          }
          bucket.groups.push({ ...g, count: gCount });
          continue;
        }
        const [r, gg, bl, a] = this.surfaceColor(m, rec.sheer);
        outGroups.push({ start: g.start, count: gCount, color: [r, gg, bl, a] });
      }

      for (const [key, bucket] of byMaterial) {
        const total = bucket.groups.reduce((sum, g) => sum + g.count, 0);
        const gkey = `${geometry.uuid}|${key}`;
        let gi = groupKey.get(gkey);
        if (gi === undefined) {
          gi = this.instGroups.length;
          groupKey.set(gkey, gi);
          const c = bucket.m?.color ?? white;
          // Tekstur tidak ikut (warna saja); material bertekstur biasanya putih
          // -> diredam sedikit supaya tidak menyilaukan.
          const tint = bucket.m?.map ? 0.8 : 1;
          // Sub-geometri: atribut DIPAKAI BERSAMA geometri sumber (tidak
          // disalin), hanya index-nya yang dipotong sesuai grup material.
          const sub = new THREE.BufferGeometry();
          sub.setAttribute('position', geometry.getAttribute('position'));
          sub.setAttribute('normal', geometry.getAttribute('normal'));
          const src = geometry.index;
          const idx = new Uint32Array(total);
          let w = 0;
          for (const g of bucket.groups) {
            for (let k = 0; k < g.count; k++) idx[w++] = src ? src.getX(g.start + k) : g.start + k;
          }
          sub.setIndex(new THREE.BufferAttribute(idx, 1));
          sub.computeBoundingBox();
          sub.computeBoundingSphere();
          this.instGroups.push({
            mesh: null as unknown as THREE.InstancedMesh, // diisi setelah jumlah instans diketahui
            geometry: sub,
            base: new THREE.Color(c.r * tint, c.g * tint, c.b * tint),
            sheer: rec.sheer,
            tris: total / 3,
            matrices: [],
            filled: 0,
          });
        }
        groupIds.push(gi);
        instCount.set(gi, (instCount.get(gi) ?? 0) + 1);
      }
      if (outGroups.length === 0 && groupIds.length === 0) continue;
      rec.meshCount++;

      let slot = 0;
      if (!instanced) {
        // Petak dari perkiraan titik tengah — cukup beberapa vertex contoh.
        centroid.set(0, 0, 0);
        const step = Math.max(1, Math.floor(pos.count / 8));
        let taken = 0;
        for (let k = 0; k < pos.count; k += step) {
          centroid.add(sample.fromBufferAttribute(pos, k));
          taken++;
        }
        if (taken > 0) centroid.multiplyScalar(1 / taken).applyMatrix4(matrix);
        const tx = THREE.MathUtils.clamp(Math.floor(((centroid.x - b.min[0]) / spanX) * grid), 0, grid - 1);
        const tz = THREE.MathUtils.clamp(Math.floor(((centroid.z - b.min[2]) / spanZ) * grid), 0, grid - 1);
        slot = (tz * grid + tx) * 2 + (rec.sheer ? 1 : 0);
        let count = counts.get(slot);
        if (!count) {
          count = { v: 0, i: 0 };
          counts.set(slot, count);
        }
        count.v += pos.count;
        for (const g of outGroups) count.i += g.count;
      }
      pieces.push({
        rec,
        instanced,
        part: slot,
        groupIds,
        geometry,
        matrix,
        vCount: pos.count,
        groups: outGroups,
      });
    }

    // --- buat InstancedMesh setelah jumlah instans diketahui
    const group = new THREE.Group();
    this.uniqueTriangles = 0;
    for (let gi = 0; gi < this.instGroups.length; gi++) {
      const ig = this.instGroups[gi];
      const n = instCount.get(gi) ?? 0;
      const mesh = new THREE.InstancedMesh(ig.geometry, ig.sheer ? this.matInstSheer : this.matInst, Math.max(n, 1));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(n, 1) * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = !ig.sheer;
      mesh.receiveShadow = !ig.sheer;
      mesh.renderOrder = ig.sheer ? 1 : 0;
      mesh.frustumCulled = false; // dinyalakan setelah semua instans terisi
      ig.mesh = mesh;
      group.add(mesh);
      this.uniqueTriangles += ig.tris;
    }

    // --- buat buffer gabungan untuk geometri unik
    const slotIndex = new Map<number, number>();
    for (const [slot, total] of Array.from(counts.entries()).sort((a, c) => a[0] - c[0])) {
      if (total.v === 0) continue;
      slotIndex.set(slot, this.parts.length);
      const sheer = slot % 2 === 1;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total.v * 3), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(total.v * 3), 3));
      const color = new THREE.BufferAttribute(new Uint8Array(total.v * 4), 4, true);
      color.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('color', color);
      geometry.setIndex(new THREE.BufferAttribute(total.v > 65535 ? new Uint32Array(total.i) : new Uint16Array(total.i), 1));
      geometry.setDrawRange(0, 0);
      const r = Math.hypot(...this.bounds.max.map((v, i) => v - this.bounds.min[i])) / 2 || 1;
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), r);

      const mesh = new THREE.Mesh(geometry, sheer ? this.matSheer : this.matOpaque);
      mesh.castShadow = !sheer;
      mesh.receiveShadow = !sheer;
      mesh.frustumCulled = false; // dinyalakan setelah bola pembatas benar
      mesh.renderOrder = sheer ? 1 : 0;
      group.add(mesh);
      this.parts.push({
        mesh,
        geometry,
        color,
        baseOriginal: new Uint8Array(total.v * 4),
        sheer,
        min: new THREE.Vector3(Infinity, Infinity, Infinity),
        max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
      });
      this.uniqueTriangles += total.i / 3;
    }
    for (const piece of pieces) if (!piece.instanced) piece.part = slotIndex.get(piece.part) ?? 0;

    this.scene.add(group);
    this.modelGroup = group;
    this.merge = {
      token,
      pieces,
      pi: 0,
      vertexCursor: 0,
      groupCursor: 0,
      indexCursor: 0,
      paintCursor: 0,
      vOff: new Array(this.parts.length).fill(0),
      iOff: new Array(this.parts.length).fill(0),
      geomUse: useCount,
    };
    this.emit('progress', { value: 55, stage: 'prepare' });
    this.scheduleMerge();
  }

  // Penjadwal potongan penggabungan. Memakai MessageChannel, BUKAN
  // setTimeout(0): timer bersarang diklem ~4 ms oleh browser, dan dengan
  // potongan 8 ms klem itu sendiri memakan sekitar sepertiga waktu penyiapan.
  // Pembatalan tidak lewat timer — cukup `this.merge = null`, yang dicek di
  // sini dan di stepMerge().
  private scheduleMerge() {
    if (!this.mergeChannel) {
      this.mergeChannel = new MessageChannel();
      this.mergeChannel.port1.onmessage = () => {
        if (this.disposed || !this.merge) return;
        this.stepMerge();
        if (this.merge) this.scheduleMerge();
      };
    }
    this.mergeChannel.port2.postMessage(0);
  }

  // Pass 2, dicicil. Instans hanya perlu satu matriks (murah); geometri unik
  // disalin vertex demi vertex ke buffer gabungan.
  private stepMerge() {
    const st = this.merge;
    if (!st || st.token !== this.loadToken) return;
    const t0 = performance.now();
    const v = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();
    const tmpBox = new THREE.Box3();
    // Awal potongan ini per bagian — dipakai untuk upload PARSIAL ke GPU.
    const sliceV = st.vOff.slice();
    const sliceI = st.iOff.slice();

    mergeSlice: while (st.pi < st.pieces.length) {
      const piece = st.pieces[st.pi];

      if (piece.instanced) {
        // Hanya rentang milik potongan ini yang dicat — mengecat ulang seluruh
        // rentang elemen tiap potongan bikin penyiapan kuadratik.
        const fresh: Placement[] = [];
        for (const gi of piece.groupIds) {
          const ig = this.instGroups[gi];
          const i = ig.filled++;
          ig.mesh.setMatrixAt(i, piece.matrix);
          ig.matrices.push(piece.matrix);
          const placement: Placement = { kind: 1, group: gi, instance: i };
          piece.rec.ranges.push(placement);
          fresh.push(placement);
          // Kotak batas elemen dari kotak geometri yang ditransformasi —
          // tanpa menyentuh satu pun vertex.
          if (ig.geometry.boundingBox) {
            tmpBox.copy(ig.geometry.boundingBox).applyMatrix4(piece.matrix);
            piece.rec.min = [
              Math.min(piece.rec.min[0], tmpBox.min.x),
              Math.min(piece.rec.min[1], tmpBox.min.y),
              Math.min(piece.rec.min[2], tmpBox.min.z),
            ];
            piece.rec.max = [
              Math.max(piece.rec.max[0], tmpBox.max.x),
              Math.max(piece.rec.max[1], tmpBox.max.y),
              Math.max(piece.rec.max[2], tmpBox.max.z),
            ];
          }
        }
        this.paintRecord(piece.rec, fresh);
        st.pi++;
        if (performance.now() - t0 >= MERGE_BUDGET_MS) break;
        continue;
      }

      const part = this.parts[piece.part];
      const geometry = piece.geometry;
      if (!part || !geometry) {
        st.pi++;
        continue;
      }
      const pos = geometry.getAttribute('position');
      const nor = geometry.getAttribute('normal');
      const src = geometry.index;
      const vOff = st.vOff[piece.part];
      const iOff = st.iOff[piece.part];
      const position = part.geometry.getAttribute('position').array as Float32Array;
      const normal = part.geometry.getAttribute('normal').array as Float32Array;
      const index = part.geometry.index!.array as Uint32Array | Uint16Array;
      const rec = piece.rec;

      normalMatrix.getNormalMatrix(piece.matrix);
      const mirrored = piece.matrix.determinant() < 0;
      for (let k = st.vertexCursor; k < piece.vCount; k++) {
        v.fromBufferAttribute(pos, k).applyMatrix4(piece.matrix);
        const o = (vOff + k) * 3;
        position[o] = v.x;
        position[o + 1] = v.y;
        position[o + 2] = v.z;
        if (v.x < rec.min[0]) rec.min[0] = v.x;
        if (v.y < rec.min[1]) rec.min[1] = v.y;
        if (v.z < rec.min[2]) rec.min[2] = v.z;
        if (v.x > rec.max[0]) rec.max[0] = v.x;
        if (v.y > rec.max[1]) rec.max[1] = v.y;
        if (v.z > rec.max[2]) rec.max[2] = v.z;
        part.min.min(v);
        part.max.max(v);
        v.fromBufferAttribute(nor, k).applyMatrix3(normalMatrix).normalize();
        normal[o] = v.x;
        normal[o + 1] = v.y;
        normal[o + 2] = v.z;
        st.vertexCursor = k + 1;
        if ((k & 1023) === 1023 && performance.now() - t0 >= MERGE_BUDGET_MS) break mergeSlice;
      }

      let gi = iOff;
      for (let g = 0; g < st.groupCursor; g++) gi += piece.groups[g].count;
      for (; st.groupCursor < piece.groups.length; st.groupCursor++) {
        const g = piece.groups[st.groupCursor];
        const [r, gg, bl, a] = g.color;
        for (let k = st.indexCursor; k < g.count; k++) {
          const vi = (src ? src.getX(g.start + k) : g.start + k) + vOff;
          // Memanggang pencerminan ke posisi membalik urutan putar segitiga.
          // Tukar dua index terakhir supaya muka depan tetap menghadap keluar.
          const dst = mirrored ? k - (k % 3) + (k % 3 === 1 ? 2 : k % 3 === 2 ? 1 : 0) : k;
          index[gi + dst] = vi;
          const co = vi * 4;
          part.baseOriginal[co] = r;
          part.baseOriginal[co + 1] = gg;
          part.baseOriginal[co + 2] = bl;
          part.baseOriginal[co + 3] = a;
          st.indexCursor = k + 1;
          if ((k & 4095) === 4095 && performance.now() - t0 >= MERGE_BUDGET_MS) break mergeSlice;
        }
        st.indexCursor = 0;
        gi += g.count;
      }

      // Cat hanya potongan baru ini, sekali. Mengecat ulang semua rentang
      // elemen Revit yang sama bikin penyiapan kuadratik terhadap jumlah mesh.
      while (st.paintCursor < piece.vCount) {
        const count = Math.min(4096, piece.vCount - st.paintCursor);
        this.paintRecord(rec, [{
          kind: 0, part: piece.part, vStart: vOff + st.paintCursor, vCount: count,
          tStart: 0, tCount: 0,
        }]);
        st.paintCursor += count;
        if (performance.now() - t0 >= MERGE_BUDGET_MS) break mergeSlice;
      }
      rec.ranges.push({
        kind: 0,
        part: piece.part,
        vStart: vOff,
        vCount: piece.vCount,
        tStart: iOff / 3,
        tCount: (gi - iOff) / 3,
      });
      st.vertexCursor = st.groupCursor = st.indexCursor = st.paintCursor = 0;

      st.vOff[piece.part] = vOff + piece.vCount;
      st.iOff[piece.part] = gi;
      part.geometry.setDrawRange(0, gi);
      piece.geometry = null;

      st.pi++;
      if (performance.now() - t0 > MERGE_BUDGET_MS) break;
    }

    // Upload PARSIAL: tanpa ini `needsUpdate` mengirim ulang SELURUH buffer
    // (bisa ratusan MB) pada setiap potongan.
    for (let part = 0; part < this.parts.length; part++) {
      const p = this.parts[part];
      if (!p) continue;
      const vFrom = sliceV[part];
      const vCount = st.vOff[part] - vFrom;
      const iFrom = sliceI[part];
      const iCount = st.iOff[part] - iFrom;
      if (vCount <= 0 && iCount <= 0) continue;
      if (vCount > 0) {
        const pos = p.geometry.getAttribute('position') as THREE.BufferAttribute;
        const nor = p.geometry.getAttribute('normal') as THREE.BufferAttribute;
        pos.addUpdateRange(vFrom * 3, vCount * 3);
        pos.needsUpdate = true;
        nor.addUpdateRange(vFrom * 3, vCount * 3);
        nor.needsUpdate = true;
        p.color.addUpdateRange(vFrom * 4, vCount * 4);
        p.color.needsUpdate = true;
      }
      if (iCount > 0) {
        const idx = p.geometry.index as THREE.BufferAttribute;
        idx.addUpdateRange(iFrom, iCount);
        idx.needsUpdate = true;
      }
    }
    for (const ig of this.instGroups) {
      ig.mesh.instanceMatrix.needsUpdate = true;
      if (ig.mesh.instanceColor) ig.mesh.instanceColor.needsUpdate = true;
    }

    if (st.pi >= st.pieces.length) this.finishMerge();
    else this.emit('progress', { value: 55 + (st.pi / st.pieces.length) * 44, stage: 'prepare' });
  }

  private finishMerge() {
    this.merge = null;

    // Bola pembatas per petak & per kelompok instans dihitung dari isi
    // sebenarnya, lalu frustum culling dinyalakan.
    this.triangles = 0;
    for (const p of this.parts) {
      this.triangles += p.geometry.drawRange.count / 3;
      if (!Number.isFinite(p.min.x)) continue;
      const center = p.min.clone().add(p.max).multiplyScalar(0.5);
      p.geometry.boundingSphere = new THREE.Sphere(center, p.min.distanceTo(p.max) / 2 || 1);
      p.geometry.boundingBox = new THREE.Box3(p.min.clone(), p.max.clone());
      p.mesh.frustumCulled = true;
    }
    for (const ig of this.instGroups) {
      ig.mesh.count = ig.filled; // sisa slot (kalau ada) tidak digambar
      ig.mesh.computeBoundingSphere();
      ig.mesh.frustumCulled = true;
      this.triangles += ig.tris * ig.filled;
    }

    this.finishIndex();
    this.renderDirty = true;

    // Pasang material model yang akan menerima bidang potong (kecuali lantai
    // & grid). Setelah ini, refreshClipping() menerapkan state saat ini.
    this.clipMaterials = [this.matOpaque, this.matSheer, this.matInst, this.matInstSheer];
    this.refreshClipping();

    if (this.triangles > HEAVY_TRIANGLES && this.shadowsWanted) {
      this.setShadows(false);
      this.autoLightened = true;
    } else if (this.triangles > 1_500_000) {
      // Peta bayangan dirender sekali, tapi sekali itu melewati SELURUH model.
      this.keyLight.shadow.mapSize.set(1024, 1024);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null;
    }
    this.renderer.shadowMap.needsUpdate = true;
    this.emit('progress', { value: 100, stage: 'prepare' });
    this.emit('ready', undefined);
    this.flyTo(isoPose(this.bounds), 1.8);
  }

  // Dipakai UI untuk memberi tahu kalau kualitas diturunkan otomatis.
  get lightenedAutomatically() {
    return this.autoLightened;
  }
  get triangleCount() {
    return this.triangles;
  }
  get uniqueTriangleCount() {
    return this.uniqueTriangles;
  }

  get isPreparing() {
    return this.merge !== null;
  }

  applyNames(names: ElementNames) {
    this.names = names;
    this.refreshIdentities();
  }

  private clearModel() {
    this.releaseMergeSources();
    this.renderDirty = true;
    if (this.modelGroup) {
      this.scene.remove(this.modelGroup);
      for (const p of this.parts) p?.geometry.dispose();
    }
    for (const ig of this.instGroups) ig.geometry.dispose();
    this.instGroups = [];
    this.parts = [];
    this.modelGroup = null;
    this.merge = null;
    this.records.clear();
    this.recordList = [];
    this.recordBoxes = new Float32Array(0);
    this.triangles = 0;
    this.uniqueTriangles = 0;
    this.autoLightened = false;
    this.slowFrames = 0;
    this.elements = [];
    this.highlighted.clear();
    this.selectedGid = null;
    this.hoverGid = null;
    this.labelCandidates = [];
    this.minimapRects = [];
    this.clipMaterials = [];
    if (this.sectionBox) this.sectionBox.visible = false;
  }

  // Geometri sumber GLTF dilepas saat model diganti/dibersihkan. Sub-geometri
  // instans memakai bersama atribut sumber, jadi ini hanya aman di jalur
  // pembongkaran (load ulang / clearModel), bukan setelah penggabungan selesai.
  private releaseMergeSources() {
    this.merge?.geomUse.forEach((_, geometry) => geometry.dispose());
  }

  private disposeSource(root: THREE.Object3D, geometries: boolean) {
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const buffers = new Set<THREE.BufferGeometry>();
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      if (geometries) buffers.add(obj.geometry);
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of list) materials.add(material);
    });
    materials.forEach((material) => {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
      material.dispose();
    });
    textures.forEach((texture) => texture.dispose());
    buffers.forEach((geometry) => geometry.dispose());
  }

  private isSheerMaterial(mat: THREE.Material | THREE.Material[]): boolean {
    const mats = Array.isArray(mat) ? mat : [mat];
    return mats.every((m) => {
      const mm = m as THREE.Material & { opacity?: number };
      return mm.transparent && (mm.opacity ?? 1) < SHEER_OPACITY;
    });
  }

  // Warna dasar satu permukaan sebagai RGBA 0..255.
  private surfaceColor(m: SurfaceMaterial, sheer: boolean): [number, number, number, number] {
    const c = m?.color ?? WHITE;
    // Tekstur tidak ikut (warna saja); material bertekstur biasanya putih
    // -> diredam sedikit supaya tidak menyilaukan.
    const tint = m?.map ? 0.8 : 1;
    const alpha = sheer ? Math.round(THREE.MathUtils.clamp((m?.transparent ? m.opacity : 1) || 0.3, 0.12, 0.6) * 255) : 255;
    return [Math.round(c.r * 255 * tint), Math.round(c.g * 255 * tint), Math.round(c.b * 255 * tint), alpha];
  }

  private makeRecord(gid: string, name: string | null, category: string | null): ElementRecord {
    const cat = category || DEFAULT_CATEGORY;
    const label = humanizeCategory(cat);
    const clean = humanizeName(name);
    return {
      eid: 0,
      gid,
      name: clean ?? (gid.startsWith('unmapped:') ? label : `${label} · ${gid.slice(0, 6)}`),
      rawName: name,
      category: cat,
      categoryLabel: label,
      discipline: disciplineOf(cat) as Discipline,
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
      center: [0, 0, 0],
      size: [0, 0, 0],
      radius: 0,
      meshCount: 0,
      ranges: [],
      hasRealName: Boolean(clean),
      sheer: false,
      embeddedName: name,
      embeddedCategory: category,
    };
  }

  // Nama & kategori dari tabel `elements` datang setelah model dimuat.
  // Geometri TIDAK disusun ulang — hanya teks, kategori, dan disiplin.
  private refreshIdentities() {
    const db = this.names;
    if (!db) return;
    this.records.forEach((rec, gid) => {
      let name = db.nameByGid.get(gid) ?? rec.embeddedName;
      let category = db.categoryByGid.get(gid) ?? rec.embeddedCategory;
      if ((!name || !category) && /^\d+$/.test(gid)) {
        const alt = db.byElementId.get(gid);
        if (alt) {
          name = name ?? alt.name;
          category = category ?? alt.category;
        }
      }
      const fresh = this.makeRecord(gid, name, category);
      rec.name = fresh.name;
      rec.rawName = fresh.rawName;
      rec.category = fresh.category;
      rec.categoryLabel = fresh.categoryLabel;
      rec.discipline = fresh.discipline;
      rec.hasRealName = fresh.hasRealName;
    });
    if (!this.merge) this.finishIndex();
  }

  private finishIndex() {
    const list: ElementInfo[] = [];
    this.records.forEach((r) => {
      if (!Number.isFinite(r.min[0])) {
        r.min = [0, 0, 0];
        r.max = [0, 0, 0];
      }
      r.size = [r.max[0] - r.min[0], r.max[1] - r.min[1], r.max[2] - r.min[2]];
      r.center = [(r.min[0] + r.max[0]) / 2, (r.min[1] + r.max[1]) / 2, (r.min[2] + r.max[2]) / 2];
      r.radius = Math.hypot(r.size[0], r.size[1], r.size[2]) / 2;
      list.push(r);
    });
    this.elements = list;
    // Kotak batas dalam satu array datar — uji sinar saat memilih objek
    // menyapu array ini tanpa membuat objek baru.
    const boxes = new Float32Array(this.recordList.length * 6);
    for (let i = 0; i < this.recordList.length; i++) {
      const r = this.recordList[i];
      boxes[i * 6] = r.min[0];
      boxes[i * 6 + 1] = r.min[1];
      boxes[i * 6 + 2] = r.min[2];
      boxes[i * 6 + 3] = r.max[0];
      boxes[i * 6 + 4] = r.max[1];
      boxes[i * 6 + 5] = r.max[2];
    }
    this.recordBoxes = boxes;
    this.buildLabelCandidates();
    this.buildMinimapRects();
  }

  getElement(gid: string): ElementInfo | undefined {
    return this.records.get(gid);
  }

  // ------------------------------------------------------------------ scene dressing
  private buildGround() {
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
      (this.ground.material as THREE.Material).dispose();
    }
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.dispose();
    }
    const w = this.bounds.max[0] - this.bounds.min[0];
    const d = this.bounds.max[2] - this.bounds.min[2];
    const span = Math.max(w, d, 10) * 6;
    const geo = new THREE.PlaneGeometry(span, span);
    const mat = new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1, metalness: 0 });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = this.groundY - 0.02;
    this.ground.receiveShadow = true;
    this.ground.userData.isGround = true;
    this.scene.add(this.ground);

    const step = Math.max(1, Math.round(Math.max(w, d) / 20));
    const divisions = Math.round(span / step);
    this.grid = new THREE.GridHelper(span, Math.min(divisions, 400), COLORS.grid1, COLORS.grid2);
    this.grid.position.y = this.groundY + 0.005;
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.45;
    this.scene.add(this.grid);
  }

  private fitLights() {
    const b = this.bounds;
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    const r = Math.hypot(w, h, d) / 2 || 1;
    this.keyLight.position.set(r * 0.9, r * 1.6, r * 0.7);
    this.keyLight.target.position.set(0, 0, 0);
    const cam = this.keyLight.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.1;
    cam.far = r * 5;
    cam.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }

  setShadows(on: boolean) {
    this.renderDirty = true;
    this.shadowsWanted = on;
    this.renderer.shadowMap.enabled = on;
    this.keyLight.castShadow = on;
    [this.matOpaque, this.matSheer, this.ground?.material].forEach((m) => {
      if (m) (m as THREE.Material).needsUpdate = true;
    });
    this.renderer.shadowMap.needsUpdate = true;
  }
  get shadowsOn() {
    return this.renderer.shadowMap.enabled;
  }

  // ------------------------------------------------------------------ section
  // Pasang bidang potong ke material model (bukan renderer global), supaya
  // lantai & grid di bawah tetap utuh. Dipanggil saat model selesai digabung
  // dan tiap kali nilai potongan berubah.
  private refreshClipping() {
    const planes = this.sectionOn ? this.clipPlanes : [];
    const half = this.bounds.max.map((v, i) => (v - this.bounds.min[i]) / 2 || 1) as [number, number, number];
    const [hx, hy, hz] = half;
    const c = this.sectionClip;
    this.clipPlanes[0].constant = hx * c.xMax;
    this.clipPlanes[1].constant = hx * c.xMin;
    this.clipPlanes[2].constant = hy * c.yMax;
    this.clipPlanes[3].constant = hy * c.yMin;
    this.clipPlanes[4].constant = hz * c.zMax;
    this.clipPlanes[5].constant = hz * c.zMin;
    for (const m of this.clipMaterials) {
      m.clippingPlanes = planes;
      m.clipShadows = true;
      m.needsUpdate = true;
    }
    this.updateSectionBox();
    this.renderDirty = true;
  }

  // Gambar ulang bingkai kotak potong mengikuti 6 slider. Tampil hanya saat
  // section aktif. depthTest=false supaya kotaknya tetap terlihat walau di
  // balik dinding (sama seperti kotak penanda elemen di Mode teknis).
  private updateSectionBox() {
    if (!this.sectionOn) {
      if (this.sectionBox) this.sectionBox.visible = false;
      return;
    }
    const [hx, hy, hz] = this.bounds.max.map((v, i) => (v - this.bounds.min[i]) / 2 || 1) as [number, number, number];
    const c = this.sectionClip;
    const cx = (this.bounds.min[0] + this.bounds.max[0]) / 2;
    const cy = (this.bounds.min[1] + this.bounds.max[1]) / 2;
    const cz = (this.bounds.min[2] + this.bounds.max[2]) / 2;
    // Posisi dunia tiap bidang potong. Plane X+ (normal −X, konstanta
    // hx*xMax) mempertahankan x ≤ hx*xMax, jadi bidangnya di cx + hx*xMax;
    // X− (normal +X, konstanta hx*xMin) mempertahankan x ≥ −hx*xMin, jadi
    // bidangnya di cx − hx*xMin. Pola sama untuk Y dan Z.
    const x0 = cx + hx * c.xMax;
    const x1 = cx - hx * c.xMin;
    const y0 = cy + hy * c.yMax;
    const y1 = cy - hy * c.yMin;
    const z0 = cz + hz * c.zMax;
    const z1 = cz - hz * c.zMin;
    // 12 rusuk kotak, tiap rusuk 2 titik.
    const v: number[] = [];
    const edge = (a: [number, number, number], b: [number, number, number]) => v.push(...a, ...b);
    const corners = (x: number, y: number, z: number): [number, number, number] => [x, y, z];
    const xIn = [x0, x1], yIn = [y0, y1], zIn = [z0, z1];
    for (const x of xIn) for (const y of yIn) edge(corners(x, y, z0), corners(x, y, z1)); // 4 rusuk sejajar Z
    for (const y of yIn) for (const z of zIn) edge(corners(x0, y, z), corners(x1, y, z)); // 4 rusuk sejajar X
    for (const x of xIn) for (const z of zIn) edge(corners(x, y0, z), corners(x, y1, z)); // 4 rusuk sejajar Y
    if (!this.sectionBox) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
      const mat = new THREE.LineBasicMaterial({
        color: COLORS.highlight,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      });
      this.sectionBox = new THREE.LineSegments(geo, mat);
      this.sectionBox.renderOrder = 998;
      this.sectionBox.frustumCulled = false;
      this.scene.add(this.sectionBox);
    }
    const attr = this.sectionBox.geometry.getAttribute('position') as THREE.BufferAttribute;
    (attr.array as Float32Array).set(v);
    attr.needsUpdate = true;
    this.sectionBox.visible = true;
  }

  setSection(on: boolean, clip: SectionClip) {
    this.sectionOn = on;
    this.sectionClip = clip;
    this.refreshClipping();
  }

  // ------------------------------------------------------------------ colors
  setStyle(style: Style) {
    this.style = style;
    // ACES membuat tampilan monokrom lembut, tapi menggelapkan warna material
    // asli dari Revit — untuk "warna asli" pakai tone mapping linear.
    const tm = style === 'mono' ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    if (this.renderer.toneMapping !== tm) {
      this.renderer.toneMapping = tm;
      this.renderer.toneMappingExposure = style === 'mono' ? 1.0 : 1.1;
      [this.matOpaque, this.matSheer].forEach((m) => (m.needsUpdate = true));
    }
    this.repaintAll();
  }

  private paintRecord(rec: ElementRecord, ranges = rec.ranges) {
    const sel = rec.gid === this.selectedGid;
    const hi = !sel && this.highlighted.has(rec.gid);
    for (const r of ranges) {
      if (r.kind === 1) {
        // Instans: warnanya satu per instans (instanceColor), bukan per vertex.
        const ig = this.instGroups[r.group];
        if (!ig?.mesh.instanceColor) continue;
        const arr = ig.mesh.instanceColor.array as Float32Array;
        const o = r.instance * 3;
        if (sel || hi || this.style === 'mono') {
          const c = sel ? this.cSelected : hi ? this.cHighlight : ig.sheer ? this.cMonoGlass : this.cMono;
          arr[o] = c[0] / 255;
          arr[o + 1] = c[1] / 255;
          arr[o + 2] = c[2] / 255;
        } else {
          arr[o] = ig.base.r;
          arr[o + 1] = ig.base.g;
          arr[o + 2] = ig.base.b;
        }
        continue;
      }
      const part = this.parts[r.part];
      if (!part) continue;
      const arr = part.color.array as Uint8Array;
      const end = (r.vStart + r.vCount) * 4;
      if (sel || hi || this.style === 'mono') {
        const c = sel ? this.cSelected : hi ? this.cHighlight : part.sheer ? this.cMonoGlass : this.cMono;
        const a = part.sheer ? (sel || hi ? HIGHLIGHT_GLASS_ALPHA : MONO_GLASS_ALPHA) : 255;
        for (let o = r.vStart * 4; o < end; o += 4) {
          arr[o] = c[0];
          arr[o + 1] = c[1];
          arr[o + 2] = c[2];
          arr[o + 3] = a;
        }
      } else {
        arr.set(part.baseOriginal.subarray(r.vStart * 4, end), r.vStart * 4);
      }
    }
  }

  private repaintAll() {
    this.renderDirty = true;
    this.records.forEach((rec) => this.paintRecord(rec));
    for (const p of this.parts) {
      if (!p) continue;
      p.color.clearUpdateRanges();
      p.color.needsUpdate = true;
    }
    for (const ig of this.instGroups) if (ig.mesh.instanceColor) ig.mesh.instanceColor.needsUpdate = true;
  }

  // Cat ulang hanya elemen tertentu; upload ke GPU per rentang kalau sedikit.
  private repaint(gids: Iterable<string>) {
    this.renderDirty = true;
    const list = Array.from(gids)
      .map((g) => this.records.get(g))
      .filter((r): r is ElementRecord => Boolean(r));
    if (list.length === 0) return;
    if (list.length > PARTIAL_UPLOAD_MAX) {
      list.forEach((rec) => this.paintRecord(rec));
      for (const p of this.parts) {
        if (!p) continue;
        p.color.clearUpdateRanges();
        p.color.needsUpdate = true;
      }
      for (const ig of this.instGroups) if (ig.mesh.instanceColor) ig.mesh.instanceColor.needsUpdate = true;
      return;
    }
    const touched = new Set<MergedPart>();
    const touchedInst = new Set<InstGroup>();
    for (const rec of list) {
      this.paintRecord(rec);
      for (const r of rec.ranges) {
        if (r.kind === 1) {
          const ig = this.instGroups[r.group];
          if (ig) touchedInst.add(ig);
          continue;
        }
        const part = this.parts[r.part];
        if (!part) continue;
        part.color.addUpdateRange(r.vStart * 4, r.vCount * 4);
        touched.add(part);
      }
    }
    touched.forEach((p) => (p.color.needsUpdate = true));
    // instanceColor kecil (3 float per instans) — upload penuh saja.
    touchedInst.forEach((ig) => ig.mesh.instanceColor && (ig.mesh.instanceColor.needsUpdate = true));
  }

  select(gid: string | null) {
    if (gid && !this.records.has(gid)) gid = null;
    if (this.selectedGid === gid) return;
    const prev = this.selectedGid;
    this.selectedGid = gid;
    const changed: string[] = [];
    if (prev) changed.push(prev);
    if (gid) changed.push(gid);
    this.repaint(changed);
    this.emit('select', gid);
  }
  get selected() {
    return this.selectedGid;
  }

  setHighlight(gids: Iterable<string>) {
    const next = new Set(gids);
    const changed = new Set<string>();
    this.highlighted.forEach((g) => {
      if (!next.has(g)) changed.add(g);
    });
    next.forEach((g) => {
      if (!this.highlighted.has(g)) changed.add(g);
    });
    this.highlighted = next;
    this.repaint(changed);
  }
  addHighlight(gids: Iterable<string>) {
    const added: string[] = [];
    for (const g of gids) {
      if (!this.highlighted.has(g)) {
        this.highlighted.add(g);
        added.push(g);
      }
    }
    this.repaint(added);
  }
  clearHighlight() {
    this.setHighlight([]);
  }
  get highlightCount() {
    return this.highlighted.size;
  }
  isHighlighted(gid: string) {
    return this.highlighted.has(gid);
  }
  highlightedGids(): string[] {
    return Array.from(this.highlighted);
  }

  // ------------------------------------------------------------------ camera
  private setPoseImmediate(p: CameraPose) {
    this.camera.position.set(...p.position);
    this.controls.target.set(...p.target);
    this.camera.lookAt(this.controls.target);
    this.syncYawPitchFromCamera();
    this.controls.update();
  }

  currentPose(): CameraPose {
    const p = this.camera.position;
    const t = this.mode === 'walk' ? this.lookTarget() : this.controls.target;
    return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  }

  private lookTarget(): THREE.Vector3 {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return this.camera.position.clone().addScaledVector(dir, 10);
  }

  flyTo(to: CameraPose, dur = 1.2, onDone?: () => void) {
    this.controls.autoRotate = false;
    this.tween = { from: this.currentPose(), to, t: 0, dur: Math.max(0.05, dur), onDone };
  }

  cancelTween() {
    this.tween = null;
  }

  private stepTween(dt: number) {
    const tw = this.tween;
    if (!tw) return;
    tw.t = Math.min(1, tw.t + dt / tw.dur);
    const k = easeInOut(tw.t);
    const pos = new THREE.Vector3(...tw.from.position).lerp(new THREE.Vector3(...tw.to.position), k);
    const tgt = new THREE.Vector3(...tw.from.target).lerp(new THREE.Vector3(...tw.to.target), k);
    this.camera.position.copy(pos);
    if (this.mode === 'walk') {
      this.camera.lookAt(tgt);
      this.syncYawPitchFromCamera();
    } else {
      this.controls.target.copy(tgt);
    }
    if (tw.t >= 1) {
      this.tween = null;
      if (this.mode === 'walk') this.eyeOffset = this.camera.position.y - this.groundY;
      tw.onDone?.();
      this.emit('tweenEnd', undefined);
    }
  }

  setMode(mode: ViewMode, opts: { pose?: CameraPose; dur?: number } = {}) {
    const prev = this.mode;
    this.planActive = false;
    this.controls.enableRotate = true;
    this.controls.autoRotate = false;
    if (mode === 'walk') {
      const pose =
        opts.pose ??
        (() => {
          // Dari posisi orbit yang jauh di luar model, turun ke eye level di
          // tempat itu cuma menghasilkan pemandangan kosong — mulai dari pintu
          // masuk saja.
          const p0 = this.camera.position;
          const b = this.bounds;
          const mx = (b.max[0] - b.min[0]) * 0.35 + 5;
          const mz = (b.max[2] - b.min[2]) * 0.35 + 5;
          if (p0.x < b.min[0] - mx || p0.x > b.max[0] + mx || p0.z < b.min[2] - mz || p0.z > b.max[2] + mz) {
            this.eyeOffset = EYE_LEVEL;
            return entrancePose(b);
          }
          const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
          dir.y = 0;
          if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
          dir.normalize();
          const y = this.groundY + this.eyeOffset;
          return {
            position: [p0.x, y, p0.z] as [number, number, number],
            target: [p0.x + dir.x * 10, y, p0.z + dir.z * 10] as [number, number, number],
          };
        })();
      this.controls.enabled = false;
      this.mode = 'walk';
      if (prev !== 'walk') this.syncYawPitchFromCamera();
      this.flyTo(pose, opts.dur ?? 1.0);
    } else if (mode === 'static') {
      // Kamera beku: kunci putaran & zoom di OrbitControls, posisi sekarang
      // dipertahankan (atau terbang ke pose yang diberikan). Klik tetap bisa
      // memilih elemen — hanya navigasinya yang dimatikan.
      this.controls.enabled = false;
      this.mode = 'static';
      if (prev === 'walk') {
        // Dari mode jalan: angkat sedikit supaya pusat putar masuk akal kalau
        // nanti kembali ke orbit, dan target = titik yang sedang dilihat.
        const pose = opts.pose ?? this.orbitPoseFromWalk();
        this.setPoseImmediate(pose);
      } else if (opts.pose) {
        this.setPoseImmediate(opts.pose);
      }
    } else {
      this.mode = 'orbit';
      this.controls.enabled = true;
      const pose = opts.pose ?? (prev === 'walk' ? this.orbitPoseFromWalk() : this.currentPose());
      this.flyTo(pose, opts.dur ?? 1.0);
    }
    if (prev !== this.mode) this.emit('mode', this.mode);
  }

  // Keluar dari mode jalan: naik sedikit & mundur, target = titik yang sedang
  // dilihat, supaya OrbitControls punya pusat putar yang masuk akal.
  private orbitPoseFromWalk(): CameraPose {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    dir.y = 0;
    dir.normalize();
    const maxDim = Math.max(...this.bounds.max.map((v, i) => v - this.bounds.min[i]));
    const t = this.camera.position.clone().addScaledVector(dir, Math.min(maxDim * 0.3, 25));
    t.y = this.groundY + Math.min(maxDim * 0.1, 4);
    const p = t.clone().addScaledVector(dir, -Math.min(maxDim * 0.5, 40));
    p.y = this.groundY + Math.min(maxDim * 0.35, 25);
    return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] };
  }

  goTo(pose: CameraPose, mode: ViewMode, dur = 1.4) {
    if (mode !== this.mode) this.setMode(mode, { pose, dur });
    else {
      this.planActive = false;
      this.controls.enableRotate = true;
      this.flyTo(pose, dur);
    }
  }

  overview(dur = 1.4) {
    this.goTo(isoPose(this.bounds), 'orbit', dur);
  }
  entrance(dur = 1.4) {
    this.eyeOffset = EYE_LEVEL;
    this.goTo(entrancePose(this.bounds), 'walk', dur);
  }
  plan(dur = 1.4) {
    this.goTo(planPose(this.bounds), 'orbit', dur);
    this.planActive = true;
    this.controls.enableRotate = false;
  }

  setAutoRotate(on: boolean) {
    if (this.mode !== 'orbit') return;
    this.controls.autoRotate = on;
  }
  get autoRotate() {
    return this.controls.autoRotate;
  }

  // Terbang ke satu elemen: jarak pas dari FOV (bola pembatas), arah pandang
  // dipertahankan. Di mode jalan: berdiri di dekat elemen pada eye level.
  focusElement(gid: string, dur = 1.2) {
    const rec = this.records.get(gid);
    if (!rec) return;
    const c = new THREE.Vector3(...rec.center);
    if (this.mode === 'walk') {
      const from = this.camera.position.clone();
      const flat = from.clone().sub(c);
      flat.y = 0;
      if (flat.lengthSq() < 1e-6) flat.set(0, 0, 1);
      flat.normalize();
      const dist = Math.max(rec.radius * 1.6, 2.5);
      const y = this.groundY + this.eyeOffset;
      const p = c.clone().addScaledVector(flat, dist);
      p.y = y;
      const look = c.clone();
      look.y = THREE.MathUtils.clamp(c.y, y - dist * 0.7, y + dist * 0.7);
      this.flyTo({ position: [p.x, p.y, p.z], target: [look.x, look.y, look.z] }, dur);
      return;
    }
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fit = (Math.max(rec.radius, 0.3) / Math.sin(Math.min(vFov, hFov) / 2)) * 1.25;
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0.7, 1);
    dir.normalize();
    if (dir.y < 0.15) dir.y = 0.15; // jangan sampai dari bawah lantai
    dir.normalize();
    const p = c.clone().addScaledVector(dir, Math.max(fit, this.camera.near * 20));
    p.y = Math.max(p.y, this.groundY + 0.5);
    this.planActive = false;
    this.controls.enableRotate = true;
    this.flyTo({ position: [p.x, p.y, p.z], target: [c.x, c.y, c.z] }, dur);
  }

  focusGids(gids: string[], dur = 1.2) {
    if (gids.length === 1) return this.focusElement(gids[0], dur);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    let n = 0;
    for (const g of gids) {
      const r = this.records.get(g);
      if (!r) continue;
      n++;
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], r.min[i]);
        max[i] = Math.max(max[i], r.max[i]);
      }
    }
    if (n === 0) return;
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-6 || this.mode === 'walk') dir.set(1, 0.75, 1);
    if (dir.y < 0.2) dir.y = 0.2;
    const pose = isoPose({ min, max }, [dir.x, dir.y, dir.z]);
    this.goTo(pose, 'orbit', dur);
  }

  setEyeLevel(offset: number, dur = 0.8) {
    this.eyeOffset = Math.max(0.3, offset);
    if (this.mode !== 'walk') return;
    const p = this.camera.position;
    const t = this.lookTarget();
    const y = this.groundY + this.eyeOffset;
    this.flyTo({ position: [p.x, y, p.z], target: [t.x, t.y + (y - p.y), t.z] }, dur);
  }
  get eyeLevel() {
    return this.eyeOffset;
  }

  // Pindah posisi horizontal (klik minimap).
  teleport(x: number, z: number) {
    if (this.mode === 'walk') {
      const p = this.camera.position;
      const t = this.lookTarget();
      const dx = x - p.x;
      const dz = z - p.z;
      this.flyTo({ position: [x, p.y, z], target: [t.x + dx, t.y, t.z + dz] }, 0.9);
    } else {
      const t = this.controls.target;
      const p = this.camera.position;
      const dx = x - t.x;
      const dz = z - t.z;
      this.flyTo({ position: [p.x + dx, p.y, p.z + dz], target: [x, t.y, z] }, 0.9);
    }
  }

  private syncYawPitchFromCamera() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
  }
  private applyYawPitch() {
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.45, 1.45);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  // ------------------------------------------------------------------ input
  private bindInput() {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('webglcontextrestored', this.onContextRestored);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
  }

  private isTypingTarget(e: Event) {
    const t = e.target as HTMLElement | null;
    return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
  }

  private onPointerDown = (e: PointerEvent) => {
    this.cancelTween();
    this.controls.autoRotate = false;
    this.emit('userInput', undefined);
    this.downAt = { x: e.clientX, y: e.clientY };
    this.drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
  };
  private onPointerMove = (e: PointerEvent) => {
    const d = this.drag;
    if (d) {
      if (e.buttons === 0) {
        this.drag = null;
        return;
      }
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (Math.abs(e.clientX - this.downAt.x) > 4 || Math.abs(e.clientY - this.downAt.y) > 4) d.moved = true;
      d.x = e.clientX;
      d.y = e.clientY;
      if (this.mode === 'walk' && d.button === 0) {
        this.yaw -= dx * 0.0045;
        this.pitch -= dy * 0.0045;
        this.applyYawPitch();
      }
      return;
    }
    // Mode statis: kamera beku, jadi tooltip hover tidak perlu dihitung.
    if (this.mode === 'static') {
      if (this.hoverGid) this.setHover(null, 0, 0);
      return;
    }
    if (this.mode === 'orbit' && !this.tween && !this.merge) {
      const now = performance.now();
      // Hover menyapu kotak batas puluhan ribu elemen — 6–7×/detik cukup
      // untuk tooltip; dulu 12,5×/detik (80 ms) dan itu terasa saat model
      // besar digerakkan sambil mouse melintas di kanvas.
      if (now - this.lastHover < 150) return;
      this.lastHover = now;
      const rect = this.container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      // Jangan raycast (dan jangan tampilkan tooltip) di area yang tertutup
      // panel UI — kursor di situ sedang memakai panel, bukan model.
      if (x < this.insets.left || x > rect.width - this.insets.right || y < this.insets.top || y > rect.height - this.insets.bottom) {
        this.setHover(null, 0, 0);
        return;
      }
      this.setHover(this.pickAt(e.clientX, e.clientY, true), x, y);
    }
  };
  private onPointerUp = (e: PointerEvent) => {
    const d = this.drag;
    this.drag = null;
    if (!d || d.moved || d.button !== 0) return;
    const rect = this.container.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
    this.select(this.pickAt(e.clientX, e.clientY));
  };
  private onWheel = (e: WheelEvent) => {
    this.cancelTween();
    this.controls.autoRotate = false;
    this.emit('userInput', undefined);
    if (this.mode !== 'walk') return;
    e.preventDefault();
    const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
    this.camera.position.addScaledVector(dir, -Math.sign(e.deltaY) * this.walkSpeed * 0.4);
  };
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTypingTarget(e)) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e', 'shift', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      if (k !== 'shift') {
        this.cancelTween();
        this.controls.autoRotate = false;
        this.emit('userInput', undefined);
      }
      this.keys.add(k);
      if (k.startsWith('arrow')) e.preventDefault();
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };
  private onBlur = () => {
    this.keys.clear();
    this.drag = null;
  };
  private onResize = () => {
    this.resize();
  };
  private onContextRestored = () => {
    this.renderDirty = true;
    this.renderer.shadowMap.needsUpdate = true;
  };
  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.renderDirty = true;
  }

  private stepKeys(dt: number) {
    if (this.keys.size === 0) return;
    if (this.mode === 'static') return; // kamera beku — keyboard tidak menggerakkan apa pun
    const run = this.keys.has('shift') ? 2.6 : 1;
    const v = this.walkSpeed * run * dt;
    const fwd = (this.keys.has('w') || this.keys.has('arrowup') ? 1 : 0) - (this.keys.has('s') || this.keys.has('arrowdown') ? 1 : 0);
    const side = (this.keys.has('d') || this.keys.has('arrowright') ? 1 : 0) - (this.keys.has('a') || this.keys.has('arrowleft') ? 1 : 0);
    const up = (this.keys.has('e') ? 1 : 0) - (this.keys.has('q') ? 1 : 0);
    if (!fwd && !side && !up) return;
    if (this.mode === 'walk') {
      const yawOnly = new THREE.Euler(0, this.yaw, 0, 'YXZ');
      const f = new THREE.Vector3(0, 0, -1).applyEuler(yawOnly);
      const r = new THREE.Vector3(1, 0, 0).applyEuler(yawOnly);
      this.camera.position.addScaledVector(f, fwd * v).addScaledVector(r, side * v);
      if (up) this.eyeOffset = Math.max(0.3, this.eyeOffset + up * v * 0.6);
      this.camera.position.y = this.groundY + this.eyeOffset;
    } else {
      // Orbit: geser kamera & target bersama (fly-through rata), kecepatan
      // relatif jarak ke target supaya terasa sama di dekat & jauh.
      const dist = this.camera.position.distanceTo(this.controls.target);
      const s = Math.max(dist * 0.6, this.walkSpeed) * run * dt;
      const dir = this.controls.target.clone().sub(this.camera.position);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
      const delta = new THREE.Vector3()
        .addScaledVector(dir, fwd * s)
        .addScaledVector(right, side * s)
        .addScaledVector(new THREE.Vector3(0, 1, 0), up * s * 0.6);
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    }
  }

  // ------------------------------------------------------------------ picking
  private pickAt(clientX: number, clientY: number, hover = false): string | null {
    const rect = this.container.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    return this.pickNdc(ndc, hover);
  }

  private isNonPhysical(rec: ElementRecord) {
    return NON_PHYSICAL.has(rec.category.toUpperCase());
  }

  // Jarak masuk sinar ke kotak batas elemen ke-i (slab test), atau -1 kalau
  // meleset. Ditulis manual pada array datar: dipanggil puluhan ribu kali per
  // klik, jadi tidak boleh ada alokasi objek di dalamnya.
  private boxDistance(i: number, ox: number, oy: number, oz: number, ix: number, iy: number, iz: number): number {
    const b = this.recordBoxes;
    const o = i * 6;
    let t0 = ((ix >= 0 ? b[o] : b[o + 3]) - ox) * ix;
    let t1 = ((ix >= 0 ? b[o + 3] : b[o]) - ox) * ix;
    const ty0 = ((iy >= 0 ? b[o + 1] : b[o + 4]) - oy) * iy;
    const ty1 = ((iy >= 0 ? b[o + 4] : b[o + 1]) - oy) * iy;
    if (t0 > ty1 || ty0 > t1) return -1;
    if (ty0 > t0) t0 = ty0;
    if (ty1 < t1) t1 = ty1;
    const tz0 = ((iz >= 0 ? b[o + 2] : b[o + 5]) - oz) * iz;
    const tz1 = ((iz >= 0 ? b[o + 5] : b[o + 2]) - oz) * iz;
    if (t0 > tz1 || tz0 > t1) return -1;
    if (tz0 > t0) t0 = tz0;
    if (tz1 < t1) t1 = tz1;
    if (t1 < 0) return -1;
    return t0 < 0 ? 0 : t0; // 0 = kamera berada di dalam kotak
  }

  // Jarak tembak terdekat ke segitiga milik satu elemen.
  //   Infinity = diuji, tapi meleset
  //   -1       = tidak diuji karena terlalu besar (pakai jarak kotak saja)
  private hitDistance(ray: THREE.Ray, rec: ElementRecord, deadline = Infinity): number {
    let best = Infinity;
    let tris = 0;
    for (const r of rec.ranges) tris += r.kind === 1 ? (this.instGroups[r.group]?.tris ?? 0) : r.tCount;
    // Elemen raksasa (mis. permukaan tanah): cukup pakai jarak kotaknya.
    if (tris > PICK_EXACT_MAX_TRIS) return -1;
    const a = this.tmpA;
    const bb = this.tmpB;
    const c = this.tmpC;
    const target = this.tmpHit;
    for (const r of rec.ranges) {
      if (r.kind === 1) {
        // Instans: sinar dipindah ke ruang lokal geometri (satu invers
        // matriks), lalu diuji ke segitiga geometri yang dipakai bersama.
        const ig = this.instGroups[r.group];
        if (!ig) continue;
        const m = ig.matrices[r.instance];
        if (!m) continue;
        this.tmpMat.copy(m).invert();
        this.tmpRay.copy(ray).applyMatrix4(this.tmpMat);
        const pos = ig.geometry.getAttribute('position').array as Float32Array;
        const index = ig.geometry.index!.array as Uint32Array;
        for (let t = 0; t < index.length; t += 3) {
          if (t % 3072 === 0 && performance.now() >= deadline) return Infinity;
          const i0 = index[t] * 3;
          const i1 = index[t + 1] * 3;
          const i2 = index[t + 2] * 3;
          a.set(pos[i0], pos[i0 + 1], pos[i0 + 2]);
          bb.set(pos[i1], pos[i1 + 1], pos[i1 + 2]);
          c.set(pos[i2], pos[i2 + 1], pos[i2 + 2]);
          if (this.tmpRay.intersectTriangle(a, bb, c, false, target)) {
            // Kembalikan ke ruang dunia untuk membandingkan jarak antar elemen.
            target.applyMatrix4(m);
            const d = ray.origin.distanceTo(target);
            if (d < best) best = d;
          }
        }
        continue;
      }
      const part = this.parts[r.part];
      if (!part) continue;
      const pos = part.geometry.getAttribute('position').array as Float32Array;
      const index = part.geometry.index!.array as Uint32Array | Uint16Array;
      const end = (r.tStart + r.tCount) * 3;
      for (let t = r.tStart * 3; t < end; t += 3) {
        if ((t - r.tStart * 3) % 3072 === 0 && performance.now() >= deadline) return Infinity;
        const i0 = index[t] * 3;
        const i1 = index[t + 1] * 3;
        const i2 = index[t + 2] * 3;
        a.set(pos[i0], pos[i0 + 1], pos[i0 + 2]);
        bb.set(pos[i1], pos[i1 + 1], pos[i1 + 2]);
        c.set(pos[i2], pos[i2 + 1], pos[i2 + 2]);
        if (ray.intersectTriangle(a, bb, c, false, target)) {
          const d = ray.origin.distanceTo(target);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }

  // Pilih elemen di bawah sinar. Dua putaran: benda padat dulu, baru objek
  // tembus pandang / non-fisik (volume ruang, grid, anotasi) — supaya yang
  // "kosong" tidak pernah merebut klik dari benda nyata di belakangnya.
  private pickNdc(ndc: THREE.Vector2, hover = false): string | null {
    // Klik diberi tenggat juga (dulu cuma hover): di model besar, klik di
    // titik yang menembus tumpukan kotak batas besar bisa menyapu ratusan
    // kandidat dan membekukan frame. Kalau tenggat habis, hasil terbaik
    // sejauh ini yang dipakai — bukan membekukan halaman.
    const deadline = performance.now() + (hover ? 6 : PICK_CLICK_BUDGET_MS);
    if (this.merge || this.recordList.length === 0) return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    const ray = this.raycaster.ray;
    const ox = ray.origin.x;
    const oy = ray.origin.y;
    const oz = ray.origin.z;
    const ix = 1 / ray.direction.x;
    const iy = 1 / ray.direction.y;
    const iz = 1 / ray.direction.z;

    for (let pass = 0; pass < 2; pass++) {
      const cands = this.pickCands;
      cands.length = 0;
      for (let i = 0; i < this.recordList.length; i++) {
        const rec = this.recordList[i];
        if (rec.ranges.length === 0) continue;
        const soft = rec.sheer || this.isNonPhysical(rec);
        if (pass === 0 ? soft : !soft) continue;
        const d = this.boxDistance(i, ox, oy, oz, ix, iy, iz);
        if (d >= 0) cands.push(d, i);
      }
      if (cands.length === 0) continue;
      // Urutkan pasangan (jarak, indeks) berdasarkan jarak.
      const order: number[] = [];
      for (let k = 0; k < cands.length; k += 2) order.push(k);
      order.sort((p, q) => cands[p] - cands[q]);

      let best: ElementRecord | null = null;
      let bestDist = Infinity;
      let tested = 0;
      // Elemen yang dilewati karena terlalu besar: dipakai hanya kalau tidak
      // ada satu pun tembakan segitiga yang kena.
      let approx: ElementRecord | null = null;
      let approxDist = Infinity;
      for (const k of order) {
        // Kotak berikutnya sudah lebih jauh dari tembakan terbaik -> selesai.
        if (cands[k] > bestDist) break;
        if (tested++ >= PICK_CANDIDATES || performance.now() >= deadline) break;
        const rec = this.recordList[cands[k + 1]];
        const d = this.hitDistance(ray, rec, deadline);
        if (d < 0) {
          if (cands[k] < approxDist) {
            approxDist = cands[k];
            approx = rec;
          }
        } else if (d < bestDist) {
          bestDist = d;
          best = rec;
        }
      }
      // Kotak batas TIDAK dipakai sebagai jawaban kalau segitiganya memang
      // diuji dan meleset — klik di ruang kosong harus tetap "tidak ada".
      // Kecualinya kalau tenggat habis di tengah uji: lebih baik menjawab
      // elemen paling dekat dari kotaknya daripada membekukan halaman.
      const timedOut = performance.now() >= deadline;
      const pick = best ?? (timedOut ? approx : approxDist <= bestDist ? approx : null);
      if (pick) return pick.gid;
    }
    return null;
  }

  private setHover(gid: string | null, x: number, y: number) {
    if (gid === this.hoverGid && gid === null) return;
    this.hoverGid = gid;
    this.emit('hover', gid ? { gid, x, y } : null);
  }

  // Mode jalan: apa yang ada di tengah layar (crosshair).
  private stepCenterLook(now: number) {
    if (this.mode !== 'walk' || this.merge) return;
    if (now - this.lastHover < 200) return;
    this.lastHover = now;
    const gid = this.pickNdc(new THREE.Vector2(0, 0), true);
    this.setHover(gid, this.container.clientWidth / 2, this.container.clientHeight / 2);
  }
  get hovered() {
    return this.hoverGid;
  }

  // ------------------------------------------------------------------ labels
  setLabels(on: boolean) {
    this.labelsOn = on;
    if (!on) this.labelPool.forEach((d) => (d.style.display = 'none'));
  }

  private buildLabelCandidates() {
    // Ambil elemen bernama yang paling "menonjol" per kategori, supaya label
    // tersebar ke berbagai disiplin — bukan 90 dinding sejenis.
    const byCat = new Map<string, ElementRecord[]>();
    this.records.forEach((r) => {
      if (!r.hasRealName) return;
      if (this.isNonPhysical(r)) return;
      if (!byCat.has(r.category)) byCat.set(r.category, []);
      byCat.get(r.category)!.push(r);
    });
    const perCat = Math.max(2, Math.ceil(LABEL_CANDIDATES / Math.max(1, byCat.size)));
    const out: ElementRecord[] = [];
    byCat.forEach((list) => {
      list.sort((a, b) => b.radius - a.radius);
      out.push(...list.slice(0, perCat));
    });
    out.sort((a, b) => b.radius - a.radius);
    this.labelCandidates = out.slice(0, LABEL_CANDIDATES);
  }

  private labelDiv(i: number): HTMLDivElement {
    let d = this.labelPool[i];
    if (!d) {
      d = document.createElement('div');
      d.className = 'sc-label';
      this.labelLayer.appendChild(d);
      this.labelPool[i] = d;
    }
    return d;
  }

  private stepLabels() {
    if (!this.labelsOn) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const ins = this.insets;
    const maxDim = Math.max(...this.bounds.max.map((v, i) => v - this.bounds.min[i]));
    const maxDist = this.mode === 'walk' ? Math.min(60, maxDim) : maxDim * 1.2;
    const camPos = this.camera.position;
    const v = new THREE.Vector3();
    const shown: { x: number; y: number; text: string; dist: number; gid: string }[] = [];
    for (const r of this.labelCandidates) {
      if (r.gid === this.selectedGid) continue;
      v.set(r.center[0], r.max[1], r.center[2]);
      const dist = v.distanceTo(camPos);
      if (dist > maxDist) continue;
      v.project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      const x = (v.x + 1) * 0.5 * w;
      const y = (1 - v.y) * 0.5 * h;
      // Label hanya di area bebas panel.
      if (x < ins.left + 60 || x > w - ins.right - 60 || y < ins.top + 20 || y > h - ins.bottom) continue;
      shown.push({ x, y, text: r.name, dist, gid: r.gid });
    }
    shown.sort((a, b) => a.dist - b.dist);
    const placed: { x: number; y: number; text: string; gid: string }[] = [];
    for (const s of shown) {
      if (placed.length >= LABEL_MAX) break;
      if (placed.some((p) => Math.abs(p.x - s.x) < 170 && Math.abs(p.y - s.y) < 28)) continue;
      placed.push(s);
    }
    for (let i = 0; i < Math.max(placed.length, this.labelPool.length); i++) {
      const d = this.labelDiv(i);
      const p = placed[i];
      if (!p) {
        d.style.display = 'none';
        continue;
      }
      d.style.display = 'block';
      d.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(0)}px, ${(p.y - 6).toFixed(0)}px)`;
      const text = p.text.length > 32 ? `${p.text.slice(0, 29)}…` : p.text;
      if (d.textContent !== text) d.textContent = text;
      d.classList.toggle('is-hi', this.highlighted.has(p.gid));
    }
  }

  // Posisi layar pusat-atas sebuah elemen (untuk label seleksi di React),
  // sudah dijepit ke area bebas panel.
  projectElement(gid: string): { x: number; y: number; visible: boolean } | null {
    const r = this.records.get(gid);
    if (!r) return null;
    const v = new THREE.Vector3(r.center[0], r.max[1], r.center[2]).project(this.camera);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const ins = this.insets;
    const x = (v.x + 1) * 0.5 * w;
    const y = (1 - v.y) * 0.5 * h;
    return {
      x: THREE.MathUtils.clamp(x, ins.left + 70, Math.max(ins.left + 70, w - ins.right - 70)),
      y: THREE.MathUtils.clamp(y, ins.top + 14, Math.max(ins.top + 14, h - ins.bottom)),
      visible: v.z < 1 && v.z > -1,
    };
  }

  // ------------------------------------------------------------------ minimap
  attachMinimap(canvas: HTMLCanvasElement | null) {
    this.minimap = canvas;
    this.lastMinimap = 0;
  }
  setMinimapMarkers(m: { x: number; z: number; label: string }[]) {
    this.minimapMarkers = m;
  }

  private buildMinimapRects() {
    const all = Array.from(this.records.values())
      .filter((r) => !this.isNonPhysical(r))
      .map((r) => ({ x: r.min[0], z: r.min[2], w: r.size[0], d: r.size[2], gid: r.gid, area: r.size[0] * r.size[2] }));
    all.sort((a, b) => b.area - a.area);
    this.minimapRects = all.slice(0, MINIMAP_RECTS);
  }

  private minimapTransform(canvas: HTMLCanvasElement) {
    const W = canvas.width;
    const H = canvas.height;
    const b = this.bounds;
    const w = b.max[0] - b.min[0] || 1;
    const d = b.max[2] - b.min[2] || 1;
    const pad = 10 * (window.devicePixelRatio || 1);
    const s = Math.min((W - pad * 2) / w, (H - pad * 2) / d);
    const ox = (W - w * s) / 2;
    const oz = (H - d * s) / 2;
    return {
      toPx: (x: number, z: number) => [ox + (x - b.min[0]) * s, oz + (z - b.min[2]) * s] as [number, number],
      toWorld: (px: number, pz: number) => [b.min[0] + (px - ox) / s, b.min[2] + (pz - oz) / s] as [number, number],
      s,
    };
  }

  minimapClick(px: number, pz: number) {
    const c = this.minimap;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const { toWorld } = this.minimapTransform(c);
    const [x, z] = toWorld(px * dpr, pz * dpr);
    this.teleport(
      THREE.MathUtils.clamp(x, this.bounds.min[0] - 20, this.bounds.max[0] + 20),
      THREE.MathUtils.clamp(z, this.bounds.min[2] - 20, this.bounds.max[2] + 20)
    );
  }

  private stepMinimap(now: number) {
    const c = this.minimap;
    if (!c || now - this.lastMinimap < 100) return;
    this.lastMinimap = now;
    const dpr = window.devicePixelRatio || 1;
    const cssW = c.clientWidth;
    const cssH = c.clientHeight;
    if (cssW === 0) return;
    if (c.width !== Math.round(cssW * dpr) || c.height !== Math.round(cssH * dpr)) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const { toPx, s } = this.minimapTransform(c);
    ctx.clearRect(0, 0, c.width, c.height);
    const [bx0, bz0] = toPx(this.bounds.min[0], this.bounds.min[2]);
    const [bx1, bz1] = toPx(this.bounds.max[0], this.bounds.max[2]);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(bx0, bz0, bx1 - bx0, bz1 - bz0);
    for (const r of this.minimapRects) {
      const [x, z] = toPx(r.x, r.z);
      const hi = this.highlighted.has(r.gid) || r.gid === this.selectedGid;
      ctx.fillStyle = hi ? 'rgba(190,240,90,0.85)' : 'rgba(255,255,255,0.14)';
      ctx.fillRect(x, z, Math.max(1, r.w * s), Math.max(1, r.d * s));
    }
    ctx.font = `${9 * dpr}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const m of this.minimapMarkers) {
      const [x, z] = toPx(m.x, m.z);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.arc(x, z, 6 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8f7c5';
      ctx.fillText(m.label, x, z + 0.5 * dpr);
    }
    const p = this.camera.position;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const ang = Math.atan2(dir.x, -dir.z); // 0 = arah -Z (atas minimap)
    const [cx, cz] = toPx(p.x, p.z);
    const hf = ((this.camera.fov * this.camera.aspect) / 2) * (Math.PI / 180);
    const len = 22 * dpr;
    ctx.fillStyle = 'rgba(200,245,110,0.22)';
    ctx.beginPath();
    ctx.moveTo(cx, cz);
    ctx.lineTo(cx + Math.sin(ang - hf) * len, cz - Math.cos(ang - hf) * len);
    ctx.lineTo(cx + Math.sin(ang + hf) * len, cz - Math.cos(ang + hf) * len);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c9f55e';
    ctx.beginPath();
    ctx.arc(cx, cz, 3.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
  }

  // ------------------------------------------------------------------ loop
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dtRaw = this.clock.getDelta();
    if (document.hidden || this.renderer.getContext().isContextLost()) return;
    const dt = Math.min(dtRaw, 0.1);
    const now = performance.now();
    // Tween kamera memakai waktu nyata (bukan dt yang di-clamp) supaya durasi
    // animasi tetap sama di mesin lambat.
    this.stepTween(Math.min(dtRaw, 0.5));
    this.stepKeys(dt);
    if (this.mode === 'orbit') this.controls.update();
    else if (!this.tween) this.applyYawPitch();
    // Saat menyiapkan model, gambar sesekali saja — waktunya dipakai untuk
    // menggabungkan geometri (lihat MERGE_RENDER_EVERY_MS).
    if (this.merge) {
      if (now - this.lastMergeRender < MERGE_RENDER_EVERY_MS) return;
      this.lastMergeRender = now;
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const frameChanged = this.renderDirty
      || !this.camera.position.equals(this.renderedPosition)
      || !this.camera.quaternion.equals(this.renderedQuaternion);
    if (frameChanged) {
      this.renderer.render(this.scene, this.camera);
      this.renderedPosition.copy(this.camera.position);
      this.renderedQuaternion.copy(this.camera.quaternion);
      this.renderDirty = false;
      // Hanya frame yang benar-benar digambar yang dihitung untuk jaring
      // pengaman frame berat.
      this.renderedFrames++;
      this.renderedTime += dtRaw;
    }
    this.stepLabels();
    this.stepMinimap(now);
    this.stepCenterLook(now);
    this.frames++;
    if (now - this.lastStats > 500) {
      const fps = Math.round((this.frames * 1000) / (now - this.lastStats));
      this.frames = 0;
      this.lastStats = now;
      const p = this.camera.position;
      // Jaring pengaman adaptif: di bawah SLOW_FPS, kualitas diturunkan
      // BERTAHAP — bayangan dulu (biaya terbesar, tidak mengubah bentuk),
      // baru resolusi — sampai frame kembali layak. Dulu ambangnya 20 FPS dan
      // hanya sekali lepas, jadi model yang selalu 25–35 FPS tidak pernah
      // ditolong. Dipicu hanya oleh frame yang benar-benar digambar (lihat
      // catatan #55) dan tidak jalan saat menyiapkan model.
      const activeFps = this.renderedTime > 0 ? this.renderedFrames / this.renderedTime : 0;
      if (frameChanged && activeFps > 0 && activeFps < SLOW_FPS && (this.parts.length > 0 || this.instGroups.length > 0) && !this.merge) {
        this.slowFrames++;
        if (this.slowFrames >= 3) {
          let changed = false;
          if (this.shadowsOn) {
            this.setShadows(false);
            changed = true;
          }
          const ratio = this.renderer.getPixelRatio();
          if (!changed && ratio > 0.75) {
            this.renderer.setPixelRatio(Math.max(0.75, ratio - 0.25));
            // setPixelRatio TIDAK mengubah ukuran drawing buffer — perlu
            // setSize ulang, kalau tidak penurunan resolusi tidak berefek.
            this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
            changed = true;
          }
          if (changed) {
            this.autoLightened = true;
            this.renderDirty = true;
          }
          this.slowFrames = 0;
        }
      } else this.slowFrames = 0;
      this.renderedFrames = 0;
      this.renderedTime = 0;
      this.emit('stats', {
        fps,
        eyeHeight: p.y - this.groundY,
        position: [p.x, p.y, p.z],
        mode: this.mode,
        triangles: this.triangles,
        uniqueTriangles: this.uniqueTriangles,
        instanced: this.instGroups.length,
        lightened: this.autoLightened,
      });
    }
  };

  // Digambar tepat sebelum diambil; frame biasa tidak perlu buffer diawetkan.
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('webglcontextrestored', this.onContextRestored);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    this.mergeChannel?.port1.close();
    this.mergeChannel?.port2.close();
    this.mergeChannel = null;
    this.sectionBox?.geometry.dispose();
    (this.sectionBox?.material as THREE.Material | undefined)?.dispose();
    this.sectionBox?.removeFromParent();
    this.sectionBox = null;
    this.controls.dispose();
    this.clearModel();
    this.ground?.geometry.dispose();
    (this.ground?.material as THREE.Material | undefined)?.dispose();
    this.grid?.dispose();
    this.keyLight.shadow.dispose();
    [this.matOpaque, this.matSheer, this.matInst, this.matInstSheer].forEach((m) => m.dispose());
    this.renderer.dispose();
    el.remove();
    this.labelLayer.remove();
    this.listeners.clear();
  }
}
