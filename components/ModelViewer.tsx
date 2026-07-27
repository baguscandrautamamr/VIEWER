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
const DEFAULT_CATEGORY = 'Default';
// Palet warna untuk fitur "Ganti Warna" elemen terpilih.
const PAINT_COLORS = ['#ef4444', '#f59e0b', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ffffff'];

export default function ModelViewer({
  projectId,
  initialGlbUrl,
  locale = 'id',
  cameraPreset = null,
  onElementSelect,
}: ModelViewerProps) {
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
  const modeRef = useRef<IsolateMode>('object');
  const isolateOnRef = useRef(true);
  const dimMaterialRef = useRef<THREE.Material | null>(null);
  // Mesh yang terakhir diklik (dipakai fitur ganti warna).
  const selectedMeshRef = useRef<THREE.Mesh | null>(null);
  // Override warna per globalId (fitur "Ganti Warna"). Bertahan lewat isolate.
  const colorMatByGid = useRef<Map<string, THREE.Material>>(new Map());

  // --- Tool aktif ---
  const toolRef = useRef<Tool>('orbit');

  // --- Measure (ukur jarak) ---
  const measurePtsRef = useRef<THREE.Vector3[]>([]);
  const measureGroupRef = useRef<THREE.Group | null>(null);
  const measureLabelElRef = useRef<HTMLDivElement | null>(null);

  // --- Section box interaktif ---
  // Batas kotak dalam koordinat dunia (model sudah di-center ke origin).
  // Disimpan di ref, bukan state: di-update tiap gerakan mouse saat drag,
  // jadi tidak memicu re-render React tiap frame.
  const sectionBoundsRef = useRef({ minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: -1, maxZ: 1 });
  const sectionGroupRef = useRef<THREE.Group | null>(null);
  const sectionEdgesRef = useRef<THREE.LineSegments | null>(null);
  const sectionHandlesRef = useRef<THREE.Mesh[]>([]);
  // Handle yang sedang ditarik: sumbu + sisi (1 = sisi max, -1 = sisi min).
  const sectionDragRef = useRef<{ axis: 'x' | 'y' | 'z'; side: 1 | -1 } | null>(null);
  const sectionInfoElRef = useRef<HTMLDivElement | null>(null);
  const sectionOnRef = useRef(false);
  // Klik yang harus diabaikan karena barusan menarik handle section.
  const suppressClickRef = useRef(false);
  // Handler pointer dipasang sekali saat mount, jadi tidak melihat perubahan
  // state biasa — pakai ref supaya status markup selalu terbaca terbaru.
  const markupOnRef = useRef(false);

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

  const [mode, setMode] = useState<IsolateMode>('object');
  const [isolateOn, setIsolateOn] = useState(true);
  const [selected, setSelected] = useState<{ globalId: string; category: string | null } | null>(null);
  const [liveUpdateMessage, setLiveUpdateMessage] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [markupOn, setMarkupOn] = useState(false);
  const [sectionOn, setSectionOn] = useState(false);

  const [tool, setToolState] = useState<Tool>('orbit');
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeData, setTreeData] = useState<TreeCategory[]>([]);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [measureDist, setMeasureDist] = useState<number | null>(null);
  const [walking, setWalking] = useState(false);
  const [speedMult, setSpeedMult] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);

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
    if (!next) resetIsolation();
  }

  // Pilih tool navigasi. Mengatur perilaku mouse OrbitControls (pan/rotate),
  // dan masuk/keluar mode walkthrough (pointer lock).
  function selectTool(next: Tool) {
    if (toolRef.current === 'walk' && next !== 'walk') {
      walkControlsRef.current?.unlock();
    }
    toolRef.current = next;
    setToolState(next);
    const controls = controlsRef.current;
    if (controls) {
      controls.mouseButtons.LEFT = next === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    }
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

  // Ambil peta kategori tiap elemen dari Supabase (anon, dibatasi RLS).
  useEffect(() => {
    let active = true;
    getSupabase()
      .from('elements')
      .select('global_id, category')
      .eq('project_id', projectId)
      .then(({ data }) => {
        if (!active || !data) return;
        const map = new Map<string, string>();
        data.forEach((row) => {
          if (row.category) map.set(row.global_id as string, row.category as string);
        });
        categoryByGlobalId.current = map;
        buildTree(); // kategori dari DB baru datang -> susun ulang tree
      });
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

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    loadModel(scene, initialGlbUrl);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    // Isi `pointer` (koordinat NDC) dari posisi mouse di dalam container.
    function setPointerFromEvent(event: MouseEvent | PointerEvent) {
      const rect = container.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    }

    let downX = 0;
    let downY = 0;
    let moved = false;
    function handlePointerDown(event: PointerEvent) {
      downX = event.clientX;
      downY = event.clientY;
      moved = false;

      // Handle section box punya prioritas di atas orbit & seleksi objek.
      if (sectionOnRef.current && toolRef.current !== 'walk') {
        setPointerFromEvent(event);
        raycaster.setFromCamera(pointer, camera);
        if (beginSectionDrag(raycaster)) {
          renderer.domElement.setPointerCapture(event.pointerId);
        }
      }
    }
    function handlePointerMove(event: PointerEvent) {
      if (Math.abs(event.clientX - downX) > 4 || Math.abs(event.clientY - downY) > 4) {
        moved = true;
      }
      if (sectionDragRef.current) {
        setPointerFromEvent(event);
        raycaster.setFromCamera(pointer, camera);
        updateSectionDrag(raycaster);
        return;
      }
      // Ubah kursor jadi "grab" saat menyentuh handle, biar kelihatan bisa ditarik.
      if (sectionOnRef.current && !walkingRef.current) {
        setPointerFromEvent(event);
        raycaster.setFromCamera(pointer, camera);
        const overHandle = raycaster.intersectObjects(sectionHandlesRef.current, false).length > 0;
        renderer.domElement.style.cursor = overHandle ? 'grab' : '';
      }
    }
    function handlePointerUp() {
      endSectionDrag();
    }

    function handleClick(event: MouseEvent) {
      if (moved) return;
      // Klik untuk menarik handle section — jangan ikut mengubah seleksi.
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const activeTool = toolRef.current;
      if (activeTool === 'walk') return;

      setPointerFromEvent(event);
      raycaster.setFromCamera(pointer, camera);
      const root = modelRootRef.current;
      const intersects = raycaster.intersectObjects(root ? [root] : scene.children, true);
      const hit = intersects.find((i) => (i.object as THREE.Mesh).visible !== false) ?? intersects[0];

      if (activeTool === 'measure') {
        if (hit) addMeasurePoint(hit.point.clone());
        return;
      }

      // orbit / pan -> seleksi + isolate
      if (hit) {
        const target = hit.object as THREE.Mesh;
        const gid = (target.userData.globalId as string) || null;
        selectedMeshRef.current = target;
        if (isolateOnRef.current) {
          if (modeRef.current === 'category') isolateByCategory(target);
          else isolateMesh(target);
        }
        setSelected({ globalId: gid ?? '—', category: categoryOf(target) });
        onElementSelect?.(gid);
      } else {
        resetIsolation();
        selectedMeshRef.current = null;
        setSelected(null);
        onElementSelect?.(null);
      }
    }
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointercancel', handlePointerUp);
    renderer.domElement.addEventListener('click', handleClick);

    // Pemetaan tombol gerak (sama untuk orbit & walkthrough):
    //   W/S atau ↑/↓ = maju/mundur, A/D atau ←/→ = kiri/kanan,
    //   Q / Space / PageUp = naik, E / Shift / PageDown = turun.
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
        case 'ShiftLeft':
        case 'ShiftRight':
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
      if (setMoveKey(target, e, true)) e.preventDefault();
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
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointercancel', handlePointerUp);
      renderer.domElement.removeEventListener('click', handleClick);
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

    updateSectionGizmo();

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
    const loader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    loader.setDRACOLoader(dracoLoader);
    loader.load(
      glbUrl,
      (gltf) => {
        if (modelRootRef.current) scene.remove(modelRootRef.current);
        meshesByGlobalId.current.clear();
        originalMaterials.current.clear();
        colorMatByGid.current.clear();
        selectedMeshRef.current = null;

        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const globalId = child.userData?.gltfExtensions?.globalId ?? child.name;
            child.userData.globalId = globalId;
            meshesByGlobalId.current.set(globalId, child);
            originalMaterials.current.set(child, child.material);
            if (highlightIds.includes(globalId)) flashHighlight(child);
          }
        });

        scene.add(gltf.scene);
        modelRootRef.current = gltf.scene;
        frameCameraToObject(gltf.scene);
        setHiddenCategories(new Set());
        setHiddenIds(new Set());
        buildTree();
        // Ukuran model baru diketahui -> kotak section ikut menyesuaikan.
        resetSectionBounds();
        applySection();
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
      if (!inner.has(gid)) inner.set(gid, child.name || gid);
    });
    const cats: TreeCategory[] = Array.from(byCat.entries())
      .map(([category, inner]) => ({
        category,
        elements: Array.from(inner.entries()).map(([globalId, name]) => ({ globalId, name })),
      }))
      .sort((a, b) => a.category.localeCompare(b.category));
    setTreeData(cats);
  }

  function focusModel() {
    if (modelRootRef.current) frameCameraToObject(modelRootRef.current);
  }

  function focusOnMesh(mesh: THREE.Mesh) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 2.5;
    const dir = new THREE.Vector3(1, 0.8, 1).normalize();
    camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    controls.target.copy(center);
    controls.update();
  }

  // --- Section box interaktif (gizmo 6 handle, gaya Navisworks) ---

  // Warna handle per sumbu, konvensi umum CAD: X merah, Y hijau, Z biru.
  const AXIS_COLOR: Record<'x' | 'y' | 'z', number> = { x: 0xef4444, y: 0x22c55e, z: 0x3b82f6 };

  // Kembalikan kotak ke ukuran penuh model.
  function resetSectionBounds() {
    const s = modelSizeRef.current;
    sectionBoundsRef.current = {
      minX: -s.x / 2,
      maxX: s.x / 2,
      minY: -s.y / 2,
      maxY: s.y / 2,
      minZ: -s.z / 2,
      maxZ: s.z / 2,
    };
  }

  function resetSection() {
    resetSectionBounds();
    applySection();
  }

  // Bangun gizmo sekali: rangka kotak + 6 handle kubus kecil (satu per sisi).
  function ensureSectionGizmo(): THREE.Group | null {
    if (sectionGroupRef.current) return sectionGroupRef.current;
    const scene = sceneRef.current;
    if (!scene) return null;

    const group = new THREE.Group();

    const boxGeom = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeom),
      new THREE.LineBasicMaterial({ color: 0x22d3ee, depthTest: false, transparent: true, opacity: 0.9 })
    );
    edges.renderOrder = 998;
    group.add(edges);
    sectionEdgesRef.current = edges;
    boxGeom.dispose();

    const handles: THREE.Mesh[] = [];
    (['x', 'y', 'z'] as const).forEach((axis) => {
      ([1, -1] as const).forEach((side) => {
        const h = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshBasicMaterial({ color: AXIS_COLOR[axis], depthTest: false })
        );
        h.renderOrder = 999;
        h.userData.axis = axis;
        h.userData.side = side;
        group.add(h);
        handles.push(h);
      });
    });
    sectionHandlesRef.current = handles;

    scene.add(group);
    sectionGroupRef.current = group;
    return group;
  }

  // Terapkan batas kotak ke clipping planes renderer + tampilkan/sembunyikan
  // gizmo. Dipanggil saat toggle, model selesai load, dan tiap gerakan drag.
  function applySection() {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const b = sectionBoundsRef.current;
    const [pXmax, pXmin, pYmax, pYmin, pZmax, pZmin] = clipPlanesRef.current;
    // Bidang menyimpan sisi DALAM kotak: normal·p + constant > 0.
    pXmax.constant = b.maxX; // normal (-1,0,0) -> x < maxX
    pXmin.constant = -b.minX; // normal (1,0,0)  -> x > minX
    pYmax.constant = b.maxY;
    pYmin.constant = -b.minY;
    pZmax.constant = b.maxZ;
    pZmin.constant = -b.minZ;
    renderer.clippingPlanes = sectionOnRef.current ? clipPlanesRef.current : [];

    const group = sectionOnRef.current ? ensureSectionGizmo() : sectionGroupRef.current;
    if (group) group.visible = sectionOnRef.current;
  }

  // Sinkronkan ref dengan state toggle, lalu terapkan.
  useEffect(() => {
    sectionOnRef.current = sectionOn;
    applySection();
    if (!sectionOn) {
      endSectionDrag();
      const canvas = rendererRef.current?.domElement;
      if (canvas) canvas.style.cursor = ''; // buang kursor "grab" sisa hover handle
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionOn, loadState]);

  // Posisi & skala gizmo dihitung tiap frame (dipanggil dari updateOverlays):
  // rangka mengikuti batas kotak, handle dijaga berukuran tetap di layar dan
  // digeser sedikit ke DALAM kotak supaya tidak ikut terpotong clipping.
  function updateSectionGizmo() {
    const group = sectionGroupRef.current;
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!group || !group.visible || !camera || !container) return;

    const b = sectionBoundsRef.current;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const sx = Math.max(b.maxX - b.minX, 1e-6);
    const sy = Math.max(b.maxY - b.minY, 1e-6);
    const sz = Math.max(b.maxZ - b.minZ, 1e-6);

    const edges = sectionEdgesRef.current;
    if (edges) {
      edges.position.set(cx, cy, cz);
      // Sedikit lebih kecil dari kotak: garis yang tepat di atas bidang potong
      // akan ikut terbuang oleh clipping (uji > 0), jadi ditarik ke dalam.
      edges.scale.set(sx * 0.999, sy * 0.999, sz * 0.999);
    }

    const tanHalfFov = Math.tan((camera.fov * Math.PI) / 360);
    const targetPx = 9;
    const h = container.clientHeight || 1;

    sectionHandlesRef.current.forEach((handle) => {
      const axis = handle.userData.axis as 'x' | 'y' | 'z';
      const side = handle.userData.side as 1 | -1;
      const pos = new THREE.Vector3(cx, cy, cz);
      if (axis === 'x') pos.x = side === 1 ? b.maxX : b.minX;
      if (axis === 'y') pos.y = side === 1 ? b.maxY : b.minY;
      if (axis === 'z') pos.z = side === 1 ? b.maxZ : b.minZ;

      const dist = camera.position.distanceTo(pos);
      const size = (targetPx * tanHalfFov * dist) / (h / 2);
      handle.scale.setScalar(size * 2);
      // Geser ke dalam kotak sebesar ukurannya supaya tidak terpotong.
      pos[axis] -= side * size * 1.2;
      handle.position.copy(pos);
    });

    const info = sectionInfoElRef.current;
    if (info) info.textContent = `${sx.toFixed(1)} × ${sz.toFixed(1)} × ${sy.toFixed(1)} m`;
  }

  // Titik terdekat pada sebuah garis (sumbu) terhadap sinar mouse. Dipakai
  // supaya handle bergerak persis mengikuti mouse sepanjang sumbunya saja.
  function axisOffsetFromRay(
    ray: THREE.Ray,
    axisOrigin: THREE.Vector3,
    axisDir: THREE.Vector3
  ): number | null {
    const w0 = axisOrigin.clone().sub(ray.origin);
    const b = axisDir.dot(ray.direction);
    const denom = 1 - b * b;
    if (Math.abs(denom) < 1e-6) return null; // sumbu sejajar arah pandang
    const d = axisDir.dot(w0);
    const e = ray.direction.dot(w0);
    return (b * e - d) / denom;
  }

  // Mulai drag kalau pointer mengenai salah satu handle. Return true bila kena.
  function beginSectionDrag(raycaster: THREE.Raycaster): boolean {
    if (!sectionOnRef.current) return false;
    const handles = sectionHandlesRef.current;
    if (!handles.length) return false;
    const hits = raycaster.intersectObjects(handles, false);
    if (!hits.length) return false;
    const handle = hits[0].object;
    sectionDragRef.current = {
      axis: handle.userData.axis as 'x' | 'y' | 'z',
      side: handle.userData.side as 1 | -1,
    };
    if (controlsRef.current) controlsRef.current.enabled = false;
    suppressClickRef.current = true;
    return true;
  }

  // Geser satu sisi kotak mengikuti mouse, dibatasi ukuran model & sisi lawan.
  function updateSectionDrag(raycaster: THREE.Raycaster) {
    const drag = sectionDragRef.current;
    if (!drag) return;
    const { axis, side } = drag;
    const b = sectionBoundsRef.current;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const cz = (b.minZ + b.maxZ) / 2;

    const upper = axis === 'x' ? b.maxX : axis === 'y' ? b.maxY : b.maxZ;
    const lower = axis === 'x' ? b.minX : axis === 'y' ? b.minY : b.minZ;
    const facePos = side === 1 ? upper : lower;

    const axisOrigin = new THREE.Vector3(cx, cy, cz);
    axisOrigin[axis] = facePos;
    const axisDir = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);

    const t = axisOffsetFromRay(raycaster.ray, axisOrigin, axisDir);
    if (t === null) return;

    const size = modelSizeRef.current;
    const half = (axis === 'x' ? size.x : axis === 'y' ? size.y : size.z) / 2 || 1;
    const gap = half * 0.02; // sisa ketebalan minimum supaya kotak tak terbalik
    let value = facePos + t;
    if (side === 1) value = Math.min(Math.max(value, lower + gap), half);
    else value = Math.max(Math.min(value, upper - gap), -half);

    if (axis === 'x') side === 1 ? (b.maxX = value) : (b.minX = value);
    else if (axis === 'y') side === 1 ? (b.maxY = value) : (b.minY = value);
    else side === 1 ? (b.maxZ = value) : (b.minZ = value);

    applySection();
  }

  function endSectionDrag() {
    if (!sectionDragRef.current) return;
    sectionDragRef.current = null;
    if (controlsRef.current) controlsRef.current.enabled = !markupOnRef.current && !walkingRef.current;
  }

  useEffect(() => {
    markupOnRef.current = markupOn;
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
    walkSpeedRef.current = maxDim * 0.4; // kecepatan jalan relatif ukuran model
    camera.near = Math.max(maxDim / 1000, 0.01);
    camera.far = maxDim * 100;
    camera.position.set(dist, dist * 0.8, dist);
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
  }

  function forEachMesh(cb: (mesh: THREE.Mesh) => void) {
    const root = modelRootRef.current;
    if (!root) return;
    root.traverse((child) => {
      if (child instanceof THREE.Mesh) cb(child);
    });
  }

  function categoryOf(mesh: THREE.Mesh): string | null {
    const gid = (mesh.userData.globalId as string) || '';
    const fromDb = categoryByGlobalId.current.get(gid);
    if (fromDb) return fromDb;
    const name = mesh.name || '';
    if (name.includes(':')) return name.split(':')[0].trim() || null;
    return null;
  }

  function isolateMesh(target: THREE.Mesh) {
    forEachMesh((mesh) => {
      if (mesh === target) restoreMesh(mesh);
      else dimMesh(mesh);
    });
  }

  function isolateByCategory(target: THREE.Mesh) {
    const targetCat = categoryOf(target);
    if (!targetCat) {
      isolateMesh(target);
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

  // Kembalikan material mesh: override warna (kalau ada) diprioritaskan,
  // baru material asli.
  function restoreMesh(mesh: THREE.Mesh) {
    const gid = (mesh.userData.globalId as string) || '';
    const override = colorMatByGid.current.get(gid);
    const original = originalMaterials.current.get(mesh);
    if (override) mesh.material = override;
    else if (original) mesh.material = original;
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

  // --- Ganti warna elemen terpilih ---
  function applyColor(hex: string) {
    const mesh = selectedMeshRef.current;
    if (!mesh) return;
    const gid = (mesh.userData.globalId as string) || '';
    if (!gid) return;
    const orig = originalMaterials.current.get(mesh);
    const base = (Array.isArray(orig) ? orig[0] : orig) as THREE.Material | undefined;
    const clone = base ? (base.clone() as THREE.Material) : new THREE.MeshStandardMaterial();
    // @ts-expect-error material standar punya .color
    clone.color = new THREE.Color(hex);
    colorMatByGid.current.set(gid, clone);
    restoreMesh(mesh);
  }

  function resetColor() {
    const mesh = selectedMeshRef.current;
    if (!mesh) return;
    const gid = (mesh.userData.globalId as string) || '';
    colorMatByGid.current.delete(gid);
    restoreMesh(mesh);
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
      setMeasureDist(measurePtsRef.current[0].distanceTo(measurePtsRef.current[1]));
    } else {
      setMeasureDist(null);
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
  }

  // --- Selection Tree callbacks ---
  function selectElementById(gid: string) {
    const mesh = meshesByGlobalId.current.get(gid);
    if (!mesh) return;
    selectedMeshRef.current = mesh;
    if (isolateOnRef.current) {
      if (modeRef.current === 'category') isolateByCategory(mesh);
      else isolateMesh(mesh);
    }
    setSelected({ globalId: gid, category: categoryOf(mesh) });
    onElementSelect?.(gid);
    focusOnMesh(mesh);
  }

  function selectCategory(cat: string) {
    const mesh = meshesByGlobalId.current.get(
      treeData.find((c) => c.category === cat)?.elements[0]?.globalId ?? ''
    );
    if (isolateOnRef.current && mesh) isolateByCategory(mesh);
    if (mesh) {
      selectedMeshRef.current = mesh;
      setSelected({ globalId: mesh.userData.globalId as string, category: cat });
    }
  }

  function setElementVisible(gid: string, visible: boolean) {
    forEachMesh((mesh) => {
      if ((mesh.userData.globalId as string) === gid) mesh.visible = visible;
    });
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
    setHiddenCategories(new Set());
    setHiddenIds(new Set());
  }

  const btnBase = 'rounded px-2 py-1 text-xs transition-colors';
  const dockBtn = (active: boolean) =>
    `flex h-9 w-9 items-center justify-center rounded border text-base transition-colors ${
      active ? 'border-accent bg-accent text-black' : 'border-white/20 bg-black/50 text-white hover:bg-black/70'
    }`;

  const toolHint =
    tool === 'pan'
      ? `${t.panHint} · ${t.navKeys}`
      : tool === 'measure'
        ? t.measureHint
        : tool === 'walk'
          ? t.walkHint
          : markupOn
            ? t.markupFrozen
            : `${t.isolateHint} · ${t.navKeys}`;

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full" />

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
      </div>

      {/* Hint tool aktif (atas-tengah). */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded bg-black/40 px-2 py-1 text-xs text-white opacity-80 backdrop-blur">
        {toolHint}
      </div>

      {/* Kontrol mode isolate + tampilan (kanan atas). */}
      <div className="absolute right-3 top-3 z-30 flex max-w-[70%] flex-wrap items-center justify-end gap-2">
        <button
          onClick={toggleIsolate}
          className={`${btnBase} border border-white/20 backdrop-blur ${
            isolateOn ? 'bg-accent text-black' : 'bg-black/50 text-white'
          }`}
          title={t.isolate}
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
          onClick={() => {
            resetIsolation();
            setSelected(null);
            selectedMeshRef.current = null;
          }}
          className={`${btnBase} border border-white/20 bg-black/50 text-white backdrop-blur`}
        >
          {t.resetView}
        </button>
      </div>

      {/* Panel section box: ukuran kotak + reset. Pemotongan diatur dengan
          menarik handle berwarna langsung di 3D (X merah, Y hijau, Z biru). */}
      {sectionOn && (
        <div className="absolute right-3 top-14 z-30 w-56 rounded border border-white/20 bg-black/60 p-3 text-white backdrop-blur">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium">{t.section}</span>
            <button onClick={resetSection} className="text-[11px] opacity-70 hover:opacity-100">
              {t.resetView}
            </button>
          </div>
          <div ref={sectionInfoElRef} className="mb-1.5 font-mono text-[11px] text-cyan-300" />
          <p className="text-[11px] leading-snug opacity-60">{t.sectionHint}</p>
        </div>
      )}

      {/* Readout hasil ukur — tetap tampil walau kamera digerakkan (bukan
          hanya saat tool measure aktif) selama masih ada hasil. */}
      {measureDist != null && (
        <div className="absolute bottom-3 left-1/2 z-30 -translate-x-1/2 rounded border border-white/20 bg-black/70 px-3 py-1.5 text-xs text-white backdrop-blur">
          {t.measureResult}: <span className="font-semibold text-cyan-300">{measureDist.toFixed(2)} m</span>
          <button onClick={clearMeasure} className="ml-3 opacity-70 underline hover:opacity-100">
            {t.measureClear}
          </button>
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

      {/* Info elemen terpilih + ganti warna. */}
      {selected && (
        <div className="absolute bottom-3 left-3 z-30 rounded bg-black/70 px-3 py-2 text-xs text-white backdrop-blur">
          <div className="opacity-60">{t.selected}</div>
          <div className="font-medium">{selected.category ?? t.noCategory}</div>
          <div className="mb-2 opacity-50">{selected.globalId}</div>
          {selected.globalId !== '—' && (
            <div className="flex items-center gap-1.5">
              <span className="mr-1 opacity-60">{t.color}:</span>
              {PAINT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => applyColor(c)}
                  aria-label={c}
                  style={{ background: c }}
                  className="h-4 w-4 rounded-full border border-white/40 hover:scale-110"
                />
              ))}
              <button
                onClick={resetColor}
                className="ml-1 text-[10px] opacity-70 underline hover:opacity-100"
                title={t.colorReset}
              >
                ↺
              </button>
            </div>
          )}
        </div>
      )}

      {liveUpdateMessage && (
        <div className="absolute bottom-3 right-3 z-30 rounded bg-black/70 px-3 py-1 text-xs text-white">
          {liveUpdateMessage}
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
