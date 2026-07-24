'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { subscribeToProjectUpdates, unsubscribe } from '@/lib/realtime';
import { locales, type Locale } from '@/lib/i18n';

interface ModelViewerProps {
  projectId: string;
  initialGlbUrl: string;
  locale?: Locale;
  onElementSelect?: (globalId: string | null) => void;
}

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
  const meshesByGlobalId = useRef<Map<string, THREE.Mesh>>(new Map());
  const originalMaterials = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());
  const [liveUpdateMessage, setLiveUpdateMessage] = useState<string | null>(null);

  const t = locales[locale].viewer;

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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

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
        isolateMesh(target);
        onElementSelect?.(target.userData.globalId ?? null);
      } else {
        resetIsolation();
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
      loadModel(scene, version.glb_storage_path, version.changed_global_ids);
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
    loader.load(glbUrl, (gltf) => {
      // Buang model versi lama sebelum pasang yang baru.
      meshesByGlobalId.current.forEach((mesh) => scene.remove(mesh));
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
    });
  }

  function isolateMesh(target: THREE.Mesh) {
    meshesByGlobalId.current.forEach((mesh) => {
      if (mesh === target) {
        const original = originalMaterials.current.get(mesh);
        if (original) mesh.material = original;
      } else {
        dimMesh(mesh);
      }
    });
  }

  function resetIsolation() {
    meshesByGlobalId.current.forEach((mesh) => {
      const original = originalMaterials.current.get(mesh);
      if (original) mesh.material = original;
    });
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

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 text-xs opacity-70">
        {t.isolateHint}
      </div>
      {liveUpdateMessage && (
        <div className="absolute bottom-3 left-3 rounded bg-black/70 px-3 py-1 text-xs text-white">
          {liveUpdateMessage}
        </div>
      )}
    </div>
  );
}
