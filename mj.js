// --- Mahjong: take the tiles off in pairs of the same face (any two flowers, any two seasons). A tile can
// go when nothing lies on it and its left or its right side is open. One a day (144 on an upright pyramid,
// 8 × 10, 4 layers), the same for everyone; Nova igra: Brzi (72) or Kornjača (144). Every deal is made
// backwards (pairs taken off a full board, both picked while free), so the order they came off in is a solution.
// A spot: [hx, hy, z] on a half grid (a tile is 2 × 2), so the half steps (the turtle's head) stay whole.
// Everything here starts with mj: the game files share one global scope. ---
const mjRect = (c0, c1, r0, r1, z) => { const out = []; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push([c * 2, r * 2, z]); return out; };
// A layout with each spot's neighbours worked out once: up (on it, one layer higher), l and r (beside it).
function mjLay(pos) {
  const side = d => pos.map(t => pos.flatMap((u, j) => u[2] === t[2] && u[0] === t[0] + d && Math.abs(u[1] - t[1]) < 2 ? [j] : []));
  return { pos, l: side(-2), r: side(2),
    up: pos.map(t => pos.flatMap((u, j) => u[2] === t[2] + 1 && Math.abs(u[0] - t[0]) < 2 && Math.abs(u[1] - t[1]) < 2 ? [j] : [])) };
}
const MJ = {
  daily: mjLay([...mjRect(0, 7, 0, 9, 0).filter(([x, y]) => !((x === 0 || x === 14) && (y === 0 || y === 18))),   // 76
    ...mjRect(1, 6, 1, 8, 1), ...mjRect(2, 5, 3, 6, 2), ...mjRect(3, 4, 4, 5, 3)]),                                  // 48, 16, 4
  quick: mjLay([...mjRect(0, 5, 0, 7, 0), ...mjRect(1, 4, 1.5, 5.5, 1), ...mjRect(2, 3, 3, 4, 2)]),                  // 48, 20, 4
  turtle: mjLay([...[[1, 12], [3, 10], [2, 11], [1, 12], [1, 12], [2, 11], [3, 10], [1, 12]].flatMap(([a, b], r) => mjRect(a, b, r, r, 0)),
    [0, 7, 0], [26, 7, 0], [28, 7, 0],                                                                               // the head, the tail
    ...mjRect(4, 9, 1, 6, 1), ...mjRect(5, 8, 2, 5, 2), ...mjRect(6, 7, 3, 4, 3), [13, 7, 4]]),
};
// Faces: d circles, b bamboo, c characters (1–9), w winds (E S W N), r dragons (red, green, white), f flowers, s seasons.
const MJ_KINDS = [...'dbc'].flatMap(s => [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => s + n)).concat('w0', 'w1', 'w2', 'w3', 'r0', 'r1', 'r2');
const MJ_BONUS = ['f0', 'f1', 'f2', 'f3', 's0', 's1', 's2', 's3'];
const mjFour = ks => ks.flatMap(k => [k, k, k, k]).concat(MJ_BONUS);
const MJ_SET = { daily: mjFour(MJ_KINDS), turtle: mjFour(MJ_KINDS),
  quick: mjFour([...'dbc'].flatMap(s => [1, 2, 3, 4].map(n => s + n)).concat('r0', 'r1', 'r2', 'w0')) };   // whole fours, 72
const mjGrp = f => 'fs'.includes(f[0]) ? f[0] : f;
const mjFree = (L, live, i) => live[i] && !L.up[i].some(j => live[j]) && !(L.l[i].some(j => live[j]) && L.r[i].some(j => live[j]));
const mjFrees = (L, live) => L.pos.flatMap((_, i) => mjFree(L, live, i) ? [i] : []);
// Why tile i can't go: the tiles on it, or (none on it) the ones closing it on both sides.
const mjWhy = (L, live, i) => { const up = L.up[i].filter(j => live[j]); return up.length ? up : [...L.l[i], ...L.r[i]].filter(j => live[j]); };
// The free pairs that match (0 = stuck).
const mjPairs = (L, face, live) => { const fr = mjFrees(L, live); return fr.flatMap((i, k) => fr.slice(k + 1).filter(j => mjGrp(face[i]) === mjGrp(face[j])).map(j => [i, j])); };

// The faces as pairs that match, in a random order.
function mjPairUp(faces, r) {
  const by = {};
  faces.forEach(f => (by[mjGrp(f)] ||= []).push(f));
  return shuffle(Object.values(by).flatMap(g => { shuffle(g, r); return g.flatMap((f, k) => k % 2 ? [] : [[f, g[k + 1]]]); }), r);
}
// One free spot, the higher layers a little likelier (fewer like faces piled in one column: less "solvable, but stuck").
const mjPick = (L, fr, r) => { let s = r() * fr.reduce((s, i) => s + 1 + L.pos[i][2], 0); return fr.find(i => (s -= 1 + L.pos[i][2]) < 0) ?? fr[fr.length - 1]; };
// Deal faces onto the spots at, backwards: take two free spots at once, give them a pair, take them off. A dead
// end (under two free) starts again, 50 times at most. → { face (per spot of L), path: the pairs, first move first } or null.
function mjDeal(L, at, faces, r) {
  for (let k = 0; k < 50; k++) {
    const live = L.pos.map(() => false), face = L.pos.map(() => null), path = [], pairs = mjPairUp(faces, r);
    at.forEach(i => live[i] = true);
    for (const [a, b] of pairs) {
      const fr = at.filter(i => mjFree(L, live, i));
      if (fr.length < 2) break;
      const i = mjPick(L, fr, r), j = mjPick(L, fr.filter(x => x !== i), r);
      face[i] = a; face[j] = b; live[i] = live[j] = false;
      path.push([i, j]);   // taken off a full board: the order is a game
    }
    if (path.length === pairs.length) return { face, path };
  }
  return null;
}
// A new board of layout lay ('daily', 'quick', 'turtle'); the daily's seed is 'mj#' + its date.
const mjMake = (lay, seed) => mjDeal(MJ[lay], MJ[lay].pos.map((_, i) => i), MJ_SET[lay], rng(hash(seed)));
// Promiješaj: the tiles left dealt anew onto the spots left (the removed keep their faces, for Poništi). Not
// always possible (two tiles stacked, one column left): null, and the button goes out.
function mjShuffle(L, face, live, seed) {
  const at = L.pos.flatMap((_, i) => live[i] ? [i] : []), d = mjDeal(L, at, at.map(i => face[i]), rng(hash(seed)));
  return d && { face: face.map((f, i) => live[i] ? d.face[i] : f), path: d.path };
}
// Savjet: the first pair of the deal's way still on the board and free; off that way (another copy taken), the
// free pair that frees the most tiles; none: null.
function mjHint(L, face, live, path) {
  const p = path.find(([i, j]) => mjFree(L, live, i) && mjFree(L, live, j));
  if (p) return p;
  const n = l => mjFrees(L, l).length;
  return mjPairs(L, face, live).map(([i, j]) => { const l = [...live]; l[i] = l[j] = false; return [n(l), i, j]; })
    .sort((a, b) => b[0] - a[0])[0]?.slice(1) ?? null;
}

// --- The faces: SVG 40 × 52 (circles, sticks, the bird, flowers, seasons drawn; 萬, the winds, 中 and 發 as
// text in the system's CJK font). The centre of a circle takes the tile's own colour (--face).
const MJ_K = { b: '#1d5fbf', g: '#2f8a4c', r: '#c2352b', k: '#1b1b1a', o: '#d9681c', y: '#c99a06', p: '#b5487d' };
const MJ_P = { 1: [[20, 26]], 2: [[20, 15], [20, 37]], 3: [[11, 12], [20, 26], [29, 40]], 4: [[12, 15], [28, 15], [12, 37], [28, 37]],
  5: [[12, 13], [28, 13], [20, 26], [12, 39], [28, 39]], 6: [[13, 11], [27, 11], [13, 26], [27, 26], [13, 41], [27, 41]],
  7: [[9, 9], [20, 15], [31, 21], [13, 33], [27, 33], [13, 44], [27, 44]], 8: [[13, 8], [27, 8], [13, 20], [27, 20], [13, 32], [27, 32], [13, 44], [27, 44]],
  9: [[9, 10], [20, 10], [31, 10], [9, 26], [20, 26], [31, 26], [9, 42], [20, 42], [31, 42]] };
const MJ_CJK = 'font-family="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, Noto Sans SC, sans-serif" font-weight="700"';
const mjTx = (s, x, y, size, fill) => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="middle" ${MJ_CJK}>${s}</text>`;
const mjDot = (x, y, r, c) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x}" cy="${y}" r="${r * .42}" style="fill:var(--face)"/>`;
const mjStick = (x, y, h, c) => `<rect x="${x - 2.3}" y="${y - h / 2}" width="4.6" height="${h}" rx="2.3" fill="${c}"/><rect x="${x - 2.3}" y="${y - .6}" width="4.6" height="1.2" style="fill:var(--face)"/>`;
function mjArt(f) {
  const s = f[0], n = +f[1], K = MJ_K;
  if (s === 'd') return n === 1 ? `<circle cx="20" cy="26" r="13" fill="${K.b}"/><circle cx="20" cy="26" r="8.5" style="fill:var(--face)"/><circle cx="20" cy="26" r="5" fill="${K.r}"/>`
    : MJ_P[n].map(([x, y], i) => mjDot(x, y, n >= 7 ? 4.6 : 5.6, [K.b, K.g, K.r][(i + n) % 3])).join('');
  if (s === 'b') return n === 1 ? `<path d="M10 40c4-2 8-6 10-12" stroke="${K.g}" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="21" cy="25" r="8" fill="${K.g}"/><circle cx="25" cy="19" r="4.5" fill="${K.r}"/><path d="M29 18l5 2-5 2z" fill="${K.y}"/>`
    : MJ_P[n].map(([x, y], i) => mjStick(x, y, n >= 7 ? 10 : 13, (n === 5 && i === 2) || (n === 9 && x === 20) || (n === 7 && i < 3) ? K.r : K.g)).join('');
  if (s === 'c') return mjTx('一二三四五六七八九'[n - 1], 20, 22, 16, K.k) + mjTx('萬', 20, 46, 18, K.r);
  if (s === 'w') return mjTx('東南西北'[n], 20, 36, 25, K.k);
  if (s === 'r') return n === 0 ? mjTx('中', 20, 37, 28, K.r) : n === 1 ? mjTx('發', 20, 36, 25, K.g)
    : `<rect x="8" y="9" width="24" height="34" rx="3" fill="none" stroke="${K.b}" stroke-width="2.5"/><rect x="12.5" y="13.5" width="15" height="25" rx="1" fill="none" stroke="${K.b}" stroke-width="1.2"/>`;
  if (s === 'f') { const c = [K.r, K.p, K.y, K.b][n];
    return `<path d="M20 30v15" stroke="${K.g}" stroke-width="2"/><path d="M20 40c-5 0-7-3-7-5 3 0 6 1 7 5z" fill="${K.g}"/>` + [0, 1, 2, 3, 4].map(k => { const a = k * 1.2566 - 1.5708; return `<circle cx="${20 + 7 * Math.cos(a)}" cy="${21 + 7 * Math.sin(a)}" r="5" fill="${c}"/>`; }).join('') + `<circle cx="20" cy="21" r="3.4" fill="${K.y}"/>`; }
  return [`<path d="M20 44V26" stroke="${K.g}" stroke-width="2.4" stroke-linecap="round"/><path d="M20 30c-9 0-11-7-11-10 7 0 11 4 11 10z M20 26c0-8 5-12 11-12 0 6-4 12-11 12z" fill="${K.g}"/>`,
    `<circle cx="20" cy="26" r="7.5" fill="${K.o}"/>` + [0, 1, 2, 3, 4, 5, 6, 7].map(k => { const a = k * .7854; return `<path d="M${20 + 11 * Math.cos(a)} ${26 + 11 * Math.sin(a)}L${20 + 15 * Math.cos(a)} ${26 + 15 * Math.sin(a)}" stroke="${K.o}" stroke-width="2.2" stroke-linecap="round"/>`; }).join(''),
    `<path d="M11 40C11 24 20 13 31 11c1 14-6 27-20 29z" fill="${K.o}"/><path d="M11 40L26 17" stroke="#f6f0e1" stroke-width="1.4"/>`,
    [0, 1, 2].map(k => `<g transform="rotate(${k * 60} 20 26)" stroke="${K.b}" stroke-width="2" stroke-linecap="round"><path d="M20 12v28M16 15l4 4 4-4M16 37l4-4 4 4"/></g>`).join('')][n];
}
const mjSvg = f => `<svg viewBox="0 0 40 52" aria-hidden="true">${mjArt(f)}</svg>`;

// --- On screen: the tiles placed once per game (a higher layer up and to the left by the edge's width, later in
// the page so a tap finds it first; only a face takes a tap, never an edge); a move only changes classes.
// A game: { lay, seed, face, path, live (1/0 per spot), hist (pairs taken, last last), mix (shuffles), help (ms
// of fines), elapsed (with them), solvedAt, noMix (no shuffle works now), date (the daily's) }.
const MJ_FINE = { undo: 10000, hint: 30000, mix: 60000 };   // the daily's only
let jg = null, jSel = -1, mjEls = [], mjBig = false;   // the game on screen, the tile picked, the tiles by spot, Kornjača zoomed in
const mjSave = () => { try { localStorage[jg.date ? 'mjDaily' : 'mjGame'] = JSON.stringify(jg); } catch {} };
const mjDays = () => tLoad('mjDone') || {};   // date → ms (with the fines) of each solved daily
const mjOpenView = which => { jSel = -1; try { localStorage.mjOn = which; } catch {} go('mj'); };
const mjFresh = (lay, seed) => { const d = mjMake(lay, seed); return { lay, seed, face: d.face, path: d.path, live: d.face.map(() => 1), hist: [], mix: 0, help: 0, elapsed: 0, solvedAt: null }; };
// The Igre tile: today's daily, dealt on the day's first open.
function openMj() {
  jg = tLoad('mjDaily');
  if (jg?.date !== dayKey()) { jg = { ...mjFresh('daily', 'mj#' + dayKey()), date: dayKey() }; mjSave(); }
  mjOpenView('daily');
}
// Nova igra: layout lay ('quick' or 'turtle'; the last one played if none); one under way at that layout goes on.
function mjGame(lay, fresh) {
  if (!lay) try { lay = localStorage.mjLay || 'quick'; } catch { lay = 'quick'; }
  try { localStorage.mjLay = lay; } catch {}
  jg = tLoad('mjGame');
  if (fresh || !jg || jg.solvedAt || jg.lay !== lay) { jg = mjFresh(lay, 'mj' + Math.random()); mjSave(); }
  mjOpenView('game');
}
$('tileMj').onclick = openMj;
$('mjBack').onclick = () => go('games');

// The board, sized to the room left (width and height; at most 60 wide): a layer's offset (the edge, --e) is
// about a ninth of a tile. Kornjača on a phone is small whole: Povećaj makes it 44 wide, moved with a finger.
function drawMj() {
  const L = MJ[jg.lay], P = L.pos, top = Math.max(...P.map(p => p[2])), cols = Math.max(...P.map(p => p[0])) / 2 + 1, rows = Math.max(...P.map(p => p[1])) / 2 + 1;
  const wrap = $('mjWrap'), room = innerHeight - wrap.getBoundingClientRect().top - (innerWidth >= 1100 ? 32 : 150), k = 58 / 44;
  const fit = Math.floor(Math.min(60, (wrap.clientWidth - 18) / (cols + top * .115), room / (rows * k + top * .115)));
  const small = fit < 40, W = small && mjBig ? 44 : Math.max(20, fit), H = Math.round(W * k), E = Math.max(2, Math.round(W * .115));
  const ord = P.map((_, i) => i).sort((a, b) => P[a][2] - P[b][2] || P[a][1] - P[b][1] || P[a][0] - P[b][0]);
  const b = $('mjb');
  b.style.cssText = `--e:${E}px;width:${cols * W + top * E}px;height:${rows * H + top * E}px`;
  b.innerHTML = ord.map(i => { const [x, y, z] = P[i];
    return `<div class="mt" data-i="${i}" style="--d:${top - z};left:${x / 2 * W + (top - z) * E}px;top:${y / 2 * H + (top - z) * E}px;width:${W}px;height:${H}px"><div class="f">${mjSvg(jg.face[i])}</div></div>`; }).join('');
  mjEls = [];
  for (const el of b.children) mjEls[+el.dataset.i] = el;
  $('mjName').textContent = jg.date ? 'Mahjong · dnevni' : `Mahjong · ${jg.lay === 'quick' ? 'Brzi' : 'Kornjača'}`;
  $('mjSide').textContent = jg.date ? new Date(jg.date + 'T12:00').toLocaleDateString('hr', { day: 'numeric', month: 'numeric' }) : '';
  $('mjNew').hidden = !!jg.date;
  $('mjZoom').hidden = !small;
  $('mjZoom').textContent = mjBig ? 'Cijela' : 'Povećaj';
  wrap.classList.toggle('zoom', small && mjBig);
  [['mjUndo', 'undo'], ['mjHint', 'hint'], ['mjMix', 'mix']].forEach(([id, f]) => $(id).lastChild.textContent = jg.date ? `+${MJ_FINE[f] / 1000} s` : '');
  mjMark();
}
// Classes after a move: gone, blocked (dimmed), picked; the count, the free pairs, the buttons.
function mjMark() {
  const L = MJ[jg.lay], left = jg.live.filter(Boolean).length, all = jg.live.length / 2, n = left ? mjPairs(L, jg.face, jg.live).length : 0;
  mjEls.forEach((el, i) => { el.classList.toggle('gone', !jg.live[i]); el.classList.toggle('blk', !!jg.live[i] && !mjFree(L, jg.live, i)); el.classList.toggle('sel', i === jSel); });
  $('mjLeft').firstChild.textContent = all - left / 2;
  $('mjLeft').lastChild.textContent = '/' + all;
  $('mjLine').innerHTML = !left ? '' : n ? `Mogući parovi: <b>${n}</b>` : jg.noMix ? '<b>Nema više parova.</b> Promiješati se ne može: Poništi.' : '<b>Nema više parova.</b> Poništi ili Promiješaj.';
  $('mjLine').classList.toggle('stuck', !!left && !n);
  $('mjUndo').disabled = !jg.hist.length || !!jg.solvedAt;
  $('mjHint').disabled = !n || !!jg.solvedAt;
  $('mjMix').disabled = !left || !!jg.noMix || !!jg.solvedAt;
  $('mjTimer').textContent = clock(jg.elapsed);
}

// A tap on a free tile picks it; the same again lets it go; a match takes both off; another free one is
// picked instead. A blocked one: red, the tiles that close it yellow (on it, else beside it), a short shake.
$('mjb').onclick = e => {
  const el = e.target.closest('.mt');
  if (!el || jg.solvedAt) return;
  const i = +el.dataset.i, L = MJ[jg.lay];
  if (!mjFree(L, jg.live, i)) return mjBlocked(i);
  if (jSel === i) jSel = -1;
  else if (jSel >= 0 && mjGrp(jg.face[jSel]) === mjGrp(jg.face[i])) {
    jg.live[jSel] = jg.live[i] = 0;
    jg.hist.push([jSel, i]);
    jSel = -1;
    jg.noMix = false;
    if (!jg.live.some(Boolean)) jg.solvedAt = Date.now();
    mjSave();
    if (jg.solvedAt) { mjMark(); return mjSolved(); }
  } else jSel = i;
  mjMark();
};
$('mjb').oncontextmenu = e => { e.preventDefault(); jSel = -1; mjMark(); };
let mjWhyT = 0;
function mjBlocked(i) {
  const L = MJ[jg.lay], on = L.up[i].some(j => jg.live[j]);
  mjEls.forEach(el => el.classList.remove('why', 'by'));
  mjEls[i].classList.add('why');
  mjWhy(L, jg.live, i).forEach(j => mjEls[j].classList.add('by'));
  if (!reduced()) mjEls[i].animate([{ transform: 'none' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 200 });
  navigator.vibrate?.(20);
  $('mjLine').innerHTML = on ? '<b>Na njoj leži pločica.</b> Makni žutu pa je slobodna.' : '<b>Zatvorena lijevo i desno.</b> Makni jednu od žutih pa je slobodna.';
  clearTimeout(mjWhyT);
  mjWhyT = setTimeout(() => { mjEls.forEach(el => el.classList.remove('why', 'by')); mjMark(); }, 1800);
}
// Help. The daily pays in time at once (the clock shows it); Nova igra is free.
function mjFine(f) {
  if (!jg.date) return;
  jg.elapsed += MJ_FINE[f];
  jg.help += MJ_FINE[f];
  const t = $('mjTimer');
  t.dataset.fine = `+${MJ_FINE[f] / 1000} s`;
  t.classList.remove('hit');
  void t.offsetWidth;   // the same class again restarts its animation
  t.classList.add('hit');
}
$('mjUndo').onclick = () => {
  if (!jg.hist.length || jg.solvedAt) return;
  const [i, j] = jg.hist.pop();
  jg.live[i] = jg.live[j] = 1;
  jSel = -1;
  jg.noMix = false;
  mjFine('undo');
  mjSave();
  mjMark();
};
$('mjHint').onclick = () => {
  if (jg.solvedAt) return;
  const h = mjHint(MJ[jg.lay], jg.face, jg.live, jg.path);
  if (!h) return;
  mjFine('hint');
  mjSave();
  mjMark();
  h.forEach(i => mjEls[i].classList.add('hint'));
  setTimeout(() => h.forEach(i => mjEls[i]?.classList.remove('hint')), 1800);
};
// Promiješaj: the tiles left dealt anew, solvable; when none of 50 deals works (two stacked, one column), no fine
// and the button goes out until the next move.
$('mjMix').onclick = () => {
  if (jg.solvedAt || jg.noMix) return;
  const m = mjShuffle(MJ[jg.lay], jg.face, jg.live, jg.seed + '#mix#' + ++jg.mix);
  if (!m) { jg.noMix = true; mjSave(); mjMark(); return; }
  Object.assign(jg, m);
  jSel = -1;
  mjFine('mix');
  mjSave();
  mjEls.forEach((el, i) => { if (jg.live[i]) { el.firstChild.innerHTML = mjSvg(jg.face[i]); if (!reduced()) el.firstChild.animate([{ opacity: .2 }, { opacity: 1 }], { duration: 260 }); } });
  mjMark();
};
$('mjNew').querySelectorAll('[data-lay]').forEach(b => b.onclick = () => {
  const start = () => mjGame(b.dataset.lay, true);
  jg.hist.length && !jg.solvedAt ? say('Nova igra? Ova se gubi.', 6000, ['Nova', start]) : start();
});
$('mjZoom').onclick = () => { mjBig = !mjBig; drawMj(); };
addEventListener('keydown', e => {
  if (view !== 'mj' || e.target.closest('input, textarea') || document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (k === 'z' && !e.altKey) { e.preventDefault(); $('mjUndo').click(); }
  else if (mod || e.altKey) return;
  else if (k === 'h') $('mjHint').click();
  else if (k === 's') $('mjMix').click();
  else if (k === 'escape') { jSel = -1; mjMark(); }
});
addEventListener('resize', () => view === 'mj' && drawMj());

// Solved: the shared card (card = 'mj'). The daily: the time with the fines, days in a row, the board (level 7);
// a game: its time and Nova igra.
function mjSolved() {
  card = 'mj';
  $('solved').className = 'mj';
  $('solvedMenu').textContent = 'Igre';
  $('diffSolved').hidden = $('solvedTechs').hidden = $('lboard').hidden = true;
  const help = jg.help ? ` (pomoć +${clock(jg.help)})` : '';
  if (jg.date) {
    const done = mjDays();
    done[jg.date] = jg.elapsed;
    try { localStorage.mjDone = JSON.stringify(done); } catch {}
    $('solvedText').textContent = `Riješeno za ${clock(jg.elapsed)}${help} · ${daysWord(streak(Object.keys(done)))} zaredom`;
    lbNow = { day: jg.date, level: 7, ms: jg.elapsed };
    if (lbName()) lbQueue(lbNow.day, 7, lbNow.ms);
    lbShow(lbNow.day, 7, lbNow.ms);
  } else $('solvedText').textContent = `Vrijeme: ${clock(jg.elapsed)}`;
  mjButtons();
  setTimeout(() => view === 'mj' && $('solved').showModal(), reduced() ? 0 : 500);
}
function mjButtons() {
  $('solvedClose').hidden = $('solvedLevel').hidden = true;
  $('solvedNext').hidden = !!jg.date;
  $('solvedShare').hidden = !jg.date;
  $('solvedShare').classList.remove('quiet');
  $('solvedShare').lastChild.textContent = 'Podijeli';
  if (jg.date) dailyShare('Mahjong', jg.date, 7, jg.elapsed);
}
