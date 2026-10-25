// Builds the quiz data in public/data and public/flags from public sources.
//
//   node scripts/build-data.mjs            fetch everything, incl. Wikipedia pageviews
//   node scripts/build-data.mjs --offline  skip Wikimedia (difficulty from population only)
//
// Downloads are cached in .cache/ so repeated runs are fast.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { geoEqualEarth, geoMercator, geoPath, geoArea } from 'd3-geo';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public', 'data');
const FLAGS_OUT = path.join(ROOT, 'public', 'flags');
const OFFLINE = process.argv.includes('--offline');
const USER_AGENT = 'geography-quiz-data-build/1.0 (https://github.com/Doxmen966/geography-quiz)';

const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const SOURCES = {
  countries: 'https://raw.githubusercontent.com/mledoze/countries/master/countries.json',
  world: `${NE}/ne_50m_admin_0_countries.geojson`,
  states: `${NE}/ne_10m_admin_1_states_provinces.geojson`,
  places: `${NE}/ne_10m_populated_places.geojson`,
};

async function cached(name, url) {
  const file = path.join(CACHE, name);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    console.log(`download ${url}`);
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const text = await res.text();
    await fs.mkdir(CACHE, { recursive: true });
    await fs.writeFile(file, text);
    return JSON.parse(text);
  }
}

const normalize = (s) => s.normalize('NFD').replace(/[^a-zA-Z]/g, '').toLowerCase();

// Percentile rank (0..1) of each value; missing values rank lowest.
function percentiles(values) {
  const sorted = values.filter((v) => v != null).sort((a, b) => a - b);
  return values.map((v) => (v == null || sorted.length < 2 ? 0 : sorted.indexOf(v) / (sorted.length - 1)));
}

// Splits items into thirds by score: the best known third is easy.
function assignDifficulty(items, overrides = {}) {
  const ranked = [...items].sort((a, b) => b.score - a.score);
  ranked.forEach((item, i) => {
    const third = Math.floor((i * 3) / ranked.length);
    item.difficulty = overrides[item.id] ?? ['easy', 'medium', 'hard'][third];
  });
}

// --- Wikimedia (popularity) ---------------------------------------------

async function dewikiTitles(qids) {
  const titles = {};
  for (let i = 0; i < qids.length; i += 50) {
    const ids = qids.slice(i, i + 50).join('|');
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=sitelinks&sitefilter=dewiki&ids=${ids}`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Wikidata: HTTP ${res.status}`);
    const { entities } = await res.json();
    for (const [qid, e] of Object.entries(entities)) {
      if (e.sitelinks?.dewiki) titles[qid] = e.sitelinks.dewiki.title;
    }
  }
  return titles;
}

// Sum of German Wikipedia pageviews over the last 12 full months.
async function pageviews(title) {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth() + 1, 1));
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, '') + '00';
  const article = encodeURIComponent(title.replace(/ /g, '_'));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/de.wikipedia/all-access/user/${article}/monthly/${fmt(start)}/${fmt(end)}`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Pageviews ${title}: HTTP ${res.status}`);
  const { items } = await res.json();
  return items.reduce((sum, item) => sum + item.views, 0);
}

async function popularity(qids) {
  if (OFFLINE) return null;
  const titles = await dewikiTitles(qids);
  const views = {};
  for (const qid of qids) {
    if (!titles[qid]) continue;
    views[qid] = await pageviews(titles[qid]);
    await new Promise((r) => setTimeout(r, 50));
  }
  return views;
}

// --- Geometry ------------------------------------------------------------

const round = (n) => Math.round(n * 10) / 10;

// Bounding box of the largest polygon, so overseas territories don't zoom the map out.
function mainBounds(feature, pathGen) {
  const g = feature.geometry;
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  let best = null;
  for (const coords of polys) {
    const poly = { type: 'Polygon', coordinates: coords };
    const area = geoArea(poly);
    if (!best || area > best.area) best = { area, poly };
  }
  return pathGen.bounds(best.poly).flat().map(round);
}

// --- Main ----------------------------------------------------------------

async function main() {
  const [countries, world, states, places] = await Promise.all(
    Object.entries(SOURCES).map(([name, url]) => cached(`${name}.json`, url)),
  );
  const overrides = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'difficulty-overrides.json'), 'utf8'));

  // Countries: all independent states from mledoze/countries.
  const byCode = new Map();
  for (const f of world.features) {
    for (const key of ['ISO_A3_EH', 'ISO_A3', 'ADM0_A3']) {
      const code = f.properties[key];
      if (code && code !== '-99' && !byCode.has(code)) byCode.set(code, f);
    }
  }
  const capitals = places.features.map((f) => f.properties).filter((p) => p.FEATURECLA.startsWith('Admin-0 capital'));

  const quiz = [];
  for (const c of countries.filter((c) => c.independent)) {
    const feature = byCode.get(c.cca3);
    if (!feature) throw new Error(`No geometry for ${c.cca3}`);
    const p = feature.properties;
    const capitalEn = c.capital?.[0];
    if (!capitalEn) throw new Error(`No capital for ${c.cca3}`);
    // German capital name from Natural Earth when it is the same city, otherwise keep mledoze's name.
    const ne = capitals.find((x) => (x.SOV_A3 === c.cca3 || x.ADM0_A3 === c.cca3) && [x.NAME, x.NAME_EN].some((n) => normalize(n) === normalize(capitalEn)));
    quiz.push({
      id: c.cca3,
      iso2: c.cca2.toLowerCase(),
      name: c.translations.deu.common,
      capital: ne?.NAME_DE || capitalEn,
      region: c.region,
      subregion: c.subregion,
      population: p.POP_EST || null,
      wikidata: p.WIKIDATAID,
      feature,
    });
  }

  // World map
  const width = 2000;
  const projection = geoEqualEarth().fitWidth(width, { type: 'Sphere' });
  const worldPath = geoPath(projection).digits(1);
  const [[, y0], [, y1]] = worldPath.bounds({ type: 'Sphere' });
  const quizIds = new Set(quiz.map((c) => c.id));
  const background = world.features
    .filter((f) => ![...['ISO_A3_EH', 'ISO_A3', 'ADM0_A3']].some((k) => quizIds.has(f.properties[k]) && byCode.get(f.properties[k]) === f))
    .map((f) => worldPath(f))
    .filter(Boolean);
  const worldData = {
    width,
    height: Math.ceil(y1 - y0),
    background,
    countries: Object.fromEntries(quiz.map((c) => [c.id, { path: worldPath(c.feature), bounds: mainBounds(c.feature, worldPath) }])),
  };

  // Bundesländer + Landeshauptstädte
  const deStates = states.features.filter((f) => f.properties.adm0_a3 === 'DEU');
  const deCapitals = places.features.map((f) => f.properties).filter((p) => p.ADM0_A3 === 'DEU' && /capital/.test(p.FEATURECLA));
  const deProjection = geoMercator().fitExtent([[10, 10], [790, 1040]], { type: 'FeatureCollection', features: deStates });
  const dePath = geoPath(deProjection).digits(1);
  const bundeslaender = deStates.map((f) => {
    const p = f.properties;
    const capital = deCapitals.find((c) => c.ADM1NAME === p.name);
    if (!capital) throw new Error(`No capital for ${p.name}`);
    return { id: p.iso_3166_2, name: p.name, capital: capital.NAME_DE, capitalPopulation: capital.POP_MAX, wikidata: p.wikidataid, path: dePath(f) };
  });

  // Difficulty
  const views = await popularity([...quiz, ...bundeslaender].map((x) => x.wikidata));
  const method = views ? 'pageviews' : 'population';
  const cPop = percentiles(quiz.map((c) => (c.population ? Math.log(c.population) : null)));
  const cViews = views ? percentiles(quiz.map((c) => views[c.wikidata] ?? null)) : null;
  quiz.forEach((c, i) => {
    c.pageviews = views?.[c.wikidata] ?? null;
    c.score = cViews ? 0.7 * cViews[i] + 0.3 * cPop[i] : cPop[i];
  });
  assignDifficulty(quiz, overrides.countries);

  const sViews = views ? percentiles(bundeslaender.map((s) => views[s.wikidata] ?? null)) : percentiles(bundeslaender.map((s) => s.capitalPopulation));
  bundeslaender.forEach((s, i) => {
    s.pageviews = views?.[s.wikidata] ?? null;
    s.score = sViews[i];
  });
  assignDifficulty(bundeslaender, overrides.bundeslaender);

  // Flags
  const flagDir = path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags', '4x3');
  await fs.rm(FLAGS_OUT, { recursive: true, force: true });
  await fs.mkdir(FLAGS_OUT, { recursive: true });
  for (const c of quiz) await fs.copyFile(path.join(flagDir, `${c.iso2}.svg`), path.join(FLAGS_OUT, `${c.iso2}.svg`));

  // Output
  const write = (name, data) => fs.writeFile(path.join(OUT, name), JSON.stringify(data, null, name === 'world.json' || name === 'germany.json' ? 0 : 1));
  await fs.mkdir(OUT, { recursive: true });
  const pick = ({ feature, wikidata, score, ...rest }) => rest;
  await write('countries.json', quiz.map(pick).sort((a, b) => a.name.localeCompare(b.name, 'de')));
  await write('world.json', worldData);
  await write('germany.json', { width: 800, height: 1050, states: bundeslaender.map(({ wikidata, score, capitalPopulation, ...rest }) => rest) });
  await write('meta.json', { generatedAt: new Date().toISOString(), difficultyMethod: method });

  const count = (list) => Object.fromEntries(['easy', 'medium', 'hard'].map((d) => [d, list.filter((x) => x.difficulty === d).length]));
  console.log(`countries: ${quiz.length}`, count(quiz));
  console.log(`bundeslaender: ${bundeslaender.length}`, count(bundeslaender));
  console.log(`difficulty method: ${method}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
