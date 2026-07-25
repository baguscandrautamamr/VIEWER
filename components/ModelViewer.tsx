'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { subscribeToProjectUpdates, unsubscribe } from '@/lib/realtime';
import { getSupabase } from '@/lib/supabase';
import { locales, type Locale } from '@/lib/i18n';

interface ModelViewerProps {
  projectId: string;
  initialGlbUrl: string;
  locale?: Locale;
  onElementSelect?: (globalId: string | null) => void;
}

type IsolateMode = 'object' | 'category';

const DIMMED_OPACITY = 0.12;
const HIGHLIGHT_DURATION_MS = 3000;

export default function ModelViewer({
  projectId,
  initialGlbUrl,
  locale = 'id',
  onElementSelect,
}: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRootRef = useRef<THREE.Object3D | null>(null);
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
      unsubscribe(channel);
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, initialGlbUrl]);

  function loadModel(scene: THREE.Scene, glbUrl: string, highlightIds: string[] = []) {
    const loader = new GLTFLoader();
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
      },
      undefined,
      (err) => {
        // Kalau GLB gagal di-load (CORS, URL salah, file rusak), catat di
        // console biar gampang di-diagnosa daripada layar diam kosong.
        console.error('Gagal load GLB:', glbUrl, err);
      }
    );
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
          onClick={() => {
            resetIsolation();
            setSelected(null);
          }}
          className={`${btnBase} border border-white/20 bg-black/50 text-white backdrop-blur`}
        >
          {t.resetView}
        </button>
      </div>

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
