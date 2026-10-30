// Sudoku: the board and its pad, hints and the explanation bubble, history, its menu, the logic, the dailies,
// the solved card (Tango uses it too), sharing. Also rng, hash, shuffle, dayKey and clock, used by Tango as well
// (pool.js reads the logic and the daily generator from this file).

// Cells are typed into with the number pad (as in the live camera), not the phone keyboard; on a
// computer the keys 1-9 and Backspace work too.
const inputs = Array.from({ length: 81 }, (_, k) => {
  const i = document.createElement('input');
  i.readOnly = true; i.inputMode = 'none';
  i.onclick = () => pick(k);
  i.onkeydown = e => {
    const d = /^[1-9]$/.test(e.key) ? +e.key : /^(Backspace|Delete|0)$/.test(e.key) ? 0 : -1;
    if (d < 0 || task?.givens[k]) return;
    sel = k; setCell(d);
  };
  $('grid').append(i);
  return i;
});
// Candidates layer over the cells (drawCands); after the inputs, so their nth-child borders hold.
const candCells = (() => {
  const layer = $('grid').appendChild(Object.assign(document.createElement('div'), { id: 'cands', hidden: true }));
  return inputs.map(() => layer.appendChild(document.createElement('span')));
})();
// Lines a step draws over the board (markStep), in the 90×90 box of line().
$('grid').insertAdjacentHTML('beforeend', '<svg id="hintLines" viewBox="0 0 90 90" aria-hidden="true"></svg>');
let model, featModel, printedModel = null, task = null;   // task = { givens, solution }: 81 numbers each, 0 = empty
let sel = null;   // cell picked for the pad

// Tap on a cell → pick it for the pad (a task's printed digits are fixed); same cell again → put away.
// With a digit armed, an empty cell gets it instead.
function pick(k) {
  if (armed && k !== null && !inputs[k].value && !task?.givens[k]) {
    sel = k;
    setCell(armed);
    return arm(padKeys[armed - 1].classList.contains('spent') ? 0 : armed);   // all nine placed: put away
  }
  const tapped = k;
  if (task?.givens[k]) k = null;
  sel = k === sel ? null : k;
  inputs.forEach((x, i) => x.classList.toggle('sel', i === sel));
  light(sel ?? (task?.givens[tapped] ? tapped : null));   // a printed digit can't be picked, but shows where its digit is
  $('padKind').disabled = sel === null || !inputs[sel].value;   // before a task only
  $('padKind').lastChild.textContent = sel !== null && inputs[sel].classList.contains('entry') ? 'Ovo je tiskani broj' : 'Ovo je moj broj (rukom)';
}

// Number first: a pad digit tapped with no cell picked is armed (0: none); each empty cell tapped then
// gets it (a note in notes mode). The same digit again, Esc, or leaving the game puts it away.
let armed = 0;
function arm(d) {
  armed = d;
  padKeys.forEach((b, j) => b.ariaPressed = String(j + 1 === d));
  pick(null);
  inputs.forEach(x => x.classList.toggle('same', !!d && x.value === String(d)));
}
addEventListener('keydown', e => e.key === 'Escape' && armed && arm(0));

// The tapped cell's row, column and box, and every cell holding its digit (null: none).
function light(k) {
  const v = k === null ? '' : inputs[k].value;
  inputs.forEach((x, i) => {
    x.classList.toggle('peer', k !== null && PEERS[k].includes(i));
    x.classList.toggle('same', !!v && x.value === v);
  });
}

// Notes: the user's own small digits per cell (pad "Bilješke"); undo: the board before each change.
let notes = Array.from({ length: 81 }, () => []), noting = false, undo = [];

// Where the board's progress (values, notes, elapsed) is kept: today's daily in its day, any other task in itself.
const state = () => task.daily ? daily : task;
const saveState = () => { if (task.daily) saveDaily(); else try { localStorage.sudokuTask = JSON.stringify(task); } catch {} };

// Saved progress back on the board: typed digits (judged, except in the solo daily) and notes.
function restore(st) {
  undo = [];
  inputs.forEach((x, i) => {
    const d = task.givens[i] ? 0 : +st.values?.[i] || 0;
    x.className = '';
    x.value = d || '';
    if (d && !task.daily) x.classList.add(d === task.solution[i] ? 'ok' : 'wrong');
    notes[i] = [...st.notes?.[i] ?? ''].map(Number);
  });
}

$('undoBtn').onclick = () => {
  const u = undo.pop();
  if (!u) return;
  idle = 0;
  clearHint();
  pick(null);
  notes = u.notes;
  const x = inputs[u.k];
  x.value = u.v;
  x.classList.remove('ok', 'wrong', 'maybe', 'hint');
  if (u.v && !task.daily && !task.givens[u.k]) x.classList.add(+u.v === task.solution[u.k] ? 'ok' : 'wrong');
  light(u.k);
  markConflicts();
};

// Pad digit (0 = empty) into the picked cell. In notes mode an empty cell gets it pencilled in or out
// instead, and the pad stays for the next one.
function setCell(d) {
  const k = sel, i = inputs[k];
  if (k === null) return;   // a digit with no cell picked does nothing
  idle = 0;
  if (d && tipOn) { tipOn = false; say(''); }   // the first digit puts the first games' tip away
  undo.push({ k, v: i.value, notes: notes.slice() });   // notes are replaced, never changed in place
  if (noting && task && !i.value) {
    notes[k] = !d ? [] : notes[k].includes(d) ? notes[k].filter(x => x !== d) : [...notes[k], d].sort();
    return markConflicts();
  }
  pick(null);
  i.value = d || '';
  if (d && task) { notes[k] = []; PEERS[k].forEach(j => notes[j] = notes[j].filter(x => x !== d)); }   // its row, column and box no longer need that note
  light(k);
  if (hintState?.level < 3 && !task.givens[k]) {   // a try during "Sljedeći korak"
    if (d) tryMove(k, d); else i.classList.remove('ok', 'wrong', 'maybe');
    return markConflicts();
  }
  clearHint();
  if (!task) {   // a digit typed in counts as printed
    if (!d) i.classList.remove('entry');
    i.classList.toggle('given', !!d && !i.classList.contains('entry'));
    entryLabel();
  }
  if (task && !task.daily && !task.givens[k]) {   // the daily is solo: nothing judged, only duplicates show (markConflicts)
    const flagged = i.classList.contains('maybe') || i.classList.contains('wrong');
    i.classList.remove('ok', 'wrong', 'maybe');
    if (d) i.classList.add(d === task.solution[k] ? 'ok' : 'wrong');
    if (flagged && d) learn([[k, d]]);   // typed = what is written on paper
  }
  markConflicts();
}

// Pad "Ovo je moj broj / tiskani broj": the picked digit, printed (grey) ↔ handwritten (blue).
function setKind() {
  const i = inputs[sel];
  pick(null);
  i.classList.toggle('given', !i.classList.toggle('entry'));
  entryLabel();
}

// The game's controls for the task on the board (none: a sudoku being typed in or checked first).
function showTask() {
  inputs.forEach((inp, i) => {
    const g = task?.givens[i];
    inp.classList.toggle('given', !!g);
    if (g) inp.value = g;
    inp.classList.remove('entry');
  });
  entryLabel();
  const solo = !task || !!task.daily;   // the daily is solo
  for (const id of ['hintBtn', 'solveBtn', 'candsBtn', 'explainBtn']) $(id).hidden = solo;
  $('paperBtn').hidden = solo || !!task.random;   // a scanned sudoku's paper
  $('undoBtn').hidden = $('padNotes').hidden = $('moreBtn').hidden = !task;
  $('padKind').hidden = $('setTask').hidden = !!task;
  $('timer').hidden = !task?.daily && !task?.random;
  if (!$('timer').hidden) $('timer').textContent = clock(state().elapsed);
  if (task) diffPill($('diff'), saved().find(e => e.key === task.solution.join(''))?.diff ?? difficulty(task.givens, task.solution));
  else $('diff').hidden = true;
}

// The name row: what is being played (and its date), or before a task what is being typed and how many digits.
function gameHead() {
  const n = inputs.filter(x => x.value).length;
  $('gameName').textContent = !task ? (lastProbs ? 'Provjeri očitanje' : 'Upiši sudoku') : gameKind() + (task.daily || task.random ? ` · ${LEVELS[task.level][1]}` : '');
  $('gameSide').textContent = !task ? `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'broj' : n % 10 > 1 && n % 10 < 5 && (n % 100 < 12 || n % 100 > 14) ? 'broja' : 'brojeva'}`
    : task.daily ? new Date(task.daily + 'T12:00').toLocaleDateString('hr', { day: 'numeric', month: 'numeric' }) : '';
}
const gameKind = () => task.random ? 'Nova igra' : task.daily ? 'Dnevni' : 'Skenirani sudoku';

// Candidates: in every empty cell the digits still possible there (from the givens and right entries).
let showCands = false;
// Off (or in the solo daily): the user's own notes instead.
function drawCands() {
  const auto = showCands && !task?.daily;
  $('cands').hidden = !task;
  $('cands').classList.toggle('mine', !auto);
  if (!task) return;
  const g = auto && knownGrid();
  candCells.forEach((c, i) => {
    const ds = inputs[i].value ? [] : auto ? candidates(g, i) : notes[i];
    c.replaceChildren(...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => Object.assign(document.createElement('span'), { textContent: ds.includes(d) ? d : '' })));
  });
}
$('candsBtn').onclick = () => {
  showCands = !showCands;
  $('candsBtn').ariaPressed = String(showCands);
  drawCands();
};

// The explanation: closed, the user solves alone; the marks on the board stay. Remembered.
// Off: no bubble at all (the marks on the board stay); the "Objašnjenje" toggle brings it back.
const setQuiet = q => {
  $('explainBox').classList.toggle('quiet', q);
  $('explainBtn').ariaPressed = String(!q);
  placeBubble();
  try { localStorage.sudokuQuiet = q ? '1' : '0'; } catch {}
};
// Switched off, the user must know where it went: said at once on Sakrij, and once per game when Savjet
// is pressed while it is off (it may be off from an earlier game), each time with the way back.
let quietTold = null;   // the puzzle (solution key) already told
const back = () => setQuiet(false);
$('explainToggle').onclick = () => {
  setQuiet(true);
  quietTold = task?.solution.join('');
  say('Objašnjenje je skriveno. Vraća se u ⋯ → Objašnjenje u oblačiću.', 6000, ['Vrati', back]);
};
$('explainBtn').onclick = () => setQuiet(!$('explainBox').classList.contains('quiet'));
// Held (not on its button): nearly see-through, to read the cells under it, until the finger lifts,
// wherever it moves meanwhile (captured; touch-action: none keeps the page from scrolling instead).
$('explainBox').onpointerdown = e => {
  if (e.target.closest('button')) return;
  try { $('explainBox').setPointerCapture(e.pointerId); } catch {}   // a pointer already gone
  $('explainBox').classList.add('peek');
};
for (const ev of ['pointerup', 'pointercancel']) $('explainBox').addEventListener(ev, () => $('explainBox').classList.remove('peek'));
try { setQuiet(localStorage.sudokuQuiet === '1'); } catch {}

let hintState = null;   // { h, level } of the step being explained: 1 where to look, 2 why, 3 answer

function clearHint() {
  markStep(null);
  $('explain').textContent = '';
  hintState = null;
  hintLabel(3);
}

// Savjet says what its next press brings (Savjet → Zašto? → Odgovor); while a step is open, dots show how deep.
function hintLabel(level) {
  $('hintLabel').textContent = HINT_NEXT[level];
  if (level < 3) $('hintBtn').dataset.level = level; else delete $('hintBtn').dataset.level;
}

// Handwritten digits on the board? The task button then checks them. → whether there are any.
function entryLabel() {
  const any = inputs.some(x => x.classList.contains('entry'));
  $('setTask').textContent = any ? 'Provjeri moje brojeve' : inputs.every(x => x.value) ? 'Provjeri' : 'Ovo je zadatak';
  $('setTask').disabled = !inputs.some(x => x.value);
  gameHead();
  return any;
}

// Task = the printed digits; handwritten ones are then judged against its solution. If the printed ones
// alone don't make a sudoku, the split was off: all digits are the task.
$('setTask').onclick = () => {
  const g = inputs.map(x => +x.value || 0), mine = inputs.map(x => x.classList.contains('entry'));
  let givens = g.map((d, i) => mine[i] ? 0 : d), sols = mine.some(Boolean) ? solve(givens) : [];
  const check = sols.length === 1 && !!lastProbs;
  if (!check) { givens = g; sols = solve(g); }
  if (!sols.length) return say(g.every(Boolean) ? 'Isti broj dvaput (crveno): krivo pročitano ili greška na papiru.'
    : 'Ovaj sudoku nema rješenja: neki broj je krivo pročitan ili višak. Provjeri žuta i crvena polja.', Infinity);
  if (sols.length > 1) return say('Ima više rješenja: vjerojatno fali neki broj.', Infinity);
  if (toDaily(sols[0])) return;
  task = { givens, solution: sols[0] };
  undo = [];
  learn(givens.map((d, i) => [i, d]).filter(([, d]) => d));
  try { localStorage.sudokuTask = JSON.stringify(task); } catch {}
  inputs.forEach(x => x.classList.remove('low'));
  showTask();
  if (check) return showScan(lastProbs);
  if (g.every(Boolean)) return markConflicts();   // a solved paper whose split missed: the "Riješeno!" card
  say((mine.some(Boolean) ? 'Tiskani brojevi sami nemaju jedno rješenje, pa su svi brojevi uzeti kao zadatak. ' : '') +
    'Zadatak spremljen. Rješavaj na papiru ili ovdje; papir provjeriš kamerom (⋯).');
};

// Highlights of a step in the grid: where to look, and from level 2 on what rules cells out.
// f: the part of a step-by-step "why" on show (h.steps), with its own candidates (notes) and lines.
function markStep(h, level, f = h) {
  inputs.forEach(x => x.classList.remove('hint', 'area', 'focus', 'beam', 'blocker', 'crossed'));
  drawCands();
  $('hintLines').replaceChildren();
  if (!h) return;
  f.area.forEach(j => inputs[j].classList.add('area'));
  f.focus.forEach(j => inputs[j].classList.add('focus'));
  if (level < 3) for (const [i, n] of Object.entries(f.notes || {}))
    candCells[i].replaceChildren(...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => Object.assign(document.createElement('span'),
      { textContent: n.show.includes(d) ? d : '', className: ['k', 'x', 'off'].find(c => n[c]?.includes(d)) || '' })));
  if (level < 3) for (const [ds, cls] of [[f.lines, ''], [f.alt, 'alt']]) for (const d of ds || []) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d); p.setAttribute('pathLength', '1'); if (cls) p.setAttribute('class', cls);
    $('hintLines').append(p);
  }
  if (level < 2) return;
  f.beams.forEach(v => v.cells.forEach(j => inputs[j].classList.add('beam')));
  f.blockers.forEach(j => inputs[j].classList.add('blocker'));
  f.crossed.forEach(j => inputs[j].classList.add('crossed'));
}

// Givens and correct entries; wrong or unsure entries count as empty.
const knownGrid = () => inputs.map((x, i) => task.givens[i] || (+x.value === task.solution[i] ? task.solution[i] : 0));

// "Sljedeći korak" teaches: each press goes one level deeper (where to look → why → answer), then on
// to the next step. Meanwhile the user may type a try (tryMove).
$('hintBtn').onclick = () => {
  if (hintState && hintState.level < 3) { hintState.level++; hintState.sub = 0; }
  else {
    clearHint();
    const g = knownGrid();
    if (g.every(Boolean)) return explainAt('Sve je riješeno!', []);
    const h = hint(g) || reveal(g, task.solution);
    hintState = { h, level: h.tech ? 1 : 3, sub: 0 };
    task.techs ??= {};   // Savjet used in this game (no stuck bubble then); the techniques it showed, for "Riješeno!"
    if (h.tech) task.techs[h.tech.name] = (task.techs[h.tech.name] || 0) + 1;
    saveState();
  }
  showStep();
  hintLabel(hintState.level);
  if ($('explainBox').classList.contains('quiet') && quietTold !== task.solution.join('')) {
    quietTold = task.solution.join('');
    say('Objašnjenje je isključeno: Savjet pokazuje samo oznake na mreži.', 6000, ['Uključi', back]);
  }
};

// The open step on the board and in the bubble. A step-by-step "why" shows its part `sub`; Dalje the next.
function showStep() {
  const { h, level, sub } = hintState, f = level === 2 && h.steps ? h.steps[sub] : h;
  markStep(h, level, f);
  if (level === 3) {
    const inp = inputs[h.cell];
    inp.value = h.digit;
    inp.classList.remove('wrong', 'maybe');
    inp.classList.add('hint', 'ok');
    markConflicts();
  }
  const wrong = inputs.filter(x => x.classList.contains('wrong')).length;
  explainAt((wrong ? `Pazi: ${wrong} polja su kriva (crveno).\n` : '') + (f === h ? hintText(h, level) : f.text),
    level === 3 ? [h.cell] : f.focus.length ? f.focus : f.area,   // keep the area and, from "why" on, the reasons in sight
    level === 1 ? f.area : [...f.area, ...f.focus, ...f.blockers, ...f.blockers, ...f.crossed],   // twice: the reasons matter most
    f === h ? null : [sub, h.steps.length]);
}
$('stepNext').onclick = () => { hintState.sub++; showStep(); };

// The explanation bubble: text, its tail on the main cells, kept clear of the marked ones (avoid).
// No cells: centred, no tail. part: [k, n] while showing part k of n of a step-by-step "why".
let bubbleAt = { main: [], avoid: [] };
function explainAt(text, main, avoid = [], part) {
  $('explain').textContent = text;
  $('explainSteps').hidden = !part;
  if (part) { $('stepCount').textContent = `${part[0] + 1} od ${part[1]}`; $('stepNext').hidden = part[0] === part[1] - 1; }
  bubbleAt = { main, avoid: [...main, ...avoid] };
  placeBubble();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches)   // grows out of its tail
    $('explainBox').animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 150, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
}
// Where the bubble goes: full text, board-wide, at the height that covers the fewest marked cells
// (avoid; the main ones count triple), then the least of the board: under it if it fits before the
// buttons (class below), else reaching into it no further than needed. It may cover the name row
// above the board, never the top bar or the buttons below it. The tail points at the main cells from whichever side
// the bubble ended up on (class up: bubble below them, down: above; free: no cells, or on them).
function placeBubble() {
  const box = $('explainBox'), tail = box.querySelector('.tail'), ex = $('explain'), b = $('board').getBoundingClientRect();
  const H = $('grid').offsetHeight, bar = $('backBtn').getBoundingClientRect();
  if (!ex.textContent || $('game').hidden) return;
  ex.style.maxHeight = '40vh';
  const h = box.offsetHeight, roof = (bar.bottom <= b.top ? bar.bottom + 4 : 8) - b.top;   // roof: under the top bar (phone) or the screen's top
  const span = i => { const r = inputs[i].getBoundingClientRect(); return [r.top - b.top, r.bottom - b.top]; };
  const main = bubbleAt.main.map(span), mT = Math.min(...main.map(s => s[0])), mB = Math.max(...main.map(s => s[1]));
  const ctl = $('tools').getBoundingClientRect(), floor = (ctl.top > b.top + H ? ctl.top : innerHeight) - b.top - 8;   // the buttons under the board, or the screen's bottom
  // Marked cells covered cost most, then any of the board (with the gap under it) covered, so it sinks
  // under the board as far as it fits, then distance from the main cells.
  const cost = top => bubbleAt.avoid.reduce((c, i) => { const [t, btm] = span(i); return c + (t < top + h && btm > top ? (bubbleAt.main.includes(i) ? 3 : 1) : 0); }, 0) * 1e4
    + Math.max(0, Math.min(H + 8, top + h) - Math.max(0, top)) + (main.length ? Math.max(top - mB, mT - (top + h), 0) / 1e3 : 0);
  let best = roof;
  for (let top = roof; top <= floor - h; top++) if (cost(top) < cost(best)) best = top;
  const near = H / 9;   // a tail only reaches cells about a row away
  const side = best >= H ? 'below' : !main.length ? 'free' : best >= mB - 2 && best - mB < near ? 'up' : best + h <= mT + 2 && mT - best - h < near ? 'down' : 'free';
  box.classList.remove('up', 'down', 'free', 'below');
  box.classList.add(side);
  box.style.top = best + 'px';
  const r = bubbleAt.main.map(i => inputs[i].getBoundingClientRect()), cx = r.length ? (Math.min(...r.map(x => x.left)) + Math.max(...r.map(x => x.right))) / 2 - b.left : b.width / 2;
  tail.style.left = Math.min(Math.max(cx - box.offsetLeft - 8, 14), box.offsetWidth - 30) + 'px';
  box.style.transformOrigin = `${cx - box.offsetLeft}px ${side === 'down' ? '100%' : 0}`;
}
addEventListener('resize', placeBubble);

// A digit typed while a step is being explained is the user's try: say why it is right or wrong.
function tryMove(k, d) {
  const g = knownGrid(), inp = inputs[k];
  g[k] = 0;
  const res = judgeMove(g, k, d, task.solution);
  markStep(res.step, 2);
  if (res.conflict !== undefined) inputs[res.conflict].classList.add('blocker');
  inp.classList.remove('ok', 'wrong', 'maybe');
  inp.classList.add(res.ok ? 'ok' : 'wrong');
  if (res.ok && k === hintState.h.cell) { inp.classList.add('hint'); hintState.level = 3; }
  else if (res.ok) hintState = null;   // another right move: the next press looks for the next step
  const s = res.step;
  explainAt(res.text + (res.ok ? '' : '\nObriši broj i pokušaj ponovno.'), [k],
    [...(s ? [...s.area, ...s.focus, ...s.blockers, ...s.crossed] : []), ...(res.conflict !== undefined ? [res.conflict] : [])]);
  hintLabel(hintState?.level ?? 3);
}

$('solveBtn').onclick = () => {
  clearHint();
  celebrated = task.solution.join('');   // shown, not solved: no "Riješeno!"
  task.solvedAt ??= Date.now();   // a game's clock stops
  inputs.forEach((x, i) => {
    if (task.givens[i]) return;
    x.value = task.solution[i];
    x.classList.remove('wrong', 'maybe');
    x.classList.add('ok');
  });
  markConflicts();
};

// --- History: every sudoku worked on, one entry per puzzle (its solution is the key, so a puzzle scanned
// again is the same entry), last used first. Entry: { key, givens, done: right digits of the user,
// both 81-digit strings, diff: 0-100, first, last: ms, daily: its date, time: ms it took (daily) }. ---
const HISTORY_MAX = 100;
function saved() {
  try { return JSON.parse(localStorage.sudokuHistory || '[]'); } catch { return []; }
}
// Same puzzle again → merged: fewer givens win (the truly printed ones), right digits add up. → entry
function remember(solution, givens, done, extra = {}) {
  const key = solution.join(''), list = saved(), old = list.find(e => e.key === key);
  const e = old || { key, givens: givens.join(''), done: '0'.repeat(81), first: Date.now() };
  if (givens.filter(Boolean).length < [...e.givens].filter(d => +d).length) { e.givens = givens.join(''); delete e.diff; }
  e.diff ??= difficulty([...e.givens].map(Number), solution);
  e.done = [...e.done].map((d, i) => +e.givens[i] ? 0 : +d || done[i] || 0).join('');
  e.last = Date.now();
  Object.assign(e, extra);
  try { localStorage.sudokuHistory = JSON.stringify([e, ...list.filter(x => x !== old)].slice(0, HISTORY_MAX)); } catch {}
  return e;
}

// One sudoku as a row: mini grid, progress, date, level; a tap opens it.
function historyItem(e) {
  const li = document.createElement('li'), open = document.createElement('button');
  const blanks = [...e.givens].filter(d => !+d).length, done = [...e.done].filter(d => +d).length;
  open.className = 'hrow';
  open.append(miniGrid(e), Object.assign(document.createElement('span'), { className: 'hmeta' }));
  open.lastChild.append(Object.assign(document.createElement('b'), done === blanks ? { textContent: e.time ? `Riješeno za ${clock(e.time)} ✓` : 'Riješeno ✓', className: 'solved' } : { textContent: `${done} od ${blanks} polja` }),
    Object.assign(document.createElement('small'), { textContent: (e.daily ? `Dnevni ${DAILY[e.level]?.[0].toLowerCase() ?? ''} · ` : e.random ? 'Nova igra · ' : '') + new Date(e.last).toLocaleString('hr', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      + (e.diff === undefined ? '' : ` · ${diffLevel(e.diff)[1]}`) }));
  open.onclick = () => openTask(e);
  li.append(open);
  return li;
}

function showHistory() {
  const list = saved();
  $('historyList').replaceChildren(...list.map(e => {
    const li = historyItem(e), del = document.createElement('button');
    del.className = 'hdel'; del.textContent = 'Obriši';
    del.onclick = () => {
      try { localStorage.sudokuHistory = JSON.stringify(saved().filter(x => x.key !== e.key)); } catch {}
      showHistory();
    };
    li.append(del);
    return li;
  }));
  $('historyEmpty').hidden = list.length > 0;
}

// The menu: the unfinished game on the board ("Nastavi"), today's dailies, the last two other sudokus.
function showMenu() {
  loadDays();
  $('homeDays').replaceChildren(...DAILY.map(([name], i) => {
    const s = document.createElement('span');
    s.append(Object.assign(document.createElement('span'), { className: 'dot', style: `background: var(${LEVELS[i][2]})` }), name,
      Object.assign(document.createElement('small'), { textContent: levelText(days.levels[i]) }));
    return s;
  }));
  const key = task && celebrated !== task.solution.join('') ? task.solution.join('') : null;   // solved (or "Riješi sve"): nothing to go on with
  $('homeResume').hidden = !key;
  if (key) {
    const done = inputs.map((x, i) => task.givens[i] ? 0 : +x.value || 0), blanks = task.givens.filter(d => !d).length;
    const level = task.daily || task.random ? LEVELS[task.level][1] : diffLevel(saved().find(e => e.key === key)?.diff ?? difficulty(task.givens, task.solution))[1];
    $('homeResume').firstChild.replaceWith(miniGrid({ givens: task.givens.join(''), done: done.join('') }));
    $('resumeText').textContent = [gameKind(), level, `${done.filter(Boolean).length} od ${blanks}`, ...task.daily || task.random ? [clock(state().elapsed)] : []].join(' · ');
  }
  const list = saved(), recent = list.filter(e => e.key !== key).slice(0, 2);
  $('recent').replaceChildren(...recent.map(historyItem));
  $('recentTitle').hidden = !recent.length;
  $('historyAll').hidden = !list.length;
  $('historyAll').firstChild.textContent = `Sva povijest (${list.length})`;
  ranksOff = 0;
  showRanks();
}
$('homeResume').onclick = () => task.daily === dayKey() ? openDaily(task.level) : go('game');   // today's daily: its card, the clock waits for it
$('homeDaily').onclick = () => openDaily();
$('manualBtn').onclick = () => { clearBoard(); go('game'); };
$('aboutBtn').onclick = () => { $('aboutName').value = lbName(); $('about').showModal(); };
$('aboutClose').onclick = () => $('about').close();

// ‹ Izbornik: the game stays (saved, and "Nastavi" brings it back). A sudoku still being typed in or
// checked has no task yet: it is dropped, and the saved game comes back on the board.
$('backBtn').onclick = () => {
  pick(null);
  if (!task) { clearBoard(); loadSaved(); }
  go('menu');
};

// ⋯: a bottom sheet. Esc or a tap on the dimmed page closes it (the dialog itself is the backdrop: it has no padding).
$('moreBtn').onclick = () => $('more').showModal();
$('more').onclick = e => e.target === $('more') && $('more').close();
// Dragged down it follows the finger (upward only with friction); far or fast enough, it closes, else it
// snaps back. Only the first finger counts; a move under 8 px is still a tap on an item.
let drag = null;   // { id: pointer, y, t: start, dy, on: dragging }
const sheet = document.querySelector('.sheet');
sheet.onpointerdown = e => { drag ??= { id: e.pointerId, y: e.clientY, t: e.timeStamp, dy: 0, on: false }; };
sheet.onpointermove = e => {
  if (drag?.id !== e.pointerId) return;
  const dy = e.clientY - drag.y;
  if (!drag.on && Math.abs(dy) < 8) return;
  if (!drag.on) { drag.on = true; sheet.setPointerCapture(e.pointerId); $('more').style.transition = 'none'; }
  drag.dy = dy;
  $('more').style.transform = `translateY(${dy > 0 ? dy : dy / 5}px)`;
};
sheet.onpointerup = sheet.onpointercancel = e => {
  if (drag?.id !== e.pointerId) return;
  const d = drag;
  drag = null;
  if (!d.on) return;
  $('more').style.transition = $('more').style.transform = '';   // from where the finger left it: closing or back
  if (d.dy > 80 || d.dy > 20 && d.dy / (e.timeStamp - d.t) > 0.11) $('more').close();   // 0.11 px/ms: a flick is enough
};
$('paperBtn').onclick = () => { $('more').close(); $('liveBtn').onclick(); };
// "Počni ispočetka": the user's digits and notes off this sudoku; the task, its clock and the history stay.
$('restartBtn').onclick = () => {
  $('more').close();
  clearHint();
  pick(null);
  inputs.forEach((x, i) => { if (!task.givens[i]) { x.value = ''; x.className = ''; } });
  notes = notes.map(() => []);
  undo = [];
  markConflicts();
};

// The puzzle at a glance: printed digits as dark cells, the user's right digits in blue.
function miniGrid(e) {
  const c = document.createElement('canvas'), x = c.getContext('2d'), u = 8;
  c.width = c.height = 9 * u + 2;
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 81; i++) {
    if (!+e.givens[i] && !+e.done[i]) continue;
    x.fillStyle = +e.givens[i] ? '#3a3a38' : '#1d5fbf';
    x.fillRect(1 + i % 9 * u + 1, 1 + (i / 9 | 0) * u + 1, u - 2, u - 2);
  }
  x.strokeStyle = '#121212'; x.lineWidth = 1;
  for (let j = 0; j <= 9; j += 3) {
    x.beginPath(); x.moveTo(1 + j * u, 0); x.lineTo(1 + j * u, c.height); x.moveTo(0, 1 + j * u); x.lineTo(c.width, 1 + j * u); x.stroke();
  }
  return c;
}

// A sudoku from the history becomes the task again, with the user's right digits filled in.
function openTask(e) {
  if (e.daily === dayKey()) return openDaily(e.level ?? 0);   // today's stays solo; older dailies open as practice, with help
  const solved = [...e.givens].every((g, i) => +g || +e.done[i]);
  task = { givens: [...e.givens].map(Number), solution: [...e.key].map(Number) };
  if (e.random) Object.assign(task, { random: true, level: e.level, elapsed: e.time ?? 0 }, solved ? { solvedAt: e.last } : {});   // a game: its clock goes on
  clearHint();
  lastProbs = null;
  lastVecs = Array.from({ length: 81 }, () => []);
  restore({ values: e.done });
  celebrated = solved ? e.key : null;   // reopening a solved one is no new success
  showTask();
  markConflicts();
  go('game');
}

$('historyAll').onclick = () => go('past');

// The board empty and no task, to scan or type one in. Only in memory: the saved game stays for "Nastavi".
function clearBoard() {
  task = null;
  clearHint();
  lastProbs = null;
  lastVecs = Array.from({ length: 81 }, () => []);
  inputs.forEach(x => { x.value = ''; x.className = ''; });
  notes = notes.map(() => []);
  undo = [];
  showTask();
  markConflicts();
}

// The saved task back on the board, as it was left. Today's daily from its day; one from an earlier
// day goes on as an ordinary task.
function loadSaved() {
  try { task = JSON.parse(localStorage.sudokuTask || 'null'); } catch { task = null; }
  idle = 0;
  if (task?.daily === dayKey() && loadDays().levels[task.level]) return playDaily(task.level);
  if (!task) return showTask();
  delete task.daily;
  restore(task);
  celebrated = task.solvedAt || inputs.every((x, i) => (+x.value || task.givens[i]) === task.solution[i]) ? task.solution.join('') : null;
  showTask();
  markConflicts();
}

// --- Sudoku logic. Grid = array of 81 numbers, 0 = empty. ---

const BOX_NAME = ['gornji lijevi', 'gornji srednji', 'gornji desni', 'srednji lijevi', 'središnji', 'srednji desni',
  'donji lijevi', 'donji srednji', 'donji desni'];
const BOX_LOC = ['gornjem lijevom', 'gornjem srednjem', 'gornjem desnom', 'srednjem lijevom', 'središnjem',
  'srednjem desnom', 'donjem lijevom', 'donjem srednjem', 'donjem desnom'];
const ROWS = [], COLS = [], BOXES = [];
for (let k = 0; k < 9; k++) {
  const idx = f => Array.from({ length: 9 }, (_, j) => f(j));
  ROWS.push({ kind: 'row', name: `red ${k + 1}`, loc: `redu ${k + 1}`, cells: idx(j => k * 9 + j) });
  COLS.push({ kind: 'col', name: `stupac ${k + 1}`, loc: `stupcu ${k + 1}`, cells: idx(j => j * 9 + k) });
  BOXES.push({ kind: 'box', name: `${BOX_NAME[k]} kvadrat`, loc: `${BOX_LOC[k]} kvadratu`, cells: idx(j => (k / 3 | 0) * 27 + k % 3 * 3 + (j / 3 | 0) * 9 + j % 3) });
}
const UNITS = [...BOXES, ...ROWS, ...COLS];   // hint search order: boxes are easiest to spot
const PEERS = Array.from({ length: 81 }, (_, i) => [...new Set(UNITS.filter(u => u.cells.includes(i)).flatMap(u => u.cells))].filter(j => j !== i));
const cellName = i => `polje (red ${(i / 9 | 0) + 1}, stupac ${i % 9 + 1})`;

// ex: candidates ruled out by an advanced step, as cell * 10 + digit.
function candidates(g, i, ex) {
  if (g[i]) return [];
  const used = new Set(PEERS[i].map(j => g[j]));
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => !used.has(d) && !ex?.has(i * 10 + d));
}

// Backtracking, fewest-candidates cell first. Returns up to `limit` solutions (2 = enough to detect "not unique").
function solve(g, limit = 2) {
  const a = g.slice(), sols = [];
  if (a.some((d, i) => d && PEERS[i].some(j => a[j] === d))) return sols;
  (function rec() {
    let best = -1, bc;
    for (let i = 0; i < 81; i++) if (!a[i]) {
      const c = candidates(a, i);
      if (!c.length) return;
      if (best < 0 || c.length < bc.length) { best = i; bc = c; }
    }
    if (best < 0) return sols.push(a.slice());
    for (const d of bc) { a[best] = d; rec(); if (sols.length >= limit) break; }
    a[best] = 0;
  })();
  return sols;
}

const TECH = {
  full: { name: 'Zadnje prazno polje', en: 'Full House',
    how: 'Kad u kvadratu, redu ili stupcu ostane samo jedno prazno polje, u njega ide broj koji tamo još fali.' },
  hidden: { name: 'Jedino mjesto', en: 'Hidden Single',
    how: 'Uzmi broj koji fali u kvadratu (ili redu, stupcu). Precrtaj polja čiji red, stupac ili kvadrat već ima taj broj. Ako ostane samo jedno polje, broj ide tamo.' },
  naked: { name: 'Jedini broj', en: 'Naked Single',
    how: 'Izaberi polje oko kojeg ima puno brojeva. Skupi brojeve iz njegovog reda, stupca i kvadrata. Ako je to 8 različitih brojeva, deveti je odgovor.' },
  pointing: { name: 'Pokazivački par', en: 'Pointing',
    how: 'Ako u kvadratu neki broj može ići samo u jedan red (ili stupac), taj broj iz kvadrata sigurno zauzima taj red. Zato ga u ostatku tog reda precrtaj, pa potraži jedino mjesto ili jedini broj.' },
  claiming: { name: 'Red u kvadratu', en: 'Claiming',
    how: 'Ako u redu (ili stupcu) neki broj može ići samo u polja jednog kvadrata, taj broj sigurno stoji u tom kvadratu. Zato ga u ostatku kvadrata precrtaj, pa potraži jedino mjesto ili jedini broj.' },
  pair: { name: 'Goli par', en: 'Naked Pair',
    how: 'Ako dva polja u istom redu, stupcu ili kvadratu mogu imati samo ista dva broja, ta dva broja pripadaju njima. Iz ostalih polja tog reda, stupca ili kvadrata ih precrtaj, pa potraži jedino mjesto ili jedini broj.' },
  hiddenPair: { name: 'Skriveni par', en: 'Hidden Pair',
    how: 'Ako dva broja u redu, stupcu ili kvadratu mogu ići samo u ista dva polja, ta dva polja pripadaju njima. U njima precrtaj sve ostale brojeve, pa potraži jedino mjesto ili jedini broj.' },
  xWing: { name: 'Pravokutnik', en: 'X-Wing',
    how: 'Ako neki broj u dva reda može ići samo u ista dva stupca, ta četiri polja čine pravokutnik. Broj tada sigurno zauzima oba stupca, pa ga u ostatku tih stupaca precrtaj (isto vrijedi za dva stupca i dva reda). Zatim potraži jedino mjesto ili jedini broj.' },
  yWing: { name: 'Kliješta', en: 'Y-Wing',
    how: 'Polje s dva broja (A ili B) je drška. Dva polja koja ona vidi, jedno s A ili C i drugo s B ili C, su krakovi. Jedan krak sigurno je C, pa C precrtaj iz svih polja koja vide oba kraka. Zatim potraži jedino mjesto ili jedini broj.' },
};
// Dailies before this date were made without Claiming, Hidden Pair, X-Wing and Y-Wing: same puzzle for that date on every version.
const NEW_TECH = '2026-10-29';
const HINT_NEXT = { 1: 'Zašto?', 2: 'Odgovor', 3: 'Savjet' };

// How hard a puzzle is for a person, 0-100: solve it with the hints' own techniques, easiest first.
// The hardest technique needed sets the band (null: beyond them, the cell is revealed). Within it:
// fewer givens is harder (36 → bottom, 22 → top), and from naked singles up also how often the
// hardest technique was needed.
// A band may hold sister techniques (one row/column ↔ one box; naked ↔ hidden pair; the wings only replace
// reveals): the bands, and so every earlier difficulty, stay as they were. old: without the techniques
// added on NEW_TECH (an earlier day's daily).
const BANDS = [[[TECH.full], 0], [[TECH.hidden], 10], [[TECH.naked], 30], [[TECH.pointing, TECH.claiming], 55],
  [[TECH.pair, TECH.hiddenPair, TECH.xWing, TECH.yWing], 65], [[null], 80]];
function difficulty(givens, solution, old) {
  const g = givens.slice();
  let hardest = 0, n = 0;
  while (g.some(d => !d)) {
    const h = hint(g, old) || reveal(g, solution), k = BANDS.findIndex(([t]) => t.includes(h.tech));
    if (k > hardest) { hardest = k; n = 0; }
    if (k === hardest) n++;
    g[h.cell] = h.digit;
  }
  const lo = BANDS[hardest][1], hi = (BANDS[hardest + 1]?.[1] ?? 100) - 1;   // top of a band stays in it
  const few = Math.min(1, Math.max(0, (36 - givens.filter(Boolean).length) / 14));
  return Math.round(lo + (hi - lo) * (hardest <= 1 ? few : (few + Math.min(1, n / 8)) / 2));
}
const LEVELS = [[30, 'Lagano', '--easy'], [55, 'Srednje', '--medium'], [80, 'Teško', '--hard'], [101, 'Vrlo teško', '--expert']];
const diffLevel = pct => LEVELS.find(([top]) => pct < top);

// The pill: "Težina [████░░░] 42% · Srednje", filled in the band's colour.
function diffPill(el, pct) {
  const [, name, color] = diffLevel(pct);
  el.style.setProperty('--band', `var(${color})`);
  el.replaceChildren(Object.assign(document.createElement('span'), { textContent: 'Težina' }),
    Object.assign(document.createElement('span'), { className: 'dtrack' }), Object.assign(document.createElement('b'), { textContent: `${pct}% · ${name}` }));
  el.children[1].append(Object.assign(document.createElement('span'), { className: 'dfill', style: `width: ${Math.max(pct, 4)}%` }));
  el.setAttribute('aria-label', `Težina ${pct} posto, ${name}`);
  el.hidden = false;
}
const cap = s => s[0].toUpperCase() + s.slice(1);

// Human steps. Each returns what a teacher would point at: area/focus (where to look), blockers (digits
// that rule cells out), beams (their row/column/box), crossed (empty cells ruled out), and texts:
// look, why, answer. null if the technique doesn't apply there.
const missing = (g, u) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(d => !u.cells.some(i => g[i] === d));

function fullHouse(g, u) {
  const empty = u.cells.filter(i => !g[i]);
  if (empty.length !== 1) return null;
  const t = empty[0], d = missing(g, u)[0];
  return { cell: t, digit: d, unit: u, tech: TECH.full, area: u.cells, focus: [], blockers: [], beams: [], crossed: [],
    look: `Pogledaj ${u.name}. Koliko je praznih polja ostalo?`,
    why: `U ${u.loc} je ostalo samo jedno prazno polje, a od brojeva 1–9 fali još samo ${d}.`,
    answer: `Zato u ${cellName(t)} ide ${d}.` };
}

function hiddenSingle(g, u, d, ex) {
  if (u.cells.some(i => g[i] === d)) return null;
  const empty = u.cells.filter(i => !g[i]), spots = empty.filter(i => candidates(g, i, ex).includes(d));
  if (spots.length !== 1) return null;
  const t = spots[0], crossed = empty.filter(i => i !== t), beams = new Map(), gone = [];   // blocking unit → cell holding d
  for (const i of crossed) {
    const v = UNITS.find(v => v !== u && v.cells.includes(i) && v.cells.some(j => g[j] === d));
    if (v) beams.set(v, v.cells.find(j => g[j] === d)); else gone.push(i);   // gone: ruled out by the advanced step
  }
  const where = (v, j) => v.kind === 'row' ? `stupac ${j % 9 + 1}` : v.kind === 'col' ? `red ${(j / 9 | 0) + 1}` : `red ${(j / 9 | 0) + 1}, stupac ${j % 9 + 1}`;
  const lines = [...beams].map(([v, j]) =>
    `• ${d} u ${v.loc} (${where(v, j)}) → ${v.kind === 'box' ? 'taj kvadrat otpada' : `cijeli ${v.name} otpada`}.`);
  if (gone.length) lines.push(`• ${cap(gone.map(cellName).join(' i '))} → otpada (vidi gore).`);
  return { cell: t, digit: d, unit: u, tech: TECH.hidden, area: u.cells, focus: [], blockers: [...new Set(beams.values())], beams: [...beams.keys()], crossed,
    look: `Pogledaj ${u.name}. U njemu još fali ${d}. Gdje sve ${d} može ići?`,
    why: `Precrtaj polja u kojima ${d} ne može biti:\n${lines.join('\n')}\nOstaje samo jedno slobodno polje.`,
    answer: `Zato ${d} ide u ${cellName(t)}.` };
}

function nakedSingle(g, i, ex) {
  const c = candidates(g, i, ex), gone = candidates(g, i).filter(d => !c.includes(d));
  if (c.length !== 1) return null;
  const row = ROWS[i / 9 | 0], col = COLS[i % 9], box = BOXES.find(u => u.cells.includes(i)), blockers = [];
  for (let x = 1; x <= 9; x++) {   // one cell per ruled-out digit, row first
    const j = [row, col, box].map(u => u.cells.find(j => g[j] === x)).find(j => j !== undefined);
    if (j !== undefined) blockers.push(j);
  }
  const has = u => u.cells.map(j => g[j]).filter(Boolean).sort().join(', ') || 'ništa';
  const all = [...new Set(PEERS[i].map(j => g[j]).filter(Boolean))].sort();
  return { cell: i, digit: c[0], tech: TECH.naked, area: PEERS[i], focus: [i], blockers, beams: [], crossed: [],
    look: `Pogledaj ${cellName(i)}. Koji su brojevi već u njegovom redu, stupcu i kvadratu?`,
    why: `${cap(row.name)}: ${has(row)}\n${cap(col.name)}: ${has(col)}\n${cap(box.name)}: ${has(box)}\nZajedno: ${all.join(', ')}. ` +
      (gone.length ? `Uz to ovdje ne može ni ${gone.join(' ni ')} (vidi gore). Ostaje samo ${c[0]}.` : `To je 8 različitih brojeva, fali samo ${c[0]}.`),
    answer: `Zato u ${cellName(i)} ide ${c[0]}.` };
}

// Advanced steps place nothing themselves: they rule out candidates, then a single follows.
// → [{ tech, area, focus, removed: [[cell, digit]], look, why }]
function eliminations(g, old) {
  const out = [];
  const add = e => e.removed.length && out.push(e);
  for (const box of BOXES) for (const d of missing(g, box)) {   // pointing: d of a box only in one row/column
    const spots = box.cells.filter(i => candidates(g, i).includes(d));
    if (spots.length < 2) continue;
    for (const line of [...ROWS, ...COLS]) {
      if (!spots.every(i => line.cells.includes(i))) continue;
      const removed = line.cells.filter(i => !box.cells.includes(i) && candidates(g, i).includes(d));
      if (removed.length) out.push({ tech: TECH.pointing, area: box.cells, focus: spots, removed: removed.map(i => [i, d]),
        look: `Pogledaj ${box.name}. Gdje sve u njemu može ići ${d}?`,
        why: `U ${box.loc} ${d} može ići samo u ${line.loc} (plava polja). Taj ${d} sigurno zauzima ${line.name}, pa ${d} ne može nigdje drugdje u ${line.loc} (izvan tog kvadrata).` });
    }
  }
  if (!old) for (const line of [...ROWS, ...COLS]) for (const d of missing(g, line)) {   // claiming: d of a row/column only in one box
    const spots = line.cells.filter(i => candidates(g, i).includes(d)), box = BOXES.find(b => spots.every(i => b.cells.includes(i)));
    if (spots.length < 2 || !box) continue;
    add({ tech: TECH.claiming, area: line.cells, focus: spots,
      removed: box.cells.filter(i => !line.cells.includes(i) && candidates(g, i).includes(d)).map(i => [i, d]),
      look: `Pogledaj ${line.name}. Gdje sve u njemu može ići ${d}?`,
      why: `U ${line.loc} ${d} može ići samo u polja u ${box.loc} (plava polja). Taj ${d} zato sigurno stoji u tom kvadratu, pa ${d} ne može nigdje drugdje u ${box.loc} (izvan ${line.kind === 'row' ? 'tog reda' : 'tog stupca'}).` });
  }
  for (const u of UNITS) {   // naked pair: two cells of a unit with the same two candidates
    const two = u.cells.filter(i => candidates(g, i).length === 2);
    for (const a of two) for (const b of two) {
      const pair = candidates(g, a);
      if (b <= a || pair.join() !== candidates(g, b).join()) continue;
      const removed = u.cells.filter(i => i !== a && i !== b).flatMap(i => pair.filter(d => candidates(g, i).includes(d)).map(d => [i, d]));
      if (removed.length) out.push({ tech: TECH.pair, area: u.cells, focus: [a, b], removed,
        look: `Pogledaj ${u.name}. Nađi dva polja u kojima mogu biti samo ista dva broja.`,
        why: `${cap(cellName(a))} i ${cellName(b)} mogu imati samo ${pair[0]} ili ${pair[1]}. Ta dva broja sigurno zauzimaju ta dva polja, pa ${pair[0]} i ${pair[1]} ne mogu nigdje drugdje u ${u.loc}.` });
    }
  }
  if (!old) for (const u of UNITS) {   // hidden pair: two digits of a unit that fit only the same two cells
    const spots = d => u.cells.filter(i => candidates(g, i).includes(d)), ds = missing(g, u);
    for (const x of ds) for (const y of ds) {
      const [a, b] = spots(x);
      if (y <= x || b === undefined || spots(x).length !== 2 || spots(y).join() !== [a, b].join()) continue;
      const removed = [a, b].flatMap(i => candidates(g, i).filter(d => d !== x && d !== y).map(d => [i, d]));
      add({ tech: TECH.hiddenPair, area: u.cells, focus: [a, b], removed,
        look: `Pogledaj ${u.name}. Nađi dva broja koja mogu ići samo u ista dva polja.`,
        why: `U ${u.loc} ${x} i ${y} mogu ići samo u ${cellName(a)} i ${cellName(b)} (plava polja). Ta dva polja zato pripadaju njima, pa u njima ne može ništa drugo (${[...new Set(removed.map(([, d]) => d))].join(', ')} otpada).` });
    }
  }
  if (old) return out;
  const C = Array.from({ length: 81 }, (_, i) => candidates(g, i));
  for (const [bases, covers] of [[ROWS, COLS], [COLS, ROWS]]) for (let d = 1; d <= 9; d++) {   // X-wing: d of two rows only in the same two columns (or the other way)
    const two = bases.map(u => ({ u, s: u.cells.filter(i => C[i].includes(d)) })).filter(x => x.s.length === 2);
    for (const [k, p] of two.entries()) for (const q of two.slice(k + 1)) {
      const cov = p.s.map(i => covers.find(c => c.cells.includes(i)));
      if (q.s.some((i, j) => !cov[j].cells.includes(i))) continue;
      const removed = cov.flatMap(c => c.cells.filter(i => !p.s.includes(i) && !q.s.includes(i) && C[i].includes(d))).map(i => [i, d]);
      if (removed.length) out.push(xWing(d, p.u, q.u, cov, [...p.s, ...q.s], removed));
    }
  }
  for (let p = 0; p < 81; p++) {   // Y-wing: pivot a|b, wings a|c and b|c it sees → c off cells seeing both wings
    if (C[p].length !== 2) continue;
    const [a, b] = C[p], twos = PEERS[p].filter(i => C[i].length === 2);
    for (const A of twos) for (const B of twos) {
      const c = C[A].find(x => x !== a);
      if (!C[A].includes(a) || C[A].includes(b) || !C[B].includes(b) || !C[B].includes(c)) continue;
      const removed = PEERS[A].filter(i => i !== B && PEERS[B].includes(i) && C[i].includes(c)).map(i => [i, c]);
      if (removed.length) out.push(yWing(C, p, A, B, a, b, c, removed));
    }
  }
  return out;
}

// Lines over the board, in a 90×90 box (10 a cell): a cell's centre, the spot of candidate d in it,
// a line from p to q with both ends pulled in (bow: bent sideways, past the digits between), a closed shape.
const ctr = i => [i % 9 * 10 + 5, (i / 9 | 0) * 10 + 5];
const spot = (i, d) => [i % 9 * 10 + (d - 1) % 3 * 10 / 3 + 5 / 3, (i / 9 | 0) * 10 + ((d - 1) / 3 | 0) * 10 / 3 + 5 / 3];
const xy = ([x, y]) => `${+x.toFixed(2)} ${+y.toFixed(2)}`;
function line(p, q, pull, bow = 0) {
  const l = Math.hypot(q[0] - p[0], q[1] - p[1]), ux = (q[0] - p[0]) / l, uy = (q[1] - p[1]) / l;
  const a = [p[0] + ux * pull, p[1] + uy * pull], b = [q[0] - ux * pull, q[1] - uy * pull];
  return `M${xy(a)} ` + (bow ? `Q${xy([(p[0] + q[0]) / 2 + uy * bow, (p[1] + q[1]) / 2 - ux * bow])} ` : 'L') + xy(b);
}
const shape = ps => `M${ps.map(xy).join(' L')} Z`;

// The wings explain step by step (steps: what the bubble shows on each Dalje, with its own marks).
// notes: { cell: { show: digits, k: pointed at, x: ruled out, off: set aside } }
function xWing(d, b1, b2, [c1, c2], corners, removed) {
  const [p1, p2, q1, q2] = corners, both = [...b1.cells, ...b2.cells], two = b1.kind === 'row' ? 'dva reda' : 'dva stupca';
  const notes = (k, off = []) => Object.fromEntries([...k.map(i => [i, { show: [d], k: [d] }]), ...off.map(i => [i, { show: [d], off: [d] }])]);
  const d1 = line(spot(p1, d), spot(q2, d), 1.6), d2 = line(spot(p2, d), spot(q1, d), 1.6);
  const steps = [
    { area: b1.cells, focus: [p1, p2], notes: notes([p1, p2]),
      text: `U ${b1.loc} broj ${d} može ići samo u dva polja: u ${c1.name} ili ${c2.name} (plava polja).` },
    { area: both, focus: corners, notes: notes(corners), text: `U ${b2.loc} isto: ${d} može ići samo u ${c1.name} ili ${c2.name}.` },
    { area: both, focus: corners, notes: notes(corners), lines: [shape([p1, p2, q2, q1].map(i => spot(i, d)))],
      text: `Ta četiri polja čine pravokutnik. I u ${b1.loc} i u ${b2.loc} broj ${d} mora stati u jedan od njegovih kutova.` },
    { area: both, focus: corners, notes: notes([p1, q2], [p2, q1]), lines: [d1],
      text: `Ako je ${d} u ${b1.loc} u ${c1.loc}, onda u ${b2.loc} ne može u ${c1.name}. Ide u ${c2.name} (puna crta).` },
    { area: both, focus: corners, notes: notes([p2, q1], [p1, q2]), alt: [d2],
      text: `Ako je ${d} u ${b1.loc} u ${c2.loc}, onda u ${b2.loc} ide u ${c1.name} (isprekidana crta).` },
    { area: [...c1.cells, ...c2.cells], focus: corners, notes: { ...notes(corners), ...Object.fromEntries(removed.map(([i]) => [i, { show: [d], x: [d] }])) },
      lines: [d1], alt: [d2],
      text: `Kako god, ${d} iz ta ${two} zauzima i ${c1.name} i ${c2.name}. Zato ${d} ne može nigdje drugdje u ${c1.loc} ni u ${c2.loc}: precrtaj ga (crveno).` },
  ];
  return { tech: TECH.xWing, area: both, focus: [], removed, steps, look: `Pogledaj ${b1.name} i ${b2.name}. Gdje sve u njima može ići ${d}?`,
    why: steps.map(s => s.text).join('\n') };
}

function yWing(C, p, A, B, a, b, c, removed) {
  const seen = i => (i / 9 | 0) === (p / 9 | 0) ? 'isti red' : i % 9 === p % 9 ? 'isti stupac' : 'isti kvadrat';
  const far = i => seen(i) !== 'isti kvadrat' && Math.abs(i - p) > (seen(i) === 'isti red' ? 1 : 9);   // a straight line would cross digits
  const arm = i => line(ctr(p), ctr(i), 3, far(i) ? -8 : 0), arms = [arm(A), arm(B)];
  const n = (i, k = [], off = []) => ({ show: C[i], k, off }), x = removed.map(([i]) => i);
  const notes = { [p]: n(p), [A]: n(A), [B]: n(B) };
  const steps = [
    { focus: [p], notes: { ...notes, [p]: n(p, [a, b]) }, text: `${cap(cellName(p))} može biti samo ${a} ili ${b}. To je drška kliješta.` },
    { focus: [p, A], notes: { ...notes, [A]: n(A, [a, c]) }, lines: [arms[0]],
      text: `${cap(cellName(A))} vidi dršku (${seen(A)}) i može biti samo ${a} ili ${c}.` },
    { focus: [p, A, B], notes: { ...notes, [B]: n(B, [b, c]) }, lines: arms,
      text: `${cap(cellName(B))} isto vidi dršku (${seen(B)}) i može biti samo ${b} ili ${c}. To su dva kraka.` },
    { focus: [p, A], notes: { ...notes, [p]: n(p, [a], [b]), [A]: n(A, [c], [a]) }, lines: [arms[0]],
      text: `Ako je drška ${a}: ${cellName(A)} ne može biti ${a}, pa je ${c}.` },
    { focus: [p, B], notes: { ...notes, [p]: n(p, [b], [a]), [B]: n(B, [c], [b]) }, lines: [arms[1]],
      text: `Ako je drška ${b}: ${cellName(B)} ne može biti ${b}, pa je ${c}.` },
    { focus: [p, A, B], notes: { ...notes, [A]: n(A, [c]), [B]: n(B, [c]) }, lines: arms,
      text: `Drška je ${a} ili ${b}, pa je barem jedan krak sigurno ${c}. Samo ne znamo koji.` },
    { focus: [A, B], notes: { [A]: n(A, [c]), [B]: n(B, [c]), ...Object.fromEntries(x.map(i => [i, { show: C[i], x: [c] }])) }, lines: arms,
      text: x.length === 1 ? `${cap(cellName(x[0]))} vidi oba kraka, pa ne može biti ${c} (crveno).`
        : `${cap(x.map(cellName).join(' i '))} vide oba kraka, pa ne mogu biti ${c} (crveno).` },
  ];
  return { tech: TECH.yWing, area: [], focus: [p, A, B], removed, steps, notes,
    look: 'Pogledaj tri plava polja. U svakom mogu biti samo dva broja. Što je zajedničko krajnjim dvama?',
    why: steps.map(s => s.text).join('\n') };
}

// An advanced step plus the single it opens up (only for `cell`, if given). → step or null.
// ponytail: one elimination per step; chains of them fall back to reveal().
function advanced(g, cell = -1, old) {
  const fits = s => s && (cell < 0 || s.cell === cell);
  for (const e of eliminations(g, old)) {
    const ex = new Set(e.removed.map(([i, d]) => i * 10 + d));
    const s = UNITS.flatMap(u => missing(g, u).map(d => hiddenSingle(g, u, d, ex))).find(fits)
      || Array.from({ length: 81 }, (_, i) => nakedSingle(g, i, ex)).find(fits);
    if (s) return { ...s, tech: e.tech, area: [...new Set([...e.area, ...s.area])], focus: [...e.focus, ...s.focus],
      look: e.look, why: `${e.why}\n\n${s.why}`, notes: e.notes,
      steps: e.steps && [...e.steps.map(f => ({ beams: [], blockers: [], crossed: [], ...f, area: f.area || [] })),
        { ...s, notes: Object.fromEntries(e.removed.map(([i, d]) => [i, { show: [d], x: [d] }])), text: `Sad pogledaj ${s.unit ? s.unit.name : cellName(s.cell)}.\n${s.why}` }] };
  }
  return null;
}

// Next step, easiest technique first. → step or null.
function hint(g, old) {
  for (const u of UNITS) { const s = fullHouse(g, u); if (s) return s; }
  for (const u of UNITS) for (const d of missing(g, u)) { const s = hiddenSingle(g, u, d); if (s) return s; }
  for (let i = 0; i < 81; i++) { const s = nakedSingle(g, i); if (s) return s; }
  return advanced(g, -1, old);
}

// The user put d in empty cell i (g = known digits): why is that right or wrong? Clearest reason first.
// → { ok, text, step (marks to draw) or conflict (cell already holding d) }
function judgeMove(g, i, d, solution) {
  const units = UNITS.filter(u => u.cells.includes(i));
  if (d === solution[i]) {
    const step = units.map(u => fullHouse(g, u)).find(s => s?.cell === i)
      || units.map(u => hiddenSingle(g, u, d)).find(s => s?.cell === i) || nakedSingle(g, i) || advanced(g, i);
    return step ? { ok: true, step, text: `Točno! Tehnika: ${step.tech.name} (${step.tech.en})\n${step.why}` }
      : { ok: true, text: `Točno! Ali u ovom polju je zasad moguće više brojeva (${candidates(g, i).join(', ')}), pa se to još ne može sigurno zaključiti: bilo je i malo sreće. Traži polje ili broj gdje ostaje samo jedna mogućnost.` };
  }
  for (const u of units) {
    const j = u.cells.find(j => j !== i && g[j] === d);
    if (j !== undefined) return { ok: false, conflict: j,
      text: `Ne može: ${d} već postoji u ${u.loc} (red ${(j / 9 | 0) + 1}, stupac ${j % 9 + 1}). Svaki broj smije biti samo jednom u redu, stupcu i kvadratu.` };
  }
  const elsewhere = units.map(u => hiddenSingle(g, u, d)).find(s => s && s.cell !== i);
  if (elsewhere) return { ok: false, step: elsewhere,
    text: `Ne može: u ${elsewhere.unit.loc} broj ${d} mora ići u ${cellName(elsewhere.cell)}.\n${elsewhere.why}` };
  const forced = units.map(u => fullHouse(g, u)).find(s => s?.cell === i) || nakedSingle(g, i);
  if (forced) return { ok: false, step: forced, text: `Ne može: ovo polje mora biti ${forced.digit}.\n${forced.why}` };
  return { ok: false, text: `${d} se ovdje ni s čim ne sukobljava, ali nije točan. U ovom polju je zasad moguće više brojeva (${candidates(g, i).join(', ')}), pa bi to bilo nagađanje. Vrati se na označeno područje: tamo postoji siguran korak.` };
}

// ponytail: nothing explainable left → reveal the cell with fewest candidates. Add more techniques
// (chains) to eliminations() when hard puzzles need them.
function reveal(g, solution) {
  let best = -1;
  for (let i = 0; i < 81; i++) if (!g[i] && (best < 0 || candidates(g, i).length < candidates(g, best).length)) best = i;
  return { cell: best, digit: solution[best], tech: null, area: [], focus: [best], blockers: [], beams: [], crossed: [],
    answer: `Ovdje treba naprednija tehnika koju još ne znam objasniti. Otkrivam jedno polje: ${cellName(best)} = ${solution[best]}.` };
}

// Text of a step at a teaching level: 1 where to look, 2 why, 3 answer.
function hintText(h, level) {
  if (!h.tech) return h.answer;
  const head = `Tehnika: ${h.tech.name} (${h.tech.en})\n`;
  if (level === 1) return head + h.look;
  if (level === 2) return head + h.why;
  return `${h.answer}\n\nKako ${h.tech === TECH.yWing ? 'rade' : 'radi'} ${h.tech.name.toLowerCase()}: ${h.tech.how}\nSljedeći korak pokušaj pronaći istom tehnikom.`;
}

// Digits 1-9 (the count still to place shown under each, data-left) and ⌫, which only the camera shows:
// the game has Obriši among its tools.
const padKeys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(d => {
  const b = document.createElement('button');
  b.textContent = d || '⌫';
  if (!d) { b.ariaLabel = 'Prazno'; b.className = 'erase'; }
  b.onclick = () => live ? fixCell(d) : sel === null && d ? arm(d === armed ? 0 : d) : setCell(d);
  return $('pad').appendChild(b);
});
$('eraseBtn').onclick = () => setCell(0);
$('padNotes').onclick = () => {
  noting = !noting;
  $('padNotes').ariaPressed = String(noting);
  $('pad').classList.toggle('noting', noting);
};
$('padKind').onclick = () => {   // the selected digit: printed ↔ handwritten
  const f = live?.frozen;
  if (!live) return setKind();
  if (!f || f.sel === null) return;
  f.printed[f.sel] = f.printed[f.sel] === false;
  f.sel = null;
  $('pad').hidden = true;
  resolve();
  showFrozen();
};

// The whole board right → "Riješeno!", once per puzzle; not when it was opened solved or "Riješi sve" filled it.
let celebrated = null;
function checkSolved() {
  const key = task?.solution.join('');
  if (!task || celebrated === key || !inputs.every((x, i) => +x.value === task.solution[i])) return;
  celebrated = key;
  card = 'sudoku';
  $('solvedMenu').textContent = 'Izbornik';
  $('solvedLevel').firstChild.hidden = false;
  diffPill($('diffSolved'), saved().find(e => e.key === key)?.diff ?? difficulty(task.givens, task.solution));
  if (task.random) { task.solvedAt = Date.now(); saveState(); }
  $('lboard').hidden = true;   // only today's daily shows it (dailySolved)
  $('solvedText').textContent = task.daily ? dailySolved() : task.random ? `Vrijeme: ${clock(task.elapsed)}` : 'Sve je točno.';
  // Savjet is no minus: what it taught is listed instead.
  const techs = Object.entries(task.techs || {}).sort((a, b) => b[1] - a[1]);
  $('solvedTechs').hidden = !techs.length;
  $('techList').replaceChildren(...techs.map(([name, n]) => {
    const s = document.createElement('span');
    s.append(name, Object.assign(document.createElement('small'), { textContent: `${n}×` }));
    return s;
  }));
  solvedButtons();
  $('solved').showModal();
}
// The card's buttons. A game: the next one. Today's daily: on to the next level not solved yet, and the
// result to share (quietly while levels are left, as the main button once all three are done). A scan: close.
function solvedButtons() {
  const next = task.daily ? [1, 2].map(k => (task.level + k) % 3).find(i => !days.levels[i]?.solvedAt) : undefined;
  $('solvedClose').hidden = !!(task.random || task.daily);
  $('solvedNext').hidden = !task.random;
  $('solvedLevel').hidden = next === undefined;
  if (next !== undefined) {
    $('solvedLevel').dataset.lvl = next;
    $('solvedLevel').firstChild.style.background = `var(${LEVELS[next][2]})`;
    $('solvedLevel').lastChild.textContent = DAILY[next][0];
  }
  $('solvedShare').hidden = !task.daily;
  $('solvedShare').classList.toggle('quiet', next !== undefined);
  $('solvedShare').lastChild.textContent = next === undefined ? 'Podijeli' : 'Podijeli rezultat';
  if (task.daily) prepShare(next === undefined);
}
// The day's result as text + link, made before the tap (the share sheet wants the tap itself, with no
// network wait in between): this level, linked to this very daily (opened today, a friend plays it as the
// daily); all three once done, linked to the app. Places only with a name on the board, after it is sent.
let shareMsg = null;
async function prepShare(all) {
  const name = lbName(), lv = all ? [0, 1, 2] : [task.level], ms = i => days.levels[i].elapsed,
    url = all ? location.origin + location.pathname : shareLink(task.givens, `${days.date}.${task.level}`);
  const make = places => ({ url, text: [`Sudoku Scan · dnevni ${new Date().toLocaleDateString('hr', { day: 'numeric', month: 'numeric' })}`,
    ...lv.map((i, k) => `${DAILY[i][0]} ${clock(ms(i))}${places[k]?.all ? ` (${places[k].place}. od ${places[k].all})` : ''}`), ...all ? [] : ['Možeš li brže?']].join('\n') });
  shareMsg = make([]);
  if (!name || !await lbFlush()) return;
  shareMsg = make(await Promise.all(lv.map(i => lbRows(days.date, i, 0, { name, ms: ms(i) }).catch(() => null))));
}
$('solvedShare').onclick = async () => {
  const btn = $('solvedShare'), label = btn.lastChild.textContent, { text, url } = shareMsg;
  if (navigator.share) try { return await navigator.share({ title: 'Sudoku Scan', text, url }); } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); btn.lastChild.textContent = 'Kopirano ✓'; }   // on the button: a toast would sit under the card
  catch { btn.lastChild.textContent = 'Nije uspjelo'; }
  setTimeout(() => btn.lastChild.textContent = label, 2000);
};
// The card serves both games: card says whose result it shows (Tango's buttons: tangoButtons).
let card = 'sudoku';
$('solvedLevel').onclick = () => { $('solved').close(); if (card === 'tango') go('menu'); openDaily(+$('solvedLevel').dataset.lvl); };
$('solvedClose').onclick = () => $('solved').close();
$('solvedNext').onclick = () => card === 'tango' ? ($('solved').close(), tangoGame()) : newRandom(Math.min(task.level, 2), $('solvedNext'));   // a shared one may be Vrlo teško: games go to Teško
$('solvedMenu').onclick = () => { $('solved').close(); go(card === 'tango' ? 'games' : 'menu'); };

// Also the hook for "the board changed": a task's progress goes into the history, candidates redrawn,
// a finished board celebrated.
function markConflicts() {
  if (task) {
    remember(task.solution, task.givens, inputs.map((x, i) => (task.daily ? +x.value === task.solution[i] : x.classList.contains('ok')) ? task.solution[i] : 0),
      task.daily ? { daily: task.daily, level: task.level } : task.random ? { random: true, level: task.level, time: task.elapsed } : {});
    const st = state();   // the board as it is, wrong digits and notes too: back after a reload
    st.values = inputs.map(x => +x.value || 0).join('');
    st.notes = notes.map(n => n.join(''));
    saveState();
  }
  padKeys.slice(0, 9).forEach((b, j) => {   // how many of each digit are still to place; none: the key goes (its place stays)
    const left = 9 - inputs.filter(x => +x.value === j + 1).length;
    b.dataset.left = Math.max(0, left);
    b.classList.toggle('spent', !!task && left <= 0);   // before a task a misread digit may be one of nine: every key stays
  });
  $('undoBtn').disabled = !undo.length;
  drawCands();
  checkSolved();
  const v = inputs.map(i => i.classList.contains('maybe') ? '' : i.value);   // an unsure reading flags nothing
  inputs.forEach((inp, i) => {
    const r = i / 9 | 0, c = i % 9;
    inp.classList.toggle('bad', v[i] !== '' && v.some((x, j) => j !== i && x === v[i] &&
      ((j / 9 | 0) === r || j % 9 === c || ((j / 27 | 0) === (i / 27 | 0) && (j % 9 / 3 | 0) === (c / 3 | 0)))));
  });
}

// --- Daily sudoku: three a day (Lagano, Srednje, Teško), the same for everyone on a date, generated
// from the date alone (no server). Solo: no help, only duplicates marked; a full board without
// duplicates is the solution (it is unique). A card says the rules first; the timer starts on "Kreni"
// and runs only while the sudoku is on screen. ---
// Per level: [name, givens to keep, accepted difficulty from, to] (hard: still solvable with the
// techniques the hints know).
const DAILY = [['Lagano', 36, 0, 30], ['Srednje', 28, 30, 55], ['Teško', 22, 55, 80]];
function rng(seed) {   // mulberry32: the same numbers from the same seed on every device
  let a = seed >>> 0;
  return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const hash = str => [...str].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);
const shuffle = (a, r) => { for (let i = a.length - 1; i > 0; i--) { const j = r() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
function fullGrid(r) {
  const g = Array(81).fill(0);
  (function fill(i) {
    if (i === 81) return true;
    for (const d of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], r)) if (!PEERS[i].some(j => g[j] === d)) { g[i] = d; if (fill(i + 1)) return true; }
    g[i] = 0;
    return false;
  })(0);
  return g;
}
// Try k of a day's level: a random full grid emptied cell by cell while the solution stays unique.
function dailyTry(date, lvl, k) {
  const r = rng(hash(`${date}#${lvl}#${k}`)), solution = fullGrid(r), givens = solution.slice();
  for (const i of shuffle([...Array(81).keys()], r)) {
    if (givens.filter(Boolean).length <= DAILY[lvl][1]) break;
    const v = givens[i];
    givens[i] = 0;
    if (solve(givens, 2).length !== 1) givens[i] = v;
  }
  return { givens, solution, diff: difficulty(givens, solution, date < NEW_TECH) };
}
// Teško from NEW_TECH on: the day's first try that needs its hardest technique at least twice, not once in
// an otherwise easy sudoku (~1 try in 20: too many for a phone). pool.js found them on a computer; two
// base-36 digits a day. ponytail: two years; run pool.js again before it ends (then the search below).
const HARD_TRIES = '030k060803030s110z041q070d090t0c0a3c0o0l0k0e1a0v060r170f1t000k0r0f020l040n09010a0d1n0f06020625080b0f0m07030a0f0b09151o020e210d1g0n0r110w13010k170l0203000d0b0i0915050d1006030f060j0i0u0c1l010c0f0s001b07002d0i0r011x090s070004020b1r090n09131p0t030407150v0s120d060018040z0104051x1d0o092u050704080e070u000429041k0113090s07000v0000060b071g0f1f1c1w0s090i0n0n021s0m1t0i20010l040n09000m0p0x000q03020i0n0t01060d0h0o0f0419080b060l01010e0f0w19020800420p03150q0q210o0b091h000h0w000d00020c0t1h161a0g060b0716011104070d032d08130w0o080i010s050129110k0h051d071909150g1h07020e0q0n140620050j0e0n0d090c0q0c0a0n0c020v0i0t0702190800120c0f2f080e04060h020e020y0r0g1a0b1m0901060k0f110h0s0e060503070z0t04070h0b1015020v092b22011g0g0b021k240r170e0n001314111q0n0u0z06030d0c04010b020y0a0m010n0l05090o0j0k11040b020a010g0a0t11131m040e100u0u0m0914040607061o0b110j0r082j0k0r0006000e0a0e0d060h08060k0i0w0l141t1z1o03100s000l0h0u11070c1t021b0707020c000g000908061d070y0m1l0m080100050q040f140t0l0j040108020i1e1d000g070e020d140u0v0s060g0a04070x0e000p12110c01240204190105170u080v000f02071h0g1i0g0k0211121n010a1v1p0d0m130l1f0i0j0i3b0d0j0r0k260d0n0k01020f0n0c190j0b0u0g010e04090n07210x031p01040w1309052107081d1s1j030y0d0o1706121709030a0q0h0c0401060i0x0d0b0f0903070103100d040t1h0e0004020l060r0202040406082g021h140b17090d1c0n0m210l0m1d010n060r1e0r1d0a0k0k0i18010p0b0316010k0f0c1x0j1j09130002070m0b0226032r0f0n070n0w020r0j011o1n0d06000m0g0h050e0c00030d2k0e0k0h000a090f13100b04020q00101q001m03131a100103190d0c';
// Date "YYYY-MM-DD" + level → { givens, solution, diff }: the first try in the level's difficulty range
// wins, else the closest one. ponytail: up to ~3 s for Teško (computer); made once a day, then kept in the day's save.
function makeDaily(date, lvl) {
  const [, , lo, hi] = DAILY[lvl], day = (Date.parse(date) - Date.parse(NEW_TECH)) / 864e5;
  const pooled = lvl === 2 && day >= 0 ? parseInt(HARD_TRIES.substr(day * 2, 2), 36) : NaN;
  if (pooled >= 0) return dailyTry(date, lvl, pooled);
  let best = null;
  for (let k = 0; k < 80; k++) {
    const p = dailyTry(date, lvl, k);
    if (p.diff >= lo && p.diff < hi) return p;
    if (!best || Math.abs(p.diff - (lo + hi) / 2) < Math.abs(best.diff - (lo + hi) / 2)) best = p;
  }
  return best;
}
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const clock = ms => { const t = Math.floor(ms / 1000), h = t / 3600 | 0, m = t / 60 % 60 | 0, sec = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`; };

// days: today's { date, levels: 3 × ({ givens, solution, diff, values: 81 digits typed, elapsed: ms, solvedAt: ms | null } | null) };
// daily: the one being played (one of days.levels).
let days = null, daily = null;
function loadDays() {
  try { days = JSON.parse(localStorage.sudokuDaily || 'null'); } catch { days = null; }
  if (days?.date !== dayKey() || !days.levels) days = { date: dayKey(), levels: [null, null, null] };
  return days;
}
const saveDaily = () => { try { localStorage.sudokuDaily = JSON.stringify(days); } catch {} };
const dailyDone = () => { try { return JSON.parse(localStorage.sudokuDailyDone || '{}'); } catch { return {}; } };   // "date/level" → { ms }

// The card before a daily: the rules, the three levels with how far each got, "Kreni" (the clock waits for it).
let pickLvl = 0;
function openDaily(lvl) {
  loadDays();
  pickLvl = lvl ?? Math.max(0, days.levels.findIndex(st => !st?.solvedAt));
  $('dailyDate').textContent = new Date().toLocaleDateString('hr', { weekday: 'long', day: 'numeric', month: 'long' });
  showLevels();
  $('dailyDlg').showModal();
}
// Today's daily typed or scanned in (the same solution): its card, so it stays solo, never a task with help.
// ponytail: only dailies opened on this device are known; a rotated or relabelled copy gets through.
function toDaily(sol) {
  const lvl = loadDays().levels.findIndex(st => st?.solution.join('') === sol.join(''));
  if (lvl >= 0) openDaily(lvl);
  return lvl >= 0;
}
const levelText = st => st?.solvedAt ? `Riješeno za ${clock(st.elapsed)} ✓` : st?.elapsed ? `U tijeku · ${clock(st.elapsed)}` : 'Nije počet';
function showLevels() {
  [...$('dailyLevels').children].forEach((b, i) => {
    const st = days.levels[i];
    b.ariaPressed = String(i === pickLvl);
    b.querySelector('small').textContent = levelText(st);
  });
  const st = days.levels[pickLvl];
  $('dailyGo').textContent = st?.solvedAt ? 'Pogledaj' : st?.elapsed ? 'Nastavi' : 'Kreni';
}
[...$('dailyLevels').children].forEach((b, i) => b.onclick = () => { pickLvl = i; showLevels(); });
$('dailyCancel').onclick = () => $('dailyDlg').close();
$('dailyGo').onclick = async () => {
  if (!days.levels[pickLvl]) {
    $('dailyGo').disabled = true;
    $('dailyGo').textContent = 'Pripremam…';
    await new Promise(r => setTimeout(r, 30));   // let that show before the work
    days.levels[pickLvl] = { ...makeDaily(days.date, pickLvl), values: '0'.repeat(81), elapsed: 0, solvedAt: null };
    saveDaily();
    $('dailyGo').disabled = false;
  }
  $('dailyDlg').close();
  playDaily(pickLvl);
  go('game');
};

// Put one of today's dailies on the board.
function playDaily(lvl) {
  daily = days.levels[lvl];
  task = { givens: daily.givens, solution: daily.solution, daily: days.date, level: lvl };
  try { localStorage.sudokuTask = JSON.stringify(task); } catch {}
  clearHint();
  lastProbs = null;
  lastVecs = Array.from({ length: 81 }, () => []);
  restore(daily);
  celebrated = daily.solvedAt ? daily.solution.join('') : null;
  showTask();
  markConflicts();
}

// "Nova igra": the daily's generator on a random seed, so always one solution, solvable with the known
// techniques. With help, and a clock without records (those belong to the daily).
// ponytail: made on the tap (Teško up to ~3 s, the page waits); a Web Worker if that ever feels slow.
// The pressed button (a level, or "Nova igra" on the solved card) says it is working meanwhile.
async function newRandom(lvl, btn) {
  const label = btn.lastChild.textContent, keys = [...$('newLevels').children, $('solvedNext')];
  keys.forEach(b => b.disabled = true);
  btn.lastChild.textContent = 'Pripremam…';
  await new Promise(r => setTimeout(r, 30));   // let that show before the work
  const p = makeDaily('r' + Math.random(), lvl);
  keys.forEach(b => b.disabled = false);
  btn.lastChild.textContent = label;
  $('solved').close();
  startGame(p, lvl);
}
[...$('newLevels').children].forEach((b, i) => b.onclick = () => newRandom(i, b));

// A sudoku ({ givens, solution }) on the board as a game: with help and a clock (level: LEVELS index).
function startGame(p, lvl) {
  task = { givens: p.givens, solution: p.solution, random: true, level: lvl, elapsed: 0 };
  clearHint();
  lastProbs = null;
  lastVecs = Array.from({ length: 81 }, () => []);
  restore(task);
  celebrated = null;
  idle = 0;
  showTask();
  markConflicts();
  go('game');
  // The first three games say that Savjet costs nothing (it goes with the first digit, or after 6 s).
  let tips = 0;
  try { tips = +localStorage.sudokuTips || 0; if (tips < 3) localStorage.sudokuTips = tips + 1; } catch {}
  if (tips < 3) { say('Zapneš li, *Savjet* pokaže sljedeći potez i objasni zašto. Koristi ga koliko god želiš: ništa ne gubiš.', 6000); tipOn = true; }
}

// --- Sharing: a link holds the sudoku's printed digits (81, as one base-36 number), so every link leads
// to that one sudoku, for everyone, scanned ones too; no server, no generator involved. A daily's link
// also says its day and level (&d=YYYY-MM-DD.level): opened that same day, it is the daily, solo. ---
const shareLink = (givens, day) => `${location.origin}${location.pathname}?s=${BigInt(givens.join('')).toString(36)}${day ? '&d=' + day : ''}`;
$('shareBtn').onclick = async () => {
  $('more').close();
  const url = shareLink(task.givens, task.daily && `${task.daily}.${task.level}`),
    text = `${task.daily ? 'Dnevni sudoku' : 'Sudoku'} (${$('diff').querySelector('b').textContent.split('· ')[1]}). Možeš li ga riješiti?`;
  if (navigator.share) try { return await navigator.share({ title: 'Sudoku Scan', text, url }); } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url); say('Link je kopiran. Tko ga otvori, dobije ovaj isti sudoku.'); }
  catch { say(url, Infinity); }   // no clipboard: the link itself, to copy by hand
};
// A link opened (?s=): that sudoku, checked (a link is outside input). Already the game on the board or
// in the history: go on with it; else a new game. The address loses ?s, so a reload goes on, not over.
// Today's daily: its card (made from the date here too, like every daily). Another day's: a game.
function openShared() {
  const q = new URLSearchParams(location.search), s = q.get('s'), d = /^(\d{4}-\d\d-\d\d)\.([0-2])$/.exec(q.get('d'));
  if (s === null) return false;
  history.replaceState(null, '', location.pathname);
  if (d?.[1] === dayKey()) { go('menu'); openDaily(+d[2]); return true; }
  const g = /^[0-9a-z]{1,60}$/.test(s) && [...[...s].reduce((n, c) => n * 36n + BigInt(parseInt(c, 36)), 0n).toString().padStart(81, '0')].map(Number);
  const sols = g && g.length === 81 && g.filter(Boolean).length >= 17 ? solve(g) : [];
  if (sols.length !== 1) { go('menu'); say('Ovaj link ne vodi na ispravan sudoku.', Infinity); return true; }
  const key = sols[0].join(''), e = saved().find(x => x.key === key);
  if (task?.solution.join('') === key) { go('game'); if (task.daily && !daily.solvedAt) openDaily(task.level); }
  else if (e) openTask(e);
  else startGame({ givens: g, solution: sols[0] }, LEVELS.indexOf(diffLevel(difficulty(g, sols[0]))));
  return true;
}

// A daily done: stop the clock, keep the record. → the card's line: time, streak (days with at least
// one daily solved), best of this level.
function dailySolved() {
  daily.solvedAt = Date.now();
  saveDaily();
  const done = dailyDone();
  done[`${days.date}/${task.level}`] = { ms: daily.elapsed };
  try { localStorage.sudokuDailyDone = JSON.stringify(done); } catch {}
  remember(task.solution, task.givens, task.solution, { daily: days.date, level: task.level, time: daily.elapsed });
  lbNow = { day: days.date, level: task.level, ms: daily.elapsed };
  if (lbName()) lbQueue(lbNow.day, lbNow.level, lbNow.ms);
  lbShow(lbNow.day, lbNow.level, lbNow.ms);
  const same = Object.entries(done).filter(([k]) => k.endsWith('/' + task.level)).map(([, r]) => r.ms), best = Math.min(...same);
  return `Riješeno za ${clock(daily.elapsed)} · ${daysWord(streak(Object.keys(done).map(k => k.slice(0, 10))))} zaredom`
    + (same.length < 2 ? '' : best === daily.elapsed ? ' · novi rekord!' : ` · najbolje (${DAILY[task.level][0].toLowerCase()}): ${clock(best)}`);   // a record needs a second one
}
// Days in a row up to today among dates ("YYYY-MM-DD"), and "1 dan" / "5 dana".
const streak = dates => { const set = new Set(dates); let n = 0; for (const d = new Date(); set.has(dayKey(d)); d.setDate(d.getDate() - 1)) n++; return n; };
const daysWord = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'dan' : 'dana'}`;
