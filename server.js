import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import compression from 'compression';

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.resolve('storage');
const SCORES_FILE = path.join(DATA_DIR, 'highscores.json');
const MODES = ['flag-to-country', 'country-to-flag', 'country-to-capital', 'map-to-country', 'state-to-capital', 'germany-map-to-state'];
const TOP = 10;

async function loadScores() {
  try {
    return JSON.parse(await fs.readFile(SCORES_FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

// Writes go through a queue so two finished games can't overwrite each other.
let writeQueue = Promise.resolve();
function saveScore(entry) {
  const run = writeQueue.then(async () => {
    const scores = await loadScores();
    const list = [...(scores[entry.mode] ?? []), entry].sort((a, b) => b.score - a.score || a.date.localeCompare(b.date)).slice(0, TOP);
    scores[entry.mode] = list;
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${SCORES_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(scores, null, 1));
    await fs.rename(tmp, SCORES_FILE);
    return list;
  });
  writeQueue = run.catch(() => {});
  return run;
}

const app = express();
app.use(compression());
app.use(express.json({ limit: '4kb' }));

app.get('/api/highscores', async (req, res, next) => {
  try {
    res.json(await loadScores());
  } catch (err) {
    next(err);
  }
});

app.post('/api/highscores', async (req, res, next) => {
  const { mode, name, score, answered, durationSec } = req.body ?? {};
  const isCount = (n) => Number.isInteger(n) && n >= 0 && n < 100000;
  if (!MODES.includes(mode) || typeof name !== 'string' || !name.trim() || !isCount(score) || !isCount(answered) || !isCount(durationSec)) {
    return res.status(400).json({ error: 'invalid highscore' });
  }
  try {
    const entry = { mode, name: name.trim().slice(0, 20), score, answered, durationSec, date: new Date().toISOString() };
    const list = await saveScore(entry);
    res.json({ list, rank: list.indexOf(entry) + 1 || null });
  } catch (err) {
    next(err);
  }
});

app.use(express.static('public', { maxAge: '1h' }));

app.listen(PORT, () => console.log(`Geography quiz listening on http://localhost:${PORT} (highscores in ${DATA_DIR})`));
