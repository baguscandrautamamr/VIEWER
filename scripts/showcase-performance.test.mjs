import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import * as THREE from 'three';

// Compile the actual engine without a DOM/WebGL dependency. Keep the temp
// modules beside node_modules so their Three imports resolve normally.
const repo = fileURLToPath(new URL('../', import.meta.url));
const dir = mkdtempSync(path.join(repo, '.showcase-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));
for (const name of ['engine', 'disciplines', 'tour']) {
  const source = readFileSync(path.join(repo, 'lib/showcase', `${name}.ts`), 'utf8');
  let { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2022 },
    // Replace only DOM/WebGL setup; retain the actual methods and class-field
    // initializers (including the render loop) for behavior tests.
    transformers: { before: [(context) => {
      const visit = (node) => ts.isConstructorDeclaration(node)
        ? context.factory.updateConstructorDeclaration(node, node.modifiers, node.parameters, context.factory.createBlock([]))
        : ts.visitEachChild(node, visit, context);
      return (node) => ts.visitNode(node, visit);
    }] },
  });
  outputText = outputText.replaceAll("'./disciplines'", "'./disciplines.mjs'")
    .replaceAll("'./tour'", "'./tour.mjs'")
    .replaceAll("'@/lib/modelIdentity.mjs'", JSON.stringify(pathToFileURL(path.join(repo, 'lib/modelIdentity.mjs')).href));
  writeFileSync(path.join(dir, `${name}.mjs`), outputText);
}
const { ShowcaseEngine } = await import(pathToFileURL(path.join(dir, 'engine.mjs')).href);

function harness(root) {
  const engine = Object.create(ShowcaseEngine.prototype);
  Object.assign(engine, {
    scene: new THREE.Scene(), records: new Map(), recordList: [], parts: [],
    bounds: { min: [-10, -10, -10], max: [10, 10, 10] },
    loadToken: 1, style: 'mono', selectedGid: null, highlighted: new Set(),
    cMono: [120, 130, 140], cMonoGlass: [110, 120, 130],
    cSelected: [200, 255, 80], cHighlight: [150, 220, 60],
    matOpaque: new THREE.MeshStandardMaterial(), matSheer: new THREE.MeshStandardMaterial(),
    matInst: new THREE.MeshStandardMaterial(), matInstSheer: new THREE.MeshStandardMaterial(),
    instGroups: [], triangles: 0, uniqueTriangles: 0,
    emit() {}, scheduleMerge() {},
    finishMerge() { this.merge = null; this.finishIndex(); },
  });
  root.updateMatrixWorld(true);
  engine.beginMerge(root, { associations: new Map(), json: {} }, 1);
  return engine;
}

function finish(engine) {
  let slices = 0;
  while (engine.merge) {
    engine.stepMerge();
    assert.ok(++slices < 10000, 'merge makes progress');
  }
  return slices;
}

test('multi-mesh elements paint each vertex once and retain picking identity', () => {
  // Geometri per mesh dibuat sendiri-sendiri supaya jalur yang diuji adalah
  // penggabungan (bukan instans; itu diuji terpisah di bawah).
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  let vertices = 0;
  for (let i = 0; i < 80; i++) {
    const geo = new THREE.BoxGeometry(1 + i / 100, 1, 1);
    vertices += geo.attributes.position.count;
    const mesh = new THREE.Mesh(geo, material);
    mesh.userData.globalId = 'shared-element';
    mesh.position.x = i % 8;
    root.add(mesh);
  }
  const engine = harness(root);
  let painted = 0;
  const paint = engine.paintRecord;
  engine.paintRecord = function(rec, ranges = rec.ranges) {
    painted += ranges.reduce((sum, r) => sum + r.vCount, 0);
    return paint.call(this, rec, ranges);
  };
  finish(engine);
  assert.equal(painted, vertices);
  const rec = engine.records.get('shared-element');
  assert.equal(rec.ranges.length, 80);
  assert.equal(engine.elements.length, 1);
  assert.equal(engine.instGroups.length, 0);
  for (const part of engine.parts) {
    assert.equal(part.geometry.drawRange.count, part.geometry.index.count);
  }
});

test('repeated geometry becomes instances instead of copied vertices', () => {
  // Ini penyebab layar 3D kosong: menyalin vertex untuk tiap pemakaian
  // meledakkan memori sampai konteks WebGL dilepas.
  const root = new THREE.Group();
  const geo = new THREE.BoxGeometry();
  const material = new THREE.MeshStandardMaterial();
  for (let i = 0; i < 80; i++) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.userData.globalId = `element-${i}`;
    mesh.position.x = i % 8;
    root.add(mesh);
  }
  const engine = harness(root);
  let painted = 0;
  const paint = engine.paintRecord;
  engine.paintRecord = function(rec, ranges = rec.ranges) {
    painted += ranges.length;
    return paint.call(this, rec, ranges);
  };
  finish(engine);
  // Satu kelompok instans, 80 instans, dan TIDAK ADA buffer gabungan.
  assert.equal(engine.instGroups.length, 1);
  assert.equal(engine.instGroups[0].filled, 80);
  assert.equal(engine.parts.length, 0);
  // Geometri disimpan sekali: segitiga unik = satu kotak saja.
  assert.equal(engine.uniqueTriangles, geo.index.count / 3);
  // Tiap elemen dicat sekali, lewat satu penempatan instans.
  assert.equal(painted, 80);
  for (let i = 0; i < 80; i++) {
    const rec = engine.records.get(`element-${i}`);
    assert.equal(rec.ranges.length, 1);
    assert.equal(rec.ranges[0].kind, 1);
    assert.equal(rec.ranges[0].instance, i);
  }
});

test('one giant mesh yields within vertex/index/paint work and resumes without corruption', (t) => {
  const geo = new THREE.BufferGeometry();
  const vertices = 90000;
  const pos = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  for (let i = 0; i < vertices; i++) {
    pos[i * 3] = i % 3 === 1 ? 1 : 0;
    pos[i * 3 + 1] = i % 3 === 2 ? 1 : 0;
    normals[i * 3 + 2] = 1;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
  mesh.userData.globalId = 'large';
  const engine = harness(new THREE.Group().add(mesh));
  let time = 0;
  t.mock.method(performance, 'now', () => (time += 2));
  engine.stepMerge();
  assert.ok(engine.merge, 'must yield before completing the giant piece');
  assert.ok(engine.merge.vertexCursor > 0 && engine.merge.vertexCursor < vertices);
  assert.equal(engine.parts[0].geometry.drawRange.count, 0, 'incomplete piece is not drawn');
  assert.ok(finish(engine) > 2);
  assert.deepEqual(engine.parts[0].geometry.attributes.position.array, pos);
  const indices = engine.parts[0].geometry.index.array;
  assert.equal(indices.length, vertices);
  assert.ok(indices.every((value, i) => value === i));
  assert.ok(engine.parts[0].color.array.every((value, i) => value === [120, 130, 140, 255][i % 4]));
});

test('mirrored indexed and non-indexed meshes preserve visible front faces', () => {
  for (const indexed of [false, true]) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geo.computeVertexNormals();
    if (indexed) geo.setIndex([0, 1, 2]);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
    mesh.scale.x = -1;
    const engine = harness(new THREE.Group().add(mesh));
    finish(engine);
    const merged = engine.parts[0].geometry;
    assert.deepEqual(Array.from(merged.index.array), [0, 2, 1]);
    const p = merged.attributes.position;
    const a = new THREE.Vector3().fromBufferAttribute(p, 0);
    const b = new THREE.Vector3().fromBufferAttribute(p, 2);
    const c = new THREE.Vector3().fromBufferAttribute(p, 1);
    assert.ok(b.sub(a).cross(c.sub(a)).z > 0);
  }
});

test('hover stops at its deadline instead of scanning every triangle', () => {
  const engine = Object.create(ShowcaseEngine.prototype);
  let calls = 0;
  const rec = { ranges: [{ part: 0, tStart: 0, tCount: 50000 }] };
  engine.parts = [{ geometry: {
    getAttribute: () => ({ array: new Float32Array(9) }),
    index: { array: new Uint32Array(150000) },
  } }];
  engine.tmpA = new THREE.Vector3(); engine.tmpB = new THREE.Vector3();
  engine.tmpC = new THREE.Vector3(); engine.tmpHit = new THREE.Vector3();
  assert.equal(engine.hitDistance({ intersectTriangle() { calls++; } }, rec, -1), Infinity);
  assert.equal(calls, 0);
});

test('stationary frames skip GPU rendering; movement, color and resize invalidate it', (t) => {
  const engine = new ShowcaseEngine(null);
  let rendered = 0;
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const oldDocument = globalThis.document;
  const oldRaf = globalThis.requestAnimationFrame;
  globalThis.document = { hidden: false };
  globalThis.requestAnimationFrame = () => 1;
  t.after(() => { globalThis.document = oldDocument; globalThis.requestAnimationFrame = oldRaf; });
  Object.assign(engine, {
    disposed: false, merge: null, camera: new THREE.PerspectiveCamera(),
    renderedPosition: new THREE.Vector3(Infinity, Infinity, Infinity),
    renderedQuaternion: new THREE.Quaternion(), renderDirty: true,
    renderedFrames: 0, renderedTime: 0, frames: 0, lastStats: 0,
    clock: { getDelta: () => 0.016 }, mode: 'orbit', controls: { update() {} },
    renderer: { render() { rendered++; }, getContext: () => ({ isContextLost: () => false }), setSize() {} },
    container: { clientWidth: 800, clientHeight: 600 },
    stepTween() {}, stepKeys() {}, stepLabels() {}, stepMinimap() {}, stepCenterLook() {},
    records: new Map(), parts: [],
  });
  for (let i = 0; i < 10; i++) { now += 16; engine.loop(); }
  assert.equal(rendered, 1);
  engine.camera.position.x++;
  engine.loop();
  assert.equal(rendered, 2);
  engine.repaintAll(); engine.loop();
  assert.equal(rendered, 3);
  engine.resize(); engine.loop();
  assert.equal(rendered, 4);
  globalThis.document.hidden = true;
  engine.renderDirty = true; engine.loop();
  assert.equal(rendered, 4);
});

test('snapshot renders before reading an unpreserved drawing buffer', () => {
  const engine = Object.create(ShowcaseEngine.prototype);
  const calls = [];
  engine.renderer = {
    render() { calls.push('render'); },
    domElement: { toDataURL() { calls.push('capture'); return 'data:image/png;base64,test'; } },
  };
  assert.match(engine.snapshot(), /^data:image\/png/);
  assert.deepEqual(calls, ['render', 'capture']);
});

test('cancelled source models dispose shared resources once', () => {
  const engine = Object.create(ShowcaseEngine.prototype);
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture });
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const counts = { geometry: 0, texture: 0, material: 0 };
  geometry.addEventListener('dispose', () => counts.geometry++);
  texture.addEventListener('dispose', () => counts.texture++);
  material.addEventListener('dispose', () => counts.material++);
  engine.disposeSource(root, true);
  assert.deepEqual(counts, { geometry: 1, texture: 1, material: 1 });
});

test('resumed indexed material groups keep original colors and index offsets', (t) => {
  const geometry = new THREE.BoxGeometry();
  const mesh = new THREE.Mesh(geometry, [
    new THREE.MeshStandardMaterial({ color: 0xff0000 }),
    new THREE.MeshStandardMaterial({ color: 0x00ff00 }),
  ]);
  geometry.groups.forEach((g, i) => { g.materialIndex = i % 2; });
  const engine = harness(new THREE.Group().add(mesh));
  engine.style = 'original';
  let time = 0;
  t.mock.method(performance, 'now', () => (time += 9));
  finish(engine);
  const part = engine.parts[0];
  assert.deepEqual(Array.from(part.geometry.index.array), Array.from(geometry.index.array));
  assert.deepEqual(part.color.array, part.baseOriginal);
  const colors = part.color.array;
  assert.deepEqual(Array.from(colors.slice(0, 4)), [255, 0, 0, 255]);
  assert.deepEqual(Array.from(colors.slice(16, 20)), [0, 255, 0, 255]);
});

// --- Kotak section ----------------------------------------------------------

function sectionHarness() {
  const engine = Object.create(ShowcaseEngine.prototype);
  engine.records = new Map();
  engine.listeners = new Map();
  engine.highlighted = new Set();
  engine.style = 'mono';
  engine.bounds = { min: [-10, -10, -10], max: [10, 10, 10] };
  engine.sectionOn = false;
  engine.sectionClip = { xMin: 1, xMax: 1, yMin: 1, yMax: 1, zMin: 1, zMax: 1 };
  engine.clipPlanes = [
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(1, 0, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
  ];
  engine.clipMaterials = [];
  engine.sectionBox = null;
  engine.scene = new THREE.Scene();
  engine.renderDirty = false;
  return engine;
}

test('section box frame follows the clip sliders and matches the cutting planes', () => {
  const engine = sectionHarness();
  engine.sectionOn = true;
  engine.sectionClip = { xMin: 1, xMax: 0.5, yMin: 1, yMax: 1, zMin: 1, zMax: 1 };
  engine.refreshClipping();
  assert.ok(engine.sectionBox, 'frame is created when section is on');
  assert.equal(engine.sectionBox.parent, engine.scene);
  assert.equal(engine.sectionBox.visible, true);
  // Kotak harus pas di bidang potong: sisi X+ di x = cx + hx*xMax = 0 + 10*0.5.
  const attr = engine.sectionBox.geometry.getAttribute('position');
  const xs = [];
  for (let i = 0; i < attr.count; i++) xs.push(attr.getX(i));
  for (const x of xs) assert.ok(x <= 5 + 1e-6, `no vertex beyond the X+ plane (x=${x})`);
  assert.ok(xs.some((x) => Math.abs(x - 5) < 1e-6), 'one face sits exactly on the X+ plane');
  // Sisi lain tetap di tepi model (xMax sisi − = 1 → x = −10).
  assert.ok(xs.some((x) => Math.abs(x + 10) < 1e-6), 'X− face stays at the model edge');
  // Matikan section: kotak ikut hilang dari layar.
  engine.sectionOn = false;
  engine.refreshClipping();
  assert.equal(engine.sectionBox.visible, false);
});

// --- Marker seleksi (gaya kotak penanda Mode teknis) ------------------------

function markerHarness() {
  const engine = sectionHarness();
  engine.selectedGid = null;
  engine.camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 5000);
  return engine;
}

test('selection marker box wraps the selected element and follows its bounds', () => {
  const engine = markerHarness();
  // Elemen "dinding" 10×3×1 di sekitar origin.
  engine.records.set('wall-1', {
    gid: 'wall-1', name: 'Dinding', rawName: null, category: 'Walls', categoryLabel: 'Dinding',
    discipline: 'architecture', min: [-5, 0, -0.5], max: [5, 3, 0.5],
    center: [0, 1.5, 0], size: [10, 3, 1], radius: 5.2, meshCount: 1, eid: 0,
    ranges: [], hasRealName: true, sheer: false, embeddedName: null, embeddedCategory: null,
  });
  engine.select('wall-1');
  assert.ok(engine.selBox, 'marker box is created on selection');
  assert.equal(engine.selBox.visible, true);
  const attr = engine.selBox.geometry.getAttribute('position');
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < attr.count; i++) {
    min.min(new THREE.Vector3(attr.getX(i), attr.getY(i), attr.getZ(i)));
    max.max(new THREE.Vector3(attr.getX(i), attr.getY(i), attr.getZ(i)));
  }
  // Elemen dilebarkan sedikit agar kotak tidak menempel permukaan (shrink).
  const sh = 0.02;
  assert.ok(Math.abs(min.x - (-5 - sh * 10)) < 1e-3, 'marker spans the element X');
  assert.ok(Math.abs(max.y - (3 + sh * 3)) < 1e-3, 'marker spans the element Y');
  assert.ok(Math.abs(min.z - (-0.5 - sh * 1)) < 1e-3, 'marker spans the element Z');
  // Batal pilih: kotak hilang.
  engine.select(null);
  assert.equal(engine.selBox.visible, false);
});
