// --- Pasijans (Klondike, okreni 1, the stock turned as often as you like): every card onto its suit's
// foundation, ace to king. In the columns, red on black and black on red, one lower; only a king on an empty one.
// One deal a day, the same for everyone, picked so that it can be solved; no undo and no Savjet on it, and the
// leaderboard counts the cards on the foundations first, then the time. Nova igra: undo, Savjet, any deal.
// A card is 0..51: suit c / 13 (♠ ♥ ♦ ♣), rank c % 13 (A … K). A game:
// { cols: 7 × cards (bottom first), down: face-down cards at the bottom of each, found: 4 counts (by suit),
//   stock: cards (top last), waste: cards (top last) }. ---
const P_SUIT = '♠♥♦♣', P_RANK = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'], P_HOUR = 3600000;
const pS = c => c / 13 | 0, pR = c => c % 13, pRed = c => (pS(c) + 1 & 2) > 0;
const pFits = (c, col) => col.length ? pRed(col.at(-1)) !== pRed(c) && pR(col.at(-1)) === pR(c) + 1 : pR(c) === 12;
const pUp = (g, c) => g.found[pS(c)] === pR(c);   // c is next on its foundation
function pDeal(seed) {
  const d = shuffle([...Array(52).keys()], rng(hash(seed))), cols = [];
  for (let i = 0; i < 7; i++) cols.push(d.splice(0, i + 1));
  return { cols, down: [0, 1, 2, 3, 4, 5, 6], found: [0, 0, 0, 0], stock: d, waste: [] };
}
const pCards = g => g.found.reduce((a, b) => a + b, 0);
const pClone = g => ({ cols: g.cols.map(c => [...c]), down: [...g.down], found: [...g.found], stock: [...g.stock], waste: [...g.waste] });
// A move: { f: 'w' (the waste's top) | 'f' (a foundation; s: its suit) | column i (from card j up), t: 'f' | column }.
// pDo plays it if it is allowed (true), turning up the card it leaves on top of a column.
function pDo(g, m) {
  const run = m.f === 'w' ? g.waste.slice(-1) : m.f === 'f' ? (g.found[m.s] ? [m.s * 13 + g.found[m.s] - 1] : []) : g.cols[m.f].slice(m.j);
  if (!run.length || (typeof m.f === 'number' && m.j < g.down[m.f])) return false;
  if (m.t === 'f' ? run.length > 1 || m.f === 'f' || !pUp(g, run[0]) : m.t === m.f || !pFits(run[0], g.cols[m.t])) return false;
  if (m.f === 'w') g.waste.pop();
  else if (m.f === 'f') g.found[m.s]--;
  else { g.cols[m.f].length = m.j; if (g.down[m.f] && g.down[m.f] === m.j) g.down[m.f]--; }
  if (m.t === 'f') g.found[pS(run[0])]++; else g.cols[m.t].push(...run);
  return true;
}
// The stock: its top card onto the waste; empty, the waste turned back over.
const pDraw = g => { if (g.stock.length) g.waste.push(g.stock.pop()); else { g.stock = g.waste.reverse(); g.waste = []; } };

// --- The solver: depth first over the moves that get somewhere, each position seen once. With the stock turned
// endlessly, every card in stock and waste can be reached by turning: the talon is a bag, its order no matter.
// A position: { cols, down, found, T: the talon }. Moves that get somewhere: onto a foundation (one that can
// never be needed in the columns again is taken alone: no other choice tried); a column's run that turns up a card,
// empties the column for a king or frees a card for its foundation; a talon card into a column (a king: the first
// empty one). Not tried: from a foundation back down. ponytail: so it can miss a rare solution; it never claims one
// that isn't. Everything face up with the talon empty is solved (the rest goes up by itself).
function pMoves(s) {
  const out = [], tab = [], tops = s.cols.map((c, i) => c.length > s.down[i] ? c.at(-1) : -1);
  const safe = c => pR(c) <= 1 || s.found.every((n, k) => (k + 1 & 2) === (pS(c) + 1 & 2) || n >= pR(c));
  for (const [c, m] of [...tops.map((c, i) => [c, { f: i, j: s.cols[i].length - 1, t: 'f' }]), ...s.T.map((c, q) => [c, { f: 't', q, t: 'f' }])])
    if (c >= 0 && pUp(s, c)) { if (safe(c)) return [m]; out.push(m); }
  const empty = s.cols.findIndex(c => !c.length);
  s.cols.forEach((col, i) => {
    for (let j = s.down[i]; j < col.length; j++) {
      if (j > s.down[i] && !pUp(s, col[j - 1])) continue;
      for (let k = 0; k < 7; k++) {
        if (k === i || (!s.cols[k].length && (k !== empty || j === 0)) || !pFits(col[j], s.cols[k])) continue;
        (j === s.down[i] && j > 0 ? out : tab).push({ f: i, j, t: k });
      }
    }
  });
  s.T.forEach((c, q) => { for (let k = 0; k < 7; k++) if ((s.cols[k].length || k === empty) && pFits(c, s.cols[k])) out.push({ f: 't', q, t: k }); });
  return out.concat(tab);
}
function pStep(s, m) {
  const n = { cols: s.cols.map(c => c), down: [...s.down], found: [...s.found], T: s.T };
  const run = m.f === 't' ? [s.T[m.q]] : s.cols[m.f].slice(m.j);
  if (m.f === 't') n.T = s.T.filter((_, q) => q !== m.q);
  else { n.cols[m.f] = s.cols[m.f].slice(0, m.j); if (n.down[m.f] && n.down[m.f] === m.j) n.down[m.f]--; }
  if (m.t === 'f') n.found[pS(run[0])]++; else n.cols[m.t] = [...s.cols[m.t], ...run];
  return n;
}
const pKey = s => s.cols.map((c, i) => s.down[i] + ':' + c.join(',')).sort().join('|') + '/' + s.found + '/' + [...s.T].sort((a, b) => a - b);
// → the moves to the end (talon moves as { f: 't', c: the card }), null (no way found: the deal can't be solved
// with these moves) or '?' (out of budget: not known). The budget counts positions, never time, so every device
// picks the same daily.
function pSolve(g, budget = 20000) {
  const seen = new Set(), path = [];
  let nodes = 0;
  const go = s => {
    if (!s.T.length && s.down.every(d => !d)) return true;
    if (++nodes > budget) throw 0;
    const k = pKey(s);
    if (seen.has(k)) return false;
    seen.add(k);
    for (const m of pMoves(s)) {
      path.push(m.f === 't' ? { f: 't', c: s.T[m.q], t: m.t } : m);
      if (go(pStep(s, m))) return true;
      path.pop();
    }
    return false;
  };
  try { return go({ cols: g.cols, down: g.down, found: g.found, T: [...g.waste, ...g.stock] }) ? path : null; } catch { return '?'; }
}
const pStuck = g => !pMoves({ cols: g.cols, down: g.down, found: g.found, T: [...g.waste, ...g.stock] }).length;
// The day's deal: 'pas#date#0', #1 … the first the solver finishes.
function pDaily(date) {
  for (let k = 0; ; k++) { const d = pDeal(`pas#${date}#${k}`); if (Array.isArray(pSolve(d, 5000))) return d; }
}
// The leaderboard's one number: an hour for every card not on a foundation, then the time (under an hour).
// ponytail: a game over an hour counts as 59:59; a column of its own if that ever matters.
const pScore = (cards, ms) => (52 - cards) * P_HOUR + Math.min(ms, P_HOUR - 1000);
const pScoreText = v => { const n = 52 - Math.floor(v / P_HOUR), t = clock(v % P_HOUR); return n === 52 ? t : `${n}/52 · ${t}`; };

// --- On screen: the felt, every card placed by hand (left / top from the table's width), drawn anew after each
// move; a card that moved slides from where it was (FLIP), so a move, a turn of the stock or an undo is seen.
// A game: { ...deal, moves, elapsed, endedAt, cards (at the end), date (the daily's), hist (Nova igra: earlier states) }.
let pg = null, pBusy = false;   // the game on screen; pBusy: the cards going up by themselves
const pSave = () => { try { localStorage[pg.date ? 'pasDaily' : 'pasGame'] = JSON.stringify(pg); } catch {} };
const pasDone = () => tLoad('pasDone') || {};   // date → the leaderboard's number (pScore) of each finished daily
const pOpenView = which => { try { localStorage.pasOn = which; } catch {} go('pas'); };
const pFresh = d => ({ ...d, moves: 0, elapsed: 0, endedAt: null });
// The Igre tile: today's daily, dealt on the day's first open (the solver picks it: well under a second).
function openPas() {
  pg = tLoad('pasDaily');
  if (pg?.date !== dayKey()) { pg = { ...pFresh(pDaily(dayKey())), date: dayKey() }; pSave(); }
  pOpenView('daily');
}
// Nova igra: any deal (some can't be solved: undo and Savjet are there); one under way goes on.
function pasGame(fresh) {
  pg = tLoad('pasGame');
  if (fresh || !pg || pg.endedAt) { pg = { ...pFresh(pDeal('p' + Math.random())), hist: [] }; pSave(); }
  pOpenView('game');
}
$('tilePas').onclick = openPas;
$('pasBack').onclick = () => go('games');

const pCardHtml = (c, x, y, at, big) => {
  const r = P_RANK[pR(c)], s = P_SUIT[pS(c)], ix = `<span class="ix"><b>${r}</b><i>${s}</i></span>`;
  return `<div class="pc ${'SHDC'[pS(c)]}" data-c="${c}" data-at="${at}" style="left:${x}px;top:${y}px">${ix}${pR(c) > 9 ? `<span class="face">${r}<small>${s}</small></span>` : `<span class="pip">${s}</span>`}${big ? `<span class="ix br"><b>${r}</b><i>${s}</i></span>` : ''}</div>`;
};
function drawPas() {
  const t = $('pt'), old = new Map([...t.querySelectorAll('[data-c]')].map(el => [el.dataset.c, el.getBoundingClientRect()]));
  const G = t.clientWidth > 500 ? 16 : 4, W = Math.floor((t.clientWidth - 6 * G) / 7), H = Math.round(W * 1.4), big = W >= 80, X = i => i * (W + G), y0 = H + Math.round(G * 2.5);
  // a long column squeezes its steps to stay on the screen
  const room = Math.max(H * 2, innerHeight - t.getBoundingClientRect().top - y0 - (innerWidth >= 1100 ? 32 : 150)), dn = Math.round(W * .14), up = Math.round(W * .34);
  let h = '', bottom = y0 + H;
  h += pg.stock.length ? `<div class="pc down" data-c="${pg.stock.at(-1)}" data-at="s" style="left:0;top:0"></div>` : `<div class="pslot" data-at="s" style="left:0;top:0">↻</div>`;
  h += `<div class="pslot" style="left:${X(1)}px;top:0"></div>` + (pg.waste.length ? pCardHtml(pg.waste.at(-1), X(1), 0, 'w', big) : '');
  pg.found.forEach((n, s) => h += `<div class="pslot ${'SHDC'[s]}" style="left:${X(3 + s)}px;top:0">${P_SUIT[s]}</div>` + (n ? pCardHtml(s * 13 + n - 1, X(3 + s), 0, 'f' + s, big) : ''));
  pg.cols.forEach((col, i) => {
    const d = pg.down[i], u = col.length - d - 1, k = Math.min(1, (room - H) / Math.max(1, d * dn + u * up));
    h += `<div class="pslot" data-at="c${i}" style="left:${X(i)}px;top:${y0}px"></div>`;
    let y = y0;
    col.forEach((c, j) => {
      h += j < d ? `<div class="pc down" data-c="${c}" style="left:${X(i)}px;top:${y}px"></div>` : pCardHtml(c, X(i), y, `c${i}.${j}`, big);
      if (j < col.length - 1) y += Math.round((j < d ? dn : up) * k);
    });
    bottom = Math.max(bottom, y + H);
  });
  t.style.cssText = `--w:${W}px;--h:${H}px;height:${bottom}px`;
  t.innerHTML = h;
  if (!reduced()) for (const el of t.querySelectorAll('[data-c]')) {   // FLIP: from where it was
    const a = old.get(el.dataset.c), b = el.getBoundingClientRect();
    if (a && (a.left !== b.left || a.top !== b.top)) el.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
  }
  $('pasName').textContent = pg.date ? 'Pasijans · dnevni' : 'Pasijans';
  $('pasSide').textContent = pg.date ? new Date(pg.date + 'T12:00').toLocaleDateString('hr', { day: 'numeric', month: 'numeric' }) : '';
  $('pasCards').firstChild.textContent = pCards(pg);
  $('pasTimer').textContent = clock(pg.elapsed);
  $('pasEnd').hidden = !pg.date || !!pg.endedAt;
  $('pasUndo').hidden = $('pasHint').hidden = !!pg.date || !!pg.endedAt;
  $('pasUndo').disabled = !pg.hist?.length;
  $('pasNew').hidden = !!pg.date;
}

// A move by the player: kept (Nova igra: for undo), then the end checked: all up → the card; all face up and
// stock and waste empty → the rest goes up by itself; nothing that gets anywhere → the end (not solved).
function pPlay(fn) {
  if (pg.endedAt || pBusy) return false;
  const before = JSON.stringify(pClone(pg));
  if (!fn()) return false;
  if (pg.hist) { pg.hist.push(before); if (pg.hist.length > 300) pg.hist.shift(); }
  pg.moves++;
  pSave();
  drawPas();
  pAfter();
  return true;
}
function pAfter() {
  if (pCards(pg) === 52) return pasEnded();
  if (!pg.stock.length && !pg.waste.length && pg.down.every(d => !d)) {   // auto-complete, a card each 120 ms
    pBusy = true;
    const step = () => {
      const i = pg.cols.findIndex(c => c.length && pUp(pg, c.at(-1)));
      if (i < 0) { pBusy = false; return pasEnded(); }
      pDo(pg, { f: i, j: pg.cols[i].length - 1, t: 'f' });
      pg.moves++;
      pSave();
      drawPas();
      if (pCards(pg) === 52) { pBusy = false; return setTimeout(pasEnded, 300); }
      setTimeout(step, 120);
    };
    return setTimeout(step, 200);
  }
  if (pStuck(pg)) { pBusy = true; setTimeout(() => { pBusy = false; pasEnded(); }, 600); }
}
// A tap: the card (with the run on it) to the best place: its foundation, else a column it fits (one with cards
// before an empty one; a whole column never onto an empty one). Nowhere: it shakes.
const pFrom = at => at === 'w' ? { f: 'w' } : at[0] === 'f' ? { f: 'f', s: +at[1] } : { f: +at.slice(1).split('.')[0], j: +at.split('.')[1] };
function pTap(at, el) {
  if (at === 's') return pPlay(() => (pDraw(pg), true));
  const from = pFrom(at);
  const tries = [{ ...from, t: 'f' }, ...[...Array(7).keys()].sort((a, b) => !pg.cols[a].length - !pg.cols[b].length)
    .filter(k => !(typeof from.f === 'number' && from.j === 0 && !pg.cols[k].length)).map(k => ({ ...from, t: k }))];
  if (!tries.some(m => pPlay(() => pDo(pg, m)))) el?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 220 });
}
// Dragging: a face-up card and what lies on it follow the finger; dropped over a column or a foundation it goes
// there if it may, else it slides back. A drag is no tap.
let pDrag = null;   // { at, x, y, els, on }
$('pt').onpointerdown = e => {
  const el = e.target.closest('[data-at]');
  if (!el || pDrag || pg.endedAt || pBusy || e.button > 0) return;
  const at = el.dataset.at, t = $('pt'), card = at === 'w' || at[0] === 'f' || at.includes('.');
  let els = card ? [el] : [];
  if (at.includes('.')) { const { f, j } = pFrom(at); els = pg.cols[f].slice(j).map(c => t.querySelector(`[data-c="${c}"]`)); }
  els.forEach(el => el.getAnimations().forEach(a => a.finish()));   // a card still sliding in is grabbed where it lands
  pDrag = { at, x: e.clientX, y: e.clientY, els, on: false };
  t.setPointerCapture?.(e.pointerId);
};
$('pt').onpointermove = e => {
  const d = pDrag;
  if (!d || !d.els.length) return;
  const dx = e.clientX - d.x, dy = e.clientY - d.y;
  if (!d.on && Math.hypot(dx, dy) < 6) return;
  d.on = true;
  d.els.forEach(el => { el.classList.add('lift'); el.style.transform = `translate(${dx}px, ${dy}px)`; });
};
$('pt').onpointerup = () => {
  const d = pDrag;
  pDrag = null;
  if (!d) return;
  if (!d.on) return d.at === 's' || (d.els.length && d.at[0] !== 'f') ? pTap(d.at, d.els[0]) : null;   // a foundation's card comes down by dragging only
  // where the dragged card's middle is: the top row's right four are the foundations, anywhere else a column
  const t = $('pt').getBoundingClientRect(), r = d.els[0].getBoundingClientRect(), w = parseFloat($('pt').style.getPropertyValue('--w')),
    gap = (t.width - 7 * w) / 6, k = Math.max(0, Math.min(6, Math.floor((r.left + r.width / 2 - t.left + gap / 2) / (w + gap)))), top = r.top + r.height / 2 - t.top < w * 1.4 + gap;
  if (!pPlay(() => pDo(pg, { ...pFrom(d.at), t: top && k >= 3 ? 'f' : k }))) drawPas();   // back where it was (FLIP from the drop)
};
$('pt').onpointercancel = () => { pDrag = null; drawPas(); };
$('pt').oncontextmenu = e => e.preventDefault();
addEventListener('keydown', e => {
  if (view !== 'pas' || e.target.closest('input, textarea') || document.querySelector('dialog[open]')) return;
  if (e.key === ' ') { e.preventDefault(); pTap('s'); }
  if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey) && pg.hist) { e.preventDefault(); $('pasUndo').click(); }
});
$('pasUndo').onclick = () => {
  if (!pg.hist?.length || pg.endedAt || pBusy) return;
  Object.assign(pg, JSON.parse(pg.hist.pop()));
  pg.moves++;
  pSave();
  drawPas();
};
// Savjet (Nova igra): the solver's next move, its card outlined (the stock when the card is still in it).
$('pasHint').onclick = () => {
  if (pg.endedAt || pBusy) return;
  const p = pSolve(pg);
  if (!Array.isArray(p) || !p.length) return say(p === null || p === '?' ? 'Odavde ne vidim put do kraja. Probaj Poništi.' : 'Sve ide gore samo od sebe.');
  const m = p[0], t = $('pt');
  const el = m.f === 't' ? t.querySelector(pg.waste.at(-1) === m.c ? '[data-at="w"]' : '[data-at="s"]') : t.querySelector(`[data-at="c${m.f}.${m.j}"]`);
  el?.classList.add('hint');
  setTimeout(() => el?.classList.remove('hint'), 1600);
};
$('pasNew').onclick = () => pasGame(true);
$('pasEnd').onclick = () => say('Završiti dnevni? Broje se karte na temelju.', 6000, ['Završi', () => !pg.endedAt && pasEnded()]);

// The end, solved or not: the shared card (card = 'pas'). The daily: the cards up and the time, days in a
// row, the board (level 6: cards first, then time); a game: the same line and its moves, Nova igra.
function pasEnded() {
  if (pg.endedAt) return;
  pg.endedAt = Date.now();
  pg.cards = pCards(pg);
  pSave();
  drawPas();
  card = 'pas';
  $('solved').className = pg.cards === 52 ? 'pas' : 'pas stuck';
  $('solvedTitle').textContent = pg.cards === 52 ? 'Riješeno!' : 'Kraj igre';
  $('solvedMenu').textContent = 'Igre';
  $('diffSolved').hidden = $('solvedTechs').hidden = $('lboard').hidden = true;
  const line = pg.cards === 52 ? `Riješeno za ${clock(pg.elapsed)}` : `${pg.cards} od 52 na temelju · ${clock(pg.elapsed)}`;
  if (pg.date) {
    const done = pasDone(), v = pScore(pg.cards, pg.elapsed);
    done[pg.date] = v;
    try { localStorage.pasDone = JSON.stringify(done); } catch {}
    $('solvedText').textContent = `${line} · ${daysWord(streak(Object.keys(done)))} zaredom`;
    lbNow = { day: pg.date, level: 6, ms: v };
    if (lbName()) lbQueue(lbNow.day, 6, v);
    lbShow(lbNow.day, 6, v);
  } else $('solvedText').textContent = `${line} · ${pg.moves} poteza`;
  pasButtons();
  setTimeout(() => view === 'pas' && $('solved').showModal(), reduced() ? 0 : 700);
}
function pasButtons() {
  $('solvedClose').hidden = $('solvedLevel').hidden = true;
  $('solvedNext').hidden = !!pg.date;
  $('solvedShare').hidden = !pg.date;
  $('solvedShare').classList.remove('quiet');
  $('solvedShare').lastChild.textContent = 'Podijeli';
  if (pg.date) dailyShare('Pasijans', pg.date, 6, pScore(pg.cards, pg.elapsed));
}
addEventListener('resize', () => view === 'pas' && drawPas());
$('solved').addEventListener('close', () => $('solvedTitle').textContent = 'Riješeno!');   // the other games' title
