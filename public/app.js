import { play, isMuted, setMuted } from './sound.js';

const LIVES = 3;
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const DIFFICULTY_LABEL = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };
const QUESTION_SECONDS = 10;
// How many questions a run stays on a level before moving up, per data set.
const LEVEL_STEPS = { countries: [10, 25], states: [6, 11] };
const SVG_NS = 'http://www.w3.org/2000/svg';

const MODES = [
  { id: 'flag-to-country', icon: '🏳️', title: 'Flagge → Land', hint: 'Welches Land hat diese Flagge?', data: 'countries', prompt: 'flag', answer: 'name' },
  { id: 'country-to-flag', icon: '🌍', title: 'Land → Flagge', hint: 'Welche Flagge gehört zum Land?', data: 'countries', prompt: 'name', answer: 'flag' },
  { id: 'country-to-capital', icon: '🏛️', title: 'Land → Hauptstadt', hint: 'Wie heißt die Hauptstadt?', data: 'countries', prompt: 'name', answer: 'capital' },
  { id: 'map-to-country', icon: '🗺️', title: 'Karte → Land', hint: 'Welches Land ist markiert?', data: 'countries', prompt: 'world-map', answer: 'name' },
  // Searching on a world map takes longer than picking one of four buttons.
  { id: 'country-to-map', icon: '📍', title: 'Land → Karte', hint: 'Tippe das Land auf der Weltkarte an.', data: 'countries', prompt: 'flag-name', answer: 'map', seconds: 20 },
  { id: 'state-to-capital', icon: '🏰', title: 'Bundesland → Hauptstadt', hint: 'Wie heißt die Landeshauptstadt?', data: 'states', prompt: 'name', answer: 'capital' },
  { id: 'germany-map-to-state', icon: '🇩🇪', title: 'Deutschlandkarte → Bundesland', hint: 'Welches Bundesland ist markiert?', data: 'states', prompt: 'germany-map', answer: 'name' },
];

const $ = (id) => document.getElementById(id);
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) if (child != null) node.append(child);
  return node;
}

const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];

const storage = {
  get(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
  },
};

// --- Data ----------------------------------------------------------------

const cache = {};
async function load(name) {
  cache[name] ??= fetch(`data/${name}.json`).then((r) => {
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return r.json();
  });
  return cache[name];
}

async function itemsFor(mode) {
  if (mode.data === 'states') return (await load('germany')).states;
  return load('countries');
}

// --- Rendering of prompts and answers -------------------------------------

function flagImg(item, alt = '') {
  return el('img', { className: 'flag', src: `flags/${item.iso2}.svg`, alt, draggable: false });
}

let worldSvg = null;
async function worldMap(item) {
  const world = await load('world');
  if (!worldSvg) {
    worldSvg = document.createElementNS(SVG_NS, 'svg');
    worldSvg.classList.add('map');
    worldSvg.setAttribute('role', 'img');
    worldSvg.setAttribute('aria-label', 'Weltkarte mit markiertem Land');
    const paths = world.background.map((d) => `<path d="${d}"/>`);
    for (const [id, c] of Object.entries(world.countries)) paths.push(`<path data-id="${id}" d="${c.path}"/>`);
    worldSvg.innerHTML = paths.join('') + '<circle class="marker" r="0"/>';
  }
  worldSvg.querySelector('.target')?.classList.remove('target');
  const target = worldSvg.querySelector(`[data-id="${item.id}"]`);
  target.classList.add('target');
  target.parentNode.appendChild(target); // draw on top of neighbours
  worldSvg.appendChild(worldSvg.querySelector('.marker'));

  // Zoom to the country with enough surroundings to recognise the region.
  const [x0, y0, x1, y1] = world.countries[item.id].bounds;
  const size = Math.max(x1 - x0, (y1 - y0) * 4 / 3) * 2.2;
  const w = Math.min(world.width, Math.max(size, 260));
  const h = w * 3 / 4;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const vx = Math.min(Math.max(cx - w / 2, 0), world.width - w);
  const vy = Math.min(Math.max(cy - h / 2, 0), Math.max(world.height - h, 0));
  worldSvg.setAttribute('viewBox', `${vx} ${vy} ${w} ${h}`);

  // Tiny countries get a circle so they are visible at all.
  const marker = worldSvg.querySelector('.marker');
  const tiny = Math.max(x1 - x0, y1 - y0) < w / 40;
  marker.setAttribute('cx', cx);
  marker.setAttribute('cy', cy);
  marker.setAttribute('r', tiny ? w / 25 : 0);
  return worldSvg;
}

let germanySvg = null;
async function germanyMap(item) {
  const germany = await load('germany');
  if (!germanySvg) {
    germanySvg = document.createElementNS(SVG_NS, 'svg');
    germanySvg.classList.add('map', 'germany');
    germanySvg.setAttribute('viewBox', `0 0 ${germany.width} ${germany.height}`);
    germanySvg.setAttribute('role', 'img');
    germanySvg.setAttribute('aria-label', 'Deutschlandkarte mit markiertem Bundesland');
    germanySvg.innerHTML = germany.states.map((s) => `<path data-id="${s.id}" d="${s.path}"/>`).join('');
  }
  germanySvg.querySelector('.target')?.classList.remove('target');
  germanySvg.querySelector(`[data-id="${item.id}"]`).classList.add('target');
  return germanySvg;
}

async function renderPrompt(mode, item) {
  const box = $('question');
  const label = el('div', { className: 'prompt-label', textContent: mode.hint });
  let content;
  if (mode.prompt === 'flag') content = flagImg(item, 'Flagge');
  else if (mode.prompt === 'world-map') content = await worldMap(item);
  else if (mode.prompt === 'germany-map') content = await germanyMap(item);
  else if (mode.prompt === 'flag-name') content = el('div', { className: 'prompt-flag-name' }, flagImg(item, 'Flagge'), el('div', { className: 'prompt-text', textContent: item.name }));
  else content = el('div', { className: 'prompt-text', textContent: item.name });
  box.replaceChildren(label, content);
}

function answerContent(mode, item) {
  if (mode.answer === 'flag') return flagImg(item, `Flagge`);
  return item[mode.answer];
}

// --- Interactive world map ("Land → Karte") ----------------------------------
// One finger pans, two fingers (or the mouse wheel) zoom, a tap answers.

const TAP_SLOP_PX = 10; // finger movement that still counts as a tap
const TINY_TAP_RADIUS_PX = 11; // tap circle drawn around countries too small to hit
const COAST_TOLERANCE_PX = 12; // a tap just off the coast still picks the nearest country
const MIN_VIEW_WIDTH = 12; // map units, i.e. roughly 160x zoom
const TINY_CIRCLES_MAX_VIEW = 600; // tap circles only appear once zoomed in, else they pile up

let pickMap = null;
async function pickerMap() {
  if (pickMap) return pickMap;
  const world = await load('world');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('map', 'pick');
  svg.setAttribute('role', 'application');
  svg.setAttribute('aria-label', 'Weltkarte: wischen zum Verschieben, mit zwei Fingern zoomen, Land antippen');
  const countries = Object.entries(world.countries);
  const tiny = countries.filter(([, c]) => Math.max(c.bounds[2] - c.bounds[0], c.bounds[3] - c.bounds[1]) < 10);
  svg.innerHTML =
    world.background.map((d) => `<path class="bg" d="${d}"/>`).join('') +
    countries.map(([id, c]) => `<path data-id="${id}" d="${c.path}"/>`).join('') +
    tiny.map(([id, c]) => `<circle class="tiny" data-id="${id}" cx="${(c.bounds[0] + c.bounds[2]) / 2}" cy="${(c.bounds[1] + c.bounds[3]) / 2}" r="0"/>`).join('');
  const circles = [...svg.querySelectorAll('circle.tiny')].map((node) => {
    const [x0, y0, x1, y1] = world.countries[node.dataset.id].bounds;
    return { node, size: Math.max(x1 - x0, y1 - y0) };
  });

  const zoomButtons = el(
    'div',
    { className: 'zoom-buttons' },
    el('button', { type: 'button', className: 'icon-button', textContent: '+', ariaLabel: 'Hineinzoomen', onclick: () => zoomBy(1 / 2) }),
    el('button', { type: 'button', className: 'icon-button', textContent: '−', ariaLabel: 'Herauszoomen', onclick: () => zoomBy(2) }),
    el('button', { type: 'button', className: 'icon-button', textContent: '⤢', ariaLabel: 'Ganze Welt zeigen', onclick: () => animateTo(fullView()) }),
  );
  // A tap only selects; OK (or the timer running out) checks the selection,
  // so a slip of the finger doesn't cost a life.
  const confirmButton = el('button', { type: 'button', className: 'primary confirm', textContent: 'OK', disabled: true, onclick: () => confirmSelection() });
  const hint = el('div', { className: 'pick-hint', textContent: 'Land antippen, dann mit OK bestätigen' });
  const node = el('div', { className: 'pick-wrap' }, el('div', { className: 'pick-map' }, svg, zoomButtons), el('div', { className: 'pick-actions' }, hint, confirmButton));
  let selected = null;
  function select(id) {
    for (const n of svg.querySelectorAll('.selected')) n.classList.remove('selected');
    selected = id;
    if (id) {
      for (const n of svg.querySelectorAll(`[data-id="${id}"]`)) {
        n.classList.add('selected');
        n.parentNode.appendChild(n);
      }
      for (const c of svg.querySelectorAll('circle.tiny')) svg.appendChild(c);
    }
    confirmButton.disabled = !id;
  }
  function confirmSelection() {
    if (!game || game.locked || !selected) return;
    confirmButton.disabled = true;
    answer(game.items.find((it) => it.id === selected) ?? { id: selected }, null);
  }

  // The view is the visible map rectangle; its aspect ratio always matches the element.
  let view = { x: 0, y: 0, w: world.width };
  const aspect = () => (svg.clientHeight || 1) / (svg.clientWidth || 1);
  const scale = () => (svg.clientWidth || 1) / view.w; // screen px per map unit

  function fullView() {
    const w = Math.max(world.width, world.height / aspect());
    return { x: (world.width - w) / 2, y: (world.height - w * aspect()) / 2, w };
  }
  function clamp(v) {
    const full = fullView();
    const w = Math.min(Math.max(v.w, MIN_VIEW_WIDTH), full.w);
    const h = w * aspect();
    // Keep the view's centre over the map.
    const cx = Math.min(Math.max(v.x + w / 2, Math.min(w / 2, world.width / 2)), Math.max(world.width - w / 2, world.width / 2));
    const cy = Math.min(Math.max(v.y + h / 2, Math.min(h / 2, world.height / 2)), Math.max(world.height - h / 2, world.height / 2));
    return { x: cx - w / 2, y: cy - h / 2, w };
  }

  let frame = 0;
  function render() {
    frame = 0;
    svg.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.w * aspect()}`);
    const s = scale();
    const zoomedIn = view.w <= TINY_CIRCLES_MAX_VIEW;
    for (const c of circles) {
      // Once a country is big enough to hit on its own, its helper circle goes away.
      const show = zoomedIn && c.size * s < TINY_TAP_RADIUS_PX * 2;
      c.node.setAttribute('r', show ? TINY_TAP_RADIUS_PX / s : 0);
    }
  }
  function setView(v) {
    view = clamp(v);
    frame ||= requestAnimationFrame(render);
  }

  function toMap(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    return { x: view.x + (clientX - r.left) / scale(), y: view.y + (clientY - r.top) / scale() };
  }
  // Zooms by factor (<1 = in) keeping the map point under (clientX, clientY) in place.
  function zoomAt(factor, clientX, clientY, base = view) {
    const r = svg.getBoundingClientRect();
    const s = (svg.clientWidth || 1) / base.w;
    const px = base.x + (clientX - r.left) / s;
    const py = base.y + (clientY - r.top) / s;
    const w = Math.min(Math.max(base.w * factor, MIN_VIEW_WIDTH), fullView().w);
    const k = w / base.w;
    return { x: px - (px - base.x) * k, y: py - (py - base.y) * k, w };
  }
  function zoomBy(factor) {
    const r = svg.getBoundingClientRect();
    animateTo(clamp(zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2)));
  }

  let animation = 0;
  function animateTo(target, ms = 350) {
    cancelAnimationFrame(animation);
    const from = view;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - (1 - t) ** 3;
      // Interpolate the zoom geometrically so it feels even.
      const w = from.w * (target.w / from.w) ** e;
      const fcx = from.x + from.w / 2, fcy = from.y + (from.w * aspect()) / 2;
      const tcx = target.x + target.w / 2, tcy = target.y + (target.w * aspect()) / 2;
      const cx = fcx + (tcx - fcx) * e, cy = fcy + (tcy - fcy) * e;
      view = { x: cx - w / 2, y: cy - (w * aspect()) / 2, w };
      render();
      if (t < 1) animation = requestAnimationFrame(step);
    };
    animation = requestAnimationFrame(step);
  }

  // Which country is at this screen point? Small misses next to a coast count
  // for the closest country, so fingers don't have to be pixel-perfect.
  function countryAt(clientX, clientY) {
    const hit = (x, y) => {
      const target = document.elementFromPoint(x, y);
      return target && svg.contains(target) ? target.dataset.id : undefined;
    };
    const direct = hit(clientX, clientY);
    if (direct) return direct;
    for (const radius of [COAST_TOLERANCE_PX / 2, COAST_TOLERANCE_PX]) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const id = hit(clientX + Math.cos(a) * radius, clientY + Math.sin(a) * radius);
        if (id) return id;
      }
    }
    return undefined;
  }

  // --- Gestures ---
  const pointers = new Map();
  let gesture = null;
  function startGesture() {
    const pts = [...pointers.values()];
    if (pts.length === 1) {
      gesture = { type: 'pan', start: pts[0], base: view, tap: gesture?.type !== 'pinch' && !gesture?.moved };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, base: view };
    }
  }
  svg.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelAnimationFrame(animation);
    svg.setPointerCapture(e.pointerId);
    const first = pointers.size === 0;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (first) gesture = null;
    startGesture();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    if (gesture.type === 'pan') {
      const dx = pts[0].x - gesture.start.x;
      const dy = pts[0].y - gesture.start.y;
      if (Math.hypot(dx, dy) > TAP_SLOP_PX) gesture.tap = false;
      if (gesture.tap) return;
      const s = (svg.clientWidth || 1) / gesture.base.w;
      setView({ x: gesture.base.x - dx / s, y: gesture.base.y - dy / s, w: gesture.base.w });
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Zoom around the starting midpoint, then follow the fingers' movement.
      const zoomed = zoomAt(gesture.dist / dist, gesture.mid.x, gesture.mid.y, gesture.base);
      const s = (svg.clientWidth || 1) / zoomed.w;
      setView({ x: zoomed.x - (mid.x - gesture.mid.x) / s, y: zoomed.y - (mid.y - gesture.mid.y) / s, w: zoomed.w });
    }
  });
  const release = (e) => {
    if (!pointers.has(e.pointerId)) return;
    const wasTap = e.type === 'pointerup' && pointers.size === 1 && gesture?.type === 'pan' && gesture.tap;
    pointers.delete(e.pointerId);
    if (wasTap) onTap(e.clientX, e.clientY);
    if (pointers.size) {
      // Lifting one finger of a pinch continues as a pan, never as a tap.
      gesture = { type: 'pinch' };
      startGesture();
    }
  };
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    cancelAnimationFrame(animation);
    setView(zoomAt(Math.exp(e.deltaY * 0.002), e.clientX, e.clientY));
  }, { passive: false });
  // Safari fires its own gesture events for pinches; keep it from zooming the page.
  svg.addEventListener('gesturestart', (e) => e.preventDefault());
  new ResizeObserver(() => setView(view)).observe(svg);

  function onTap(clientX, clientY) {
    if (!game || game.locked || game.mode.answer !== 'map') return;
    const id = countryAt(clientX, clientY);
    if (!id) {
      // Water or an area that isn't part of the quiz: no penalty, just a hint.
      const p = toMap(clientX, clientY);
      const ring = document.createElementNS(SVG_NS, 'circle');
      ring.classList.add('miss');
      ring.setAttribute('cx', p.x);
      ring.setAttribute('cy', p.y);
      ring.setAttribute('r', 14 / scale());
      svg.appendChild(ring);
      setTimeout(() => ring.remove(), 400);
      return;
    }
    select(id);
  }

  pickMap = {
    node,
    reset() {
      cancelAnimationFrame(animation);
      for (const n of svg.querySelectorAll('.correct, .wrong')) n.classList.remove('correct', 'wrong');
      select(null);
      svg.querySelectorAll('circle.miss').forEach((n) => n.remove());
      pointers.clear();
      gesture = null;
      // Layout may not exist yet on the very first question.
      requestAnimationFrame(() => setView(fullView()));
      setView(fullView());
    },
    // Colours the right (and a wrongly tapped) country and flies to the answer.
    // What the timer submits when it runs out.
    get selection() {
      return selected && (game.items.find((it) => it.id === selected) ?? { id: selected });
    },
    reveal(targetId, chosenId) {
      confirmButton.disabled = true;
      for (const n of svg.querySelectorAll('.selected')) n.classList.remove('selected');
      const mark = (id, cls) => {
        for (const n of svg.querySelectorAll(`[data-id="${id}"]`)) {
          n.classList.add(cls);
          n.parentNode.appendChild(n);
        }
      };
      if (chosenId && chosenId !== targetId) mark(chosenId, 'wrong');
      mark(targetId, 'correct');
      for (const c of svg.querySelectorAll('circle.tiny')) svg.appendChild(c);
      if (chosenId === targetId) return;
      // Frame the right answer, and the wrong tap too so both are visible.
      const boxes = [targetId, chosenId].filter((id) => world.countries[id]).map((id) => world.countries[id].bounds);
      const x0 = Math.min(...boxes.map((b) => b[0])), y0 = Math.min(...boxes.map((b) => b[1]));
      const x1 = Math.max(...boxes.map((b) => b[2])), y1 = Math.max(...boxes.map((b) => b[3]));
      const w = Math.max((x1 - x0) * 1.6, ((y1 - y0) * 1.6) / aspect(), 120);
      animateTo(clamp({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - (w * aspect()) / 2, w }), 600);
    },
  };
  return pickMap;
}

// --- Game ------------------------------------------------------------------

let game = null;

function levelFor(game) {
  const [toMedium, toHard] = LEVEL_STEPS[game.mode.data];
  const n = game.answered;
  return n < toMedium ? 'easy' : n < toHard ? 'medium' : 'hard';
}

// Picks an unused item, starting at the run's current level.
function nextItem(game) {
  const level = levelFor(game);
  const start = DIFFICULTIES.indexOf(level);
  const order = [...DIFFICULTIES.slice(start), ...DIFFICULTIES.slice(0, start).reverse()];
  for (const difficulty of order) {
    const pool = game.items.filter((it) => it.difficulty === difficulty && !game.used.has(it.id));
    if (pool.length) return pickRandom(pool);
  }
  return null;
}

// Three wrong answers: well-known ones for easy questions, look-alikes from
// the same region for harder ones.
function distractors(game, item) {
  const key = game.mode.answer === 'flag' ? 'iso2' : game.mode.answer;
  const others = game.items.filter((it) => it.id !== item.id && it[key] !== item[key]);
  const level = item.difficulty;
  let preferred;
  if (level === 'easy') {
    preferred = others.filter((it) => it.difficulty === 'easy');
  } else if (game.mode.data === 'countries') {
    const field = level === 'hard' ? 'subregion' : 'region';
    preferred = others.filter((it) => it[field] && it[field] === item[field]);
  } else {
    preferred = others;
  }
  const picked = shuffle(preferred).slice(0, 3);
  for (const it of shuffle(others)) {
    if (picked.length >= 3) break;
    if (!picked.includes(it)) picked.push(it);
  }
  return picked;
}

async function startGame(mode) {
  game = { mode, items: await itemsFor(mode), used: new Set(), lives: LIVES, score: 0, answered: 0, startedAt: Date.now(), locked: false, best: null, record: false };
  // The current #1 of this mode; beating it during the run plays the record sound.
  const current = game;
  fetchScores().then((scores) => { current.best = scores[mode.id]?.[0]?.score ?? 0; }).catch(() => {});
  show('game');
  renderStatus();
  await nextQuestion();
}

function celebrate() {
  const level = $('level');
  level.dataset.level = 'record';
  level.textContent = '🏆 Neuer Rekord!';
}

function renderStatus() {
  $('lives').textContent = '❤️'.repeat(game.lives) + '🖤'.repeat(LIVES - game.lives);
  $('score').textContent = game.score === 1 ? '1 Punkt' : `${game.score} Punkte`;
}

async function nextQuestion() {
  const item = nextItem(game);
  if (!item) return endGame(true);
  game.used.add(item.id);
  game.current = item;
  game.locked = false;

  const level = $('level');
  level.dataset.level = item.difficulty;
  level.textContent = `Frage ${game.answered + 1} · ${DIFFICULTY_LABEL[item.difficulty]}`;

  await renderPrompt(game.mode, item);
  if (game.mode.answer === 'map') {
    const answers = $('answers');
    answers.className = 'answers map-mode';
    $('question').classList.add('compact');
    const picker = await pickerMap();
    picker.reset();
    answers.replaceChildren(picker.node);
    return startTimer();
  }
  const options = shuffle([item, ...distractors(game, item)]);
  const answers = $('answers');
  answers.className = game.mode.answer === 'flag' ? 'answers flags' : 'answers';
  $('question').classList.remove('compact');
  answers.replaceChildren(
    ...options.map((opt) => {
      const button = el('button', { type: 'button' }, answerContent(game.mode, opt));
      button.dataset.id = opt.id;
      if (game.mode.answer === 'flag') button.setAttribute('aria-label', `Flagge ${options.indexOf(opt) + 1}`);
      button.addEventListener('click', () => answer(opt, button));
      return button;
    }),
  );
  startTimer();
}

// Countdown per question; running out counts as a wrong answer.
function startTimer() {
  const current = game;
  const seconds = current.mode.seconds ?? QUESTION_SECONDS;
  const deadline = performance.now() + seconds * 1000;
  const bar = $('timer-bar');
  const text = $('timer-text');
  const timer = $('timer');
  const tick = () => {
    if (game !== current || current.locked) return;
    const left = Math.max(0, deadline - performance.now());
    bar.style.transform = `scaleX(${left / (seconds * 1000)})`;
    text.textContent = `${Math.ceil(left / 1000)} s`;
    timer.classList.toggle('urgent', left <= 3000);
    if (left === 0) answer(current.mode.answer === 'map' ? pickMap.selection : null, null);
    else current.timer = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(current.timer);
  tick();
}

function answer(choice, button) {
  if (game.locked) return;
  game.locked = true;
  cancelAnimationFrame(game.timer);
  const correct = choice?.id === game.current.id;
  game.answered += 1;
  if (game.mode.answer === 'map') pickMap.reveal(game.current.id, choice?.id);
  else for (const b of $('answers').children) {
    b.disabled = true;
    if (b.dataset.id === game.current.id) b.classList.add('correct');
  }
  if (correct) {
    game.score += 1;
    // With no previous entries every score would be a "record", so a first
    // run only gets the fanfare at game over.
    if (!game.record && game.best > 0 && game.score > game.best) {
      game.record = true;
      play('record');
      celebrate();
    } else {
      play('correct');
    }
  } else {
    button?.classList.add('wrong');
    if (!choice) $('timer-text').textContent = 'Zeit abgelaufen';
    game.lives -= 1;
    play('wrong');
    navigator.vibrate?.(150);
  }
  renderStatus();
  const current = game;
  setTimeout(() => {
    if (game !== current) return;
    if (game.lives <= 0) endGame(false);
    else nextQuestion();
  }, correct ? 800 : game.mode.answer === 'map' ? 2200 : 1600); // the map needs a moment to fly to the answer
}

// --- Game over & highscores --------------------------------------------------

async function fetchScores() {
  const res = await fetch('api/highscores');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function renderScoreList(list, node, highlight) {
  if (!list?.length) {
    node.replaceChildren(el('li', { className: 'empty', textContent: 'Noch keine Einträge.' }));
    return;
  }
  const fmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
  node.replaceChildren(
    ...list.map((e) => {
      const li = el(
        'li',
        {},
        el('span', { className: 'who' }, e.name, el('small', { textContent: `${fmt.format(new Date(e.date))} · ${e.answered} Fragen · ${formatDuration(e.durationSec)}` })),
        el('span', { className: 'pts', textContent: e.score }),
      );
      if (highlight && e.date === highlight.date && e.name === highlight.name) li.classList.add('me');
      return li;
    }),
  );
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  return m ? `${m} min ${sec % 60} s` : `${sec} s`;
}

async function endGame(completed) {
  const finished = game;
  finished.over = true;
  $('over-title').textContent = completed ? 'Alles geschafft! 🎉' : 'Spiel vorbei';
  $('final-score').textContent = finished.score;
  $('final-unit').textContent = finished.score === 1 ? 'Punkt' : 'Punkte';
  $('over-mode').textContent = finished.mode.title;
  const form = $('save-form');
  form.hidden = true;
  $('over-list').replaceChildren();
  show('over');

  let list = [];
  try {
    list = (await fetchScores())[finished.mode.id] ?? [];
  } catch {
    $('over-list').replaceChildren(el('li', { className: 'empty', textContent: 'Bestenliste nicht erreichbar.' }));
    return;
  }
  renderScoreList(list, $('over-list'));
  if (finished.score > 0 && finished.score > (list[0]?.score ?? 0)) {
    $('over-title').textContent = 'Neuer Rekord! 🏆';
    if (!finished.record) play('record');
    finished.record = true;
  }
  const qualifies = finished.score > 0 && (list.length < 10 || finished.score > list[list.length - 1].score);
  if (!qualifies) return;

  form.hidden = false;
  const input = $('player-name');
  input.value = storage.get('playerName') ?? '';
  form.onsubmit = async (event) => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    storage.set('playerName', name);
    form.querySelector('button').disabled = true;
    try {
      const res = await fetch('api/highscores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: finished.mode.id,
          name,
          score: finished.score,
          answered: finished.answered,
          durationSec: Math.round((Date.now() - finished.startedAt) / 1000),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { list: updated, rank } = await res.json();
      form.hidden = true;
      renderScoreList(updated, $('over-list'), rank ? updated[rank - 1] : null);
    } catch {
      alert('Speichern fehlgeschlagen. Bitte nochmal versuchen.');
    } finally {
      form.querySelector('button').disabled = false;
    }
  };
}

async function showHighscores(modeId = storage.get('scoreTab') ?? MODES[0].id) {
  show('highscores');
  const tabs = $('score-tabs');
  tabs.replaceChildren(
    ...MODES.map((m) => {
      const b = el('button', { type: 'button', textContent: m.title });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', m.id === modeId);
      b.addEventListener('click', () => {
        storage.set('scoreTab', m.id);
        showHighscores(m.id);
      });
      return b;
    }),
  );
  tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  try {
    renderScoreList((await fetchScores())[modeId], $('score-list'));
  } catch {
    $('score-list').replaceChildren(el('li', { className: 'empty', textContent: 'Bestenliste nicht erreichbar.' }));
  }
}

// --- Navigation --------------------------------------------------------------

function show(name) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== `screen-${name}`;
  window.scrollTo(0, 0);
}

function navigate(target) {
  if (target === 'highscores') return showHighscores();
  if (target === 'about') {
    load('meta').then((meta) => {
      const date = new Date(meta.generatedAt).toLocaleDateString('de-DE');
      const how = meta.difficultyMethod === 'pageviews' ? 'Wikipedia-Seitenaufrufe und Einwohnerzahl' : 'Einwohnerzahl';
      $('data-meta').textContent = `Datenstand: ${date}. Schwierigkeitsgrad berechnet aus: ${how}.`;
    }).catch(() => {});
  }
  show(target);
}

function renderSoundToggles() {
  for (const b of document.querySelectorAll('.sound-toggle')) {
    b.textContent = isMuted() ? '🔇' : '🔊';
    b.setAttribute('aria-label', isMuted() ? 'Ton einschalten' : 'Ton ausschalten');
    b.setAttribute('aria-pressed', String(isMuted()));
  }
}

function init() {
  renderSoundToggles();
  for (const b of document.querySelectorAll('.sound-toggle')) {
    b.addEventListener('click', () => {
      setMuted(!isMuted());
      renderSoundToggles();
      play('correct'); // short preview when switching on
    });
  }
  $('mode-list').replaceChildren(
    ...MODES.map((mode) => {
      const button = el('button', { type: 'button' }, el('span', { className: 'mode-icon', textContent: mode.icon }), el('span', {}, mode.title, el('small', { textContent: mode.hint })));
      button.addEventListener('click', () => startGame(mode));
      return el('li', {}, button);
    }),
  );
  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (nav) navigate(nav.dataset.nav);
  });
  $('quit').addEventListener('click', () => {
    if (game && game.answered > 0 && !confirm('Spiel wirklich beenden?')) return;
    game = null;
    show('home');
  });
  $('again').addEventListener('click', () => startGame(game.mode));
}

init();
