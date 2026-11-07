// --- Nit: one thread through every cell of a 6×6 board, from knot 1 to the last, through the knots in order,
// never through a wall. One a day, the same for everyone (made from the date, like Dinango's).
// A board: { path: the 36 cells of the solution in order, knots: cells of 1, 2, 3…, walls: [a, b] cell pairs }. ---
const N_SIZE = 6, N_CELLS = 36;
const nNear = k => [k - 6, k % 6 < 5 ? k + 1 : -1, k + 6, k % 6 ? k - 1 : -1].filter(j => j >= 0 && j < N_CELLS);

// The solutions (up to max): a walk from the first knot over every cell, each knot met in its turn, the last at the end.
// Pruned on every step: a cell left with no way in, or with one way in that is not the end, can't be finished.
function nSolve(knots, walls, max = 2) {
  const num = new Int8Array(N_CELLS), shut = new Set(walls.flatMap(([a, b]) => [a * N_CELLS + b, b * N_CELLS + a]));
  knots.forEach((k, i) => num[k] = i + 1);
  const near = [...Array(N_CELLS)].map((_, k) => nNear(k).filter(j => !shut.has(k * N_CELLS + j)));
  const end = knots.at(-1), on = new Uint8Array(N_CELLS), path = [knots[0]], out = [];
  on[knots[0]] = 1;
  const dead = head => {
    for (let u = 0; u < N_CELLS; u++) {
      if (on[u]) continue;
      let ways = 0;
      for (const w of near[u]) if (!on[w] || w === head) ways++;
      if (!ways || (ways === 1 && u !== end)) return true;
    }
    return false;
  };
  (function step(head, next) {
    if (out.length >= max) return;
    if (path.length === N_CELLS) { if (next > knots.length) out.push(path.slice()); return; }
    for (const v of near[head]) {
      if (on[v] || (num[v] && num[v] !== next) || (v === end && path.length < N_CELLS - 1)) continue;
      on[v] = 1; path.push(v);
      if (!dead(v)) step(v, num[v] ? next + 1 : next);
      on[v] = 0; path.pop();
    }
  })(knots[0], 2);
  return out;
}

// A random path over every cell: a snake, then many "backbites" (an end steps onto a neighbour on the path,
// the piece between turns round), which keep it one path and mix it well.
function nPath(r) {
  let p = [...Array(N_SIZE)].flatMap((_, y) => [...Array(N_SIZE)].map((_, x) => y * N_SIZE + (y % 2 ? N_SIZE - 1 - x : x)));
  for (let t = 0; t < 40 * N_CELLS; t++) {
    if (r() < .5) p.reverse();   // bite with either end
    const ns = nNear(p[0]), j = p.indexOf(ns[r() * ns.length | 0]);
    if (j > 1) p = [...p.slice(0, j).reverse(), ...p.slice(j)];
  }
  return p;
}

// A board from a seed: a random path, 2-4 walls beside it, and knots taken away (from every cell down to 7-9)
// while the thread still has one way only. ~0.1 s on a computer.
// ponytail: one solution, but not graded and not checked as solvable without guessing; add a step solver if days feel unfair.
function nMake(seed) {
  const r = rng(hash(seed));
  for (;;) {
    const path = nPath(r), at = new Int8Array(N_CELLS);
    path.forEach((k, i) => at[k] = i);
    const walls = shuffle([...Array(N_CELLS).keys()].flatMap(k => [k + 1, k + 6].filter(j => nNear(k).includes(j)).map(j => [k, j]))
      .filter(([a, b]) => Math.abs(at[a] - at[b]) !== 1), r).slice(0, 2 + (r() * 3 | 0));
    let keep = path.map((_, i) => i);   // knots as places on the path
    const goal = 7 + (r() * 3 | 0);
    for (const i of shuffle(keep.slice(1, -1), r)) {
      if (keep.length <= goal) break;
      const fewer = keep.filter(x => x !== i);
      if (nSolve(fewer.map(x => path[x]), walls).length === 1) keep = fewer;
    }
    if (keep.length <= 12) return { path, knots: keep.map(x => path[x]), walls };
  }
}

// --- On screen: the board as one SVG (cells 60 wide, a 10 margin), the thread a path per colour. ---
// A game: { ...board, line: the cells drawn so far from knot 1, elapsed, solvedAt, date (the daily's) }.
const N_PX = 60, nXY = k => [k % N_SIZE * N_PX + N_PX / 2, (k / N_SIZE | 0) * N_PX + N_PX / 2];
const nCol = i => `var(--n${i % 7 + 1})`;   // thread i (1→2 is 0); more than 7 threads start the colours again
function nSvg(b, line, mini, ring) {
  const knot = new Map(b.knots.map((k, i) => [k, i])), segs = [[line[0]]];
  for (const k of line.slice(1)) { segs.at(-1).push(k); if (knot.has(k)) segs.push([k]); }
  const tint = new Map();
  segs.forEach((s, i) => s.forEach((k, j) => { if (j || !i) tint.set(k, i); }));   // a knot keeps the thread that reached it
  let out = '<rect class="nbg" x="-10" y="-10" width="380" height="380" rx="20"/>';
  for (let k = 0; k < N_CELLS; k++) {
    const [x, y] = nXY(k), on = line.includes(k);
    out += `<rect class="nc${on ? ' on' : ''}" x="${x - 28}" y="${y - 28}" width="56" height="56" rx="6"${on ? ` style="--c:${nCol(tint.get(k))}"` : ''}/>`;
  }
  for (const [a, z] of b.walls) {
    const [x, y] = nXY(Math.max(a, z));
    out += z - a === 1 ? `<rect class="nw" x="${x - 33}" y="${y - 24}" width="6" height="48" rx="3"/>` : `<rect class="nw" x="${x - 24}" y="${y - 33}" width="48" height="6" rx="3"/>`;
  }
  segs.forEach((s, i) => { if (s.length > 1) out += `<path d="M${s.map(k => nXY(k).join(' ')).join('L')}" fill="none" style="stroke:${nCol(i)}" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>`; });
  const head = line.at(-1);
  if (line.length > 1 && !knot.has(head)) { const [x, y] = nXY(head); out += `<circle cx="${x}" cy="${y}" r="13" style="fill:${nCol(segs.length - 1)}"/>`; }
  if (ring) { const [x, y] = nXY(ring.k); out += `<circle class="nring" cx="${x}" cy="${y}" r="25" style="stroke:${ring.c}"/>`; }
  b.knots.forEach((k, i) => {
    const [x, y] = nXY(k);
    out += `<g class="nk" style="--d:${i}"><circle cx="${x}" cy="${y}" r="18" style="stroke:${nCol(Math.min(i, b.knots.length - 2))}"/>${mini ? '' : `<text x="${x}" y="${y + 1}" text-anchor="middle" dominant-baseline="central">${i + 1}</text>`}</g>`;
  });
  return out;
}
// The tile and its copies (the rail): a solved board, no numbers.
{ const b = nMake('nit-tile'); document.querySelectorAll('#tileNit > svg, [data-tile="tileNit"] > svg:first-child').forEach(s => { s.setAttribute('viewBox', '-10 -10 380 380'); s.innerHTML = nSvg(b, b.path, true); }); }

let ng = null, nUndo = [], nWon = false, nTip = null;   // the game on screen, its earlier lines, solved just now (the knots pop once), the open Savjet ({ k, line, c, title, text, act })
const nSave = () => { try { localStorage[ng.date ? 'nitDaily' : 'nitGame'] = JSON.stringify(ng); } catch {} };
const nitDone = () => tLoad('nitDone') || {};   // date → ms of each solved daily
const nNew = b => ({ ...b, line: [b.knots[0]], elapsed: 0, solvedAt: null });
const nOpen = which => { try { localStorage.nitOn = which; } catch {} nUndo = []; nWon = false; nTip = null; go('nit'); };
// The Igre tile: today's daily, made on the day's first open.
function openNit() {
  ng = tLoad('nitDaily');
  if (ng?.date !== dayKey()) { ng = { ...nNew(nMake('nit#' + dayKey())), date: dayKey() }; nSave(); }
  nOpen('daily');
}
// Nova igra: a random board; one started earlier goes on.
function nitGame() {
  ng = tLoad('nitGame');
  if (!ng || ng.solvedAt) { ng = nNew(nMake('n' + Math.random())); nSave(); }
  nOpen('game');
}
$('tileNit').onclick = openNit;
$('nitBack').onclick = () => go('games');
$('nitNew').onclick = nitGame;

function drawNit() {
  $('nb').innerHTML = nSvg(ng, ng.line, false, nTip);
  $('nb').classList.toggle('won', nWon);
  $('nitName').textContent = ng.date ? 'Nit · dnevni' : 'Nit · Nova igra';
  $('nitSide').textContent = ng.date ? new Date(ng.date + 'T12:00').toLocaleDateString('hr', { day: 'numeric', month: 'numeric' }) : '';
  $('nitTimer').textContent = clock(ng.elapsed);
  $('ntools').hidden = !!ng.solvedAt;
  $('nUndoBtn').disabled = !nUndo.length;
  $('nHintBtn').hidden = !!ng.date;   // the daily is solo, as Dinango's
  $('nTip').hidden = !nTip;
  if (nTip) { $('nTip').firstChild.textContent = nTip.title; $('nTip').children[1].textContent = nTip.text; $('nTipDo').textContent = nTip.act; }
  $('nitNew').hidden = !ng.solvedAt;
}

// The thread to cell k: back to it if it is on the thread already; else one step on from the end, if a
// neighbour without a wall between, not a knot out of turn, and the thread doesn't end on the last knot yet.
function nTo(k) {
  const line = ng.line, at = line.indexOf(k), head = line.at(-1);
  if (k < 0 || ng.solvedAt) return false;
  if (at >= 0) { if (at === line.length - 1) return false; line.length = at + 1; return true; }
  const wall = ng.walls.some(([a, z]) => (a === head && z === k) || (a === k && z === head));
  const turn = line.filter(c => ng.knots.includes(c)).length, num = ng.knots.indexOf(k);
  if (!nNear(head).includes(k) || wall || head === ng.knots.at(-1) || (num >= 0 && num !== turn)) return false;
  line.push(k);
  return true;
}
// A finger moves faster than the cells: walk to it one cell at a time, the longer way first.
function nToward(k) {
  for (let n = 0; n < 12 && k >= 0; n++) {
    const h = ng.line.at(-1);
    if (h === k) return;
    if (ng.line.includes(k)) return void nTo(k);
    const dr = (k / N_SIZE | 0) - (h / N_SIZE | 0), dc = k % N_SIZE - h % N_SIZE;
    const rows = dr ? h + Math.sign(dr) * N_SIZE : -1, cols = dc ? h + Math.sign(dc) : -1;
    const [first, then] = Math.abs(dr) >= Math.abs(dc) ? [rows, cols] : [cols, rows];
    if (!nTo(first) && !nTo(then)) return;
  }
}
const nAt = e => {
  const r = $('nb').getBoundingClientRect(), u = r.width / 380, x = (e.clientX - r.left) / u - 10, y = (e.clientY - r.top) / u - 10;
  return x < 0 || y < 0 || x >= 360 || y >= 360 ? -1 : (y / N_PX | 0) * N_SIZE + (x / N_PX | 0);
};
let nDrag = null;   // the line before this drag (for Poništi)
$('nb').onpointerdown = e => {
  if (ng.solvedAt || nDrag) return;   // a second finger is ignored
  nDrag = ng.line.slice();
  $('nb').setPointerCapture(e.pointerId);
  nToward(nAt(e));
  drawNit();
};
$('nb').onpointermove = e => {
  if (!nDrag) return;
  const was = ng.line.join();
  nToward(nAt(e));
  if (ng.line.join() !== was) drawNit();
};
$('nb').onpointerup = $('nb').onpointercancel = () => {
  if (!nDrag) return;
  if (nDrag.join() !== ng.line.join()) nUndo.push(nDrag);
  nDrag = null;
  nChanged();
};
// The keyboard: arrows lead the thread, Backspace takes a step back.
$('nb').tabIndex = 0;
$('nb').onkeydown = e => {
  const step = { ArrowUp: -N_SIZE, ArrowDown: N_SIZE, ArrowLeft: -1, ArrowRight: 1 }[e.key], h = ng.line.at(-1), before = ng.line.slice();
  if (step === undefined && e.key !== 'Backspace') return;
  e.preventDefault();
  if (e.key === 'Backspace') { if (ng.line.length > 1) nTo(ng.line.at(-2)); }
  else if ((step !== -1 || h % N_SIZE) && (step !== 1 || h % N_SIZE < N_SIZE - 1)) nTo(h + step);
  if (before.join() !== ng.line.join()) { nUndo.push(before); nChanged(); }
};
function nChanged() {
  nTip = null;
  nSave();
  if (!ng.solvedAt && ng.line.length === N_CELLS && ng.line.at(-1) === ng.knots.at(-1)) nitSolved();
  drawNit();
}
// How many cells the thread could step to now (tried with nTo, then taken back).
const nMoves = () => nNear(ng.line.at(-1)).filter(j => !ng.line.includes(j) && nTo(j) && ng.line.pop() >= 0).length;
// Savjet: the thread off the one solution first (back to its last right cell), else the next cell.
$('nHintBtn').onclick = () => {
  const off = ng.line.findIndex((k, i) => k !== ng.path[i]), at = ng.line.length;
  nTip = off >= 0 ? { k: ng.path[off - 1], line: ng.line.slice(0, off), c: 'var(--negative)', title: 'Nit je skrenula', text: 'Odavde ne ide do kraja. Vrati se ovamo, pa traži dalje.', act: 'Vrati' }
    : at < N_CELLS && { k: ng.path[at], line: ng.path.slice(0, at + 1), c: nCol(ng.knots.filter(k => ng.line.includes(k)).length - 1), title: 'Sljedeći korak',
      text: nMoves() === 1 ? 'Odavde nit može samo ovamo.' : 'Samo ovuda nit prolazi kroz sva polja do kraja.', act: 'Stavi' };
  drawNit();
};
$('nTipDo').onclick = () => { nUndo.push(ng.line.slice()); ng.line = nTip.line; nChanged(); };
$('nTip').querySelector('.quiet').onclick = () => { nTip = null; drawNit(); };
$('nUndoBtn').onclick = () => { if (nUndo.length) { ng.line = nUndo.pop(); nChanged(); } };
$('nClearBtn').onclick = () => { if (ng.line.length > 1) { nUndo.push(ng.line.slice()); ng.line = [ng.knots[0]]; nChanged(); } };

// Solved: the knots pop in order, then the shared card (card = 'nit'): the daily's time, days in a row and the
// board (level 4); a game's time.
function nitSolved() {
  ng.solvedAt = Date.now();
  nWon = true;
  nSave();
  card = 'nit';
  $('solved').className = 'nit';
  $('solvedMenu').textContent = 'Igre';
  $('diffSolved').hidden = $('solvedTechs').hidden = $('lboard').hidden = true;
  if (ng.date) {
    const done = nitDone();
    done[ng.date] = ng.elapsed;
    try { localStorage.nitDone = JSON.stringify(done); } catch {}
    $('solvedText').textContent = `Riješeno za ${clock(ng.elapsed)} · ${daysWord(streak(Object.keys(done)))} zaredom`;
    lbNow = { day: ng.date, level: 4, ms: ng.elapsed };
    if (lbName()) lbQueue(lbNow.day, 4, lbNow.ms);
    lbShow(lbNow.day, 4, lbNow.ms);
  } else $('solvedText').textContent = `Vrijeme: ${clock(ng.elapsed)}`;
  nitButtons();
  setTimeout(() => view === 'nit' && $('solved').showModal(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900);
}
// The daily: Igre and Podijeli (the place added once the board answers); a game: Igre and the next one.
function nitButtons() {
  $('solvedClose').hidden = $('solvedLevel').hidden = true;
  $('solvedNext').hidden = !!ng.date;
  $('solvedShare').hidden = !ng.date;
  $('solvedShare').classList.remove('quiet');
  $('solvedShare').lastChild.textContent = 'Podijeli';
  if (ng.date) dailyShare('Nit', ng.date, 4, ng.elapsed);
}
