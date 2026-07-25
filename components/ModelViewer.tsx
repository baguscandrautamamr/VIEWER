'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { subscribeToProjectUpdates, unsubscribe } from '@/lib/realtime';
import { getSupabase } from '@/lib/supabase';
import { locales, type Locale } from '@/lib/i18n';

interface ModelViewerProps {
  projectId: string;
  initialGlbUrl: string;
  locale?: Locale;
  // Preset kamera dari klik sheet: top/bottom/front/back/left/right/iso.
  cameraPreset?: string | null;
  onElementSelect?: (globalId: string | null) => void;
}

type IsolateMode = 'object' | 'category';

const DIMMED_OPACITY = 0.12;
const HIGHLIGHT_DURATION_MS = 3000;

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
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  // 6 bidang potong (section box). Urutan: X+, X−, Y+, Y−, Z+, Z−.
  // Normal menghadap ke DALAM box; constant di-set dari ukuran model.
  const clipPlanesRef = useRef<THREE.Plane[]>([
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
    new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), 0),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  ]);
  const modelRootRef = useRef<THREE.Object3D | null>(null);
  // Ukuran bounding box model (buat menghitung jarak kamera preset).
  const modelSizeRef = useRef<THREE.Vector3>(new THREE.Vector3(1, 1, 1));
  const meshesByGlobalId = useRef<Map<string, THREE.Mesh>>(new Map());
  const originalMaterials = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());
  // GlobalId -> category, diambil dari tabel `elements`. Dipakai untuk
  // isolate per-kategori (klik 1 lighting -> semua lighting).
  const categoryByGlobalId = useRef<Map<string, string>>(new Map());
  // Mode dibaca dari ref di dalam handler klik (handler dipasang sekali saat
  // mount, jadi tidak lihat perubahan state biasa). State dipakai untuk UI.
  const modeRef = useRef<IsolateMode>('object');

  const [mode, setMode] = useState<IsolateMode>('object');
  const [selected, setSelected] = useState<{ globalId: string; category: string | null } | null>(null);
  const [liveUpdateMessage, setLiveUpdateMessage] = useState<string | null>(null);
  // Status load model: buat overlay "Memuat…"/"Gagal" supaya layar tidak blank
  // tanpa penjelasan (mis. saat GLB besar / Draco gagal decode).
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  // Section box: on/off + posisi tiap sisi (0..1 fraksi dari setengah ukuran
  // model; 1 = di tepi/tidak memotong, 0 = di tengah).
  const [sectionOn, setSectionOn] = useState(false);
  const [clip, setClip] = useState({ xMin: 1, xMax: 1, yMin: 1, yMax: 1, zMin: 1, zMax: 1 });

  const t = locales[locale].viewer;

  function changeMode(next: IsolateMode) {
    modeRef.current = next;
    setMode(next);
  }

  // Ambil peta kategori tiap elemen dari Supabase (anon, dibatasi RLS).
  // Kalau tabel `elements` masih kosong, mode kategori otomatis fallback ke
  // isolate 1 objek — jadi tetap jalan, cuma belum grouping.
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
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  // Setup scene sekali saat mount. Loading & reload GLB dipisah ke fungsi
  // loadModel supaya bisa dipanggil ulang saat ada push baru dari Revit.
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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    loadModel(scene, initialGlbUrl);

    // Raycasting untuk isolate-on-click.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function handleClick(event: MouseEvent) {
      const rect = container.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);

      if (intersects.length > 0) {
        const target = intersects[0].object as THREE.Mesh;
        const gid = (target.userData.globalId as string) ?? null;

        if (modeRef.current === 'category') {
          isolateByCategory(target);
        } else {
          isolateMesh(target);
        }

        setSelected(gid ? { globalId: gid, category: categoryByGlobalId.current.get(gid) ?? null } : null);
        onElementSelect?.(gid);
      } else {
        resetIsolation();
        setSelected(null);
        onElementSelect?.(null);
      }
    }
    renderer.domElement.addEventListener('click', handleClick);

    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    function handleResize() {
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    }
    // Pakai ResizeObserver (bukan cuma window.resize) supaya canvas ikut
    // menyesuaikan saat container melebar/menyempit — mis. waktu sidebar sheet
    // dibuka/ditutup, viewer harus langsung isi ruang penuh.
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(container);
    window.addEventListener('resize', handleResize);

    // Subscribe ke perubahan push dari Revit — lihat lib/realtime.ts.
    const channel = subscribeToProjectUpdates(projectId, (version) => {
      setLiveUpdateMessage(t.liveUpdate);
      // Ambil model versi baru lewat proxy (Drive/Supabase ditangani server).
      loadModel(scene, `/api/model/${version.id}`, version.changed_global_ids);
      setTimeout(() => setLiveUpdateMessage(null), HIGHLIGHT_DURATION_MS);
    });

    return () => {
      renderer.domElement.removeEventListener('click', handleClick);
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      unsubscribe(channel);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, initialGlbUrl]);

  // Klik sheet -> pindahkan kamera ke sudut preset. Model sudah di-center ke
  // origin (lihat frameCameraToObject) & scene Y-up, jadi target = (0,0,0).
  function applyCameraPreset(preset: string) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const key = preset.split('#')[0]; // buang suffix tick ("top#3" -> "top")
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

  // Terapkan preset kamera saat prop cameraPreset berubah (klik sheet).
  useEffect(() => {
    if (cameraPreset) applyCameraPreset(cameraPreset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraPreset]);

  function loadModel(scene: THREE.Scene, glbUrl: string, highlightIds: string[] = []) {
    setLoadState('loading');
    const loader = new GLTFLoader();
    // Dukung GLB terkompresi Draco (KHR_draco_mesh_compression). Decoder di-serve
    // dari /public/draco (lihat public/draco), jadi tidak bergantung CDN.
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    loader.setDRACOLoader(dracoLoader);
    loader.load(
      glbUrl,
      (gltf) => {
        // Buang model versi lama sebelum pasang yang baru (group root, bukan
        // per-mesh — mesh-nya anak dari group ini, bukan anak langsung scene).
        if (modelRootRef.current) scene.remove(modelRootRef.current);
        meshesByGlobalId.current.clear();
        originalMaterials.current.clear();

        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            // GlobalId ikut terbawa dari IFC -> glTF extras saat convert.
            const globalId = child.userData?.gltfExtensions?.globalId ?? child.name;
            child.userData.globalId = globalId;
            meshesByGlobalId.current.set(globalId, child);
            originalMaterials.current.set(child, child.material);

            if (highlightIds.includes(globalId)) {
              flashHighlight(child);
            }
          }
        });

        scene.add(gltf.scene);
        modelRootRef.current = gltf.scene;
        frameCameraToObject(gltf.scene);
        setLoadState('ready');
        dracoLoader.dispose(); // bebaskan worker decoder Draco
      },
      undefined,
      (err) => {
        // Kalau GLB gagal di-load (CORS, URL salah, file rusak, Draco tak ke-
        // decode), catat di console + tampilkan overlay error, jangan blank.
        console.error('Gagal load GLB:', glbUrl, err);
        setLoadState('error');
        dracoLoader.dispose();
      }
    );
  }

  // Tombol "Fokus": frame ulang kamera ke model saat ini (kalau model ke luar
  // layar / user tersesat saat orbit). Aman dipanggil berulang — model sudah
  // di-center ke origin, jadi cuma reposisi kamera.
  function focusModel() {
    if (modelRootRef.current) frameCameraToObject(modelRootRef.current);
  }

  // Terapkan section box: hitung constant tiap bidang dari ukuran model, lalu
  // pasang ke renderer.clippingPlanes (global -> memotong semua objek). Kalau
  // section off, kosongkan supaya tidak ada potongan.
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

  // Re-apply saat toggle/slider berubah, atau saat model baru selesai load
  // (ukuran model baru diketahui setelah 'ready').
  useEffect(() => {
    applyClipping();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionOn, clip, loadState]);

  function resetSection() {
    setClip({ xMin: 1, xMax: 1, yMin: 1, yMax: 1, zMin: 1, zMax: 1 });
  }

  // Model IFC dari Revit sering pakai koordinat dunia yang jauh dari origin
  // (survey/shared coords) dan ukurannya bervariasi. Tanpa ini, kamera default
  // (10,10,10) nunjuk ke (0,0,0) dan modelnya "di luar layar" -> viewport hitam.
  // Jadi: pindahkan center model ke origin, lalu set jarak & near/far kamera
  // berdasarkan ukuran model biar selalu ke-frame pas.
  function frameCameraToObject(object: THREE.Object3D) {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    object.position.sub(center); // center model -> (0,0,0)
    modelSizeRef.current = size.clone();

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 1.8;
    camera.near = Math.max(maxDim / 1000, 0.01);
    camera.far = maxDim * 100;
    camera.position.set(dist, dist * 0.8, dist);
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
  }

  // Mode "Objek": cuma 1 mesh yang diklik yang tetap terang.
  function isolateMesh(target: THREE.Mesh) {
    meshesByGlobalId.current.forEach((mesh) => {
      if (mesh === target) restoreMesh(mesh);
      else dimMesh(mesh);
    });
  }

  // Mode "Kategori": semua mesh dengan kategori sama seperti yang diklik
  // tetap terang. Kalau elemen yang diklik belum punya data kategori,
  // fallback ke isolate 1 objek biar tetap ada efeknya.
  function isolateByCategory(target: THREE.Mesh) {
    const targetCat = categoryByGlobalId.current.get(target.userData.globalId as string) ?? null;
    if (!targetCat) {
      isolateMesh(target);
      return;
    }
    meshesByGlobalId.current.forEach((mesh) => {
      const cat = categoryByGlobalId.current.get(mesh.userData.globalId as string) ?? null;
      if (cat === targetCat) restoreMesh(mesh);
      else dimMesh(mesh);
    });
  }

  function resetIsolation() {
    meshesByGlobalId.current.forEach((mesh) => restoreMesh(mesh));
  }

  function restoreMesh(mesh: THREE.Mesh) {
    const original = originalMaterials.current.get(mesh);
    if (original) mesh.material = original;
  }

  function dimMesh(mesh: THREE.Mesh) {
    const dimmedMaterial = new THREE.MeshStandardMaterial({
      color: 0x888888,
      transparent: true,
      opacity: DIMMED_OPACITY,
      depthWrite: false,
    });
    mesh.material = dimmedMaterial;
  }

  function flashHighlight(mesh: THREE.Mesh) {
    // Highlight sementara untuk element yang baru berubah dari push
    // terakhir. Warna aksen bisa disesuaikan ke identitas project.
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

  const btnBase = 'rounded px-2 py-1 text-xs transition-colors';

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      <div className="pointer-events-none absolute left-3 top-3 text-xs opacity-70">
        {t.isolateHint}
      </div>

      {/* Kontrol mode isolate + reset */}
      <div className="absolute right-3 top-3 flex items-center gap-2">
        <div className="flex overflow-hidden rounded border border-white/20 bg-black/50 backdrop-blur">
          <button
            onClick={() => changeMode('object')}
            className={`${btnBase} ${mode === 'object' ? 'bg-accent text-black' : 'text-white'}`}
          >
            {t.modeObject}
          </button>
          <button
            onClick={() => changeMode('category')}
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
          onClick={() => {
            resetIsolation();
            setSelected(null);
          }}
          className={`${btnBase} border border-white/20 bg-black/50 text-white backdrop-blur`}
        >
          {t.resetView}
        </button>
      </div>

      {/* Panel section box: 6 slider (X/Y/Z, + & −). */}
      {sectionOn && (
        <div className="absolute right-3 top-14 w-56 rounded border border-white/20 bg-black/60 p-3 text-white backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium">{t.section}</span>
            <button
              onClick={resetSection}
              className="text-[11px] opacity-70 hover:opacity-100"
            >
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
                onChange={(e) =>
                  setClip((c) => ({ ...c, [field]: parseFloat(e.target.value) }))
                }
                className="w-full accent-accent"
              />
            </label>
          ))}
        </div>
      )}

      {/* Overlay status load: memuat / gagal (biar tidak blank tanpa info). */}
      {loadState !== 'ready' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={`rounded px-4 py-2 text-sm ${
              loadState === 'error'
                ? 'bg-red-500/15 text-red-400'
                : 'bg-black/50 text-white backdrop-blur'
            }`}
          >
            {loadState === 'error' ? t.loadError : t.loading}
          </div>
        </div>
      )}

      {/* Info elemen terpilih */}
      {selected && (
        <div className="absolute bottom-3 left-3 rounded bg-black/70 px-3 py-2 text-xs text-white">
          <div className="opacity-60">{t.selected}</div>
          <div className="font-medium">{selected.category ?? t.noCategory}</div>
          <div className="opacity-50">{selected.globalId}</div>
        </div>
      )}

      {liveUpdateMessage && (
        <div className="absolute bottom-3 right-3 rounded bg-black/70 px-3 py-1 text-xs text-white">
          {liveUpdateMessage}
        </div>
      )}
    </div>
  );
}
