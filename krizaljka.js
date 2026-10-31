// --- Moja križaljka: the user names a topic, the server (Supabase function "krizaljka", Claude) sends
// back terms with clues, and the grid is woven here: each term goes where it crosses the most, no two
// letters side by side outside a word, many random orders, the densest kept. LJ, NJ and DŽ are one cell. ---
const XW_W = 11, XW_H = 13;
const xwCells = w => w.toUpperCase().match(/LJ|NJ|DŽ|./gu);   // when the server sends no cells of its own

// One try: terms in this order, each placed at its best crossing. Returns the placed terms and the size.
function xwWeave(order, r) {
  const g = new Map(), placed = [];   // "row,col" → { ch, a: across word here?, d: down word here? }
  const at = (y, x) => g.get(y + ',' + x);
  let r0 = 0, r1 = 0, c0 = 0, c1 = 0;
  const fits = (w, y0, x0, dir) => {
    const dy = dir === 'd' ? 1 : 0, dx = 1 - dy;
    if (at(y0 - dy, x0 - dx) || at(y0 + dy * w.length, x0 + dx * w.length)) return -1;
    let cross = 0;
    for (let i = 0; i < w.length; i++) {
      const y = y0 + dy * i, x = x0 + dx * i, c = at(y, x);
      if (c) { if (c.ch !== w[i] || c[dir]) return -1; cross++; continue; }
      if (at(y + dx, x + dy) || at(y - dx, x - dy)) return -1;   // a neighbour across the word's line
    }
    return cross;
  };
  const put = (t, y0, x0, dir) => {
    const dy = dir === 'd' ? 1 : 0, dx = 1 - dy;
    t.cells.forEach((ch, i) => { const k = (y0 + dy * i) + ',' + (x0 + dx * i), c = g.get(k) || { ch }; c[dir] = true; g.set(k, c); });
    r0 = Math.min(r0, y0); c0 = Math.min(c0, x0); r1 = Math.max(r1, y0 + dy * (t.cells.length - 1)); c1 = Math.max(c1, x0 + dx * (t.cells.length - 1));
    placed.push({ t, r: y0, c: x0, dir });
  };
  put(order[0], 0, 0, r() < .5 ? 'a' : 'd');
  for (const t of order.slice(1)) {
    const w = t.cells;
    let best = null;
    for (const [k, c] of g) {
      const [y, x] = k.split(',').map(Number);
      for (let i = 0; i < w.length; i++) if (w[i] === c.ch) for (const dir of ['a', 'd']) {
        if (c[dir]) continue;
        const y0 = dir === 'd' ? y - i : y, x0 = dir === 'a' ? x - i : x, cross = fits(w, y0, x0, dir);
        if (cross < 1) continue;
        const h = Math.max(r1, y0 + (dir === 'd' ? w.length - 1 : 0)) - Math.min(r0, y0) + 1, wd = Math.max(c1, x0 + (dir === 'a' ? w.length - 1 : 0)) - Math.min(c0, x0) + 1;
        if (h > XW_H || wd > XW_W) continue;
        const score = cross * 100 - h * wd / 10 + r();
        if (!best || score > best.score) best = { score, y0, x0, dir };
      }
    }
    if (best) put(t, best.y0, best.x0, best.dir);
  }
  const crossings = [...g.values()].filter(c => c.a && c.d).length;
  return { placed: placed.map(p => ({ ...p, r: p.r - r0, c: p.c - c0 })), rows: r1 - r0 + 1, cols: c1 - c0 + 1, crossings };
}

// terms: [{ cells: ['K','NJ',…], clue }]. The same seed gives the same grid.
function xwMake(terms, seed, tries = 600) {
  const r = rng(seed);
  let best = null;
  for (let i = 0; i < tries; i++) {
    const res = xwWeave(shuffle(terms.slice(), r), r), val = res.placed.length * 1000 + res.crossings * 10 - res.rows * res.cols / 20;
    if (!best || val > best.val) best = { ...res, val };
  }
  return best;
}

// --- The screens: Križaljke (your topics as cards, a new one below, the wait while it is made) and the
// game (C1: white cells, the clue in a bar, own keyboard with LJ NJ DŽ). Topics and games stay on the device:
// xwTopics { key: { tema, pojmovi } }, xwGames { key: { seed, lay: [[term, row, col, dir]], rows, cols, fill, done, at } }. ---
const XW_URL = 'https://fgllmnemukhouwyebfop.supabase.co/functions/v1/krizaljka';
const XW_IDEAS = ['Svemir', 'Dinosauri', 'Grčki bogovi', 'Hrvatski otoci', 'Nogomet', 'Kuhinja', 'Glazbala', 'Harry Potter'];
const XW_KEYS = ['E R T Z U I O P Š Đ', 'A S D F G H J K L Č Ć Ž', 'LJ NJ DŽ C V B N M ⌫'];
const xwGet = k => { try { return JSON.parse(localStorage[k] || '{}'); } catch { return {}; } };
const xwSet = (k, v) => { try { localStorage[k] = JSON.stringify(v); } catch {} };
let xw = null, xwBusy = false;   // xw: the game on screen; xwBusy: a topic is being made

// A game's words with their cells and numbers (reading order of the first cells, one number per start).
function xwWords(key) {
  const g = xwGet('xwGames')[key], terms = xwGet('xwTopics')[key].pojmovi;
  const words = g.lay.map(([i, r, c, dir]) => ({ cells: terms[i].slova, clue: terms[i].trag, dir,
    at: terms[i].slova.map((_, j) => (r + (dir === 'd' ? j : 0)) + ',' + (c + (dir === 'a' ? j : 0))) }));
  const starts = [...new Set(words.map(w => w.at[0]))].sort((a, b) => { const [ra, ca] = a.split(','), [rb, cb] = b.split(','); return ra - rb || ca - cb; });
  words.forEach(w => w.n = starts.indexOf(w.at[0]) + 1);
  return words.sort((a, b) => a.n - b.n || (a.dir === 'a' ? -1 : 1));
}
const xwSolved = (w, fill) => w.at.every((k, j) => fill[k] === w.cells[j]);

function xwTile() {
  const games = xwGet('xwGames'), key = Object.keys(games).sort((a, b) => games[b].at - games[a].at)[0];
  if (!key) return Object.assign($('tileXw').lastChild, { textContent: 'Odaberi temu', className: '' });
  const words = xwWords(key), n = words.filter(w => xwSolved(w, games[key].fill)).length;
  Object.assign($('tileXw').lastChild, { className: games[key].done ? 'solved' : '',
    textContent: xwGet('xwTopics')[key].tema + (games[key].done ? ' ✓' : ` · ${n} od ${words.length}`) });
}

// Križaljke: a card per topic (a small picture of its grid, how far), "Nova tema", the form and ideas.
function showXw() {
  $('xwPick').hidden = xwBusy;
  $('xwWait').hidden = !xwBusy;
  const games = xwGet('xwGames'), topics = xwGet('xwTopics');
  $('xwCards').replaceChildren($('xwPlus'), ...Object.keys(games).sort((a, b) => games[b].at - games[a].at).map(key => {
    const g = games[key], words = xwWords(key), n = words.filter(w => xwSolved(w, g.fill)).length;
    const b = Object.assign(document.createElement('button'), { className: 'xcard', onclick: () => xwOpen(key) });
    const mini = Object.assign(document.createElement('div'), { className: 'xmini' }), on = new Set(words.flatMap(w => w.at));
    mini.style.gridTemplateColumns = `repeat(${g.cols}, 1fr)`;
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      const k = r + ',' + c;
      mini.append(Object.assign(document.createElement('i'), { className: !on.has(k) ? '' : g.fill[k] ? 'f' : 'e' }));
    }
    const t = document.createElement('span');
    t.append(Object.assign(document.createElement('b'), { textContent: topics[key].tema }),
      Object.assign(document.createElement('small'), { textContent: g.done ? 'Riješeno ✓' : `${n} od ${words.length}`, className: g.done ? 'solved' : '' }));
    b.append(mini, t);
    return b;
  }));
  if (!$('xwIdeas').childElementCount) $('xwIdeas').append(...XW_IDEAS.map(t => Object.assign(document.createElement('button'), {
    type: 'button', textContent: t, onclick: () => { $('xwTopic').value = t; xwAsk(t); } })));
}
document.querySelectorAll('.weave i:not(.e)').forEach((i, n) => i.style.animationDelay = n * 0.08 + 's');   // the cells appear one by one
$('xwPlus').onclick = () => $('xwTopic').focus();
$('xwForm').onsubmit = e => { e.preventDefault(); xwAsk($('xwTopic').value); };
$('xwHome').onclick = () => go('games');
$('tileXw').onclick = () => go('xw');

// A topic: from the device if it was made before, else from the server (Claude, up to a minute the first time).
async function xwAsk(raw) {
  const tema = raw.trim().replace(/\s+/g, ' '), key = tema.toLowerCase();
  if (tema.length < 2) return say('Upiši temu, npr. *svemir*.');
  if (xwGet('xwTopics')[key]) return xwGet('xwGames')[key] ? xwOpen(key) : xwNew(key);
  xwBusy = true;
  $('xwWaitName').textContent = tema;
  $('xwSteps').className = 'at1';
  showXw();
  try {
    const res = await fetch(XW_URL, { method: 'POST', headers: { apikey: LB_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ tema }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.pojmovi) throw new Error(data.greska || 'Generator trenutno ne radi. Probaj malo kasnije.');
    const topics = xwGet('xwTopics');
    topics[key] = { tema: data.tema, pojmovi: data.pojmovi };
    xwSet('xwTopics', topics);
    $('xwSteps').className = 'at2';
    await new Promise(r => setTimeout(r, 50));   // let the step show before the grid is woven
    xwNew(key);
  } catch (e) {
    xwBusy = false;
    if (view === 'xw') showXw();
    say(e instanceof TypeError ? 'Nema veze s internetom. Nova tema treba internet.' : e.message, Infinity);
  }
}

// A new grid from the topic's terms (a new seed each time: other terms, other crossings).
function xwNew(key) {
  const terms = xwGet('xwTopics')[key].pojmovi.map((p, i) => ({ cells: p.slova, i })), seed = Date.now() % 2147483647;
  const res = xwMake(terms, seed), games = xwGet('xwGames');
  games[key] = { seed, lay: res.placed.map(p => [p.t.i, p.r, p.c, p.dir]), rows: res.rows, cols: res.cols, fill: {}, done: false, at: Date.now() };
  xwSet('xwGames', games);
  xwBusy = false;
  xwOpen(key);
}

function xwOpen(key) {
  const g = xwGet('xwGames')[key], words = xwWords(key);
  xw = { key, g, words, sel: words.find(w => !xwSolved(w, g.fill)) || words[0] };
  xw.k = xw.sel.at.find(k => !g.fill[k]) || xw.sel.at[0];
  try { localStorage.xwOn = key; } catch {}
  go('xwplay');
}
const xwSave = () => { const games = xwGet('xwGames'); xw.g.at = Date.now(); games[xw.key] = xw.g; xwSet('xwGames', games); };

function drawXw() {
  const { g, words, sel } = xw, cell = {}, solved = new Set(), bad = new Set();
  for (const w of words) {
    w.at.forEach((k, j) => cell[k] = w.cells[j]);
    if (xwSolved(w, g.fill)) w.at.forEach(k => solved.add(k));
    else if (w.at.every(k => g.fill[k])) w.at.forEach((k, j) => g.fill[k] !== w.cells[j] && bad.add(k));   // a full word, wrong: show where
  }
  const n = words.filter(w => xwSolved(w, g.fill)).length;
  $('xwName').textContent = xwGet('xwTopics')[xw.key].tema;
  $('xwSide').textContent = `${n} od ${words.length}`;
  $('xg').style.gridTemplateColumns = `repeat(${g.cols}, minmax(0, 1fr))`;
  const nums = Object.fromEntries(words.map(w => [w.at[0], w.n]));
  $('xg').replaceChildren(...Array.from({ length: g.rows * g.cols }, (_, i) => {
    const k = ((i / g.cols) | 0) + ',' + (i % g.cols), d = document.createElement('div');
    if (!cell[k]) return d;
    d.dataset.k = k;
    d.className = 'l' + (g.done ? '' : sel.at.includes(k) ? (k === xw.k ? ' cur' : ' act') : '') + (solved.has(k) ? ' ok' : bad.has(k) ? ' bad' : '') + ((g.fill[k] || '').length > 1 ? ' two' : '');
    d.textContent = g.fill[k] || '';
    if (nums[k]) d.prepend(Object.assign(document.createElement('sup'), { textContent: nums[k] }));
    return d;
  }));
  $('xwClue').hidden = $('xwKb').hidden = g.done;
  $('xwDone').hidden = !g.done;
  $('xwClue').querySelector('p').replaceChildren(Object.assign(document.createElement('b'), { textContent: `${sel.n} ${sel.dir === 'a' ? '→' : '↓'} ` }), `${sel.clue} (${sel.cells.length})`);
  if (!$('xwKb').childElementCount) $('xwKb').append(...XW_KEYS.map(row => {
    const div = document.createElement('div');
    div.append(...row.split(' ').map(ch => Object.assign(document.createElement('button'), { textContent: ch, className: ch.length > 1 ? 'w' : '',
      ariaLabel: ch === '⌫' ? 'Briši' : null, onclick: () => ch === '⌫' ? xwBack() : xwPut(ch) })));
    return div;
  }));
}

// Tap a cell: its word (the one already chosen if it is in it); the same cell again turns to the other word.
$('xg').onclick = e => {
  const k = e.target.closest('[data-k]')?.dataset.k;
  if (!k || xw.g.done) return;
  const mine = xw.words.filter(w => w.at.includes(k));
  xw.sel = k === xw.k && mine.length > 1 ? mine.find(w => w !== xw.sel) : mine.includes(xw.sel) ? xw.sel : mine[0];
  xw.k = k;
  drawXw();
};
function xwPut(ch) {
  const { g, sel } = xw, i = sel.at.indexOf(xw.k);
  g.fill[xw.k] = ch;
  if (xwSolved(sel, g.fill)) {   // word done: on to the next unsolved one
    const rest = xw.words.filter(w => !xwSolved(w, g.fill));
    g.done = !rest.length;
    if (rest.length) { xw.sel = rest.find(w => w.n > sel.n) || rest[0]; xw.k = xw.sel.at.find(k => !g.fill[k]) || xw.sel.at[0]; }
  } else xw.k = sel.at.slice(i + 1).find(k => !g.fill[k]) ?? sel.at[Math.min(i + 1, sel.at.length - 1)];
  xwSave();
  drawXw();
}
function xwBack() {
  const { g, sel } = xw, i = sel.at.indexOf(xw.k);
  if (!g.fill[xw.k] && i > 0) xw.k = sel.at[i - 1];
  delete g.fill[xw.k];
  xwSave();
  drawXw();
}
const xwStep = d => { const i = xw.words.indexOf(xw.sel), w = xw.words[(i + d + xw.words.length) % xw.words.length]; xw.sel = w; xw.k = w.at.find(k => !xw.g.fill[k]) || w.at[0]; drawXw(); };
$('xwPrev').onclick = () => xwStep(-1);
$('xwNext').onclick = () => xwStep(1);
$('xwBack').onclick = () => go('xw');
$('xwAgain').onclick = () => xwNew(xw.key);
// A computer keyboard: letters and Backspace (ponytail: LJ/NJ/DŽ only from the on-screen keys).
addEventListener('keydown', e => {
  if (view !== 'xwplay' || xw.g.done || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Backspace') { e.preventDefault(); return xwBack(); }
  if (/^[a-zčćžšđ]$/i.test(e.key)) xwPut(e.key.toUpperCase());
});
