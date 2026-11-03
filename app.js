import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const SIGNAL_INFO = {
  engine_speed_rpm: { label: 'Engine speed', unit: 'rpm', digits: 0 },
  hydraulic_pressure_bar: { label: 'Hydraulic pressure', unit: 'bar', digits: 0 },
  oil_temperature_c: { label: 'Oil temperature', unit: '°C', digits: 1 },
  pump_vibration_mm_s: { label: 'Pump vibration', unit: 'mm/s', digits: 2 },
  hydraulic_flow_l_min: { label: 'Hydraulic flow', unit: 'l/min', digits: 0 },
};
const COLORS = { normal: '#3fb27f', warning: '#e0a526', critical: '#e5484d', accent: '#4c9fe0', muted: '#93a4b5', grid: '#2a3d50' };
const $ = (id) => document.getElementById(id);

const state = {
  config: null,
  data: null,
  cache: new Map(),
  t: 0,
  tf: 0,           // fractional time while playing
  playing: false,
  selectedSignal: 'pump_vibration_mm_s',
  procedure: null, // component whose procedure is open
  step: 0,
};

// The static build (scripts/export_static.py) marks index.html and serves precomputed
// JSON files at the same paths as the API, so the page also works on GitHub Pages.
const STATIC = document.querySelector('meta[name="twinguard-static"]') !== null;
const api = (path) => (STATIC ? `${path.slice(1)}.json` : path);

const fmtTime =(m) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
const componentById = (id) => state.config.components.find((c) => c.id === id);

// ---------------------------------------------------------------- 3D view
const container = $('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0e1620);
scene.add(new THREE.HemisphereLight(0xdfefff, 0x203040, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(6, 10, 8);
scene.add(sun);
scene.add(new THREE.GridHelper(30, 30, 0x2a3d50, 0x1b2b3b));

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const HOME = { position: new THREE.Vector3(11, 6, 9), target: new THREE.Vector3(0, 1.6, 0.8) };
camera.position.copy(HOME.position);
controls.target.copy(HOME.target);

new GLTFLoader().load(
  'assets/forest_harvester.glb',
  (gltf) => scene.add(gltf.scene),
  undefined,
  () => { $('modelMissing').hidden = false; },
);

// Marker drawn on top of the model (depthTest off): the pump sits inside the body.
const markerMaterial = new THREE.MeshBasicMaterial({ color: COLORS.warning, depthTest: false, transparent: true, opacity: 0.9 });
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.05, 12, 48), markerMaterial);
ring.rotation.x = Math.PI / 2;
const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), markerMaterial);
const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 8), markerMaterial);
pin.position.y = 0.55;
const marker = new THREE.Group();
for (const m of [ring, dot, pin]) { m.renderOrder = 10; marker.add(m); }
marker.visible = false;
scene.add(marker);

let flight = null;
function flyTo(position, target, ms = 800) {
  flight = { fromP: camera.position.clone(), fromT: controls.target.clone(), toP: position, toT: target, start: performance.now(), ms };
}
function focusMarker() {
  const target = marker.position.clone();
  const direction = camera.position.clone().sub(controls.target).normalize();
  flyTo(target.clone().add(direction.multiplyScalar(5.5)), target);
}

const label = $('markerLabel');
function placeLabel() {
  if (!marker.visible) { label.hidden = true; return; }
  const p = marker.position.clone();
  p.y += 1.2;
  p.project(camera);
  label.hidden = p.z > 1;
  label.style.left = `${(p.x * 0.5 + 0.5) * container.clientWidth}px`;
  label.style.top = `${(-p.y * 0.5 + 0.5) * container.clientHeight}px`;
}

function resize3d() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize3d).observe(container);

let lastFrame = null;
function advancePlayback(now) {
  if (!state.playing || !state.data) { lastFrame = null; return; }
  if (lastFrame !== null) {
    state.tf += ((now - lastFrame) / 1000) * Number($('speed').value);
    const t = Math.min(state.data.minutes - 1, Math.floor(state.tf));
    if (t !== state.t) setTime(t, { fromPlayback: true });
    if (t >= state.data.minutes - 1) setPlaying(false);
  }
  lastFrame = now;
}

function animate(now) {
  requestAnimationFrame(animate);
  if (flight) {
    const k = Math.min(1, (now - flight.start) / flight.ms);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    camera.position.lerpVectors(flight.fromP, flight.toP, e);
    controls.target.lerpVectors(flight.fromT, flight.toT, e);
    if (k === 1) flight = null;
  }
  if (marker.visible) {
    const s = 1 + 0.12 * Math.sin(now * 0.004);
    ring.scale.set(s, s, s);
  }
  advancePlayback(now);
  controls.update();
  renderer.render(scene, camera);
  placeLabel();
}
requestAnimationFrame(animate);

// ---------------------------------------------------------------- data
async function getScenario(id) {
  if (!state.cache.has(id)) {
    const res = await fetch(api(`/api/scenarios/${encodeURIComponent(id)}`));
    if (!res.ok) throw new Error(`Scenario ${id}: ${res.status}`);
    state.cache.set(id, await res.json());
  }
  return state.cache.get(id);
}

async function loadScenario(id, { keepProcedure = false } = {}) {
  setPlaying(false);
  state.data = await getScenario(id);
  $('scenario').value = id;
  $('scenarioDesc').textContent = state.data.description;
  if (!keepProcedure) closeProcedure();
  setTime(0);
}

function setTime(t, { fromPlayback = false } = {}) {
  state.t = Math.max(0, Math.min(state.data.minutes - 1, Math.round(t)));
  if (!fromPlayback) state.tf = state.t;
  update();
}

function setPlaying(on) {
  if (on && state.data && state.t >= state.data.minutes - 1) setTime(0);
  state.playing = on;
  $('play').textContent = on ? 'Pause' : 'Play';
}

// ---------------------------------------------------------------- assessment panel
function buildSignalRows() {
  const body = $('signalRows');
  for (const s of state.config.signals) {
    const tr = document.createElement('tr');
    tr.dataset.signal = s;
    const info = SIGNAL_INFO[s];
    tr.innerHTML = '<td></td><td></td><td></td><td></td>';
    tr.cells[0].textContent = `${info.label} (${info.unit})`;
    tr.addEventListener('click', () => { state.selectedSignal = s; update(); });
    body.appendChild(tr);
  }
}

function update() {
  const d = state.data;
  if (!d) return;
  const t = state.t;
  const a = d.assessment;
  const status = a.status[t];

  $('clock').textContent = fmtTime(t);
  const badge = $('statusBadge');
  badge.textContent = status.toUpperCase();
  badge.className = `badge ${status}`;
  $('score').textContent = a.score[t].toFixed(2);

  const sigma = state.config.contribution_sigma;
  for (const tr of $('signalRows').rows) {
    const s = tr.dataset.signal;
    const info = SIGNAL_INFO[s];
    const z = a.deviation[s][t];
    tr.cells[1].textContent = d.readings[s][t].toFixed(info.digits);
    tr.cells[2].textContent = a.expected[s][t].toFixed(info.digits);
    tr.cells[3].textContent = `${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(1)} σ`;
    tr.cells[3].classList.toggle('hot', Math.abs(z) >= sigma);
    tr.classList.toggle('selected', s === state.selectedSignal);
  }

  const component = a.component[t] ? componentById(a.component[t]) : null;
  $('componentBox').hidden = !component;
  $('noComponent').hidden = !(status !== 'normal' && !component);
  if (component) {
    $('componentName').textContent = component.name;
    $('componentRule').textContent = `Matched rule: ${component.rule.description}.`;
    if (!state.procedure) openProcedure(component);
  }

  // Marker: the currently suspected component, or the one whose procedure is open
  const shown = component || state.procedure;
  marker.visible = Boolean(shown);
  if (shown) {
    marker.position.fromArray(shown.position);
    const color = component ? COLORS[status] : COLORS.accent;
    markerMaterial.color.set(color);
    label.style.color = color;
    label.firstChild.textContent = component ? 'Suspected component' : 'Component under inspection';
  }
  $('focus').disabled = !shown;

  drawChart();
}

// ---------------------------------------------------------------- procedure
function openProcedure(component) {
  state.procedure = component;
  state.step = 0;
  $('procedureNote').textContent = `${component.name}. ${component.procedure_note} ${component.position_note}`;
  const steps = $('steps');
  steps.replaceChildren(...component.procedure.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
  const links = $('links');
  links.replaceChildren(...(component.links || []).map((link) => {
    const div = document.createElement('div');
    const a = document.createElement('a');
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = `${link.label} ↗`;
    const credit = document.createElement('p');
    credit.className = 'hint';
    credit.textContent = link.credit;
    div.append(a, credit);
    return div;
  }));
  $('checkResult').textContent = '';
  $('procedure').hidden = false;
  renderSteps();
}

function closeProcedure() {
  state.procedure = null;
  $('procedure').hidden = true;
}

function renderSteps() {
  const items = $('steps').children;
  for (let i = 0; i < items.length; i++) {
    items[i].className = i < state.step ? 'done' : i === state.step ? 'active' : '';
  }
  const last = items.length - 1;
  $('back').disabled = state.step === 0;
  $('next').disabled = state.step === last;
  $('afterRepair').hidden = state.step !== last;
}

async function runAfterRepairCheck() {
  const check = await getScenario('after_repair');
  const thresholds = state.config.thresholds;
  const highest = Math.max(...check.assessment.score);
  const alarms = check.assessment.status.filter((s) => s !== 'normal').length;
  $('checkResult').textContent = alarms === 0
    ? `Model result on ${check.minutes / 60} h of simulated post-repair data: normal throughout. Highest anomaly score ${highest.toFixed(2)} (warning at ${thresholds.warning.toFixed(2)}). Replaying it on the timeline.`
    : `Model result on simulated post-repair data: ${alarms} minutes above the warning threshold. Highest anomaly score ${highest.toFixed(2)}.`;
  await loadScenario('after_repair', { keepProcedure: true });
  setPlaying(true);
}

// ---------------------------------------------------------------- timeline chart
const canvas = $('chart');
const ctx = canvas.getContext('2d');
const M = { l: 60, r: 70, t: 18, b: 22, gap: 26 };

function chartGeometry() {
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  const avail = H - M.t - M.b - M.gap;
  const h1 = avail * 0.55;
  return { W, H, plotW: W - M.l - M.r, h1, h2: avail - h1, top2: M.t + h1 + M.gap };
}

function niceTicks(lo, hi, count = 3) {
  const step0 = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= step0);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v);
  return ticks;
}

function drawLine(values, x, y, color, dashed = false) {
  ctx.beginPath();
  ctx.setLineDash(dashed ? [5, 4] : []);
  values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawChart() {
  const d = state.data;
  if (!d || !state.config) return;
  const dpr = window.devicePixelRatio || 1;
  const g = chartGeometry();
  if (canvas.width !== Math.round(g.W * dpr) || canvas.height !== Math.round(g.H * dpr)) {
    canvas.width = Math.round(g.W * dpr);
    canvas.height = Math.round(g.H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, g.W, g.H);
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  const n = d.minutes;
  const a = d.assessment;
  const thr = state.config.thresholds;
  const x = (i) => M.l + (i / (n - 1)) * g.plotW;

  // Panel 1: anomaly score with thresholds and status shading
  const yMax1 = Math.max(thr.critical * 1.15, Math.max(...a.score) * 1.05);
  const y1 = (v) => M.t + g.h1 - (Math.max(0, v) / yMax1) * g.h1;
  for (let i = 0; i < n; i++) {
    if (a.status[i] === 'normal') continue;
    ctx.fillStyle = `${COLORS[a.status[i]]}30`;
    ctx.fillRect(x(i), M.t, g.plotW / (n - 1) + 0.5, g.h1);
  }
  axis(niceTicks(0, yMax1), y1, (v) => v.toFixed(1));
  for (const [name, value] of [['warning', thr.warning], ['critical', thr.critical]]) {
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.moveTo(M.l, y1(value));
    ctx.lineTo(M.l + g.plotW, y1(value));
    ctx.strokeStyle = COLORS[name];
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS[name];
    ctx.textAlign = 'left';
    ctx.fillText(name, M.l + g.plotW + 6, y1(value));
  }
  drawLine(a.score, x, y1, '#e6edf3');
  title('Anomaly score (1.0 = top 1% of normal operation)', M.t - 9);

  // Panel 2: selected signal, actual vs expected
  const s = state.selectedSignal;
  const info = SIGNAL_INFO[s];
  const actual = d.readings[s];
  const expected = a.expected[s];
  let lo = Math.min(...actual, ...expected);
  let hi = Math.max(...actual, ...expected);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;
  const y2 = (v) => g.top2 + g.h2 - ((v - lo) / (hi - lo)) * g.h2;
  axis(niceTicks(lo, hi), y2, (v) => v.toFixed(info.digits > 1 ? 1 : 0));
  drawLine(expected, x, y2, COLORS.muted, true);
  drawLine(actual, x, y2, COLORS.accent);
  title(`${info.label} (${info.unit}): actual (solid) vs expected for the conditions (dashed)`, g.top2 - 9);

  // Time axis
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'center';
  const stepH = n > 240 ? 1 : 0.5;
  for (let h = 0; h * 60 <= n - 1; h += stepH) ctx.fillText(`${h} h`, x(h * 60), g.H - M.b / 2);

  // Cursor
  ctx.beginPath();
  ctx.moveTo(x(state.t), M.t - 4);
  ctx.lineTo(x(state.t), g.top2 + g.h2);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function axis(ticks, y, fmt) {
  const g = chartGeometry();
  ctx.textAlign = 'right';
  for (const v of ticks) {
    ctx.beginPath();
    ctx.moveTo(M.l, y(v));
    ctx.lineTo(M.l + g.plotW, y(v));
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(fmt(v), M.l - 6, y(v));
  }
}

function title(text, yPos) {
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = 'left';
  ctx.fillText(text, M.l, yPos);
}

function timeFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const g = chartGeometry();
  const k = (event.clientX - rect.left - M.l) / g.plotW;
  return k * (state.data.minutes - 1);
}
canvas.addEventListener('pointerdown', (e) => {
  if (!state.data) return;
  canvas.setPointerCapture(e.pointerId);
  setPlaying(false);
  setTime(timeFromPointer(e));
});
canvas.addEventListener('pointermove', (e) => {
  if (canvas.hasPointerCapture(e.pointerId)) setTime(timeFromPointer(e));
});
new ResizeObserver(drawChart).observe(canvas);

// ---------------------------------------------------------------- controls
$('play').addEventListener('click', () => setPlaying(!state.playing));
$('scenario').addEventListener('change', (e) => loadScenario(e.target.value));
$('focus').addEventListener('click', focusMarker);
$('resetView').addEventListener('click', () => flyTo(HOME.position.clone(), HOME.target.clone()));
$('back').addEventListener('click', () => { state.step = Math.max(0, state.step - 1); renderSteps(); });
$('next').addEventListener('click', () => { state.step = Math.min($('steps').children.length - 1, state.step + 1); renderSteps(); });
$('reset').addEventListener('click', () => { state.step = 0; $('checkResult').textContent = ''; renderSteps(); });
$('runCheck').addEventListener('click', runAfterRepairCheck);
window.addEventListener('keydown', (e) => {
  if (!state.data || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); setPlaying(!state.playing); }
  if (e.code === 'ArrowRight') setTime(state.t + (e.shiftKey ? 10 : 1));
  if (e.code === 'ArrowLeft') setTime(state.t - (e.shiftKey ? 10 : 1));
});

async function init() {
  state.config = await (await fetch(api('/api/config'))).json();
  $('thrWarning').textContent = state.config.thresholds.warning.toFixed(2);
  $('thrCritical').textContent = state.config.thresholds.critical.toFixed(2);
  buildSignalRows();
  const scenarios = await (await fetch(api('/api/scenarios'))).json();
  $('scenario').replaceChildren(...scenarios.map((s) => new Option(s.name, s.id)));
  // URL parameters make it easy to open a given moment: ?scenario=pump_wear&t=400
  const qs = new URLSearchParams(window.location.search);
  await loadScenario(qs.get('scenario') || 'pump_wear');
  if (qs.has('t')) setTime(Number(qs.get('t')));
}
init();
