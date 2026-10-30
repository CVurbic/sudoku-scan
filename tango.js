// --- Tango: a 6×6 board of squares (0) and circles (1). Each row and column holds three of each, never three
// alike in a row; = joins two cells that are alike, × two that differ. One a day, the same for everyone
// (made from the date, like the sudoku's), solo: only broken rules show. After it, Nova igra, with Savjet.
// A board: { giv, sol, signs: [a, b, same], values: 36 × (-1 empty, 0, 1), elapsed, solvedAt, date (the daily's) }. ---
const T_LINES = [...Array(6)].flatMap((_, i) => [[...Array(6)].map((_, j) => i * 6 + j), [...Array(6)].map((_, j) => j * 6 + i)]);   // rows and columns
const T_ROWS = [...Array(64).keys()].map(m => [0, 1, 2, 3, 4, 5].map(i => m >> i & 1))
  .filter(r => r.filter(Boolean).length === 3 && !r.some((x, i) => i > 1 && x === r[i - 1] && x === r[i - 2]));   // the 14 lines that keep the rules
// The solutions of a board (up to max), row by row from the 14 lines.
function tSolve(g, signs, max = 2) {
  const out = [], b = [];
  (function row(r) {
    if (out.length >= max) return;
    if (r === 6) return out.push(b.slice());
    for (const line of T_ROWS) {
      if (line.some((x, c) => g[r * 6 + c] >= 0 && g[r * 6 + c] !== x)) continue;
      b.splice(r * 6, 6, ...line);
      if (signs.every(([a, z, same]) => z >= (r + 1) * 6 || (b[a] === b[z]) === same) && [0, 1, 2, 3, 4, 5].every(c => {
        const col = [...Array(r + 1)].map((_, i) => b[i * 6 + c]), ones = col.filter(Boolean).length;
        return ones <= 3 && col.length - ones <= 3 && !(r > 1 && col[r] === col[r - 1] && col[r] === col[r - 2]);
      })) row(r + 1);
    }
    b.length = r * 6;
  })(0);
  return out;
}
// The next step a person can see, easiest first → { k: cell, v, rule, from: cells it follows from, line } or null.
function tHint(g, signs) {
  for (const [a, z, same] of signs) for (const [x, y] of [[a, z], [z, a]])
    if (g[x] >= 0 && g[y] < 0) return { k: y, v: same ? g[x] : 1 - g[x], rule: same ? '=' : '×', from: [x] };
  for (const L of T_LINES) for (let i = 0; i < 4; i++) {
    const [p, q, s] = L.slice(i, i + 3);
    if (g[p] >= 0 && g[p] === g[q] && g[s] < 0) return { k: s, v: 1 - g[p], rule: 'par', from: [p, q] };
    if (g[q] >= 0 && g[q] === g[s] && g[p] < 0) return { k: p, v: 1 - g[q], rule: 'par', from: [q, s] };
    if (g[p] >= 0 && g[p] === g[s] && g[q] < 0) return { k: q, v: 1 - g[p], rule: 'sendvič', from: [p, s] };
  }
  for (const L of T_LINES) for (const v of [0, 1])
    if (L.filter(i => g[i] === v).length === 3) { const k = L.find(i => g[i] < 0); if (k !== undefined) return { k, v: 1 - v, rule: 'pun', from: L.filter(i => g[i] === v), line: L }; }
  for (const L of T_LINES) {   // every way to finish the line agrees on a cell
    const ways = T_ROWS.filter(w => w.every((x, j) => g[L[j]] < 0 || g[L[j]] === x) && signs.every(([a, z, same]) => !L.includes(a) || !L.includes(z) || (w[L.indexOf(a)] === w[L.indexOf(z)]) === same));
    const j = L.findIndex((i, j) => g[i] < 0 && ways.length && ways.every(w => w[j] === ways[0][j]));
    if (j >= 0) return { k: L[j], v: ways[0][j], rule: 'red', from: L.filter(i => g[i] >= 0), line: L };
  }
  return null;
}
// A board from a seed: a random full one, 6-9 signs, givens taken away (down to 4) while the solution stays
// one and the steps of tHint alone still finish it. ~0.1 s on a computer.
function tMake(seed) {
  const r = rng(hash(seed));
  for (;;) {
    const all = tSolve(Array(36).fill(-1), [], 1e5), sol = all[r() * all.length | 0];
    const edges = shuffle([...Array(36).keys()].flatMap(i => [...i % 6 < 5 ? [[i, i + 1]] : [], ...i < 30 ? [[i, i + 6]] : []]), r);
    const signs = edges.slice(0, 6 + (r() * 4 | 0)).map(([a, z]) => [a, z, sol[a] === sol[z]]), giv = sol.slice();
    for (const i of shuffle([...Array(36).keys()], r)) {
      if (giv.filter(x => x >= 0).length <= 4) break;
      giv[i] = -1;
      if (tSolve(giv, signs).length !== 1) giv[i] = sol[i];
    }
    const g = giv.slice();
    for (let h; (h = tHint(g, signs)); ) g[h.k] = h.v;
    if (g.every((x, i) => x === sol[i])) return { giv, sol, signs };
  }
}
// Broken rules → { cells, signs (indexes) }: three alike in a row, four alike in a line, a sign not kept.
function tBad(g, signs) {
  const cells = new Set(), bad = new Set();
  for (const L of T_LINES) {
    for (let i = 0; i < 4; i++) if (g[L[i]] >= 0 && g[L[i]] === g[L[i + 1]] && g[L[i]] === g[L[i + 2]]) [L[i], L[i + 1], L[i + 2]].forEach(k => cells.add(k));
    for (const v of [0, 1]) { const own = L.filter(k => g[k] === v); if (own.length > 3) own.forEach(k => cells.add(k)); }
  }
  signs.forEach(([a, z, same], i) => { if (g[a] >= 0 && g[z] >= 0 && (g[a] === g[z]) !== same) { bad.add(i); cells.add(a); cells.add(z); } });
  return { cells, signs: bad };
}

const T_SYM = ['<rect x="3" y="3" width="18" height="18" rx="2.5" fill="var(--hue)"/>', '<circle cx="12" cy="12" r="9.5" fill="var(--hard)"/>'];
const T_NAME = [['kvadrat', 'kvadrata', 'kvadrati'], ['krug', 'kruga', 'krugovi']];
const tCells = Array.from({ length: 36 }, (_, k) => {
  const b = document.createElement('button');
  b.onclick = () => tTap(k);
  return $('tb').insertBefore(b, $('tbSigns'));
});
let tg = null, tUndo = [], tTip = null;   // the board on screen, its earlier values, the open Savjet ({ k, v, from, title, text, act })
const tLoad = key => { try { return JSON.parse(localStorage[key] || 'null'); } catch { return null; } };
const tSave = () => { try { localStorage[tg.date ? 'tangoDaily' : 'tangoGame'] = JSON.stringify(tg); } catch {} };
const tangoDone = () => tLoad('tangoDone') || {};   // date → ms of each solved daily
const tNew = p => ({ ...p, values: p.giv.slice(), elapsed: 0, solvedAt: null });
const tOpen = which => { try { localStorage.tangoOn = which; } catch {} tUndo = []; tTip = null; go('tango'); };
// The Igre tile: today's daily, made on the day's first open.
function openTango() {
  tg = tLoad('tangoDaily');
  if (tg?.date !== dayKey()) { tg = { ...tNew(tMake('tango#' + dayKey())), date: dayKey() }; tSave(); }
  tOpen('daily');
}
// Nova igra: a random board, with Savjet; one started earlier goes on.
function tangoGame() {
  tg = tLoad('tangoGame');
  if (!tg || tg.solvedAt) { tg = tNew(tMake('t' + Math.random())); tSave(); }
  tOpen('game');
}
$('tangoBack').onclick = () => go('games');
$('tangoNew').onclick = () => tangoGame();

function drawTango() {
  const g = tg.values, bad = tBad(g, tg.signs), solo = !!tg.date, game = tLoad('tangoGame');
  tCells.forEach((b, k) => {
    b.className = [tg.giv[k] >= 0 && 'given', tTip?.from.includes(k) && 'from', tTip?.k === k && 'to', bad.cells.has(k) && 'bad'].filter(Boolean).join(' ');
    b.innerHTML = g[k] < 0 ? '' : `<svg viewBox="0 0 24 24" aria-hidden="true">${T_SYM[g[k]]}</svg>`;
    b.ariaLabel = `Red ${(k / 6 | 0) + 1}, stupac ${k % 6 + 1}: ${g[k] < 0 ? 'prazno' : T_NAME[g[k]][0]}`;
  });
  $('tbSigns').replaceChildren(...tg.signs.map(([a, z, same], i) => Object.assign(document.createElement('span'), {
    textContent: same ? '=' : '×', className: bad.signs.has(i) ? 'bad' : '',
    style: `left: ${(a % 6 + (z - a === 1 ? 1 : 0.5)) / 6 * 100}%; top: ${((a / 6 | 0) + (z - a === 1 ? 0.5 : 1)) / 6 * 100}%` })));
  $('tangoName').textContent = solo ? 'Tango · dnevni' : 'Tango · Nova igra';
  $('tangoSide').textContent = solo ? new Date(tg.date + 'T12:00').toLocaleDateString('hr', { day: 'numeric', month: 'numeric' }) : '';
  $('tangoTimer').textContent = clock(tg.elapsed);
  $('tHintBtn').hidden = solo;   // the daily is solo, as the sudoku's
  $('ttools').hidden = !!tg.solvedAt;
  $('tUndoBtn').disabled = !tUndo.length;
  $('tangoNew').hidden = !tg.solvedAt;
  $('tangoNew').textContent = solo && game && !game.solvedAt ? 'Nastavi vježbu' : 'Nova igra';
  $('tTip').hidden = !tTip;
  if (tTip) { $('tTip').firstChild.textContent = tTip.title; $('tTip').children[1].textContent = tTip.text; $('tTipDo').textContent = tTip.act; }
}
// A tap: empty → square → circle → empty. Printed cells stay.
function tTap(k) {
  if (tg.giv[k] >= 0 || tg.solvedAt) return;
  tUndo.push(tg.values.slice());
  tg.values[k] = tg.values[k] === 1 ? -1 : tg.values[k] + 1;
  tChanged();
}
function tChanged() {
  tTip = null;
  tSave();
  if (tg.values.every((v, i) => v === tg.sol[i])) tangoSolved();
  drawTango();
}
$('tUndoBtn').onclick = () => { if (tUndo.length) { tg.values = tUndo.pop(); tChanged(); } };
$('tClearBtn').onclick = () => { if (tg.values.some((v, i) => v !== tg.giv[i])) { tUndo.push(tg.values.slice()); tg.values = tg.giv.slice(); tChanged(); } };   // undo brings it back

// Savjet: a wrong cell first (or the step would build on it), else the easiest next step, said in words.
$('tHintBtn').onclick = () => {
  const g = tg.values, wrong = g.findIndex((v, i) => v >= 0 && v !== tg.sol[i]), h = wrong < 0 && tHint(g, tg.signs);
  tTip = wrong >= 0 ? { k: wrong, v: -1, from: [], title: 'Nešto ne štima', text: 'Ovo polje nije točno. Obriši ga, pa traži dalje.', act: 'Obriši' }
    : h && { ...h, from: h.line ?? h.from, ...tWords(h, g), act: 'Stavi' };
  drawTango();
};
$('tTipDo').onclick = () => { tUndo.push(tg.values.slice()); tg.values[tTip.k] = tTip.v; tChanged(); };
$('tTip').querySelector('.quiet').onclick = () => { tTip = null; drawTango(); };
function tWords(h, g) {
  const x = g[h.from[0]], n = T_NAME, line = h.line && (h.line[1] - h.line[0] === 1 ? 'red' : 'stupac');
  return {
    '=': { title: 'Znak =', text: `Znak = kaže da su ova dva polja ista. Jedno je ${n[x][0]}, pa je i drugo ${n[x][0]}.` },
    '×': { title: 'Znak ×', text: `Znak × kaže da su ova dva polja različita. Jedno je ${n[x][0]}, pa je drugo ${n[1 - x][0]}.` },
    par: { title: 'Par', text: `Dva ${n[x][1]} jedan do drugog. Treći zaredom ne smije biti ${n[x][0]}, pa ovdje ide ${n[1 - x][0]}.` },
    sendvič: { title: 'Sendvič', text: `${cap(n[x][0])}, prazno, ${n[x][0]}. Da je u sredini ${n[x][0]}, bila bi tri zaredom, pa ovdje ide ${n[1 - x][0]}.` },
    pun: { title: line === 'red' ? 'Pun red' : 'Pun stupac', text: `Ovaj ${line} već ima tri ${n[x][1]}, koliko smije. Ostala polja su ${n[1 - x][2]}.` },
    red: { title: 'Jedini način', text: `Kako god dovršiš ovaj ${line} (3 i 3, nikad tri ista zaredom, znakovi), ovdje uvijek ide ${n[h.v][0]}.` },
  }[h.rule];
}

// Solved: the shared card (card = 'tango'). The daily: time, days in a row, the board (level 3); a game: its time.
function tangoSolved() {
  tg.solvedAt = Date.now();
  tSave();
  card = 'tango';
  $('solvedMenu').textContent = 'Igre';
  $('diffSolved').hidden = $('solvedTechs').hidden = $('lboard').hidden = true;
  if (tg.date) {
    const done = tangoDone();
    done[tg.date] = tg.elapsed;
    try { localStorage.tangoDone = JSON.stringify(done); } catch {}
    $('solvedText').textContent = `Riješeno za ${clock(tg.elapsed)} · ${daysWord(streak(Object.keys(done)))} zaredom`;
    lbNow = { day: tg.date, level: 3, ms: tg.elapsed };
    if (lbName()) lbQueue(lbNow.day, 3, lbNow.ms);
    lbShow(lbNow.day, 3, lbNow.ms);
  } else $('solvedText').textContent = `Vrijeme: ${clock(tg.elapsed)}`;
  tangoButtons();
  $('solved').showModal();
}
// The daily: Igre, and on to today's sudoku daily (its first level not solved), the result shared quietly;
// with the sudokus done too, Podijeli is the main one. A game: Igre and the next one.
function tangoButtons() {
  const next = tg.date ? loadDays().levels.findIndex(st => !st?.solvedAt) : -1;
  $('solvedClose').hidden = true;
  $('solvedNext').hidden = !!tg.date;
  $('solvedLevel').hidden = next < 0;
  if (next >= 0) { $('solvedLevel').dataset.lvl = next; $('solvedLevel').firstChild.hidden = true; $('solvedLevel').lastChild.textContent = 'Sudoku'; }
  $('solvedShare').hidden = !tg.date;
  $('solvedShare').classList.toggle('quiet', next >= 0);
  $('solvedShare').lastChild.textContent = next < 0 ? 'Podijeli' : 'Podijeli rezultat';
  if (tg.date) tShare();
}
// As prepShare: made before the tap, the place added once the board answers.
async function tShare() {
  const name = lbName(), ms = tg.elapsed, day = tg.date, make = p => ({ url: location.origin + location.pathname,
    text: [`Tango · ${new Date(day + 'T12:00').toLocaleDateString('hr', { day: 'numeric', month: 'numeric' })}`, `${clock(ms)}${p?.all ? ` (${p.place}. od ${p.all})` : ''}`, 'Možeš li brže?'].join('\n') });
  shareMsg = make();
  if (!name || !await lbFlush()) return;
  shareMsg = make(await lbRows(day, 3, 0, { name, ms }).catch(() => null));
}
