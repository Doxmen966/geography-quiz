import { play, isMuted, setMuted } from './sound.js';

const LIVES = 3;
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const DIFFICULTY_LABEL = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };
// How many questions a run stays on a level before moving up, per data set.
const LEVEL_STEPS = { countries: [10, 25], states: [6, 11] };
const SVG_NS = 'http://www.w3.org/2000/svg';

const MODES = [
  { id: 'flag-to-country', icon: '🏳️', title: 'Flagge → Land', hint: 'Welches Land hat diese Flagge?', data: 'countries', prompt: 'flag', answer: 'name' },
  { id: 'country-to-flag', icon: '🌍', title: 'Land → Flagge', hint: 'Welche Flagge gehört zum Land?', data: 'countries', prompt: 'name', answer: 'flag' },
  { id: 'country-to-capital', icon: '🏛️', title: 'Land → Hauptstadt', hint: 'Wie heißt die Hauptstadt?', data: 'countries', prompt: 'name', answer: 'capital' },
  { id: 'map-to-country', icon: '🗺️', title: 'Karte → Land', hint: 'Welches Land ist markiert?', data: 'countries', prompt: 'world-map', answer: 'name' },
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
  else content = el('div', { className: 'prompt-text', textContent: item.name });
  box.replaceChildren(label, content);
}

function answerContent(mode, item) {
  if (mode.answer === 'flag') return flagImg(item, `Flagge`);
  return item[mode.answer];
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
  const options = shuffle([item, ...distractors(game, item)]);
  const answers = $('answers');
  answers.classList.toggle('flags', game.mode.answer === 'flag');
  answers.replaceChildren(
    ...options.map((opt) => {
      const button = el('button', { type: 'button' }, answerContent(game.mode, opt));
      button.dataset.id = opt.id;
      if (game.mode.answer === 'flag') button.setAttribute('aria-label', `Flagge ${options.indexOf(opt) + 1}`);
      button.addEventListener('click', () => answer(opt, button));
      return button;
    }),
  );
}

function answer(choice, button) {
  if (game.locked) return;
  game.locked = true;
  const correct = choice.id === game.current.id;
  game.answered += 1;
  for (const b of $('answers').children) {
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
    button.classList.add('wrong');
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
  }, correct ? 800 : 1600);
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
