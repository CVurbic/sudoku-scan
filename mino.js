// --- Minolovac: open every cell without a mine; a number says how many mines touch its cell. A mine costs
// 30 s and the game goes on. One a day (9 × 12, 20 mines), the same for everyone, opened at the same cell
// (made from the date, like Nit's); Nova igra in three sizes. Some boards ask for a guess: part of the game.
// A board: { w, h, lv, mines: cells, start: the cell opened first (no mine on it or around it) }. ---
const M_LV = [['Lagano', 9, 9, 10], ['Srednje', 9, 12, 20], ['Teško', 10, 14, 30]], M_DAILY = 1, M_FINE = 30000;
const mNear = (k, w, h) => {
  const r = k / w | 0, c = k % w, out = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++)
    if ((dr || dc) && r + dr >= 0 && r + dr < h && c + dc >= 0 && c + dc < w) out.push((r + dr) * w + c + dc);
  return out;
};
// ponytail: mines anywhere off the start; not checked for guesses (Chris: a guess now and then belongs to the game).
function mMake(seed, lv) {
  const [, w, h, n] = M_LV[lv], r = rng(hash(seed)), start = (h / 2 | 0) * w + (w / 2 | 0), safe = new Set([start, ...mNear(start, w, h)]);
  return { w, h, lv, start, mines: shuffle([...Array(w * h).keys()].filter(k => !safe.has(k)), r).slice(0, n).sort((a, b) => a - b) };
}
const mCount = (g, k) => mNear(k, g.w, g.h).filter(j => g.mines.includes(j)).length;
// Open cell k of game g: a mine is a hit (+30 s, shown, counted as found); a 0 opens its neighbours, and theirs.
function mOpen(g, k) {
  if (g.open.includes(k) || g.flag.includes(k) || g.hits.includes(k)) return;
  if (g.mines.includes(k)) { g.hits.push(k); g.elapsed += M_FINE; return; }
  for (const q = [k]; q.length; ) {
    const j = q.pop();
    if (g.open.includes(j) || g.flag.includes(j)) continue;
    g.open.push(j);
    if (!mCount(g, j)) q.push(...mNear(j, g.w, g.h));
  }
}
// A number with as many flags (and hits) around it as it says opens the rest of its neighbours.
function mChord(g, k) {
  const ns = mNear(k, g.w, g.h);
  if (ns.filter(j => g.flag.includes(j) || g.hits.includes(j)).length === mCount(g, k)) ns.forEach(j => mOpen(g, j));
}
const mFlag = (g, k) => { if (!g.open.includes(k) && !g.hits.includes(k)) g.flag = g.flag.includes(k) ? g.flag.filter(j => j !== k) : [...g.flag, k]; };
const mDone = g => g.open.length === g.w * g.h - g.mines.length;
const mNew = b => { const g = { ...b, open: [], flag: [], hits: [], elapsed: 0, solvedAt: null }; mOpen(g, b.start); return g; };

// --- On screen: a grid of tiles (Pločice), drawn anew on every move.
// A game: { ...board, open, flag, hits, elapsed (with the fines), solvedAt, date (the daily's) }.
const M_FLAG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 17V3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M7 3.5l9 3.5-9 3.5z" fill="var(--negative)"/></svg>';
const M_MINE = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5v15M2.5 10h15M4.7 4.7l10.6 10.6M15.3 4.7L4.7 15.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="10" r="5.2" fill="currentColor"/></svg>';
let mg = null;   // the game on screen
const mSave = () => { try { localStorage[mg.date ? 'minoDaily' : 'minoGame'] = JSON.stringify(mg); } catch {} };
const minoDone = () => tLoad('minoDone') || {};   // date → ms (with the fines) of each solved daily
const mOpenView = which => { try { localStorage.minoOn = which; } catch {} go('mino'); };
// The Igre tile: today's daily, made on the day's first open.
function openMino() {
  mg = tLoad('minoDaily');
  if (mg?.date !== dayKey()) { mg = { ...mNew(mMake('mino#' + dayKey(), M_DAILY)), date: dayKey() }; mSave(); }
  mOpenView('daily');
}
// Nova igra: a random board at level lv (the last one played if none); one started earlier at that level goes on.
function minoGame(lv) {
  if (lv === undefined) try { lv = +localStorage.minoLv || 0; } catch { lv = 0; }
  try { localStorage.minoLv = lv; } catch {}
  mg = tLoad('minoGame');
  if (!mg || mg.solvedAt || mg.lv !== lv) { mg = mNew(mMake('m' + Math.random(), lv)); mSave(); }
  mOpenView('game');
}
$('tileMino').onclick = openMino;
$('minoBack').onclick = () => go('games');
$('minoNew').querySelectorAll('button').forEach((b, i) => { b.prepend(stairs(i)); b.onclick = () => minoGame(i); });

function drawMino() {
  const b = $('mb'), shown = new Set(mg.solvedAt ? mg.mines : mg.flag);
  b.style.setProperty('--w', mg.w);
  b.style.setProperty('--h', mg.h);
  b.ariaLabel = `Ploča ${mg.w} × ${mg.h}, ${mg.mines.length} mina`;
  b.innerHTML = Array.from({ length: mg.w * mg.h }, (_, k) => {
    if (mg.hits.includes(k)) return `<i class="x">${M_MINE}</i>`;
    if (mg.open.includes(k)) { const n = mCount(mg, k); return `<i class="o${n ? ' k' + n : ''}">${n || ''}</i>`; }
    return `<i class="u">${shown.has(k) ? M_FLAG : ''}</i>`;
  }).join('');
  $('minoName').textContent = mg.date ? 'Minolovac · dnevni' : `Minolovac · ${M_LV[mg.lv][0]}`;
  $('minoSide').textContent = mg.date ? new Date(mg.date + 'T12:00').toLocaleDateString('hr', { day: 'numeric', month: 'numeric' }) : '';
  $('minoLeft').lastChild.textContent = mg.solvedAt ? 0 : mg.mines.length - mg.flag.length - mg.hits.length;
  $('minoTimer').textContent = clock(mg.elapsed);
  $('minoNew').hidden = !mg.solvedAt;
}

// Input. Mouse: left opens (a number: its neighbours), right flags. Finger: a tap opens, held 400 ms flags
// (a ring fills meanwhile); a finger that moves off is no tap. The browser's own long-press menu never shows.
let mPress = null;   // { k, x, y, el, timer }
const mCell = e => { const el = e.target.closest('#mb > i'); return el ? [...$('mb').children].indexOf(el) : -1; };
function mAct(k, flag) {
  if (k < 0 || mg.solvedAt) return;
  const hits = mg.hits.length;
  if (flag) { mFlag(mg, k); navigator.vibrate?.(15); }
  else if (mg.open.includes(k)) mChord(mg, k);
  else mOpen(mg, k);
  if (mg.hits.length > hits) {   // a mine: the clock shows the fine (no toast: it would cover the board's top row)
    $('minoTimer').classList.remove('hit');
    void $('minoTimer').offsetWidth;   // the same class again restarts its animation
    $('minoTimer').classList.add('hit');
  }
  mSave();
  if (mDone(mg)) minoSolved();
  drawMino();
}
const mDrop = () => { if (mPress) { clearTimeout(mPress.timer); mPress.el.classList.remove('hold'); mPress = null; } };
$('mb').onpointerdown = e => {
  const k = mCell(e);
  if (k < 0 || mg.solvedAt || mPress) return;   // a second finger is ignored
  if (e.pointerType === 'mouse') { if (e.button === 2) mAct(k, true); else if (e.button === 0) mPress = { k, x: e.clientX, y: e.clientY, el: e.target.closest('i') }; return; }
  const el = e.target.closest('i');
  if (el.classList.contains('u')) el.classList.add('hold');
  mPress = { k, x: e.clientX, y: e.clientY, el, timer: setTimeout(() => { const { k } = mPress; mDrop(); mPress = { k, done: true, el }; mAct(k, true); }, 400) };
};
$('mb').onpointermove = e => { if (mPress && !mPress.done && Math.hypot(e.clientX - mPress.x, e.clientY - mPress.y) > 10) mDrop(); };
$('mb').onpointerup = () => { const p = mPress; mDrop(); if (p && !p.done) mAct(p.k, false); };
$('mb').onpointercancel = mDrop;
$('mb').oncontextmenu = e => e.preventDefault();

// Solved: the mines show as flags, then the shared card (card = 'mino'): the daily's time with the fines,
// days in a row and the board (level 5); a game's time.
const minesWord = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'mina' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'mine' : 'mina'}`;
function minoSolved() {
  mg.solvedAt = Date.now();
  mSave();
  card = 'mino';
  $('solved').className = 'mino';
  $('solvedMenu').textContent = 'Igre';
  $('diffSolved').hidden = $('solvedTechs').hidden = $('lboard').hidden = true;
  const fines = mg.hits.length ? ` (${minesWord(mg.hits.length)}, +${clock(mg.hits.length * M_FINE)})` : '';
  if (mg.date) {
    const done = minoDone();
    done[mg.date] = mg.elapsed;
    try { localStorage.minoDone = JSON.stringify(done); } catch {}
    $('solvedText').textContent = `Riješeno za ${clock(mg.elapsed)}${fines} · ${daysWord(streak(Object.keys(done)))} zaredom`;
    lbNow = { day: mg.date, level: 5, ms: mg.elapsed };
    if (lbName()) lbQueue(lbNow.day, 5, lbNow.ms);
    lbShow(lbNow.day, 5, lbNow.ms);
  } else $('solvedText').textContent = `Vrijeme: ${clock(mg.elapsed)}${fines}`;
  minoButtons();
  setTimeout(() => view === 'mino' && $('solved').showModal(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700);
}
// The daily: Igre and Podijeli (the place added once the board answers); a game: Igre and the next one.
function minoButtons() {
  $('solvedClose').hidden = $('solvedLevel').hidden = true;
  $('solvedNext').hidden = !!mg.date;
  $('solvedShare').hidden = !mg.date;
  $('solvedShare').classList.remove('quiet');
  $('solvedShare').lastChild.textContent = 'Podijeli';
  if (mg.date) dailyShare('Minolovac', mg.date, 5, mg.elapsed);
}
