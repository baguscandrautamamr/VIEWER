import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
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
//  * Seluruh model DIGABUNG jadi dua mesh saja (padat & tembus pandang).
//    Model Revit besar punya puluhan ribu elemen; kalau tiap elemen jadi mesh
//    sendiri, tiap frame = puluhan ribu draw call dan navigasi tersendat apa
//    pun GPU-nya. Setelah digabung: 2 draw call.
//  * Penggabungan dilakukan SEKALI dan BERTAHAP (dicicil per frame dengan
//    anggaran waktu), jadi halaman tidak pernah membeku dan progresnya
//    kelihatan. Nama elemen yang datang belakangan dari database hanya
//    memperbarui teks — geometri tidak disusun ulang.
//  * Warna per-VERTEX (Uint8 RGBA, 4 byte): sorotan/seleksi/gaya tidak
//    mengganti material, cukup menulis ulang rentang vertex milik elemen itu.
//  * Raycast (klik, hover, crosshair) memakai BVH (three-mesh-bvh).
//    PENTING: BVH mengurutkan ULANG index buffer, jadi nomor segitiga tidak
//    bisa dipakai untuk mencari elemen. Identitas disimpan per-VERTEX
//    (`vertexEid`, di CPU saja) — itu tidak ikut terurut.
//  * Shadow map STATIS: lampu & model tidak bergerak, jadi bayangan dirender
//    sekali (autoUpdate=false), bukan tiap frame.
//
// Sengaja TIDAK memakai React di sini: semua yang berjalan tiap frame (label,
// minimap, tween kamera) dikerjakan langsung ke DOM/canvas supaya React tidak
// re-render 60×/detik. React (ShowcaseViewer.tsx) cukup mendengarkan event.

THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type Style = 'mono' | 'original';

export interface EngineStats {
  fps: number;
  eyeHeight: number; // tinggi kamera dari dasar model (m)
  position: [number, number, number];
  mode: ViewMode;
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
const MERGE_BUDGET_MS = 24;
const MERGE_RENDER_EVERY_MS = 260;
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

type PartIndex = 0 | 1; // 0 = padat, 1 = tembus pandang

interface VertexRange {
  part: PartIndex;
  vStart: number;
  vCount: number;
}

interface ElementRecord extends ElementInfo {
  eid: number;
  ranges: VertexRange[];
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
  vertexEid: Uint32Array; // vertex -> indeks di recordList (CPU saja)
  bvhReady: boolean;
}

// Satu mesh sumber (atau satu instance) yang menunggu disalin.
interface Piece {
  rec: ElementRecord;
  part: PartIndex;
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

  private records = new Map<string, ElementRecord>();
  private recordList: ElementRecord[] = [];
  private parts: (MergedPart | null)[] = [null, null];
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
  private cMono = u8(COLORS.mono);
  private cMonoGlass = u8(COLORS.monoGlass);
  private cHighlight = u8(COLORS.highlight);
  private cSelected = u8(COLORS.selected);

  private ground: THREE.Mesh | null = null;
  private grid: THREE.GridHelper | null = null;
  private keyLight: THREE.DirectionalLight;
  private shadowsWanted = true;

  // --- penggabungan bertahap ---
  private mergeTimer = 0;
  private lastMergeRender = 0;
  private merge: {
    token: number;
    pieces: Piece[];
    pi: number;
    vOff: [number, number];
    iOff: [number, number];
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
  private frames = 0;
  private lastStats = 0;
  private lastHover = 0;
  private raycaster = new THREE.Raycaster();
  private hoverGid: string | null = null;

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

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    // Pixel ratio dibatasi 1,5: di layar retina, DPR 2–3 berarti 4–9× piksel
    // yang harus di-shading — tidak sepadan untuk presentasi.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // statis — lihat catatan di atas
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

    this.raycaster.firstHitOnly = true;
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
    this.merge = null;
    window.clearTimeout(this.mergeTimer);
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    loader.setDRACOLoader(draco);
    this.emit('progress', { value: 0, stage: 'download' });
    loader.load(
      url,
      (gltf) => {
        draco.dispose();
        if (this.disposed || token !== this.loadToken) return;
        try {
          this.installModel(gltf.scene, gltf.parser, token);
        } catch (err) {
          console.error('Gagal menyiapkan model:', err);
          this.emit('error', 'prepare');
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

  // Pass 1 (murah, tanpa menyentuh isi vertex): kumpulkan daftar potongan,
  // identitas elemen, dan hitung total vertex/index per bagian.
  private beginMerge(root: THREE.Object3D, parser: { associations: Map<unknown, unknown>; json: unknown }, token: number) {
    const pieces: Piece[] = [];
    const counts: { v: number; i: number }[] = [
      { v: 0, i: 0 },
      { v: 0, i: 0 },
    ];
    const geomUse = new Map<THREE.BufferGeometry, number>();
    const white = new THREE.Color(0xffffff);

    const addPiece = (mesh: THREE.Mesh, gid: string, matrix: THREE.Matrix4) => {
      const geometry = mesh.geometry as THREE.BufferGeometry;
      const pos = geometry.getAttribute('position');
      if (!pos) return;
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
      const part: PartIndex = rec.sheer ? 1 : 0;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const indexTotal = geometry.index ? geometry.index.count : pos.count;
      const groups = geometry.groups.length > 0 ? geometry.groups : [{ start: 0, count: indexTotal, materialIndex: 0 }];
      const outGroups: Piece['groups'] = [];
      for (const g of groups) {
        const count = g.count === Infinity ? indexTotal - g.start : Math.min(g.count, indexTotal - g.start);
        if (count <= 0) continue;
        const m = (mats[g.materialIndex ?? 0] ?? mats[0]) as THREE.MeshStandardMaterial & { map?: THREE.Texture | null };
        const c = m?.color ?? white;
        // Tekstur tidak ikut (warna per-vertex saja); material bertekstur
        // biasanya putih -> diredam sedikit supaya tidak menyilaukan.
        const tint = m?.map ? 0.8 : 1;
        const alpha = part === 1 ? Math.round(THREE.MathUtils.clamp((m?.transparent ? m.opacity : 1) || 0.3, 0.12, 0.6) * 255) : 255;
        outGroups.push({
          start: g.start,
          count,
          color: [Math.round(c.r * 255 * tint), Math.round(c.g * 255 * tint), Math.round(c.b * 255 * tint), alpha],
        });
        counts[part].i += count;
      }
      if (outGroups.length === 0) return;
      counts[part].v += pos.count;
      rec.meshCount++;
      geomUse.set(geometry, (geomUse.get(geometry) ?? 0) + 1);
      pieces.push({ rec, part, geometry, matrix, vCount: pos.count, groups: outGroups });
    };

    const instMatrix = new THREE.Matrix4();
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const inst = child as THREE.InstancedMesh;
      if (inst.isInstancedMesh) {
        // Instance dibentangkan jadi potongan terpisah — kalau dilewati,
        // objeknya HILANG dari model gabungan.
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, instMatrix);
          addPiece(child, `unmapped:${child.uuid}#${i}`, new THREE.Matrix4().multiplyMatrices(child.matrixWorld, instMatrix));
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
      addPiece(child, gid, child.matrixWorld.clone());
    });

    const group = new THREE.Group();
    for (const part of [0, 1] as PartIndex[]) {
      const total = counts[part];
      if (total.v === 0) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total.v * 3), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(total.v * 3), 3));
      const color = new THREE.BufferAttribute(new Uint8Array(total.v * 4), 4, true);
      color.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('color', color);
      geometry.setIndex(new THREE.BufferAttribute(total.v > 65535 ? new Uint32Array(total.i) : new Uint16Array(total.i), 1));
      geometry.setDrawRange(0, 0);
      // Bounding sphere diisi manual: geometri masih kosong, dan model tidak
      // pernah di-cull per mesh (frustumCulled = false).
      const r = Math.hypot(...this.bounds.max.map((v, i) => v - this.bounds.min[i])) / 2 || 1;
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), r);

      const mesh = new THREE.Mesh(geometry, part === 0 ? this.matOpaque : this.matSheer);
      mesh.castShadow = part === 0;
      mesh.receiveShadow = part === 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = part;
      group.add(mesh);
      this.parts[part] = {
        mesh,
        geometry,
        color,
        baseOriginal: new Uint8Array(total.v * 4),
        vertexEid: new Uint32Array(total.v),
        bvhReady: false,
      };
    }
    this.scene.add(group);
    this.modelGroup = group;

    this.merge = { token, pieces, pi: 0, vOff: [0, 0], iOff: [0, 0], geomUse };
    this.emit('progress', { value: 55, stage: 'prepare' });
    this.scheduleMerge();
  }

  private scheduleMerge() {
    window.clearTimeout(this.mergeTimer);
    this.mergeTimer = window.setTimeout(() => {
      if (this.disposed || !this.merge) return;
      this.stepMerge();
      if (this.merge) this.scheduleMerge();
    }, 0);
  }

  // Pass 2, dicicil: salin vertex (sudah ditransformasi ke world) + index.
  private stepMerge() {
    const st = this.merge;
    if (!st || st.token !== this.loadToken) return;
    const t0 = performance.now();
    const v = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3();
    // Awal potongan ini per bagian — dipakai untuk upload PARSIAL ke GPU.
    // Tanpa ini, `needsUpdate = true` mengirim ulang SELURUH buffer (bisa
    // ratusan MB) pada setiap potongan, dan justru itu yang bikin macet.
    const sliceV: [number, number] = [st.vOff[0], st.vOff[1]];
    const sliceI: [number, number] = [st.iOff[0], st.iOff[1]];

    while (st.pi < st.pieces.length) {
      const piece = st.pieces[st.pi];
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
      for (let k = 0; k < piece.vCount; k++) {
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
        v.fromBufferAttribute(nor, k).applyMatrix3(normalMatrix).normalize();
        normal[o] = v.x;
        normal[o + 1] = v.y;
        normal[o + 2] = v.z;
        part.vertexEid[vOff + k] = rec.eid;
      }

      let gi = iOff;
      for (const g of piece.groups) {
        const [r, gg, b, a] = g.color;
        if (src) {
          for (let k = 0; k < g.count; k++) {
            const vi = src.getX(g.start + k) + vOff;
            index[gi + k] = vi;
            const co = vi * 4;
            part.baseOriginal[co] = r;
            part.baseOriginal[co + 1] = gg;
            part.baseOriginal[co + 2] = b;
            part.baseOriginal[co + 3] = a;
          }
        } else {
          for (let k = 0; k < g.count; k++) {
            const vi = g.start + k + vOff;
            index[gi + k] = vi;
            const co = vi * 4;
            part.baseOriginal[co] = r;
            part.baseOriginal[co + 1] = gg;
            part.baseOriginal[co + 2] = b;
            part.baseOriginal[co + 3] = a;
          }
        }
        gi += g.count;
      }

      rec.ranges.push({ part: piece.part, vStart: vOff, vCount: piece.vCount });
      this.paintRecord(rec);

      st.vOff[piece.part] = vOff + piece.vCount;
      st.iOff[piece.part] = gi;
      part.geometry.setDrawRange(0, gi);

      // Geometri sumber dilepas begitu potongan terakhir yang memakainya
      // selesai — supaya memori puncak tidak dobel.
      const left = (st.geomUse.get(geometry) ?? 1) - 1;
      if (left <= 0) {
        st.geomUse.delete(geometry);
        geometry.dispose();
      } else st.geomUse.set(geometry, left);
      piece.geometry = null;

      st.pi++;
      if (performance.now() - t0 > MERGE_BUDGET_MS) break;
    }

    for (const part of [0, 1] as PartIndex[]) {
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

    if (st.pi >= st.pieces.length) this.finishMerge();
    else this.emit('progress', { value: 55 + (st.pi / st.pieces.length) * 44, stage: 'prepare' });
  }

  private finishMerge() {
    this.merge = null;
    window.clearTimeout(this.mergeTimer);
    this.finishIndex();
    this.repaintAll();
    this.renderer.shadowMap.needsUpdate = true;
    this.emit('progress', { value: 100, stage: 'prepare' });
    this.emit('ready', undefined);
    // Baru sekarang animasi masuk dijalankan — modelnya sudah utuh.
    this.flyTo(isoPose(this.bounds), 1.8);
    this.scheduleBvh();
  }

  get isPreparing() {
    return this.merge !== null;
  }

  applyNames(names: ElementNames) {
    this.names = names;
    this.refreshIdentities();
  }

  private clearModel() {
    if (this.modelGroup) {
      this.scene.remove(this.modelGroup);
      for (const p of this.parts) p?.geometry.dispose();
    }
    this.parts = [null, null];
    this.modelGroup = null;
    this.merge = null;
    this.records.clear();
    this.recordList = [];
    this.elements = [];
    this.highlighted.clear();
    this.selectedGid = null;
    this.hoverGid = null;
    this.labelCandidates = [];
    this.minimapRects = [];
  }

  private isSheerMaterial(mat: THREE.Material | THREE.Material[]): boolean {
    const mats = Array.isArray(mat) ? mat : [mat];
    return mats.every((m) => {
      const mm = m as THREE.Material & { opacity?: number };
      return mm.transparent && (mm.opacity ?? 1) < SHEER_OPACITY;
    });
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
    this.buildLabelCandidates();
    this.buildMinimapRects();
  }

  // BVH dibangun setelah model tampil supaya layar tidak "beku". Sebelum siap,
  // klik/hover memakai raycast biasa (lebih lambat, tapi tetap benar).
  private scheduleBvh() {
    const targets = this.parts.filter((p): p is MergedPart => Boolean(p));
    const token = this.loadToken;
    let i = 0;
    const next = () => {
      if (this.disposed || token !== this.loadToken) return;
      const p = targets[i++];
      if (!p) return;
      const bvh = new MeshBVH(p.geometry, { maxLeafTris: 12 });
      (p.geometry as THREE.BufferGeometry & { boundsTree?: MeshBVH }).boundsTree = bvh;
      p.bvhReady = true;
      setTimeout(next, 0);
    };
    setTimeout(next, 120);
  }

  getElement(gid: string): ElementInfo | undefined {
    return this.records.get(gid);
  }

  // ------------------------------------------------------------------ scene dressing
  private buildGround() {
    if (this.ground) {
      this.scene.remove(this.ground);
      this.ground.geometry.dispose();
    }
    if (this.grid) this.scene.remove(this.grid);
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

  private paintRecord(rec: ElementRecord) {
    const sel = rec.gid === this.selectedGid;
    const hi = !sel && this.highlighted.has(rec.gid);
    for (const r of rec.ranges) {
      const part = this.parts[r.part];
      if (!part) continue;
      const arr = part.color.array as Uint8Array;
      const end = (r.vStart + r.vCount) * 4;
      if (sel || hi || this.style === 'mono') {
        const c = sel ? this.cSelected : hi ? this.cHighlight : r.part === 1 ? this.cMonoGlass : this.cMono;
        const a = r.part === 1 ? (sel || hi ? HIGHLIGHT_GLASS_ALPHA : MONO_GLASS_ALPHA) : 255;
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
    this.records.forEach((rec) => this.paintRecord(rec));
    for (const p of this.parts) {
      if (!p) continue;
      p.color.clearUpdateRanges();
      p.color.needsUpdate = true;
    }
  }

  // Cat ulang hanya elemen tertentu; upload ke GPU per rentang kalau sedikit.
  private repaint(gids: Iterable<string>) {
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
      return;
    }
    const touched = new Set<MergedPart>();
    for (const rec of list) {
      this.paintRecord(rec);
      for (const r of rec.ranges) {
        const part = this.parts[r.part];
        if (!part) continue;
        part.color.addUpdateRange(r.vStart * 4, r.vCount * 4);
        touched.add(part);
      }
    }
    touched.forEach((p) => (p.color.needsUpdate = true));
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
    if (this.mode === 'orbit' && !this.tween && !this.merge) {
      const now = performance.now();
      if (now - this.lastHover < 80) return;
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
      this.setHover(this.pickAt(e.clientX, e.clientY), x, y);
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
  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private stepKeys(dt: number) {
    if (this.keys.size === 0) return;
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
  private pickAt(clientX: number, clientY: number): string | null {
    const rect = this.container.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    return this.pickNdc(ndc);
  }

  private recordOfHit(part: MergedPart, hit: THREE.Intersection): ElementRecord | null {
    const face = hit.face;
    if (!face) return null;
    return this.recordList[part.vertexEid[face.a]] ?? null;
  }

  private isNonPhysical(rec: ElementRecord) {
    return NON_PHYSICAL.has(rec.category.toUpperCase());
  }

  // Padat diutamakan; volume ruang/grid/anotasi (non-fisik) tidak boleh
  // merebut klik dari benda nyata di belakangnya.
  private pickNdc(ndc: THREE.Vector2): string | null {
    if (this.merge) return null; // model belum lengkap
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.near = this.camera.near;
    for (const part of this.parts) {
      if (!part) continue;
      const hits = this.raycaster.intersectObject(part.mesh, false);
      const rec = hits[0] ? this.recordOfHit(part, hits[0]) : null;
      if (!rec) continue;
      if (!this.isNonPhysical(rec)) return rec.gid;
      // Kena objek non-fisik: cari benda nyata di baliknya (jalur jarang,
      // jadi boleh pakai raycast penuh).
      this.raycaster.firstHitOnly = false;
      const all = this.raycaster.intersectObject(part.mesh, false);
      this.raycaster.firstHitOnly = true;
      for (const h of all) {
        const r2 = this.recordOfHit(part, h);
        if (r2 && !this.isNonPhysical(r2)) return r2.gid;
      }
      return rec.gid;
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
    const gid = this.pickNdc(new THREE.Vector2(0, 0));
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
    this.renderer.render(this.scene, this.camera);
    this.stepLabels();
    this.stepMinimap(now);
    this.stepCenterLook(now);
    this.frames++;
    if (now - this.lastStats > 500) {
      const fps = Math.round((this.frames * 1000) / (now - this.lastStats));
      this.frames = 0;
      this.lastStats = now;
      const p = this.camera.position;
      this.emit('stats', { fps, eyeHeight: p.y - this.groundY, position: [p.x, p.y, p.z], mode: this.mode });
    }
  };

  // Screenshot PNG dari frame terakhir (preserveDrawingBuffer aktif).
  snapshot(): string {
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.mergeTimer);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.clearModel();
    this.ground?.geometry.dispose();
    [this.matOpaque, this.matSheer].forEach((m) => m.dispose());
    this.renderer.dispose();
    el.remove();
    this.labelLayer.remove();
    this.listeners.clear();
  }
}
