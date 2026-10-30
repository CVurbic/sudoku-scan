// Reading a sudoku from a picture: OpenCV finds and straightens the grid, the models read the digits and tell
// printed from handwritten, learning from use, and the live camera.

const S = 64, N = S * 9;   // cell px, warped grid px

async function cvReady() {
  if (cv instanceof Promise) cv = await cv;
  else if (!cv.Mat) await new Promise(r => cv.onRuntimeInitialized = r);
  loading('Učitavam model…');
  try { model = await tf.loadLayersModel('model/model.json'); }
  catch { return loading('Model nije pronađen (pokreni train.js).'); }
  featModel = tf.model({ inputs: model.inputs, outputs: model.layers[model.layers.length - 2].output });
  try { printedModel = await tf.loadLayersModel('model/printed/model.json'); } catch {}   // optional: printed vs handwritten
  rebuildMemory();
  $('file').disabled = $('liveBtn').disabled = $('paperBtn').disabled = false;
  loading('');
}

// A photo of the saved sudoku's paper is checked against it; any other photo is a new sudoku (the saved
// one stays for "Nastavi"). A photo is never today's daily.
$('file').onchange = async () => {
  const f = $('file').files[0];
  if (!f) return;
  $('file').value = '';   // the same picture again fires again
  say('Tražim mrežu…');
  const probs = await readGrid(f);
  if (!probs) return say('Mreža nije pronađena. Probaj sliku snimljenu bliže i ravnije, ili skeniraj kamerom.', Infinity);
  const off = task && probs.filter((p, i) => task.givens[i] && best(p) !== task.givens[i]).length;
  if (task && (task.daily || off > task.givens.filter(Boolean).length / 3)) clearBoard();
  showScan(lastProbs = probs);
};

// Photo → 81 entries: null (empty cell) or 9 digit probabilities. null if no grid found. Also used by bench.js.
async function readGrid(file) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1000 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = img.width * k | 0; c.height = img.height * k | 0;
  const x = c.getContext('2d');
  x.drawImage(img, 0, 0, c.width, c.height);

  // Also inverted, for light lines on dark (a dark-mode screenshot): there the plain picture may still
  // show a grid-like part (one 3×3 box), so the better grid of the two wins.
  const plain = findGrid(cv.imread(c));
  x.filter = 'invert(1)';
  x.drawImage(img, 0, 0, c.width, c.height);
  const inv = findGrid(cv.imread(c)), grid = !plain || inv?.score > plain.score ? inv : plain;
  (grid === inv ? plain : inv)?.warped.delete();
  return grid && readTurns(grid.warped, file.type === 'image/png').probs;
}

// Warped RGBA grid (deleted here) → readCells result of the best of 4 turns, plus rot = clockwise turns.
// Paper may lie rotated: keep the turn the model is most sure about. screen: a screenshot (printedKinds).
function readTurns(warped, screen) {
  let best = null, color = warped, gray = new cv.Mat();
  cv.cvtColor(color, gray, cv.COLOR_RGBA2GRAY);
  // Light digits on a dark ground (a dark-mode screenshot) → dark on light, as the reading expects. On paper
  // most pixels are brighter than the mean (ink is the minority); here most are darker.
  const g = gray.data, mean = g.reduce((a, b) => a + b, 0) / g.length;
  let above = 0;
  for (const x of g) if (x > mean) above++;
  if (above < 0.3 * g.length) {
    g.forEach((x, i) => g[i] = 255 - x);
    color.data.forEach((x, i) => { if (i % 4 !== 3) color.data[i] = 255 - x; });   // alpha stays
  }
  for (let r = 0; r < 4; r++) {
    if (r) [gray, color] = [gray, color].map(m => { const t = new cv.Mat(); cv.rotate(m, t, cv.ROTATE_90_CLOCKWISE); m.delete(); return t; });
    const res = readCells(gray, color, screen);
    if (!best || res.upright > best.upright + 0.05) { best = { ...res, rot: r }; cv.imshow('warped', gray); }   // +0.05: photos are usually upright
  }
  gray.delete(); color.delete();
  lastVecs = best.vecs; lastFeats = best.feats; lastPrinted = best.printed;
  return best;
}

// Each cell is binarised twice: a small window keeps thin pen strokes, a large one keeps blurry print whole.
const THRESHOLDS = [[31, 10], [51, 10]];

// Warped grid → { probs (as readGrid), upright: mean probability that a found digit is not turned,
// vecs: per cell the model inputs (one per binarisation that saw a digit) }.
// Model outputs 10 classes: digits 1-9 and "turned" (digit rotated 90/180/270°); a cell's
// probabilities are the average over its binarisations. A digit seen in only one of them must be
// read with ≥90% certainty, and its ink must be at least a third as dark as the grid's typical
// digit; else it is noise (paper texture, specks, creases).
function readCells(warped, color, screen) {
  const found = [], bin = new cv.Mat();
  for (const [block, c] of THRESHOLDS) {
    cv.adaptiveThreshold(warped, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, block, c);
    for (let i = 0; i < 81; i++) {
      const d = cellDigit(bin, warped, color, i / 9 | 0, i % 9);
      if (d) found.push([i, d]);
    }
  }
  bin.delete();
  const sum = Array(81).fill(null), hits = Array(81).fill(0), ink = Array(81).fill(0);
  if (found.length) {
    const xs = new Float32Array(found.length * 784);
    found.forEach(([, d], k) => xs.set(d.v, k * 784));
    const p = tf.tidy(() => model.predict(tf.tensor4d(xs, [found.length, 28, 28, 1])).arraySync());
    recall(xs, p);
    found.forEach(([i, d], k) => { hits[i]++; ink[i] = Math.max(ink[i], d.ink); sum[i] = sum[i] ? sum[i].map((x, j) => x + p[k][j]) : p[k]; });
  }
  let upright = 0;
  const inks = ink.filter(Boolean).sort((a, b) => a - b), typical = inks[inks.length >> 1];
  const probs = sum.map((s, i) => {
    if (!s || hits[i] < THRESHOLDS.length && Math.max(...s) < 0.9 || ink[i] < typical / 3) return null;
    const total = s.reduce((a, b) => a + b), turned = s[9] / total;
    upright += (1 - turned) / 81;   // /81 not /found: a turn that hides digits (90°) scores lower too
    return s.slice(0, 9).map(x => x / (total - s[9] || 1));
  });
  const vecs = Array.from({ length: 81 }, () => []);
  found.forEach(([i, d]) => probs[i] && vecs[i].push(d.v));
  // Printed or handwritten: shape (first binarisation's digit) + ink colourfulness, ink/paper brightness,
  // height and darkness relative to the grid's typical digit.
  const feats = Array(81).fill(null);
  for (const [i, d] of found) if (probs[i] && !feats[i]) feats[i] = { v: d.v, s: [d.chroma, d.lum, d.h, ink[i] / typical], stroke: d.stroke, d: best(probs[i]) };
  const p = Array(81).fill(null), idx = feats.flatMap((f, i) => f ? [i] : []);
  if (printedModel && idx.length) {
    const out = tf.tidy(() => printedModel.predict([
      tf.tensor4d(idx.flatMap(i => Array.from(feats[i].v)), [idx.length, 28, 28, 1]),
      tf.tensor2d(idx.flatMap(i => feats[i].s), [idx.length, 4])]).dataSync());
    idx.forEach((i, k) => p[i] = out[k]);
  }
  return { probs, upright, vecs, feats, printed: printedKinds(p, feats, screen) };
}

// P(printed) per cell → true printed / false handwritten / null empty. Printed digits on one paper look
// alike (same ink, size), so each cell also leans to the nearer of the grid's two groups (sure ones
// as centres). Only 1-2 "handwritten" digits: more likely misreadings than a started sudoku → all printed.
// A screenshot holds no handwriting, so there the model (made for paper) is skipped: plain (black, white,
// grey) digits next to coloured ones are the given ones; else bold ones next to regular ones (strokeCut);
// else all are. Elsewhere a clear bold/regular split decides too.
function printedKinds(p, feats, screen) {
  const plain = feats.map(f => f && f.s[0] < 0.15);
  if (screen && plain.filter(x => x === false).length >= 3 && plain.filter(Boolean).length >= 3) return plain;
  const cut = strokeCut(feats.filter(Boolean), screen ? 4 : 20);
  if (cut) return feats.map(f => f && f.stroke >= cut);
  if (screen) return feats.map(f => f && true);
  const idx = p.flatMap((x, i) => x === null ? [] : [i]);
  const groups = [idx.filter(i => p[i] > 0.8), idx.filter(i => p[i] < 0.2)];
  if (groups.every(g => g.length >= 3)) {
    const sd = [0, 1, 2, 3].map(d => {
      const xs = idx.map(i => feats[i].s[d]), m = xs.reduce((a, b) => a + b) / xs.length;
      return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length) || 1;
    });
    const [mp, mh] = groups.map(g => sd.map((_, d) => g.reduce((a, i) => a + feats[i].s[d], 0) / g.length));
    const dist = (i, m) => Math.hypot(...m.map((x, d) => (feats[i].s[d] - x) / sd[d]));
    p = p.map((x, i) => x === null ? null : (x + 1 / (1 + Math.exp(4 * (dist(i, mp) - dist(i, mh))))) / 2);
  }
  const printed = p.map(x => x === null ? null : x > 0.5);
  return printed.filter(x => x === false).length > 2 ? printed : printed.map(x => x === null ? null : true);
}

// Screens: the given digits bold, the typed ones regular, each group even in stroke width. → the lowest
// bold width, or 0 when the widths don't fall into two such groups (Fisher ≥ min, ≥ 1.2× wider, both
// sizeable). min: 4 for a screenshot (PNG; serif fonts score ~5); 20 for anything else, as photos of
// paper score up to ~14.5 (Wicht dataset), while a sans-serif screen sent on as JPEG still scores 23+.
// The split must also run through the digits: one digit in both weights, clearly apart, for at least
// three digits. A split by shape alone (one font: thin 1s, thick 8s) keeps each digit on one side.
function strokeCut(cells, min) {   // cells: [{ stroke, d: digit read }]
  const xs = cells.map(c => c.stroke).sort((a, b) => a - b);
  const n = xs.length, side = Math.max(8, Math.ceil(0.15 * n)), mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  const vari = a => { const m = mean(a); return a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length; };
  let best = min, cut = 0;
  for (let k = side; k <= n - side; k++) {
    const lo = xs.slice(0, k), hi = xs.slice(k), f = (mean(hi) - mean(lo)) ** 2 / (vari(lo) + vari(hi) || 1e-9);
    if (f > best && mean(hi) >= 1.2 * mean(lo)) { best = f; cut = xs[k]; }
  }
  let both = 0;
  for (let d = 1; cut && d <= 9; d++) {
    const lo = cells.filter(c => c.d === d && c.stroke < cut).map(c => c.stroke), hi = cells.filter(c => c.d === d && c.stroke >= cut).map(c => c.stroke);
    if (!lo.length || !hi.length) continue;
    if (mean(hi) < 1.15 * mean(lo)) return 0;
    both++;
  }
  return both >= 3 ? cut : 0;
}

// --- Learning from use. Cells whose digit became known (confirmed givens, own entries matching the
// solution, digits typed into flagged cells) are remembered on the device; a new cell that looks like
// remembered ones (close in the model's feature space) leans towards their digit. The model itself
// never changes, so a bad memory can't break it. ---
const MEMORY_MAX = 2000, K = 5, SIM = 0.95, PULL = 0.7;
let memory = [], memFeat = null, lastVecs = Array.from({ length: 81 }, () => []);
let lastFeats = Array(81).fill(null), lastPrinted = Array(81).fill(null);   // of the last scan: features, printed? (printedKinds)
let lastProbs = null;   // readGrid result of the last photo
try {
  memory = JSON.parse(localStorage.sudokuMemory || '[]')
    .map(([x, d]) => ({ x: Uint8Array.from(atob(x), ch => ch.charCodeAt(0)), d }));
} catch {}

// n model inputs → unit-length feature rows [n, 64].
const features = (xs, n) => tf.tidy(() => {
  const f = featModel.predict(tf.tensor4d(xs, [n, 28, 28, 1]));
  return f.div(f.norm('euclidean', 1, true).add(1e-6));
});

function rebuildMemory() {
  memFeat?.dispose(); memFeat = null;
  if (!memory.length || !featModel) return;
  const xs = new Float32Array(memory.length * 784);
  memory.forEach((m, k) => xs.set(Float32Array.from(m.x, b => b / 255), k * 784));
  memFeat = features(xs, memory.length);
}

// [[cell, digit], ...] for cells of the last scan → remembered.
function learn(pairs) {
  let added = 0;
  for (const [i, d] of pairs) for (const v of lastVecs[i]) {
    memory.push({ x: Uint8Array.from(v, p => Math.round(p * 255)), d });
    added++;
  }
  if (!added) return;
  memory = memory.slice(-MEMORY_MAX);
  try { localStorage.sudokuMemory = JSON.stringify(memory.map(m => [btoa(String.fromCharCode(...m.x)), m.d])); } catch {}
  rebuildMemory();
}

// Model outputs p (rows of 10, edited in place) for inputs xs: pull towards the digit of the K nearest
// remembered cells, if at least 2 of them are very similar.
function recall(xs, p) {
  if (!memFeat) return;
  const f = features(xs, p.length);
  const top = tf.tidy(() => tf.topk(tf.matMul(f, memFeat, false, true), Math.min(K, memory.length)));
  const sims = top.values.arraySync(), idx = top.indices.arraySync();
  [f, top.values, top.indices].forEach(t => t.dispose());
  p.forEach((pk, k) => {
    const vote = Array(9).fill(0);
    let n = 0;
    idx[k].forEach((j, t) => { if (sims[k][t] > SIM) { vote[memory[j].d - 1] += sims[k][t]; n++; } });
    if (n < 2) return;
    const total = vote.reduce((a, b) => a + b), digit = 1 - pk[9];
    for (let j = 0; j < 9; j++) pk[j] = (1 - PULL) * pk[j] + PULL * digit * vote[j] / total;
  });
}

const best = p => p ? p.indexOf(Math.max(...p)) + 1 : 0;
// Own entry vs known solution digit: the model only has to confirm it, not name it.
// 'wrong' only when the model is also sure it sees another digit (scribbles, crossed-out tries → 'maybe').
const judge = (p, sol) => p[sol - 1] >= 0.3 ? 'ok' : p[sol - 1] < 0.01 && Math.max(...p) > 0.9 ? 'wrong' : 'maybe';

// No task yet: show the model's best guess. With a task: givens come from the task, own entries are judged.
function showScan(probs) {
  go('game');
  clearHint();
  probs.forEach((p, i) => {
    const inp = inputs[i], b = best(p);
    inp.classList.remove('low', 'ok', 'wrong', 'maybe', 'entry');
    if (!task) {
      inp.value = b || '';
      inp.classList.toggle('low', !!p && p[b - 1] < 0.8);
      inp.classList.toggle('entry', lastPrinted[i] === false);
      inp.classList.toggle('given', !!b && lastPrinted[i] !== false);
      return;
    }
    if (task.givens[i]) return;
    if (!p) { inp.value = ''; return; }
    const j = judge(p, task.solution[i]);
    inp.value = j === 'ok' ? task.solution[i] : b;
    inp.classList.add(j);
  });
  if (task) learn(inputs.map((x, i) => [i, task.solution[i]]).filter(([i]) => inputs[i].classList.contains('ok')));
  markConflicts();
  const mine = !task && entryLabel();
  if (!task && inputs.every(x => x.value)) return say(inputs.some(x => x.classList.contains('bad'))   // a solved paper
    ? 'Isti broj dvaput (crveno): krivo pročitano ili greška na papiru. Ispravi krivo pročitano i stisni "Provjeri".'
    : 'Točno riješeno ✓ Žuto = nesigurno: ako je nešto krivo pročitano, ispravi. "Provjeri" ga sprema.', Infinity);
  if (mine) return say('Sivo = tiskano, plavo = upisano rukom, žuto = nesigurno, crveno = duplikat. Ispravi i stisni "Provjeri moje brojeve".', Infinity);
  if (!task) return say('Žuto = nesigurno, crveno = duplikat. Ispravi, obriši brojeve upisane rukom i stisni "Ovo je zadatak".', Infinity);
  sayEntries();
}
// "Tvoji brojevi: 34 točno, 1 krivo, 2 nesigurno", after a check of the paper.
const sayEntries = () => { const n = c => inputs.filter(x => x.classList.contains(c)).length; say(`*Tvoji brojevi:* ${n('ok')} točno, ${n('wrong')} krivo, ${n('maybe')} nesigurno`); };

// Candidate corner sets from the raw and the line-thickened (gaps closed) binary image: outer contour
// as a 4-gon, its extreme points, and the extreme points of the cells (square holes between grid
// lines; immune to thick frames or labels glued to the border). Each is warped and scored by
// lineScore; best wins. Returns { warped: N×N RGBA Mat, quad: its corners in src } or null.
function findGrid(src) {
  const gray = new cv.Mat(), bin = new cv.Mat(), thick = new cv.Mat(), k3 = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, bin, new cv.Size(5, 5), 0);
  cv.adaptiveThreshold(bin, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 11, 2);
  cv.dilate(bin, thick, k3);
  const minArea = 0.03 * src.rows * src.cols;   // small enough for live mode to say "come closer"
  const quads = [...gridQuads(bin, minArea), ...gridQuads(thick, minArea)];

  let out = null, quad, bestScore = 0.2;   // below this no candidate looks like a grid
  const wb = new cv.Mat();
  for (const q of quads) {
    const M = perspective(q);
    cv.warpPerspective(bin, wb, M, new cv.Size(N, N));
    const s = lineScore(wb);
    if (s > bestScore) {
      bestScore = s; quad = q;
      out?.delete(); out = new cv.Mat();
      cv.warpPerspective(src, out, M, new cv.Size(N, N));
    }
    M.delete();
  }
  [wb, src, gray, bin, thick, k3].forEach(m => m.delete());
  return out && { warped: out, quad, score: bestScore };
}

function gridQuads(bin, minArea) {
  const cs = new cv.MatVector(), h = new cv.Mat(), quads = [];
  cv.findContours(bin, cs, h, cv.RETR_CCOMP, cv.CHAIN_APPROX_SIMPLE);
  const all = [];
  for (let i = 0; i < cs.size(); i++) {
    const cnt = cs.get(i);
    all.push({ cnt, a: cv.contourArea(cnt), r: cv.boundingRect(cnt) });
  }
  const outer = all.reduce((m, x) => x.a > m.a ? x : m, { a: 0 });
  if (outer.a > minArea) {
    quads.push(corners(outer.cnt.data32S));
    const approx = new cv.Mat();
    cv.approxPolyDP(outer.cnt, approx, 0.02 * cv.arcLength(outer.cnt, true), true);
    if (approx.rows === 4) quads.push(corners(approx.data32S));
    approx.delete();
    const cells = all.filter(x => {
      const { x: rx, y: ry, width: w, height: hh } = x.r;
      return x !== outer && w / hh > 0.7 && w / hh < 1.4 && x.a > 0.7 * w * hh &&
        x.a > outer.a / 400 && x.a < outer.a / 40 &&
        cv.pointPolygonTest(outer.cnt, new cv.Point(rx + w / 2, ry + hh / 2), false) > 0;
    });
    const med = cells.map(x => x.a).sort((a, b) => a - b)[cells.length >> 1];
    const good = cells.filter(x => x.a > 0.6 * med && x.a < 1.6 * med);
    if (good.length >= 20) quads.push(corners(good.flatMap(x => Array.from(x.cnt.data32S))));
  }
  all.forEach(x => x.cnt.delete());
  cs.delete(); h.delete();
  return quads;
}

// Flat [x,y,...] points → [tl, tr, br, bl] corners as a flat array.
function corners(pts) {
  let tl, tr, br, bl;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (!tl || x + y < tl[0] + tl[1]) tl = [x, y];
    if (!br || x + y > br[0] + br[1]) br = [x, y];
    if (!tr || x - y > tr[0] - tr[1]) tr = [x, y];
    if (!bl || y - x > bl[1] - bl[0]) bl = [x, y];
  }
  return [...tl, ...tr, ...br, ...bl];
}

// Corners q → the N×N square (or back, if inverse).
function perspective(q, inverse) {
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, q), to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, N, 0, N, N, 0, N]);
  const M = inverse ? cv.getPerspectiveTransform(to, from) : cv.getPerspectiveTransform(from, to);
  from.delete(); to.delete();
  return M;
}

// Warped binary image → how grid-like it is: coverage of the 20 expected grid lines minus
// coverage of the 18 lines through cell middles (busy backgrounds cover both equally).
function lineScore(wb) {
  const band = new cv.Mat(), cover = pos => {
    let s = 0;
    for (const p0 of pos) {
      const p = Math.min(N - 7, Math.max(0, Math.round(p0) - 3));
      for (const [rect, axis] of [[new cv.Rect(0, p, N, 7), 0], [new cv.Rect(p, 0, 7, N), 1]]) {
        const roi = wb.roi(rect);
        cv.reduce(roi, band, axis, cv.REDUCE_MAX);
        s += cv.countNonZero(band) / N;
        roi.delete();
      }
    }
    return s / (2 * pos.length);
  };
  const s = cover([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => k * S)) - cover([0, 1, 2, 3, 4, 5, 6, 7, 8].map(k => (k + 0.5) * S));
  band.delete();
  return s;
}

// Digit = tallest stroke touching the cell centre (the anchor) + strokes nearly as tall or
// horizontal bars over it (detached top of a 5). Margin drops grid lines; dots and small corner
// notes are skipped. → { v: 28×28 MNIST-style vector, ink: how much darker the strokes are than
// the paper, chroma: ink colourfulness, lum: ink/paper brightness, h: digit height / cell }, or null
// if the cell is empty.
function cellDigit(bin, gray, color, r, c) {
  const m = 4, w = S - 2 * m, lo = 0.3 * w, hi = 0.7 * w, rect = new cv.Rect(c * S + m, r * S + m, w, w);
  const view = bin.roi(rect), cell = view.clone();
  view.delete();   // an undeleted roi keeps the whole parent image alive
  const cs = new cv.MatVector(), h = new cv.Mat(), grp = new cv.Mat(), k3 = cv.Mat.ones(3, 3, cv.CV_8U);
  cv.dilate(cell, grp, k3);   // group on thickened strokes: blurry print breaks into pieces
  cv.findContours(grp, cs, h, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const parts = [];
  for (let i = 0; i < cs.size(); i++) {
    const cnt = cs.get(i), b = cv.boundingRect(cnt);
    cnt.delete();
    if (b.width < 0.15 * S && b.height < 0.15 * S) continue;
    if (b.x > hi || b.x + b.width < lo || b.y > hi || b.y + b.height < lo) continue;
    if (b.width >= w - 2 || b.height >= w - 2) continue;
    parts.push({ i, b });
  }
  const A = parts.reduce((t, p) => p.b.height > (t?.b.height ?? 0) ? p : t, null)?.b;
  let out = null;
  if (A && A.height > 0.3 * S) {
    const mask = cv.Mat.zeros(w, w, cv.CV_8U), digit = new cv.Mat();
    let y0 = w, y1 = 0;
    for (const { i, b } of parts) {
      const cx = b.x + b.width / 2, bar = b.width > b.height && cx > A.x && cx < A.x + A.width && b.y < A.y + A.height / 2;
      if (b.height >= 0.5 * A.height || bar) {
        cv.drawContours(mask, cs, i, new cv.Scalar(255), cv.FILLED);
        y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.height);
      }
    }
    cv.bitwise_and(cell, mask, digit);
    const g = gray.roi(rect), col = color.roi(rect), paper = new cv.Mat();
    cv.bitwise_not(grp, paper);
    const [R, G, B] = cv.mean(col, digit), [pR, pG, pB] = cv.mean(col, paper), lum = (r, g, b) => 0.3 * r + 0.59 * g + 0.11 * b;
    out = { v: toMnist(digit), ink: cv.mean(g, paper)[0] - cv.mean(g, digit)[0],
      chroma: (Math.max(R, G, B) - Math.min(R, G, B)) / 255, lum: lum(R, G, B) / (lum(pR, pG, pB) || 1), h: (y1 - y0) / S };
    // Stroke width (2 · area / outline) per digit height: bold vs regular, as on screens.
    const dc = new cv.MatVector(), dh = new cv.Mat();
    cv.findContours(digit, dc, dh, cv.RETR_LIST, cv.CHAIN_APPROX_NONE);
    let outline = 0;
    for (let j = 0; j < dc.size(); j++) { const cnt = dc.get(j); outline += cv.arcLength(cnt, true); cnt.delete(); }
    out.stroke = 2 * cv.countNonZero(digit) / (outline || 1) / (y1 - y0 || 1);
    [mask, digit, g, col, paper, dc, dh].forEach(x => x.delete());
  }
  [cs, h, grp, k3, cell].forEach(x => x.delete());
  return out;
}

// White-on-black digit → MNIST layout: fit in 20×20, centre of mass at (14,14) in 28×28. Also used by train.js.
function toMnist(bin) {
  const r = cv.boundingRect(bin), k = 20 / Math.max(r.width, r.height);
  const roi = bin.roi(r), small = new cv.Mat(), img = cv.Mat.zeros(28, 28, cv.CV_8U);
  cv.resize(roi, small, new cv.Size(Math.max(1, Math.round(r.width * k)), Math.max(1, Math.round(r.height * k))), 0, 0, cv.INTER_AREA);
  const mo = cv.moments(small);
  const x = Math.min(28 - small.cols, Math.max(0, Math.round(14 - mo.m10 / mo.m00)));
  const y = Math.min(28 - small.rows, Math.max(0, Math.round(14 - mo.m01 / mo.m00)));
  const dst = img.roi(new cv.Rect(x, y, small.cols, small.rows));
  small.copyTo(dst);
  const v = Float32Array.from(img.data, p => p / 255);
  roi.delete(); small.delete(); dst.delete(); img.delete();
  return v;
}

// --- Live camera, full screen: the scanner. Find the grid in every frame; once two readings in a row
// agree, freeze it, straightened. The user checks the reading (tap a cell to fix a digit or mark it
// printed / own), then "Potvrdi" puts it on the home board, where the solving happens. ---
let live = null;   // { stream, digital: draw the board over the paper, last: previous reading, lost: frames without grid, frozen }
// frozen = { still: straightened upright grid picture, rot, digits, conf, probs, printed, sel: tapped cell,
//   board: { solution } | null, givens, entry (see resolve), why }
const frame = document.createElement('canvas');
// Status over the camera: a short headline and, if needed, one line of detail.
const tip = (t, sub = '') => { $('tipMain').textContent = t; $('tipSub').textContent = sub; };

// The back camera, preferably the one with the torch: facingMode alone may pick a camera without one
// (an Android 10 phone opened "camera2 2", wide angle; the torch sits on "camera2 0", the main one).
// Probing takes a moment, so the pick is remembered: its deviceId, or '' when no back camera has a torch.
async function backCamera() {
  const open = id => navigator.mediaDevices.getUserMedia({ video: { ...(id ? { deviceId: { exact: id } } : { facingMode: 'environment' }), width: { ideal: 1280 } } });
  const torch = s => !!s.getVideoTracks()[0].getCapabilities?.().torch;
  const hasTorch = async s => torch(s) || (await new Promise(r => setTimeout(r, 500)), torch(s));   // some phones list it a moment late
  const keep = id => { try { localStorage.sudokuCamera = id; } catch {} };
  let known; try { known = localStorage.sudokuCamera; } catch {}
  if (known) try { return await open(known); } catch {}   // that camera is gone: probe again
  let stream = await open();
  if (known === '' || await hasTorch(stream)) return stream;
  const first = stream.getVideoTracks()[0].getSettings().deviceId;
  const others = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput' && d.deviceId !== first && /back|rear/i.test(d.label));
  for (const d of others) {
    stream?.getTracks().forEach(t => t.stop());   // phones run one camera at a time
    stream = await open(d.deviceId).catch(() => null);
    if (stream && await hasTorch(stream)) { keep(d.deviceId); return stream; }
  }
  keep('');
  if (!others.length) return stream;
  stream?.getTracks().forEach(t => t.stop());
  return open(first);
}

$('liveBtn').onclick = async () => {
  arm(0);
  $('liveBar').before($('pad'));   // the camera's pad: digits, ⌫ and printed / own, shown for a tapped cell
  $('pad').append($('padKind'));
  $('pad').hidden = true;
  $('padKind').disabled = false;
  $('live').hidden = false;
  document.body.style.overflow = 'hidden';
  $('live').requestFullscreen?.().catch(() => {});   // Android; iPhone keeps the fixed full-page layer
  tip('Pokrećem kameru…');
  let stream;
  try { stream = await backCamera(); }
  catch { closeLive(); return say('Kamera nije dostupna (treba dozvola i https). Možeš učitati sliku iz galerije.', Infinity); }
  $('video').srcObject = stream;
  await $('video').play();
  live = { stream, digital: true, last: null, lost: 0, frozen: null,
    canTorch: !!stream.getVideoTracks()[0].getCapabilities?.().torch, torch: false };   // torch: Android Chrome, not iPhone
  $('liveView').textContent = 'Papir';
  liveButtons();
  setTimeout(() => {   // some Android phones list the torch only once the camera has settled
    if (live?.stream !== stream || live.canTorch) return;
    live.canTorch = !!stream.getVideoTracks()[0].getCapabilities?.().torch;
    liveButtons();
  }, 1000);
  while (live) {
    const t = performance.now();
    if (!live.frozen) liveFrame();
    await new Promise(r => setTimeout(r, Math.max(30, 150 - (performance.now() - t))));   // ≤ ~7 fps, leaves the phone some air
  }
};

function closeLive() {
  live?.stream.getTracks().forEach(t => t.stop());
  live = null;
  $('live').hidden = true;
  $('tools').after($('pad'));   // back in the game, always shown there
  $('tools').append($('padKind'));
  $('pad').hidden = false;
  $('padKind').hidden = !!task;
  pick(null);
  setLift(0);
  $('video').style.visibility = '';
  document.body.style.overflow = '';
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
$('liveClose').onclick = closeLive;

$('liveView').onclick = () => {
  if (!live) return;
  live.digital = !live.digital;
  $('liveView').textContent = live.digital ? 'Papir' : 'Digitalno';
  if (live.frozen) showFrozen();
};
$('liveRescan').onclick = () => {
  if (!live) return;
  live.frozen = live.last = null;
  setLift(0);
  $('video').style.visibility = '';
  $('pad').hidden = true;
  liveButtons();
  $('video').play();
};

// "Potvrdi": the reading as checked here becomes the task on the home board: printed digits as givens,
// the user's own digits judged, earlier progress of the same puzzle (history) filled in.
$('liveConfirm').onclick = () => {
  const f = live?.frozen;
  if (!f?.board) return;
  if (toDaily(f.board.solution)) return closeLive();
  task = { givens: f.givens, solution: f.board.solution };
  try { localStorage.sudokuTask = JSON.stringify(task); } catch {}
  learn(f.digits.map((d, i) => [i, d]).filter(([i, d]) => d && (f.givens[i] || f.entry[i] === 'ok')));
  const e = remember(task.solution, task.givens, f.digits.map((d, i) => f.entry[i] === 'ok' ? d : 0));
  clearHint();
  lastProbs = null;
  notes = notes.map(() => []);
  undo = [];
  inputs.forEach((x, i) => {
    x.className = '';
    x.value = f.entry[i] ? f.digits[i] : +e.done[i] || '';
    if (f.entry[i]) x.classList.add(f.entry[i]); else if (+e.done[i]) x.classList.add('ok');
  });
  closeLive();
  showTask();
  markConflicts();
  go('game');
  if (f.entry.some(Boolean)) sayEntries();
};

function liveButtons() {
  $('liveBar').hidden = !live?.frozen;
  $('liveTorch').hidden = !live?.canTorch || !!live.frozen;
}

// Flashlight while scanning; switched off as soon as the reading freezes.
function setTorch(on) {
  live.torch = on;
  $('liveTorch').ariaPressed = String(on);
  live.stream.getVideoTracks()[0].applyConstraints({ advanced: [{ torch: on }] }).catch(() => {});
}
$('liveTorch').onclick = () => live && setTorch(!live.torch);

function liveFrame() {
  const v = $('video'), o = $('overlay');
  if (!v.videoWidth) return;
  o.width = v.videoWidth; o.height = v.videoHeight;   // also clears the overlay
  const k = Math.min(1, 1000 / Math.max(v.videoWidth, v.videoHeight));   // same scale as photos: thin lines vanish below ~800 px
  frame.width = v.videoWidth * k | 0; frame.height = v.videoHeight * k | 0;
  frame.getContext('2d', { willReadFrequently: true }).drawImage(v, 0, 0, frame.width, frame.height);
  const grid = findGrid(cv.imread(frame));
  if (!grid) {
    if (++live.lost > 10) live.last = null;   // ~1.5 s away: maybe a different sudoku next
    return tip(live.lost > 3 ? frameAdvice() : 'Tražim sudoku…');
  }
  live.lost = 0;
  const ctx = o.getContext('2d'), advice = gridAdvice(grid.quad);
  if (advice) {
    grid.warped.delete();
    live.last = null;
    painter(ctx, grid.quad, k, 0).outline(AMBER);
    return tip(advice);
  }
  const r = readTurns(grid.warped), digits = r.probs.map(best), conf = r.probs.map(p => p ? Math.max(...p) : 0);
  const same = live.last?.join() === digits.join();
  live.last = digits;
  if (!same) {
    const pen = painter(ctx, grid.quad, k, r.rot);
    pen.outline(AMBER);
    render(pen, digits, conf);
    return tip('Čitam… drži mirno', `${digits.filter(Boolean).length} brojeva`);
  }
  // Stable reading: freeze. From now on the overlay is the grid itself, cut out of this frame,
  // straightened and turned upright (still), at 2× the reading size for sharp digits.
  v.pause();
  v.style.visibility = 'hidden';
  if (live.torch) setTorch(false);
  const still = document.createElement('canvas'), src = cv.imread(frame), M = perspective(grid.quad);
  let flat = new cv.Mat();
  cv.warpPerspective(src, flat, M, new cv.Size(N, N));
  for (let i = 0; i < r.rot; i++) { const t = new cv.Mat(); cv.rotate(flat, t, cv.ROTATE_90_CLOCKWISE); flat.delete(); flat = t; }
  cv.imshow(still, flat);
  [src, M, flat].forEach(m => m.delete());
  o.width = o.height = 2 * N;
  live.frozen = { still, rot: r.rot, digits, conf, probs: r.probs, printed: r.printed, sel: null };
  liveButtons();
  resolve();
  showFrozen();
}

// Frozen: move and zoom the square grid so it fills the screen width right under the tip, above the
// buttons. Layout sizes, not getBoundingClientRect: that would include a move still running. Taps
// still land right: cellAt measures the moved overlay.
function liftGrid() {
  const o = $('overlay'), W = o.clientWidth, H = o.clientHeight;   // #live fills the screen from its top
  const w = Math.min(W, H), x0 = (W - w) / 2, y0 = (H - w) / 2;   // the square canvas, contained
  const top = $('liveTip').getBoundingClientRect().bottom + 12, room = $('liveBottom').getBoundingClientRect().top - 12 - top;
  const size = Math.min(W - 32, room), z = size / w;   // right under the status, as large as the room allows
  setLift(`translate(${(W - size) / 2 - z * x0}px, ${top - z * y0}px) scale(${z})`);
}
const setLift = t => $('overlay').style.transform = t || '';

// Solve the frozen reading. Handwritten digits are checked against the printed ones' solution
// (f.entry: 'ok' | 'wrong' | 'maybe'). Printed ones alone not a sudoku → the split was off, all
// digits are the task.
function resolve() {
  const f = live.frozen, n = f.digits.filter(Boolean).length;
  const mine = f.digits.map((d, i) => !!d && f.printed[i] === false), givens = f.digits.map((d, i) => mine[i] ? 0 : d);
  let sols = mine.some(Boolean) ? solve(givens) : [];
  f.entry = Array(81).fill(null);
  f.givens = sols.length === 1 ? givens : f.digits.slice();   // the task: printed digits, or all if they don't make one
  if (sols.length === 1) mine.forEach((m, i) => {
    if (!m) return;
    const sol = sols[0][i];
    f.entry[i] = f.conf[i] === 1 ? (f.digits[i] === sol ? 'ok' : 'wrong') : judge(f.probs[i], sol);   // conf 1: set by the user
    if (f.entry[i] === 'ok') f.digits[i] = sol;
  });
  else sols = n >= 17 ? solve(f.digits) : [];   // fewer than 17 givens is never a proper sudoku
  f.board = sols.length === 1 ? { solution: sols[0] } : null;
  f.why = n < 17 ? `Vidim samo ${n} brojeva, premalo za sudoku.` : sols.length ? 'Ima više rješenja: možda neki broj nije pročitan.' : 'Nema rješenja.';
}

// The frozen view: the straightened picture with the reading over it, to be checked before "Potvrdi";
// then fitted under the status (whose height the text just set).
function showFrozen() {
  drawFrozen();
  liftGrid();
}
function drawFrozen() {
  const f = live.frozen, o = $('overlay'), ctx = o.getContext('2d'), b = f.board;
  ctx.drawImage(f.still, 0, 0, o.width, o.height);
  const pen = painter(ctx), sel = f.sel === null ? [] : [[f.sel, 'rgba(59, 130, 246, 0.5)']];
  const full = f.digits.every(Boolean);   // a solved paper: no duplicates = right, whatever is printed or not
  $('liveConfirm').disabled = !b;
  if (!b) {
    // Unsolvable: duplicates are the usual culprit (misread, or a wrong entry on paper);
    // of each clashing pair the less certain reading is marked.
    const dup = f.digits.map((d, i) => d && PEERS[i].some(j => f.digits[j] === d && f.conf[j] >= f.conf[i]));
    pen.outline(RED);
    render(pen, f.digits, f.conf, [...dup.map((x, i) => x && [i, 'rgba(239, 68, 68, 0.5)']).filter(Boolean), ...sel]);
    return tip(dup.some(Boolean) ? 'Isti broj dvaput (crveno)' : f.why, full ? 'Krivo pročitano? Dodirni polje i ispravi. Ako je dobro pročitano, greška je na papiru.'
      : 'Dodirni polje i ispravi broj, ili skeniraj ponovo.');
  }
  pen.outline(GREEN);
  const count = e => f.entry.filter(x => x === e).length;
  render(pen, f.digits, f.conf, [...f.entry.flatMap((e, i) => e === 'wrong' ? [[i, 'rgba(239, 68, 68, 0.5)']] : e === 'maybe' ? [[i, 'rgba(255, 224, 138, 0.6)']] : []), ...sel],
    f.entry.map(e => e && ENTRY_INK[e]));   // own entries: blue right, red wrong, brown unsure
  if (full) return tip('Točno riješeno ✓', 'Je li sve dobro pročitano? Dodirni broj da ga ispraviš. Zatim Potvrdi.');
  if (f.entry.some(Boolean)) return tip(`Tvoji brojevi: ${count('ok')} točno · ${count('wrong')} krivo · ${count('maybe')} nesigurno`,
    'Je li sve dobro pročitano? Dodirni broj da ga ispraviš ili označiš tiskani / tvoj. Zatim Potvrdi.');
  tip('Je li sve dobro pročitano?', 'Sivo = tiskano, žuto = nesigurno. Dodirni broj da ga ispraviš ili označiš kao svoj. Zatim Potvrdi.');
}

// Tap on the frozen picture → select that cell and show the number pad.
$('overlay').onclick = e => {
  const f = live?.frozen;
  if (!f) return;
  const i = cellAt(e.clientX, e.clientY);
  f.sel = i === f.sel ? null : i;
  $('pad').hidden = f.sel === null;
  $('padKind').hidden = f.sel === null || !f.digits[f.sel];
  if (f.sel !== null) $('padKind').lastChild.textContent = f.printed[f.sel] === false ? 'Ovo je tiskani broj' : 'Ovo je moj broj (rukom)';
  showFrozen();
};

// Screen point → cell of the frozen (straightened) grid, or null. Undoes object-fit: contain, the move
// and zoom (both in the bounding rect).
function cellAt(cx, cy) {
  const o = $('overlay'), r = o.getBoundingClientRect(), s = Math.min(r.width / o.width, r.height / o.height);
  const x = (cx - r.left - (r.width - o.width * s) / 2) / s * N / o.width, y = (cy - r.top - (r.height - o.height * s) / 2) / s * N / o.height;
  return x >= 0 && y >= 0 && x < N && y < N ? (y / S | 0) * 9 + (x / S | 0) : null;
}

// Number pad: set the selected cell (0 = empty), remember the correction, solve again.
function fixCell(d) {
  const f = live?.frozen;
  if (!f || f.sel === null) return;
  if (d && lastVecs[f.sel].length) learn([[f.sel, d]]);   // the user says what is written there
  f.digits[f.sel] = d;
  f.conf[f.sel] = 1;
  f.sel = null;
  $('pad').hidden = true;
  resolve();
  showFrozen();
}

// The board as the app reads it, drawn over the paper: white board + grid, read digits in dark (cell
// yellow if unsure) and marked cells. ink: per cell colour for read digits (own entries). Printed
// digits sit on a grey square (all of them while still reading).
// With live.digital off the paper stays visible and only the marks are drawn.
function render(pen, digits, conf, marks = [], ink = []) {
  if (live.digital) {
    pen.board();
    digits.forEach((d, i) => d && live.frozen?.printed[i] !== false && pen.cell(i, 'rgba(120, 120, 120, 0.4)'));   // printed: grey square
    digits.forEach((d, i) => d && conf[i] < 0.8 && !marks.some(([j]) => j === i) && pen.cell(i, 'rgba(255, 224, 138, 0.6)'));
  }
  marks.forEach(([i, color]) => pen.cell(i, color));
  if (live.digital) digits.forEach((d, i) => d && pen.digit(i, d, ink[i] || '#111827'));
}

const AMBER = '#f59e0b', GREEN = '#22c55e', RED = '#ef4444';
const ENTRY_INK = { ok: '#1d4ed8', wrong: '#dc2626', maybe: '#92400e' };

// No grid in view: say why, if the picture shows it. Only extremes get a specific tip: the darkest
// (brightness ~90) and blurriest (Laplacian variance ~5) photos in the test set still read fine.
function frameAdvice() {
  const src = cv.imread(frame), g = new cv.Mat(), lap = new cv.Mat(), m = new cv.Mat(), sd = new cv.Mat();
  cv.cvtColor(src, g, cv.COLOR_RGBA2GRAY);
  cv.Laplacian(g, lap, cv.CV_64F);
  cv.meanStdDev(lap, m, sd);
  const light = cv.mean(g)[0], sharp = sd.data64F[0] ** 2;
  [src, g, lap, m, sd].forEach(x => x.delete());
  if (light < 50) return 'Premalo svjetla. Upali svjetlo.';
  if (sharp < 4) return 'Slika je mutna. Drži mirno i malo odmakni mobitel.';
  return 'Ne vidim sudoku. Približi se tako da mreža ispuni veći dio ekrana.';
}

// Grid found but framed badly (corners as [x,y,...] in frame px) → tip, or null if fine.
function gridAdvice(q) {
  const W = frame.width, H = frame.height, edge = 0.01 * Math.max(W, H);
  let area = 0;
  for (let i = 0; i < 8; i += 2) area += q[i] * q[(i + 3) % 8] - q[(i + 2) % 8] * q[i + 1];
  if (Math.abs(area) / 2 < 0.12 * W * H) return 'Približi se, sudoku je premalen.';
  if (q.some((x, i) => x < edge || x > (i % 2 ? H : W) - edge)) return 'Odmakni se malo, cijeli sudoku mora biti u kadru.';
  return null;
}

// Drawing into the video: grid coordinates → undo the turn → inverse perspective → frame px → video px (÷k).
// No quad: the canvas is the straightened, upright grid itself (frozen view), so just scale.
function painter(ctx, quad, k, rot) {
  let P = (x, y) => [x * ctx.canvas.width / N, y * ctx.canvas.height / N];
  if (quad) {
    const Mi = perspective(quad, true), h = Array.from(Mi.data64F);
    Mi.delete();
    P = (x, y) => {
      for (let i = 0; i < rot; i++) [x, y] = [y, N - x];   // undo one clockwise turn
      const w = h[6] * x + h[7] * y + h[8];
      return [(h[0] * x + h[1] * y + h[2]) / w / k, (h[3] * x + h[4] * y + h[5]) / w / k];
    };
  }
  return {
    P,
    board() {
      ctx.beginPath();
      [[0, 0], [N, 0], [N, N], [0, N]].forEach(([x, y]) => ctx.lineTo(...P(x, y)));
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';   // see-through: the paper stays faintly visible
      ctx.fill();
      for (let j = 0; j <= 9; j++) {
        ctx.beginPath();
        ctx.moveTo(...P(j * S, 0)); ctx.lineTo(...P(j * S, N));
        ctx.moveTo(...P(0, j * S)); ctx.lineTo(...P(N, j * S));
        ctx.lineWidth = Math.max(1, ctx.canvas.width / (j % 3 ? 600 : 250)); ctx.strokeStyle = '#374151';
        ctx.stroke();
      }
    },
    outline(color) {
      ctx.beginPath();
      [[0, 0], [N, 0], [N, N], [0, N]].forEach(([x, y]) => ctx.lineTo(...P(x, y)));
      ctx.closePath();
      ctx.lineWidth = Math.max(3, ctx.canvas.width / 150); ctx.strokeStyle = color;
      ctx.stroke();
    },
    cell(i, color) {
      const x = i % 9 * S, y = (i / 9 | 0) * S;
      ctx.beginPath();
      [[x, y], [x + S, y], [x + S, y + S], [x, y + S]].forEach(([px, py]) => ctx.lineTo(...P(px, py)));
      ctx.fillStyle = color;
      ctx.fill();
    },
    digit(i, d, color) {
      const cx = (i % 9 + 0.5) * S, cy = (i / 9 | 0) * S, top = P(cx, cy), bottom = P(cx, cy + S);
      const size = Math.hypot(bottom[0] - top[0], bottom[1] - top[1]) * 0.7, [x, y] = P(cx, cy + S / 2);
      ctx.font = `bold ${size}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = size / 8; ctx.strokeStyle = '#fff'; ctx.strokeText(d, x, y);
      ctx.fillStyle = color; ctx.fillText(d, x, y);
    },
  };
}
