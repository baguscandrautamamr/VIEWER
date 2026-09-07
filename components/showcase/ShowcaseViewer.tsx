'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { locales, type Locale } from '@/lib/i18n';
import { subscribeToProjectUpdates, unsubscribe } from '@/lib/realtime';
import MarkupOverlay from '@/components/MarkupOverlay';
import { DISCIPLINE_ORDER, type Discipline } from '@/lib/showcase/disciplines';
import { fetchElementNames } from '@/lib/showcase/elementNames';
import { ShowcaseEngine, type EngineStats, type HoverInfo, type LoadProgress, type Style, type SectionClip } from '@/lib/showcase/engine';
import { resolveQuery } from '@/lib/showcase/search';
import { buildAutoTour, EYE_LEVEL, type TourStrings } from '@/lib/showcase/tour';
import { fetchSavedTour, saveTour } from '@/lib/showcase/tourStore';
import type { AiAction, AiContext, CategorySummary, ElementInfo, TourStop, ViewMode } from '@/lib/showcase/types';
import AiPanel, { useAiChat } from './AiPanel';
import EquipmentNavigator from './EquipmentNavigator';
import ExplorePanel, { type Viewpoint } from './ExplorePanel';
import InspectionPanel from './InspectionPanel';
import TourCard from './TourCard';
import TourEditor from './TourEditor';
import { Icons, Panel, tpl, type ShowcaseStrings } from './ui';

// Viewer PRESENTASI (gaya video referensi "Plant / Field"): pengalaman untuk
// client — mode jalan/orbit, tur terpandu, navigator & inspeksi elemen,
// label, minimap, dan asisten AI. Viewer teknis lama (ModelViewer.tsx) tetap
// ada sebagai "Mode teknis" untuk ukur/section/markup.
//
// Semua yang berjalan tiap frame ada di lib/showcase/engine.ts; komponen ini
// hanya memegang state UI dan mendengarkan event mesin.

interface Props {
  projectId: string;
  projectName: string;
  accessToken: string;
  glbUrl: string;
  locale?: Locale;
  sheetCount?: number;
  onOpenSheets?: () => void;
  // Admin: boleh menyusun & menyimpan tur terpandu.
  canEdit?: boolean;
  // Saklar "Mode presentasi / Mode teknis" milik PresentClient. Dirender di
  // dalam top bar viewer supaya tidak menabrak kontrol lain, dan tetap bisa
  // diklik saat model masih disiapkan (jalan keluar kalau model berat).
  modeSwitch?: ReactNode;
}

// Lebar panel & jarak tepi — dipakai untuk menghitung area bebas (insets)
// supaya label 3D dan tooltip tidak pernah tertutup panel.
const GAP = 14;
const EXPLORE_W = 236;
const SIDE_W = 300;
const MINIMAP_W = 190;
const TOPBAR_H = 52;

type SidePanel = 'none' | 'inspect' | 'ai' | 'help' | 'tour';

const PREFS_KEY = 'rwv_showcase';
// Draft editor tur per proyek — bertahan refresh, hilang saat "Simpan tur"
// (draft == tersimpan) atau dikosongkan lewat "Kosongkan" + simpan.
const DRAFT_KEY = 'rwv_tour_draft';

export default function ShowcaseViewer({
  projectId,
  projectName,
  accessToken,
  glbUrl,
  locale = 'id',
  sheetCount = 0,
  onOpenSheets,
  canEdit = false,
  modeSwitch,
}: Props) {
  const s = locales[locale].showcase as ShowcaseStrings;
  const canvasRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ShowcaseEngine | null>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const selLabelRef = useRef<HTMLDivElement>(null);

  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<LoadProgress>({ value: 0, stage: 'download' });
  const [elements, setElements] = useState<ElementInfo[]>([]);
  const [mode, setMode] = useState<ViewMode>('orbit');
  const [selectedGid, setSelectedGid] = useState<string | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [labels, setLabels] = useState(false);
  const [highlightDisc, setHighlightDisc] = useState<Discipline | null>(null);
  const [highlightCount, setHighlightCount] = useState(0);
  const [style, setStyle] = useState<Style>('mono');
  const [shadows, setShadows] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  // Potongan (section box): 6 bidang X/Y/Z ±, nilai 0..1 (1 = tepi model).
  // DUA state terpisah: `sectionOn` = potongan aktif di model, `sectionOpen`
  // = panel slidernya terbuka. Dulu satu state untuk dua-duanya, jadi
  // menutup panel ikut membatalkan potongan — sekarang ✕ hanya menutup
  // panel, potongan tetap terpotong sampai "Matikan potongan" diklik.
  const [sectionOn, setSectionOn] = useState(false);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [clip, setClip] = useState<SectionClip>({ xMin: 1, xMax: 1, yMin: 1, yMax: 1, zMin: 1, zMax: 1 });
  // Tool ukur & layer coret-coret — perilaku sama dengan Mode teknis: ukur
  // pasang 2 titik pada model, coret membekukan navigasi supaya gambar pas.
  const [measureOn, setMeasureOn] = useState(false);
  const [markupOn, setMarkupOn] = useState(false);
  // Kecepatan navigasi (slider). Tersimpan di localStorage seperti gaya/label.
  const [speed, setSpeed] = useState(1);
  const [planActive, setPlanActive] = useState(false);
  const [side, setSide] = useState<SidePanel>('none');
  const [navOpen, setNavOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [walkHint, setWalkHint] = useState(false);
  const [aiConfig, setAiConfig] = useState<{ configured: boolean; model: string | null }>({ configured: false, model: null });
  const [aiDraft, setAiDraft] = useState<string | undefined>(undefined);

  // Tur. Tiga daftar: otomatis (dari isi model), tersimpan (DB), dan draft
  // editor. Yang DIPAKAI: draft kalau ada isinya, kalau tidak -> otomatis.
  const [autoStops, setAutoStops] = useState<TourStop[]>([]);
  const [savedStops, setSavedStops] = useState<TourStop[]>([]);
  const [editorStops, setEditorStops] = useState<TourStop[]>([]);
  const tourStops = editorStops.length > 0 ? editorStops : autoStops;
  const tourDirty = editorStops !== savedStops;
  const [tourSaving, setTourSaving] = useState(false);
  const [tourNotice, setTourNotice] = useState<string | null>(null);
  const [tourIndex, setTourIndex] = useState<number>(-1); // -1 = tidak aktif
  const [tourMoving, setTourMoving] = useState(false);
  const [tourAi, setTourAi] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');

  // Penjelasan AI per elemen (cache di memori halaman).
  const [explanations, setExplanations] = useState<Record<string, string>>({});
  const [explaining, setExplaining] = useState(false);
  const heavyNotified = useRef(false);

  const tourStrings = useMemo<TourStrings>(
    () => ({
      overviewTitle: s.tourOverview,
      overviewDesc: s.tourOverviewDesc,
      planTitle: s.tourPlan,
      planDesc: s.tourPlanDesc,
      walkTitle: s.tourWalk,
      walkDesc: s.tourWalkDesc,
      disciplineTitle: {
        structure: s.discStructure,
        architecture: s.discArchitecture,
        electrical: s.discElectrical,
        plumbing: s.discPlumbing,
        hvac: s.discHvac,
        process: s.discProcess,
        fire: s.discFire,
        site: s.discSite,
        other: s.discOther,
      },
      disciplineDesc: (label, count, cats) => tpl(s.discDesc, { label, count, cats: cats.join(', ') }),
    }),
    [s]
  );
  const discLabel = useMemo<Record<Discipline, string>>(
    () => ({
      structure: s.sysStructure,
      architecture: s.sysArchitecture,
      electrical: s.sysElectrical,
      plumbing: s.sysPlumbing,
      hvac: s.sysHvac,
      process: s.sysProcess,
      fire: s.sysFire,
      site: s.sysSite,
      other: s.sysOther,
    }),
    [s]
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 3500);
  }, []);

  // ---------------------------------------------------------------- engine
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const engine = new ShowcaseEngine(el);
    engineRef.current = engine;
    engine.attachMinimap(minimapRef.current);

    // Preferensi tampilan tersimpan di browser.
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      if (p.style === 'original' || p.style === 'mono') {
        engine.setStyle(p.style);
        setStyle(p.style);
      }
      if (typeof p.labels === 'boolean') {
        engine.setLabels(p.labels);
        setLabels(p.labels);
      }
      if (typeof p.speed === 'number' && p.speed >= 0.25 && p.speed <= 8) {
        engine.setSpeed(p.speed);
        setSpeed(p.speed);
      }
    } catch {
      /* abaikan */
    }

    const offs = [
      engine.on('progress', setProgress),
      engine.on('ready', () => {
        setLoadState('ready');
        setElements(engine.elements);
        setShadows(engine.shadowsOn);
      }),
      engine.on('error', (kind) => {
        setLoadError(kind === 'context-lost' ? s.contextLost : s.loadError);
        setLoadState('error');
      }),
      engine.on('select', (gid) => {
        setSelectedGid(gid);
        // Memilih elemen selalu membuka panel inspeksi (riwayat obrolan AI
        // tetap tersimpan, tinggal dibuka lagi dari dock).
        if (gid) setSide('inspect');
        else setSide((cur) => (cur === 'inspect' ? 'none' : cur));
      }),
      engine.on('hover', setHover),
      engine.on('stats', (st) => {
        setStats(st);
        // Mesin bisa mematikan bayangan sendiri kalau model terlalu berat;
        // beri tahu sekali supaya user tahu kenapa tampilannya berubah.
        if (st.lightened) {
          setShadows(engine.shadowsOn);
          if (!heavyNotified.current) {
            heavyNotified.current = true;
            showToast(tpl(s.heavyNotice, { tri: (st.triangles / 1e6).toFixed(1) }));
          }
        }
      }),
      engine.on('mode', (m) => {
        setMode(m);
        setPlanActive(false);
        setAutoRotate(false);
        if (m === 'walk') {
          setWalkHint(true);
          window.setTimeout(() => setWalkHint(false), 6000);
        }
      }),
      engine.on('tweenEnd', () => setTourMoving(false)),
      engine.on('userInput', () => setAutoRotate(false)),
    ];
    engine.load(glbUrl);

    let active = true;
    fetchElementNames(projectId, () => active).then((names) => {
      if (!names || !active) return;
      engine.applyNames(names);
      if (engine.elements.length) setElements(engine.elements);
    });

    // Auto-update saat model baru di-push dari Revit (Supabase Realtime).
    const channel = subscribeToProjectUpdates(projectId, (version) => {
      showToast(locales[locale].viewer.liveUpdate);
      setLoadState('loading');
      engine.load(`/api/model/${version.id}`);
    });

    fetchSavedTour(projectId, accessToken)
      .then((stops) => {
        if (!active) return;
        setSavedStops(stops);
        // Draft editor yang belum sempat disimpan (refresh/putus jaringan)
        // diutamakan daripada yang tersimpan di DB — sama seperti draft form.
        let draft: TourStop[] | null = null;
        try {
          const raw = localStorage.getItem(`${DRAFT_KEY}:${projectId}`);
          if (raw) {
            const parsed = JSON.parse(raw) as TourStop[];
            if (Array.isArray(parsed) && parsed.length > 0) draft = parsed;
          }
        } catch {
          /* abaikan */
        }
        setEditorStops(draft ?? stops);
      })
      .catch(() => {});

    fetch('/api/ai')
      .then((r) => r.json())
      .then((j) => setAiConfig({ configured: Boolean(j.configured), model: j.model ?? null }))
      .catch(() => setAiConfig({ configured: false, model: null }));

    // Ukuran container bisa berubah tanpa event resize window (sidebar sheet).
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(el);

    return () => {
      active = false;
      offs.forEach((off) => off());
      ro.disconnect();
      unsubscribe(channel);
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glbUrl, projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ style, labels, speed }));
    } catch {
      /* abaikan */
    }
  }, [style, labels, speed]);

  // Terapkan kecepatan navigasi ke mesin tiap slider berubah.
  useEffect(() => {
    engineRef.current?.setSpeed(speed);
  }, [speed]);

  // Simpan draft editor tur tiap berubah supaya refresh tidak menghilangkan
  // pandangan yang sudah ditangkap tapi belum di-"Simpan tur".
  useEffect(() => {
    if (savedStops.length === 0 && editorStops.length === 0) return;
    try {
      const key = `${DRAFT_KEY}:${projectId}`;
      if (editorStops === savedStops) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(editorStops));
    } catch {
      /* kuota penuh / mode privat — abaikan */
    }
  }, [editorStops, savedStops, projectId]);

  // Terapkan potongan model (section box) ke mesin tiap kali berubah.
  useEffect(() => {
    engineRef.current?.setSection(sectionOn, clip);
  }, [sectionOn, clip]);

  // Sinkronkan tool ukur & markup ke mesin. Dua-duanya memakai klik pada
  // model, jadi menyalakan satu mematikan yang lain.
  useEffect(() => {
    engineRef.current?.setMeasure(measureOn && !markupOn);
  }, [measureOn, markupOn]);
  useEffect(() => {
    engineRef.current?.setInputLocked(markupOn);
  }, [markupOn]);
  useEffect(() => () => engineRef.current?.setInputLocked(false), []);

  // Area yang tertutup panel — label 3D, tooltip, dan label seleksi menjauhinya.
  useEffect(() => {
    engineRef.current?.setInsets({
      left: GAP + EXPLORE_W + 12,
      right: GAP + (side !== 'none' ? SIDE_W : MINIMAP_W) + 12,
      top: TOPBAR_H + 40,
      bottom: tourIndex >= 0 ? 160 : 92,
    });
  }, [side, tourIndex, loadState]);

  // Tur otomatis disusun ulang tiap daftar elemen berubah (nama dari DB datang).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || elements.length === 0) return;
    setAutoStops(buildAutoTour(elements, engine.bounds, tourStrings));
    setTourAi('idle');
  }, [elements, tourStrings]);

  useEffect(() => {
    engineRef.current?.setMinimapMarkers(
      tourStops.map((st, i) => ({ x: st.pose.target[0], z: st.pose.target[2], label: String(i + 1) }))
    );
  }, [tourStops]);

  // Label elemen terpilih mengikuti objek tiap frame (DOM langsung, tanpa
  // setState) — lihat catatan teknis #7 di CATATAN.md.
  useEffect(() => {
    const div = selLabelRef.current;
    if (!div) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const engine = engineRef.current;
      if (!engine || !selectedGid) {
        div.style.display = 'none';
        return;
      }
      const p = engine.projectElement(selectedGid);
      if (!p || !p.visible) {
        div.style.display = 'none';
        return;
      }
      div.style.display = 'block';
      // Jepit pakai lebar label yang SEBENARNYA supaya tidak menyelinap ke
      // bawah panel kiri/kanan (perkiraan di engine tidak tahu lebar teks).
      const half = div.offsetWidth / 2 + 6;
      const w = canvasRef.current?.clientWidth ?? 0;
      const left = GAP + EXPLORE_W + 12 + half;
      const right = w - (GAP + (side !== 'none' ? SIDE_W : MINIMAP_W) + 12) - half;
      const x = Math.min(Math.max(p.x, left), Math.max(left, right));
      div.style.transform = `translate(-50%, -100%) translate(${x.toFixed(0)}px, ${(p.y - 8).toFixed(0)}px)`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [selectedGid, side]);

  // ---------------------------------------------------------------- derived
  const selected = useMemo(() => (selectedGid ? engineRef.current?.getElement(selectedGid) ?? null : null), [selectedGid, elements]);
  const sameName = useMemo(() => (selected ? elements.filter((e) => e.name === selected.name) : []), [selected, elements]);
  const nearby = useMemo(() => {
    if (!selected) return [];
    const c = selected.center;
    return elements
      .filter((e) => e.gid !== selected.gid && !e.gid.startsWith('unmapped:'))
      .map((e) => ({ e, d: Math.hypot(e.center[0] - c[0], e.center[1] - c[1], e.center[2] - c[2]) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5)
      .map((x) => x.e);
  }, [selected, elements]);

  const disciplines = useMemo(() => {
    const counts = new Map<Discipline, number>();
    for (const e of elements) counts.set(e.discipline, (counts.get(e.discipline) ?? 0) + 1);
    return DISCIPLINE_ORDER.filter((d) => (counts.get(d) ?? 0) > 0).map((d) => ({ key: d, label: discLabel[d], count: counts.get(d) ?? 0 }));
  }, [elements, discLabel]);

  const viewpoints = useMemo<Viewpoint[]>(() => {
    const engine = engineRef.current;
    const list: Viewpoint[] = tourStops.map((st, i) => ({ id: `stop:${i}`, label: st.title, sub: String(i + 1).padStart(2, '0') }));
    if (engine) {
      const h = engine.bounds.max[1] - engine.bounds.min[1];
      const levels = [EYE_LEVEL, 4, 8, 14].filter((v) => v < h + 1);
      levels.forEach((lv) => list.push({ id: `eye:${lv}`, label: tpl(s.levelPreset, { h: lv.toFixed(1) }), sub: 'walk' }));
      list.push({ id: `eye:${(h + EYE_LEVEL).toFixed(2)}`, label: s.roofLevel, sub: 'walk' });
    }
    return list;
  }, [tourStops, s, elements]);

  // Area terdekat (chip kanan atas): pemberhentian tur yang targetnya paling
  // dekat ke posisi kamera.
  const areaLabel = useMemo(() => {
    if (!stats || tourStops.length === 0) return null;
    let best: TourStop | null = null;
    let bd = Infinity;
    for (const st of tourStops) {
      if (st.id === 'overview' || st.plan) continue;
      const t = st.pose.target;
      const d = Math.hypot(t[0] - stats.position[0], t[2] - stats.position[2]);
      if (d < bd) {
        bd = d;
        best = st;
      }
    }
    return best?.title ?? null;
  }, [stats, tourStops]);

  // ---------------------------------------------------------------- actions
  const selectAndGo = useCallback((gid: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.select(gid);
    engine.focusElement(gid);
  }, []);

  const applyDiscHighlight = useCallback(
    (d: Discipline | null) => {
      const engine = engineRef.current;
      if (!engine) return;
      setHighlightDisc(d);
      if (!d) {
        engine.clearHighlight();
        setHighlightCount(0);
        return;
      }
      const gids = elements.filter((e) => e.discipline === d).map((e) => e.gid);
      engine.setHighlight(gids);
      setHighlightCount(gids.length);
    },
    [elements]
  );

  const clearHighlight = useCallback(() => {
    engineRef.current?.clearHighlight();
    engineRef.current?.select(null);
    setHighlightDisc(null);
    setHighlightCount(0);
  }, []);

  const goToStop = useCallback(
    (i: number) => {
      const engine = engineRef.current;
      const stop = tourStops[i];
      if (!engine || !stop) return;
      setTourIndex(i);
      setTourMoving(true);
      setSide('none');
      engine.select(null);
      if (stop.highlightCategories?.length) {
        const cats = new Set(stop.highlightCategories);
        const gids = elements.filter((e) => cats.has(e.category)).map((e) => e.gid);
        engine.setHighlight(gids);
        setHighlightCount(gids.length);
        setHighlightDisc(null);
      } else if (stop.highlightGids?.length) {
        engine.setHighlight(stop.highlightGids);
        setHighlightCount(stop.highlightGids.length);
      } else {
        engine.clearHighlight();
        setHighlightCount(0);
      }
      if (stop.plan) {
        if (stop.custom) engine.goTo(stop.pose, 'orbit', 1.6);
        else engine.plan(1.6);
        engine.planActive = true;
        engine.controls.enableRotate = false;
        setPlanActive(true);
      } else {
        engine.goTo(stop.pose, stop.mode, 1.6);
        setPlanActive(false);
      }
      if (stop.autoRotate) {
        window.setTimeout(() => {
          const e = engineRef.current;
          if (e && e.mode === 'orbit') {
            e.setAutoRotate(true);
            setAutoRotate(true);
          }
        }, 1700);
      }
    },
    [tourStops, elements]
  );

  const startTour = useCallback(() => {
    if (tourStops.length === 0) return;
    setNavOpen(false);
    goToStop(0);
  }, [tourStops, goToStop]);

  const exitTour = useCallback(() => {
    setTourIndex(-1);
    engineRef.current?.clearHighlight();
    engineRef.current?.setAutoRotate(false);
    setHighlightCount(0);
    setAutoRotate(false);
  }, []);

  const resetView = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    exitTour();
    engine.select(null);
    engine.overview();
    setPlanActive(false);
    // Reset potongan (section box) ke tepi penuh.
    setClip({ xMin: 1, xMax: 1, yMin: 1, yMax: 1, zMin: 1, zMax: 1 });
    setSectionOn(false);
    setSectionOpen(false);
    setMeasureOn(false);
    setMarkupOn(false);
  }, [exitTour]);

  const onViewpoint = useCallback(
    (id: string) => {
      const engine = engineRef.current;
      if (!engine) return;
      if (id.startsWith('stop:')) {
        const st = tourStops[Number(id.slice(5))];
        if (!st) return;
        if (st.plan) {
          if (st.custom) engine.goTo(st.pose, 'orbit');
          else engine.plan();
          engine.planActive = true;
          engine.controls.enableRotate = false;
          setPlanActive(true);
        } else engine.goTo(st.pose, st.mode);
        return;
      }
      if (id.startsWith('eye:')) {
        const h = Number(id.slice(4));
        if (engine.mode !== 'walk') engine.setMode('walk');
        window.setTimeout(() => engine.setEyeLevel(h), engine.mode === 'walk' ? 0 : 1050);
      }
    },
    [tourStops]
  );

  const snapshot = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const a = document.createElement('a');
    a.href = engine.snapshot();
    a.download = `${projectName.replace(/[^\w-]+/g, '_')}-3d.png`;
    a.click();
  }, [projectName]);

  // ---------------------------------------------------------------- AI
  const getContext = useCallback((): AiContext => {
    const engine = engineRef.current;
    const byCat = new Map<string, CategorySummary & { names: Set<string> }>();
    for (const e of elements) {
      let c = byCat.get(e.category);
      if (!c) {
        c = { category: e.category, label: e.categoryLabel, discipline: e.discipline, count: 0, samples: [], names: new Set() };
        byCat.set(e.category, c);
      }
      c.count++;
      if (c.names.size < 4 && !e.gid.startsWith('unmapped:')) c.names.add(e.name);
    }
    const categories = Array.from(byCat.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 45)
      .map(({ names, ...rest }) => ({ ...rest, samples: Array.from(names) }));
    const disc: Record<string, number> = {};
    for (const e of elements) disc[e.discipline] = (disc[e.discipline] ?? 0) + 1;
    const size = engine ? engine.bounds.max.map((v, i) => v - engine.bounds.min[i]) : [0, 0, 0];
    return {
      projectName,
      locale,
      elementCount: elements.length,
      modelSize: [size[0], size[1], size[2]],
      categories,
      disciplines: disc,
      selected: selected ? { ...selected, neighbors: nearby.map((n) => `${n.name} (${n.categoryLabel})`) } : null,
      mode,
      tourTitles: tourStops.map((t) => t.title),
    };
  }, [elements, projectName, locale, selected, nearby, mode, tourStops]);

  const runActions = useCallback(
    (actions: AiAction[]) => {
      const engine = engineRef.current;
      if (!engine) return;
      for (const a of actions) {
        switch (a.type) {
          case 'focus': {
            const r = resolveQuery(elements, a.query);
            if (r.gids.length === 0) break;
            engine.setHighlight(r.gids);
            setHighlightCount(r.gids.length);
            setHighlightDisc(null);
            if (r.gids.length === 1 && r.primary) engine.select(r.primary.gid);
            engine.focusGids(r.gids);
            break;
          }
          case 'highlight': {
            const r = resolveQuery(elements, a.query);
            engine.setHighlight(r.gids);
            setHighlightCount(r.gids.length);
            setHighlightDisc(null);
            break;
          }
          case 'mode':
            if (a.mode === 'plan') {
              engine.plan();
              setPlanActive(true);
            } else if (a.mode === 'walk') engine.entrance();
            else engine.setMode('orbit');
            break;
          case 'labels':
            engine.setLabels(a.on);
            setLabels(a.on);
            break;
          case 'tour':
            if (typeof a.stop === 'number' && tourStops[a.stop - 1]) goToStop(a.stop - 1);
            else startTour();
            break;
          case 'reset':
            resetView();
            break;
          case 'clear':
            clearHighlight();
            break;
        }
      }
    },
    [elements, tourStops, goToStop, startTour, resetView, clearHighlight]
  );

  const chat = useAiChat({ projectId, token: accessToken, getContext, onActions: runActions });

  const explainSelected = useCallback(async () => {
    if (!selected || explaining) return;
    const gid = selected.gid;
    setExplaining(true);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, token: accessToken, mode: 'explain', context: getContext() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `${res.status}`);
      }
      const reader = res.body?.getReader();
      const dec = new TextDecoder();
      let full = '';
      if (reader) {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          full += dec.decode(value, { stream: true });
          setExplanations((m) => ({ ...m, [gid]: full }));
        }
      } else full = await res.text();
      setExplanations((m) => ({ ...m, [gid]: full.trim() }));
    } catch (err) {
      showToast(tpl(s.aiError, { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      setExplaining(false);
    }
  }, [selected, explaining, projectId, accessToken, getContext, showToast, s]);

  const narrateTour = useCallback(async () => {
    if (tourAi === 'busy' || tourStops.length === 0) return;
    setTourAi('busy');
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          token: accessToken,
          mode: 'tour',
          context: getContext(),
          tour: tourStops.map((t) => ({ id: t.id, title: t.title, description: t.description })),
        }),
      });
      const j = (await res.json()) as { stops?: { id: string; title?: string; description?: string }[]; error?: string };
      if (!res.ok || !j.stops) throw new Error(j.error ?? `${res.status}`);
      const byId = new Map(j.stops.map((x) => [x.id, x]));
      const apply = (cur: TourStop[]) =>
        cur.map((st) => {
          const n = byId.get(st.id);
          return n ? { ...st, title: n.title?.trim() || st.title, description: n.description?.trim() || st.description } : st;
        });
      if (editorStops.length > 0) setEditorStops(apply); // jadi draft -> bisa disimpan
      else setAutoStops(apply);
      setTourAi('done');
    } catch (err) {
      setTourAi('error');
      showToast(tpl(s.aiError, { msg: err instanceof Error ? err.message : String(err) }));
    }
  }, [tourAi, tourStops, editorStops.length, projectId, accessToken, getContext, showToast, s]);

  // ---------------------------------------------------------------- editor tur (admin)
  // Tangkap pose kamera + sorotan yang sedang aktif jadi satu pemberhentian.
  const captureStop = useCallback(
    (title: string, description: string, id?: string): TourStop | null => {
      const engine = engineRef.current;
      if (!engine) return null;
      const stop: TourStop = {
        id: id ?? `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        title,
        description,
        mode: engine.mode,
        plan: engine.planActive,
        pose: engine.currentPose(),
        custom: true,
      };
      if (highlightDisc) {
        stop.highlightCategories = Array.from(new Set(elements.filter((e) => e.discipline === highlightDisc).map((e) => e.category)));
      } else {
        const gids = engine.highlightedGids();
        if (engine.selected && !gids.includes(engine.selected)) gids.push(engine.selected);
        if (gids.length) stop.highlightGids = gids.slice(0, 3000);
      }
      return stop;
    },
    [elements, highlightDisc]
  );

  const persistTour = useCallback(async () => {
    if (tourSaving) return;
    setTourSaving(true);
    setTourNotice(null);
    try {
      await saveTour(projectId, accessToken, editorStops);
      setSavedStops(editorStops);
      setTourNotice(s.tourSaved);
      window.setTimeout(() => setTourNotice(null), 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setTourNotice(tpl(s.tourSaveError, { msg }));
    } finally {
      setTourSaving(false);
    }
  }, [tourSaving, projectId, accessToken, editorStops, s]);

  // ---------------------------------------------------------------- keyboard
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const engine = engineRef.current;
      if (!engine) return;
      const k = e.key.toLowerCase();
      if (k === 'escape') {
        if (markupOn) setMarkupOn(false);
        else if (measureOn) setMeasureOn(false);
        else if (navOpen) setNavOpen(false);
        else if (side !== 'none') setSide('none');
        else if (tourIndex >= 0) exitTour();
        else engine.select(null);
      } else if (k === 'e' && !e.repeat) {
        const gid = engine.hovered ?? engine.selected;
        if (gid) {
          engine.select(gid);
          setSide('inspect');
        }
      } else if (k === 'f') {
        if (engine.selected) engine.focusElement(engine.selected);
      } else if (k === 't') {
        tourIndex >= 0 ? exitTour() : startTour();
      } else if (k === 'l') {
        const on = !engine.labelsOn;
        engine.setLabels(on);
        setLabels(on);
      } else if (k === 'r') {
        resetView();
      } else if (k === 's') {
        setSectionOn((v) => !v);
        setSectionOpen((v) => !v);
      } else if (k === '/' ) {
        e.preventDefault();
        setNavOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen, side, tourIndex, markupOn, measureOn, exitTour, startTour, resetView]);

  // ---------------------------------------------------------------- render
  const hoveredEl = hover ? engineRef.current?.getElement(hover.gid) ?? null : null;
  const aiOn = aiConfig.configured;

  return (
    <div className={`sc-root ${side !== 'none' ? 'has-side' : ''}`}>
      <div ref={canvasRef} className="sc-canvas" />
      <div ref={selLabelRef} className="sc-label-sel" style={{ display: 'none' }}>
        {selected?.name}
      </div>

      {/* Satu baris atas: brand · mode kamera · saklar & status.
          Semua dalam satu flex row supaya tidak pernah saling menimpa. */}
      <div className="sc-topbar">
        <div className="sc-topbar-side">
          <div className="sc-brand">
            <div className="sc-brand-mark">{Icons.compass}</div>
            <div className="sc-brand-text">
              <div className="sc-brand-name">{projectName}</div>
              <div className="sc-eyebrow">{s.tagline}</div>
            </div>
          </div>
        </div>

        <Panel className="sc-topcenter">
          <button
            type="button"
            title={s.modeWalk}
            aria-label={s.modeWalk}
            className={`sc-pill ${mode === 'walk' ? 'is-on' : ''}`}
            onClick={() => engineRef.current?.setMode('walk')}
          >
            {Icons.walk}
            <span className="sc-pill-label">{s.modeWalk}</span>
          </button>
          <button
            type="button"
            title={s.modeOrbit}
            aria-label={s.modeOrbit}
            className={`sc-pill ${mode === 'orbit' ? 'is-on' : ''}`}
            onClick={() => engineRef.current?.setMode('orbit')}
          >
            {Icons.orbit}
            <span className="sc-pill-label">{s.modeOrbit}</span>
          </button>
        </Panel>

        <div className="sc-topbar-side sc-topbar-right">
          {modeSwitch}
          <Panel className="sc-live">
            <span className="sc-dot" style={{ boxShadow: '0 0 8px var(--sc-accent)' }} />
            <span className="sc-live-label">{s.live}</span>
          </Panel>
          <button type="button" className="sc-iconbtn" onClick={() => setSide(side === 'help' ? 'none' : 'help')} title={locales[locale].viewer.shortcuts}>
            {Icons.help}
          </button>
        </div>
      </div>

      {areaLabel && loadState === 'ready' && (
        <Panel className="sc-area">
          <span className="text-[color:var(--sc-accent)]">{Icons.pin}</span>
          <span className="truncate">{areaLabel}</span>
          {stats && mode === 'walk' && (
            <span className="sc-mono shrink-0 text-white/45">· {stats.eyeHeight.toFixed(1)} m</span>
          )}
        </Panel>
      )}

      {/* Panel kiri */}
      {loadState === 'ready' && (
        <ExplorePanel
          strings={s}
          elementCount={elements.length}
          labels={labels}
          onLabels={(v) => {
            engineRef.current?.setLabels(v);
            setLabels(v);
          }}
          disciplines={disciplines}
          highlightDisc={highlightDisc}
          onHighlightDisc={applyDiscHighlight}
          highlightCount={highlightCount}
          planActive={planActive}
          onPlan={() => {
            const engine = engineRef.current;
            if (!engine) return;
            if (planActive) {
              engine.overview();
              setPlanActive(false);
            } else {
              engine.plan();
              setPlanActive(true);
            }
          }}
          viewpoints={viewpoints}
          onViewpoint={onViewpoint}
          style={style}
          onStyle={(st) => {
            engineRef.current?.setStyle(st);
            setStyle(st);
          }}
          shadows={shadows}
          onShadows={(v) => {
            engineRef.current?.setShadows(v);
            setShadows(v);
          }}
          autoRotate={autoRotate}
          onAutoRotate={(v) => {
            const engine = engineRef.current;
            if (!engine) return;
            if (engine.mode !== 'orbit') engine.setMode('orbit');
            window.setTimeout(() => engine.setAutoRotate(v), engine.mode === 'orbit' ? 0 : 1050);
            setAutoRotate(v);
          }}
          speed={speed}
          onSpeed={setSpeed}
          onFind={() => setNavOpen(true)}
          onReset={resetView}
          onEntrance={() => {
            exitTour();
            engineRef.current?.entrance();
          }}
          onClearHighlight={clearHighlight}
          onSnapshot={snapshot}
        />
      )}

      {/* Hover (orbit) / sedang melihat (walk) */}
      {mode === 'walk' && loadState === 'ready' && (
        <>
          <div className="sc-crosshair">
            <svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 1v4M7 9v4M1 7h4M9 7h4" />
            </svg>
          </div>
          {hoveredEl && hoveredEl.gid !== selectedGid && tourIndex < 0 && (
            <Panel className="sc-lookat px-2.5 py-1 text-[11px]">
              <span className="text-white/45">{s.lookingAt}: </span>
              <span className="text-white">{hoveredEl.name}</span>
              <span className="sc-mono ml-2 text-white/40">{s.pressE}</span>
            </Panel>
          )}
          {walkHint && (
            <Panel className="sc-hint">
              <span className="text-[color:var(--sc-accent)]">{Icons.eye}</span>
              <span>{s.lookHint}</span>
              <span className="text-white/45">{s.lookHintSub}</span>
            </Panel>
          )}
        </>
      )}
      {mode === 'orbit' && hoveredEl && hover && hoveredEl.gid !== selectedGid && (
        <Panel
          className={`sc-hover ${hover.x > (canvasRef.current?.clientWidth ?? 0) - 320 ? 'is-flip' : ''}`}
          style={{ left: hover.x, top: hover.y }}
        >
          {hoveredEl.name} <span className="text-white/45">· {hoveredEl.categoryLabel}</span>
        </Panel>
      )}

      {/* Bawah tengah: tur atau dock. Dibungkus .sc-bottombar yang lebarnya
          menyesuaikan ruang bebas antara panel kiri dan minimap. */}
      <div className="sc-bottombar">
      {loadState === 'ready' && tourIndex >= 0 ? (
        <TourCard
          stops={tourStops}
          index={tourIndex}
          moving={tourMoving}
          strings={s}
          aiState={tourAi}
          aiEnabled={aiOn}
          onPrev={() => goToStop(Math.max(0, tourIndex - 1))}
          onNext={() => goToStop(Math.min(tourStops.length - 1, tourIndex + 1))}
          onExit={exitTour}
          onAiNarrate={narrateTour}
        />
      ) : (
        loadState === 'ready' && (
          <Panel className="sc-dock">
            <button type="button" className="sc-pill" onClick={startTour}>
              {Icons.route}
              {s.tour}
            </button>
            <button type="button" className="sc-pill" onClick={() => setNavOpen(true)}>
              {Icons.search}
              {s.navigator}
            </button>
            <button type="button" className={`sc-pill ${side === 'ai' ? 'is-on' : ''}`} onClick={() => setSide(side === 'ai' ? 'none' : 'ai')}>
              {Icons.spark}
              {s.assistant}
            </button>
            {/* Pill section: nyalakan/matikan potongan SEKALIGUS buka/tutup
                panelnya — satu klik dua hal, biar pertama kali langsung ada
                slidernya. Setelah itu ✕ di panel hanya menutup panel. */}
            <button
              type="button"
              className={`sc-pill ${sectionOn ? 'is-on' : ''}`}
              onClick={() => {
                setSectionOn((v) => !v);
                setSectionOpen((v) => !v);
              }}
              title={s.section}
            >
              {Icons.slice}
              {s.section}
            </button>
            <button
              type="button"
              className={`sc-pill ${measureOn ? 'is-on' : ''}`}
              onClick={() => {
                setMeasureOn((v) => !v);
                setMarkupOn(false);
              }}
              title={s.measureHint}
            >
              {Icons.measure}
              {s.measure}
            </button>
            <button
              type="button"
              className={`sc-pill ${markupOn ? 'is-on' : ''}`}
              onClick={() => {
                setMarkupOn((v) => !v);
                setMeasureOn(false);
              }}
              title={s.markup}
            >
              {Icons.pen}
              {s.markup}
            </button>
            {canEdit && (
              <button type="button" className={`sc-pill ${side === 'tour' ? 'is-on' : ''}`} onClick={() => setSide(side === 'tour' ? 'none' : 'tour')} title={s.tourEditTitle}>
                {Icons.camera}
                {s.tourEdit}
              </button>
            )}
            {sheetCount > 0 && onOpenSheets && (
              <button type="button" className="sc-pill" onClick={onOpenSheets}>
                {Icons.sheet}
                {s.drawings} <span className="sc-badge">{sheetCount}</span>
              </button>
            )}
          </Panel>
        )
      )}
      </div>

      {/* Minimap kanan bawah */}
      <Panel className={`sc-minimap ${loadState === 'ready' ? '' : 'sc-hidden'}`}>
        <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] text-white/70">
          <span className="text-[color:var(--sc-accent)]">{Icons.compass}</span>
          {s.minimap}
        </div>
        <canvas
          ref={minimapRef}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            engineRef.current?.minimapClick(e.clientX - r.left, e.clientY - r.top);
          }}
        />
        <div className="sc-mono mt-1.5 flex items-center justify-between text-white/45">
          <span>
            {mode === 'walk' ? s.eyeLevel : s.groundLevel}{' '}
            <span className="text-white/75">{stats ? `${stats.eyeHeight.toFixed(1)} m` : '—'}</span>
          </span>
          <span>{stats ? `${stats.fps} FPS` : ''}</span>
        </div>
      </Panel>

      {/* Status kiri bawah — satu baris, di bawah panel kiri */}
      <div className="sc-status">
        <span className="truncate">{mode === 'walk' ? s.statusWalk : s.statusOrbit}</span>
      </div>

      {/* Panel section box: 6 slider X/Y/Z, + dan −. Kondisi render pakai
          `sectionOpen`, bukan `sectionOn` — menutup panel (×) TIDAK
          mematikan potongan; model tetap terpotong sesuai pengaturan sampai
          "Matikan potongan" diklik. */}
      {sectionOn && sectionOpen && loadState === 'ready' && (
        <Panel className="sc-section">
          <div className="flex items-center justify-between">
            <span className="sc-eyebrow">{s.section}</span>
            <button
              type="button"
              className="text-[11px] text-white/55 hover:text-white"
              onClick={() => setSectionOpen(false)}
              title={s.sectionOff}
            >
              ✕
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
            ] as [keyof SectionClip, string][]
          ).map(([field, label]) => (
            <label key={field} className="flex items-center gap-2 text-[11px]">
              <span className="w-7 shrink-0 text-white/55">{label}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={clip[field]}
                onChange={(e) => setClip((c) => ({ ...c, [field]: parseFloat(e.target.value) }))}
                className="sc-section-range"
              />
            </label>
          ))}
          {/* Matikan potongan = buang potongan SEKALIAN kembalikan tampilan
              awal (resetView). Tanpa ini kamera masih menghadap area yang
              tadi dipotong (mis. bawah Y−) sehingga model terlihat "masih
              terpotong" padahal cuma sudut pandangnya. */}
          <button type="button" className="sc-btn mt-1 w-full" onClick={resetView}>
            {Icons.reset}
            {s.sectionTurnOff}
          </button>
        </Panel>
      )}

      {/* Panel kanan */}
      {side === 'inspect' && selected && (
        <InspectionPanel
          element={selected}
          groundY={engineRef.current?.groundY ?? 0}
          sameName={sameName}
          nearby={nearby}
          strings={s}
          aiEnabled={aiOn}
          explanation={explanations[selected.gid] ?? null}
          explaining={explaining}
          disciplineLabel={discLabel[selected.discipline]}
          onExplain={explainSelected}
          onGoto={() => engineRef.current?.focusElement(selected.gid)}
          onHighlightSimilar={() => {
            const gids = sameName.map((e) => e.gid);
            engineRef.current?.setHighlight(gids);
            setHighlightCount(gids.length);
            setHighlightDisc(null);
          }}
          onAsk={() => {
            setAiDraft(locale === 'en' ? `Tell me about "${selected.name}"` : `Ceritakan tentang "${selected.name}"`);
            setSide('ai');
          }}
          onSelect={selectAndGo}
          onClose={() => setSide('none')}
        />
      )}
      {side === 'ai' && (
        <AiPanel
          strings={s}
          enabled={aiOn}
          model={aiConfig.model}
          messages={chat.messages}
          busy={chat.busy}
          onSend={(t) => {
            setAiDraft(undefined);
            chat.send(t);
          }}
          onClear={chat.clear}
          onClose={() => setSide(selected ? 'inspect' : 'none')}
          draft={aiDraft}
        />
      )}
      {side === 'tour' && canEdit && (
        <TourEditor
          strings={s}
          stops={editorStops}
          dirty={tourDirty}
          saving={tourSaving}
          savedNotice={tourNotice}
          highlightCount={highlightCount + (selectedGid ? 1 : 0)}
          onCaptureCurrent={(title, description) => {
            const st = captureStop(title, description);
            if (st) setEditorStops((cur) => [...cur, st]);
          }}
          onUpdatePose={(i) => {
            setEditorStops((cur) => {
              const st = captureStop(cur[i].title, cur[i].description, cur[i].id);
              return st ? cur.map((x, k) => (k === i ? st : x)) : cur;
            });
          }}
          onChange={setEditorStops}
          onGoto={(i) => {
            const st = editorStops[i];
            const engine = engineRef.current;
            if (!st || !engine) return;
            if (st.highlightCategories?.length) {
              const cats = new Set(st.highlightCategories);
              engine.setHighlight(elements.filter((e) => cats.has(e.category)).map((e) => e.gid));
            } else engine.setHighlight(st.highlightGids ?? []);
            setHighlightCount(engine.highlightCount);
            setHighlightDisc(null);
            engine.goTo(st.pose, st.mode);
            if (st.plan) {
              engine.planActive = true;
              engine.controls.enableRotate = false;
            }
            setPlanActive(Boolean(st.plan));
          }}
          onSeedAuto={() => setEditorStops(autoStops.map((st, i) => ({ ...st, id: `custom-seed-${Date.now()}-${i}`, custom: true, autoRotate: false })))}
          onSave={persistTour}
          onClose={() => setSide('none')}
        />
      )}
      {side === 'help' && (
        <Panel className="sc-help">
          <div className="mb-1 flex items-center justify-between">
            <span className="sc-eyebrow">{locales[locale].viewer.shortcuts}</span>
            <button type="button" className="sc-close" onClick={() => setSide('none')}>×</button>
          </div>
          <div>
            <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> — {locale === 'en' ? 'walk / move' : 'jalan / geser'}
            <br />
            <kbd>Q</kbd> / <kbd>E</kbd> — {locale === 'en' ? 'down / up (walk)' : 'turun / naik (mode jalan)'}
            <br />
            <kbd>Shift</kbd> — {locale === 'en' ? 'run' : 'lari'} · <kbd>E</kbd> — {locale === 'en' ? 'inspect' : 'inspeksi'}
            <br />
            <kbd>F</kbd> — {locale === 'en' ? 'focus selected' : 'fokus elemen terpilih'} · <kbd>T</kbd> — {s.tour}
            <br />
            <kbd>L</kbd> — {s.labels} · <kbd>R</kbd> — {s.resetView} · <kbd>/</kbd> — {s.find}
            <br />
            <kbd>Esc</kbd> — {locale === 'en' ? 'close / deselect' : 'tutup / batal pilih'}
          </div>
          <p className="mt-2 border-t border-white/10 pt-2 text-[10.5px] text-white/40">
            {elements.length.toLocaleString(locale === 'en' ? 'en-US' : 'id-ID')} {s.navCount.replace('{n} ', '')} ·{' '}
            {stats ? tpl(s.statTriangles, { tri: (stats.triangles / 1e6).toFixed(1) }) : '—'}
            {stats && stats.uniqueTriangles < stats.triangles * 0.95
              ? ` (${
                  stats.uniqueTriangles >= 1e6
                    ? `${(stats.uniqueTriangles / 1e6).toFixed(1)} jt`
                    : `${Math.round(stats.uniqueTriangles / 1000)} rb`
                } unik · ${stats.instanced} geometri berulang)`
              : ''}{' '}
            · {stats?.fps ?? 0} FPS
            <br />
            {s.approx}
          </p>
        </Panel>
      )}

      {navOpen && (
        <EquipmentNavigator
          elements={elements}
          strings={s}
          onPick={(gid) => {
            setNavOpen(false);
            selectAndGo(gid);
          }}
          onClose={() => setNavOpen(false)}
        />
      )}

      {toast && <Panel className="sc-toast">{toast}</Panel>}

      {/* Hint tool ukur + tombol bantu (ulangi / hapus). Hasil ukurnya sendiri
          digambar mesin langsung ke scene (marker + label DOM) — bukan state
          React, lihat stepMeasure() di engine. */}
      {measureOn && !markupOn && loadState === 'ready' && (
        <Panel className="sc-hint">
          <span className="text-[color:var(--sc-accent)]">{Icons.measure}</span>
          <span>{s.measureHint}</span>
          <button type="button" className="sc-hint-btn" onClick={() => engineRef.current?.clearMeasure()}>
            {s.measureClear}
          </button>
          <button type="button" className="sc-hint-btn" onClick={() => setMeasureOn(false)} title={s.measure}>
            ✕
          </button>
        </Panel>
      )}

      {/* Layer coret-coret (canvas overlay screen space). Saat aktif mesin
          membekukan navigasi via setInputLocked supaya coretan tetap pas. */}
      <MarkupOverlay
        active={markupOn}
        strings={locales[locale].markup}
        getViewerCanvas={() => engineRef.current?.renderer.domElement ?? null}
      />

      {loadState !== 'ready' && (
        <div className="sc-loading">
          <Panel className="sc-loading-box">
            <div className="flex items-center gap-2 text-[13px] text-white">
              <span className="text-[color:var(--sc-accent)]">{Icons.compass}</span>
              {projectName}
            </div>
            <p className="mt-1 text-[11.5px] text-white/60">
              {loadState === 'error'
                ? loadError ?? s.loadError
                : progress.stage === 'download'
                  ? progress.total
                    ? `${s.loadingDownload} ${Math.round(progress.value / 0.55)}%`
                    : progress.bytes
                      ? `${s.loadingDownload} ${(progress.bytes / 1048576).toFixed(1)} MB`
                      : s.loadingDownload
                  : `${s.loadingPrepare} ${Math.round(((progress.value - 55) / 45) * 100)}%`}
            </p>
            {loadState === 'loading' && (
              <>
                <div className={`sc-bar mt-3 ${progress.stage === 'download' && !progress.total ? 'is-indeterminate' : ''}`}>
                  <span style={{ width: `${Math.max(2, progress.value)}%` }} />
                </div>
                <p className="mt-2 text-[10.5px] leading-snug text-white/40">{s.loadingHeavy}</p>
              </>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
