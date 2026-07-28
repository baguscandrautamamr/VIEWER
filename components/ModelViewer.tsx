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
// Sensitivitas menoleh (radian per piksel geseran mouse).
const LOOK_SENSITIVITY = 0.005; // Shift + klik kiri
const LOOK_SENSITIVITY_SLOW = 0.002; // roda tengah di mode Diam — sengaja pelan

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

  const [mode, setMode] = useState<IsolateMode>('object');
  const [isolateOn, setIsolateOn] = useState(true);
  const [selected, setSelected] = useState<{ globalId: string; category: string | null } | null>(null);
  const [liveUpdateMessage, setLiveUpdateMessage] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [markupOn, setMarkupOn] = useState(false);
  const [sectionOn, setSectionOn] = useState(false);
  const [clip, setClip] = useState({ xMin: 1, xMax: 1, yMin: 1, yMax: 1, zMin: 1, zMax: 1 });

  const [tool, setToolState] = useState<Tool>('orbit');
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeData, setTreeData] = useState<TreeCategory[]>([]);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [measureDist, setMeasureDist] = useState<number | null>(null);
  const [walking, setWalking] = useState(false);
  const [speedMult, setSpeedMult] = useState(1);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [lockOn, setLockOn] = useState(false);

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

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

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
      if (moved) return;
      // Shift + klik dipakai untuk menoleh — jangan ubah seleksi elemen.
      if (event.shiftKey) return;
      const activeTool = toolRef.current;
      if (activeTool === 'walk') return;

      const rect = container.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

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
            : lockOn
              ? `${t.lockOnHint} · ${t.navKeys}`
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

      {/* Hint tool aktif + pintasan Shift (atas-tengah). */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-20 max-w-[46%] -translate-x-1/2 rounded bg-black/40 px-2 py-1 text-center text-xs text-white opacity-80 backdrop-blur">
        <div>{toolHint}</div>
        {tool !== 'walk' && !markupOn && (
          <div className="mt-0.5 text-[10px] opacity-70">{t.shiftKeys}</div>
        )}
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
