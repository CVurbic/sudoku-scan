// --- Tango (on screen Dinango): a 6×6 board of eggs (0) and baby dinos (1). Each row and column holds three of each, never three
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
// The levels (Lagano, Srednje, Teško): givens kept at least, and how many steps need a whole line ("red",
// the hardest of tHint's): none / 1-3 / 4 or more. Measured on 150 old dailies: 26 / 53 / 21 %.
const T_LV = [[8, 0, 0], [4, 1, 3], [4, 4, 99]], T_BOARD = [8, 9, 10];   // T_BOARD: the leaderboard's level of each
let T_ALL = null;   // every full board, made on the first board asked for
// tHint's steps from the givens → { g: where they end, red: how many needed a whole line }.
function tSteps(giv, signs) { const g = giv.slice(); let red = 0; for (let h; (h = tHint(g, signs)); ) { g[h.k] = h.v; red += h.rule === 'red'; } return { g, red }; }
// A board from a seed at a level: a random full one, 6-9 signs, givens taken away (down to the level's) while the
// solution stays one, kept when tHint's steps alone finish it with the level's count of line steps. ~10-25 ms.
function tMake(seed, lv = 1) {
  const r = rng(hash(seed)), [keep, lo, hi] = T_LV[lv];
  for (;;) {
    const all = T_ALL ??= tSolve(Array(36).fill(-1), [], 1e5), sol = all[r() * all.length | 0];
    const edges = shuffle([...Array(36).keys()].flatMap(i => [...i % 6 < 5 ? [[i, i + 1]] : [], ...i < 30 ? [[i, i + 6]] : []]), r);
    const signs = edges.slice(0, 6 + (r() * 4 | 0)).map(([a, z]) => [a, z, sol[a] === sol[z]]), giv = sol.slice();
    for (const i of shuffle([...Array(36).keys()], r)) {
      if (giv.filter(x => x >= 0).length <= keep) break;
      giv[i] = -1;
      if (tSolve(giv, signs).length !== 1) giv[i] = sol[i];
    }
    const { g, red } = tSteps(giv, signs);
    if (g.every((x, i) => x === sol[i]) && red >= lo && red <= hi) return { giv, sol, signs };
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

// The two pictures (48×48): an egg, and a baby dino just out of one. Shape and colour both differ.
const tEye = (x, y) => `<circle cx="${x}" cy="${y}" r="3.3" fill="var(--eye)"/><circle cx="${x + 1.2}" cy="${y - 1.3}" r="1.2" fill="#fff"/>`;
const tCheek = x => `<ellipse cx="${x}" cy="26.5" rx="3.2" ry="2" fill="var(--cheek)" opacity=".55"/>`;
const T_SYM = [
  `<ellipse cx="24" cy="26" rx="13.5" ry="17" fill="var(--egg)" stroke="var(--egg2)" stroke-width="1.6"/><ellipse cx="19" cy="19.5" rx="3.2" ry="2.5" fill="var(--dgl)"/>
   <ellipse cx="29.5" cy="30" rx="3.6" ry="2.7" fill="var(--dgl)"/><circle cx="21" cy="35.5" r="1.9" fill="var(--dgl)"/><circle cx="30.5" cy="17.5" r="1.6" fill="var(--dgl)"/>`,
  `<circle cx="25" cy="9.5" r="2.6" fill="var(--dg2)"/><circle cx="19" cy="11.5" r="2.2" fill="var(--dg2)"/><circle cx="31" cy="11.5" r="2.2" fill="var(--dg2)"/>
   <path d="M11.5 32C10 19 16 10.5 25 10.5S39.5 19 37.5 32Z" fill="var(--dg)"/>${tEye(19.5, 21)}${tEye(30, 21)}${tCheek(15.5)}${tCheek(34)}
   <path d="M22.5 26.5q2.2 1.6 4.4 0" fill="none" stroke="var(--eye)" stroke-width="1.4" stroke-linecap="round"/>
   <path d="M10.5 30.5 15 26l4 4.5 4.5-4.5 4.5 4.5 4.5-4.5 4 4.5 1.5-1.5C39 39 33 45 25 45s-14.5-6-14.5-14.5Z" fill="var(--egg)" stroke="var(--egg2)" stroke-width="1.6" stroke-linejoin="round"/>`];
const T_NAME = [['jaje', 'jaja', 'jaja'], ['dinić', 'dinića', 'dinići']];
// The tile and its copies (rail, Danas; Povijest copies it later): four cells of the board. The solved card: the little one.
const tTile = '<rect width="48" height="48" rx="8" fill="var(--board)"/>' + [[3, 3, 0], [25, 3, 1], [3, 25, 1], [25, 25, 0]]
  .map(([x, y, v]) => `<rect x="${x}" y="${y}" width="20" height="20" rx="4" fill="var(--cell)"/><svg x="${x + 1}" y="${y + 1}" width="18" height="18" viewBox="0 0 48 48">${T_SYM[v]}</svg>`).join('');
document.querySelectorAll('#tileTango > svg, [data-tile="tileTango"] > svg:first-child').forEach(s => s.innerHTML = tTile);
$('solvedDino').innerHTML = T_SYM[1];
const tCells = Array.from({ length: 36 }, (_, k) => {
  const b = document.createElement('button');
  b.onclick = () => tTap(k);
  b.style.cssText = `grid-area: ${(k / 6 | 0) + 1} / ${k % 6 + 1}; --d: ${(k / 6 | 0) + k % 6}`;   // --d: its place in the wave when solved
  return $('tb').insertBefore(b, $('tbSigns'));
});
let tg = null, tUndo = [], tTip = null;   // the board on screen, its earlier values, the open Savjet ({ k, v, from, title, text, act })
const tLoad = key => { try { return JSON.parse(localStorage[key] || 'null'); } catch { return null; } };
// A board's lv: 0-2 (Lagano, Srednje, Teško). The dailies: one per level and day (tangoDaily0-2); a game: tangoGame.
const tSave = () => { try { localStorage[tg.date ? 'tangoDaily' + tg.lv : 'tangoGame'] = JSON.stringify(tg); } catch {} };
// date → ms of each solved daily: one number up to 23. 11. 2026 (one daily a day), then [ms or null] per level.
const tangoDone = () => tLoad('tangoDone') || {};
const tDoneMs = v => Array.isArray(v) ? v : [null, v, null];   // an old day's one daily counts as Srednje
const tNew = p => ({ ...p, values: p.giv.slice(), elapsed: 0, solvedAt: null });
const tOpen = which => { try { localStorage.tangoOn = which; } catch {} tUndo = []; tTip = null; $('tb').classList.remove('won'); go('tango'); };
// Today's daily at a level, made (and kept) on the day's first look; the same for everyone.
function tDay(lv) {
  let g = tLoad('tangoDaily' + lv);
  if (g?.date !== dayKey()) { g = { ...tNew(tMake(`tango#${lv}#${dayKey()}`, lv)), date: dayKey(), lv }; try { localStorage['tangoDaily' + lv] = JSON.stringify(g); } catch {} }
  return g;
}
const tToday = () => [0, 1, 2].map(lv => { const g = tLoad('tangoDaily' + lv); return g?.date === dayKey() ? g : null; });   // without making any
function openTango(lv) { tg = tDay(lv); tOpen('daily' + lv); }
// Nova igra at a level: a random board, with Savjet; one started earlier at that level goes on.
function tangoGame(lv) {
  tg = tLoad('tangoGame');
  lv ??= tg?.lv ?? 1;
  if (!tg || tg.solvedAt || (tg.lv ?? 1) !== lv) { tg = { ...tNew(tMake('t' + Math.random(), lv)), lv }; tSave(); }
  tOpen('game');
}
$('tangoBack').onclick = () => go('tmenu');
$('tangoNew').onclick = () => tangoGame();

// The Dinango page: today's three dailies (where the help is, not what it is: a dot on each given cell), Nova igra
// at a level, and today's Ljestvica one level at a time.
const tMini = g => {
  let s = '<rect width="96" height="96" rx="8" fill="var(--board)"/>';
  for (let k = 0; k < 36; k++) { const x = 2 + k % 6 * 15.5, y = 2 + (k / 6 | 0) * 15.5, on = g.giv[k] >= 0;
    s += `<rect x="${x}" y="${y}" width="14" height="14" rx="2.5" fill="var(${on ? '--given' : '--cell'})"/>`;
    if (on) s += `<circle cx="${x + 7}" cy="${y + 7}" r="3.2" fill="var(--sign)" opacity=".55"/>`; }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 96 96');
  svg.classList.add('mb');
  svg.innerHTML = s;
  return svg;
};
let tRankLv = 0, tRankAsk = 0;
function showTmenu() {
  const days = [0, 1, 2].map(tDay), next = days.findIndex(g => !g.solvedAt);
  $('tDailyCount').textContent = `${days.filter(g => g.solvedAt).length} od 3`;
  $('tDays').replaceChildren(...days.map((g, lv) => {
    const b = boardKey(lv, tMini(g), g.solvedAt ? `✓ ${clock(g.elapsed)}` : g.elapsed ? 'u tijeku' : '');
    b.classList.toggle('solved', !!g.solvedAt);
    b.classList.toggle('next', lv === next);
    b.onclick = () => openTango(lv);
    return b;
  }));
  tRankLv = Math.max(0, days.findLastIndex(g => g.solvedAt));   // the last level you solved
  tRanks();
}
$('tNews').replaceChildren(...[0, 1, 2].map(lv => { const b = document.createElement('button'); b.className = 'key'; b.append(stairs(lv), DAILY[lv][0]); b.onclick = () => tangoGame(lv); return b; }));
$('tRanksLv').querySelectorAll('button').forEach((b, lv) => b.onclick = () => { tRankLv = lv; tRanks(); });
async function tRanks() {
  $('tRanksLv').querySelectorAll('button').forEach((b, lv) => b.ariaPressed = String(lv === tRankLv));
  const g = tToday()[tRankLv], ask = ++tRankAsk, mine = g?.solvedAt && lbName() ? { name: lbName(), ms: g.elapsed } : undefined;
  let b = null;
  try { b = await lbRows(dayKey(), T_BOARD[tRankLv], 8, mine); } catch {}
  if (ask !== tRankAsk) return;
  $('tRanksCount').textContent = !b ? 'Ljestvica se nije učitala.' : b.all ? players(b.all) : 'Još nitko danas';
  $('tRanksList').replaceChildren(...b?.rows ?? []);
}
$('tmenuBack').onclick = () => go('games');

function drawTango() {
  // the cell being tapped through egg → dino: its broken rules wait for a pause (tQuiet); the rest show at once
  const g = tg.values, bad = tBad(tQuiet === null ? g : g.map((v, i) => i === tQuiet ? -1 : v), tg.signs), solo = !!tg.date, game = tLoad('tangoGame');
  tCells.forEach((b, k) => {
    b.className = [tg.giv[k] >= 0 && 'given', tTip?.from.includes(k) && 'from', tTip?.k === k && 'to', bad.cells.has(k) && 'bad'].filter(Boolean).join(' ');
    b.innerHTML = g[k] < 0 ? '' : `<svg viewBox="0 0 48 48" aria-hidden="true">${T_SYM[g[k]]}</svg>`;
    b.ariaLabel = `Red ${(k / 6 | 0) + 1}, stupac ${k % 6 + 1}: ${g[k] < 0 ? 'prazno' : T_NAME[g[k]][0]}`;
  });
  $('tbSigns').replaceChildren(...tg.signs.map(([a, z, same], i) => Object.assign(document.createElement('span'), {
    textContent: same ? '=' : '×', className: (z - a === 1 ? 'h' : 'v') + (bad.signs.has(i) ? ' bad' : ''),
    style: `grid-area: ${(a / 6 | 0) + 1} / ${a % 6 + 1}` })));   // in a's cell, pushed onto the gap after it
  $('tangoName').textContent = `${solo ? 'Dinango' : 'Nova igra'} · ${DAILY[tg.lv ?? 1][0]}`;
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
// A tap: empty → egg → dino → empty. Printed cells stay. Red for that cell only after T_WAIT ms without a tap
// (while choosing between egg and dino it is no mistake yet).
let T_WAIT = 1500, tQuiet = null, tQuietT = 0;
function tTap(k) {
  if (tg.giv[k] >= 0 || tg.solvedAt) return;
  tUndo.push(tg.values.slice());
  tg.values[k] = tg.values[k] === 1 ? -1 : tg.values[k] + 1;
  clearTimeout(tQuietT);
  tQuietT = setTimeout(() => { tQuiet = null; if (view === 'tango') drawTango(); }, T_WAIT);
  tChanged(k);
}
function tChanged(quiet = null) {   // undo, Obriši sve, Savjet: red at once
  tQuiet = quiet;
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
    par: { title: 'Par', text: `Dva ${n[x][1]} zaredom. Ni sljedeće polje ne smije biti ${n[x][0]}, pa ovdje ide ${n[1 - x][0]}.` },
    sendvič: { title: 'Sendvič', text: `${cap(n[x][0])}, prazno, ${n[x][0]}. Da je u sredini ${n[x][0]}, bila bi tri zaredom, pa ovdje ide ${n[1 - x][0]}.` },
    pun: { title: line === 'red' ? 'Pun red' : 'Pun stupac', text: `Ovaj ${line} već ima tri ${n[x][1]}, koliko smije. Ostala polja su ${n[1 - x][2]}.` },
    red: { title: 'Jedini način', text: `Kako god dovršiš ovaj ${line} (3 i 3, nikad tri ista zaredom, znakovi), ovdje uvijek ide ${n[h.v][0]}.` },
  }[h.rule];
}

// Solved: a wave over the board, then the shared card (card = 'tango': the little dino, a line for U). The daily: time, days in a row, the board (level 3); a game: its time.
function tangoSolved() {
  tg.solvedAt = Date.now();
  tSave();
  card = 'tango';
  $('tb').classList.add('won');
  $('solved').className = 'tango';
  $('solvedMenu').textContent = 'Igre';
  $('diffSolved').hidden = $('solvedTechs').hidden = $('lboard').hidden = true;
  if (tg.date) {
    const done = tangoDone(), L = T_BOARD[tg.lv];
    done[tg.date] = Object.assign(tDoneMs(done[tg.date]).slice(), { [tg.lv]: tg.elapsed });
    try { localStorage.tangoDone = JSON.stringify(done); } catch {}
    $('solvedText').textContent = `${DAILY[tg.lv][0]} · ${clock(tg.elapsed)} · ${daysWord(streak(Object.keys(done)))} zaredom`;
    lbNow = { day: tg.date, level: L, ms: tg.elapsed };
    if (lbName()) lbQueue(lbNow.day, L, lbNow.ms);
    lbShow(lbNow.day, L, lbNow.ms);
  } else $('solvedText').textContent = `Vrijeme: ${clock(tg.elapsed)}`;
  tangoButtons();
  setTimeout(() => view === 'tango' && $('solved').showModal(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900);
}
// The daily: on to today's next Dinango level (as the sudoku's), then to today's sudoku daily (its first level
// not solved), the result shared quietly; with everything done, Podijeli is the main one. A game: Igre and the next one.
let tNextLv = -1;   // the Dinango level the card's main button opens, else -1 (the sudoku's)
function tangoButtons() {
  const left = tg.date ? tToday().findIndex(g => !g?.solvedAt) : -1;
  tNextLv = left;
  const next = !tg.date ? -1 : left >= 0 ? left : loadDays().levels.findIndex(st => !st?.solvedAt);
  $('solvedClose').hidden = true;
  $('solvedNext').hidden = !!tg.date;
  $('solvedLevel').hidden = next < 0;
  if (next >= 0) {
    Object.assign($('solvedLevel').dataset, { lvl: next, day: dayKey() });
    if (left >= 0) { $('solvedLevel').firstChild.replaceWith(stairs(left)); $('solvedLevel').lastChild.textContent = DAILY[left][0]; }
    else { $('solvedLevel').firstChild.hidden = true; $('solvedLevel').lastChild.textContent = 'Sudoku'; }
  }
  $('solvedShare').hidden = !tg.date;
  $('solvedShare').classList.toggle('quiet', next >= 0);
  $('solvedShare').lastChild.textContent = next < 0 ? 'Podijeli' : 'Podijeli rezultat';
  if (tg.date) dailyShare(`Dinango ${DAILY[tg.lv][0]}`, tg.date, T_BOARD[tg.lv], tg.elapsed);
}
