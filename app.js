// Shared by every game: messages, the screens (Igre, Povijest, Sudoku, its game, Tango, Križaljke) and the tab bar,
// "Instaliraj", the leaderboard, the clock. Loaded first, then sudoku.js, scan.js, tango.js, krizaljka.js; index.html starts the app.

const $ = id => document.getElementById(id);
// A message as a toast under the top bar (*word* = bold). Info goes by itself after ms (3 s, longer for
// long text); an error or an instruction (ms = Infinity) stays until ✕ or the state changes (go). '' hides it.
// act: [label, fn] puts one action button in it (e.g. "Uključi").
let msgTimer, tipOn = false;   // tipOn: the first games' Savjet tip is showing
function say(t, ms = Math.max(3000, t.length * 50), act) {
  clearTimeout(msgTimer);
  tipOn = false;
  $('toast').classList.toggle('on', !!t);
  if (!t) return;
  $('toast').setAttribute('role', ms < Infinity ? 'status' : 'alert');
  $('msg').replaceChildren(...t.split('*').map((s, i) => i % 2 ? Object.assign(document.createElement('b'), { textContent: s }) : s));
  $('msgClose').hidden = ms < Infinity;
  $('msgAct').hidden = !act;
  if (act) { $('msgAct').textContent = act[0]; $('msgAct').onclick = () => { say(''); act[1](); }; }
  if (ms < Infinity) msgTimer = setTimeout(() => say(''), ms);
}
$('msgClose').onclick = () => say('');
// While OpenCV and the model load: a quiet line over Skeniraj / Iz galerije ('' when ready).
const loading = t => { $('loading').textContent = t; $('loading').hidden = !t; };

// The screens: Igre and Povijest (on the tab bar), Sudoku's menu and its game, Tango. Going between them
// animates nothing and keeps everything: a game stays on its board. Remembered, so a reload (or the app
// opened again) comes back where the user was.
const VIEWS = ['games', 'past', 'menu', 'game', 'tmenu', 'tango', 'nit', 'mino', 'pas', 'mj', 'xw', 'xwplay'];
let view = 'games';
function go(v) {
  if (armed) arm(0);
  view = v;
  try { localStorage.sudokuView = v; } catch {}
  VIEWS.forEach(x => $(x).hidden = x !== v);
  $('tabs').hidden = v !== 'games' && v !== 'past';
  $('tabGames').ariaCurrent = v === 'games' ? 'page' : null;
  $('tabPast').ariaCurrent = v === 'past' ? 'page' : null;
  say('');   // a message belongs to the screen it was said on
  ({ games: showGames, past: showPast, menu: showMenu, game: placeBubble, tmenu: showTmenu, tango: drawTango, nit: drawNit, mino: drawMino, pas: drawPas, mj: drawMj, xw: showXw, xwplay: drawXw })[v]();
  showRail();
}

// Stairs: the sign of a level everywhere, 1, 2 or 3 bars in green, yellow, orange (Lagano, Srednje, Teško).
// grow: the level's own bar fills once (only on a solved card: rare, so it may please).
function stairs(lvl, big, grow) {
  const s = Object.assign(document.createElement('span'), { className: 'stairs' + (big ? ' big' : '') });
  s.role = 'img';
  s.ariaLabel = ['Lagano', 'Srednje', 'Teško'][lvl];
  s.style.setProperty('--c', `var(${['--easy', '--medium', '--hard'][lvl]})`);
  s.append(...[0, 1, 2].map(j => Object.assign(document.createElement('i'), { className: (j <= lvl ? 'f' : '') + (grow && j === lvl ? ' grow' : '') })));
  return s;
}
document.querySelectorAll('[data-stairs]').forEach(el => el.replaceWith(stairs(+el.dataset.stairs)));   // the markup's level signs

// The rail (from 1100px, CSS): where you are, each game's state today, a dot where something waits.
// Folded to icons by the button or [, kept; in a game it folds by itself and opens again after.
const RAIL_ON = { games: 'games', past: 'past', menu: 'menu', game: 'menu', tmenu: 'tango', tango: 'tango', nit: 'nit', mino: 'mino', pas: 'pas', mj: 'mj', xw: 'xw', xwplay: 'xw' };
const railMini = () => { try { return localStorage.railMini === '1'; } catch { return false; } };
function showRail() {
  document.body.classList.toggle('railmini', railMini() || ['game', 'tango', 'nit', 'mino', 'pas', 'mj', 'xwplay'].includes(view));
  // today's, read afresh (days is the day being played, maybe an older one)
  const solved = readDay().levels.filter(st => st?.solvedAt).length, tSolved = tToday().filter(g => g?.solvedAt).length;
  const games = xwGames(), key = Object.keys(games).sort((a, b) => games[b].at - games[a].at)[0], p = key && xwProgress(key, games);
  const xwText = p ? (p.done ? '✓' : `${p.n} od ${p.words.length}`) : '';
  const n = tLoad('nitDaily'), nDone = n?.date === dayKey() && n.solvedAt, mSolved = mToday().filter(g => g?.solvedAt).length, pa = tLoad('pasDaily'), pDone = pa?.date === dayKey() && pa.endedAt;
  const j = tLoad('mjDaily'), jDone = j?.date === dayKey() && j.solvedAt;
  const state = { menu: [solved === 3 ? '✓' : `${solved} od 3`, solved < 3], tango: [tSolved === 3 ? '✓' : `${tSolved} od 3`, tSolved < 3], xw: [xwText, false],
    nit: [nDone ? '✓' : n?.date === dayKey() && n.elapsed ? 'u tijeku' : 'čeka', !nDone],
    mino: [mSolved === 3 ? '✓' : `${mSolved} od 3`, mSolved < 3],
    pas: [pDone ? '✓' : pa?.date === dayKey() && pa.elapsed ? 'u tijeku' : 'čeka', !pDone],
    mj: [jDone ? '✓' : j?.date === dayKey() && j.elapsed ? 'u tijeku' : 'čeka', !jDone] };
  for (const b of $('rail').querySelectorAll('[data-v]')) {
    b.ariaCurrent = RAIL_ON[view] === b.dataset.v ? 'page' : null;
    if (!state[b.dataset.v]) continue;
    const [text, waits] = state[b.dataset.v];
    Object.assign(b.querySelector('small'), { textContent: text, className: text === '✓' ? 'solved' : '' });
    b.classList.toggle('waits', waits);
  }
}
document.querySelectorAll('[data-tile]').forEach(el => el.prepend($(el.dataset.tile).firstChild.cloneNode(true)));   // the tiles' pictures
$('rail').onclick = e => {
  const v = e.target.closest('[data-v]')?.dataset.v;
  if (v) v === 'tango' ? go('tmenu') : v === 'nit' ? openNit() : v === 'mino' ? openMino() : v === 'pas' ? openPas() : v === 'mj' ? openMj() : go(v);
};
function railFold() {
  const mini = !document.body.classList.contains('railmini');
  if (!['game', 'tango', 'nit', 'mino', 'pas', 'mj', 'xwplay'].includes(view)) try { localStorage.railMini = mini ? '1' : '0'; } catch {}
  document.body.classList.toggle('railmini', mini);
}
$('railFold').onclick = railFold;

// The theme: Auto (the phone's), Svijetla or Tamna; one tap moves to the next. index.html sets it before the first paint.
const THEMES = [['', 'Auto', '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor"/>'],
  ['light', 'Svijetla', '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>'],
  ['dark', 'Tamna', '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>']];
function showTheme() {
  const t = document.documentElement.dataset.theme || '', [, name, icon] = THEMES.find(x => x[0] === t);
  for (const b of [$('themeBar'), $('themeRail')]) { b.querySelector('svg').innerHTML = icon; b.title = b.ariaLabel = `Tema: ${name}`; }
  $('themeRail').querySelector('small').textContent = name;
  // the browser's bar: the chosen theme's ground, or back to each media query's own
  document.querySelectorAll('meta[name=theme-color]').forEach((m, i) => m.content = t ? (t === 'dark' ? '#111110' : '#f4f3f1') : ['#f4f3f1', '#111110'][i]);
}
document.querySelectorAll('.theme').forEach(b => b.onclick = () => {
  const t = THEMES[(THEMES.findIndex(x => x[0] === (document.documentElement.dataset.theme || '')) + 1) % 3][0];
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  try { t ? localStorage.theme = t : localStorage.removeItem('theme'); } catch {}
  showTheme();
});
showTheme();
addEventListener('keydown', e => { if (e.key === '[' && !e.target.closest('input, textarea') && matchMedia('(min-width: 1100px)').matches) railFold(); });

// Danas (Igre with the rail): a card per game (its picture, name and state; the whole card plays), today's top three
// on a podium under it, the last sudokus.
// A game's picture, drawn from its own pieces in its colour (currentColor): mockups/danas-kartice.html V6.
const D_ART = {
  sud: () => { let s = ''; const f = [0, 4, 8, 10, 15, 21, 23, 30, 33, 38, 40, 44, 47, 52, 56, 60, 63, 67, 70, 76, 80];
    for (let i = 0; i < 81; i++) s += `<rect x="${i % 9 * 10 + (i % 9 / 3 | 0) * 2}" y="${(i / 9 | 0) * 10 + (i / 27 | 0) * 2}" width="9" height="9" rx="1.5" fill="currentColor" opacity="${f.includes(i) ? .9 : .14}"/>`;
    return `<svg viewBox="0 0 94 94">${s}</svg>`; },
  din: () => { let s = ''; const m = 'ESEDSDDESEDSSDDESEEDSESDDSEDSEESDSED';
    for (let i = 0; i < 36; i++) { const x = i % 6 * 16 + 8, y = (i / 6 | 0) * 16 + 8;
      s += `<rect x="${x - 7.5}" y="${y - 7.5}" width="15" height="15" rx="3" fill="currentColor" opacity=".1"/>`;
      if (m[i] === 'E') s += `<ellipse cx="${x}" cy="${y + .5}" rx="4.2" ry="5.3" fill="currentColor"/>`;
      if (m[i] === 'D') s += `<circle cx="${x}" cy="${y}" r="4.6" fill="none" stroke="currentColor" stroke-width="2"/>`; }
    return `<svg viewBox="0 0 96 96">${s}</svg>`; },
  nit: () => { let s = ''; for (let i = 0; i < 36; i++) s += `<circle cx="${i % 6 * 16 + 8}" cy="${(i / 6 | 0) * 16 + 8}" r="2" fill="currentColor" opacity=".25"/>`;
    const p = [[0,0],[1,0],[2,0],[2,1],[1,1],[0,1],[0,2],[0,3],[1,3],[1,2],[2,2],[3,2],[3,1],[3,0],[4,0],[5,0],[5,1],[4,1],[4,2],[5,2],[5,3],[4,3],[3,3],[2,3]].map(([x, y]) => `${x * 16 + 8},${y * 16 + 8}`).join(' ');
    return `<svg viewBox="0 0 96 96">${s}<polyline points="${p}" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="8" r="5" fill="currentColor"/></svg>`; },
  min: () => { let s = ''; const g = '..1F2...1222..1x1....111.......1221..';
    for (let i = 0; i < 36; i++) { const x = i % 6 * 16, y = (i / 6 | 0) * 16, c = g[i] || '.', open = c !== 'x' && c !== 'F' && (i % 6 + (i / 6 | 0)) % 3 !== 0;
      s += `<rect x="${x + .5}" y="${y + .5}" width="15" height="15" rx="2.5" fill="currentColor" opacity="${open ? .08 : .35}"/>`;
      if (open && /\d/.test(c)) s += `<text x="${x + 8}" y="${y + 12}" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor">${c}</text>`;
      if (c === 'F') s += `<path d="M${x + 6} ${y + 13}V${y + 3}l6 3-6 3" fill="currentColor"/>`; }
    return `<svg viewBox="0 0 96 96">${s}</svg>`; },
  pas: () => `<svg viewBox="0 0 110 90">${[-18, -6, 6, 18].map((r, i) => `<rect x="37" y="12" width="36" height="52" rx="4" transform="rotate(${r} 55 95)" fill="${i === 3 ? 'var(--surface)' : 'currentColor'}" opacity="${i === 3 ? 1 : .25 + i * .2}" stroke="currentColor" stroke-width="${i === 3 ? 1.5 : 0}"/>`).join('')}<path d="M68 47l-5-4.7a3 3 0 0 1 5-3.4 3 3 0 0 1 5 3.4z" fill="#c2352b" transform="rotate(18 55 95)"/></svg>`,
  mj: () => `<svg viewBox="0 0 96 90">${[[0,2,0],[1,2,0],[2,2,0],[3,2,0],[.5,1,0],[1.5,1,0],[2.5,1,0],[1,0,0],[2,0,0],[1,1.2,1],[2,1.2,1],[1.5,.6,2]].map(([x, y, z]) => { const X = 8 + x * 20 - z * 3, Y = 10 + y * 24 - z * 3;
    return `<rect x="${X + 2}" y="${Y + 2}" width="18" height="23" rx="3" fill="currentColor" opacity=".55"/><rect x="${X}" y="${Y}" width="18" height="23" rx="3" fill="var(--surface)" stroke="currentColor" stroke-opacity=".5"/><circle cx="${X + 9}" cy="${Y + 11.5}" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/>`; }).join('')}</svg>`,
};
document.querySelectorAll('.gcard').forEach(c => c.querySelector('.gart').insertAdjacentHTML('afterbegin', D_ART[c.dataset.g]()));
// The podium under a card: 2 · 1 · 3 from lbRows' rows (null: it did not load); above it a line: the note (Sudoku's level),
// and your place when you are not on the podium.
function throne(el, b, note) {
  const top = b ? b.rows.filter(r => !r.classList.contains('apart')) : [], apart = b?.rows.find(r => r.classList.contains('apart'));
  const step = p => { const r = top[p - 1], [, name = '', time = ''] = r ? [...r.children].map(x => x.textContent) : [];
    const s = Object.assign(document.createElement('span'), { className: `p${p}${r ? '' : ' empty'}${r?.classList.contains('me') ? ' me' : ''}` });
    s.append(...[[name.slice(0, 1).toUpperCase(), 'av'], [name, 'nm'], [time, 'tm'], [p, 'step']].map(([t, k]) => Object.assign(document.createElement('span'), { textContent: t, className: k })));
    return s; };
  el.querySelector('.gline').textContent = [note, !b ? 'Nije se učitalo' : !b.all ? 'Još nitko' : apart && `Ti si ${b.place}. · ${apart.children[2].textContent}`].filter(Boolean).join(' · ');
  el.querySelector('.podium').replaceChildren(step(2), step(1), step(3));
  el.querySelector('.podium').classList.remove('swap');
}
// Sudoku's, Dinango's and Minolovac's three levels (mockups/danas-razine.html V3): a bar with its name each, the one on the podium dark.
// All three solved: each is a button inside the card's button (a span, so the card is not opened); it swaps the podium.
const dPick = {};
function levelBars(id, done, at) {
  const pick = i => { dPick[id] = i; $(id).querySelector('.podium').classList.add('swap'); showToday(); };
  $(id).querySelector('.glv').replaceChildren(...DAILY.map(([name], i) => {
    const s = Object.assign(document.createElement('span'), { className: i === at ? 'on' : '' });
    s.append(Object.assign(document.createElement('i'), { className: done[i] ? 'done' : '' }), name);
    if (done.every(Boolean)) Object.assign(s, { role: 'button', tabIndex: 0, ariaPressed: i === at,
      onclick: e => { e.stopPropagation(); pick(i); },
      onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pick(i); } } });
    return s; }));
}
let todayAsk = 0;
function showToday() {
  const li = (a, b, cls = '') => { const x = document.createElement('li'); x.append(...[a, b].map((t, i) => Object.assign(document.createElement('span'), { textContent: t, className: i ? cls : '' }))); return x; };
  $('dDate').textContent = new Date().toLocaleDateString('hr', { weekday: 'long', day: 'numeric', month: 'long' });
  // Sudoku: three bars; its podium is the level picked (all three solved), else the last solved today, else the next to play
  const lv = loadDays().levels, next = lv.findIndex(st => !st?.solvedAt), solved = lv.filter(st => st?.solvedAt).length;
  const sLv = solved === 3 && dPick.gSud != null ? dPick.gSud : lv.reduce((a, st, i) => st?.solvedAt ? i : a, Math.max(next, 0));
  levelBars('gSud', DAILY.map((_, i) => !!lv[i]?.solvedAt), sLv);
  // the others: today's saved game, done or going; ms: your number on the board
  const one = (key, done = g => g.solvedAt) => { const g = tLoad(key), on = g?.date === dayKey(); return { done: on && !!done(g), going: on && !!g.elapsed, ms: g?.elapsed }; };
  const tl = tToday(), tNext = tl.findIndex(g => !g?.solvedAt), tSolved = tl.filter(g => g?.solvedAt).length;
  const tLv = tSolved === 3 && dPick.gDin != null ? dPick.gDin : tl.reduce((a, g, i) => g?.solvedAt ? i : a, Math.max(tNext, 0));
  levelBars('gDin', tl.map(g => !!g?.solvedAt), tLv);
  const ml = mToday(), mNext = ml.findIndex(g => !g?.solvedAt), mSolved = ml.filter(g => g?.solvedAt).length;
  const mLv = mSolved === 3 && dPick.gMino != null ? dPick.gMino : ml.reduce((a, g, i) => g?.solvedAt ? i : a, Math.max(mNext, 0));
  levelBars('gMino', ml.map(g => !!g?.solvedAt), mLv);
  const n = one('nitDaily'), p = one('pasDaily', g => g.endedAt), j = one('mjDaily');
  p.ms = pasDone()[dayKey()];
  const daily = (id, level, d, open, again, text = clock(d.ms ?? 0)) => ({ id, level, ms: d.done ? d.ms : null, badge: d.done ? ['✓ ' + text, 'ok'] : [d.going ? 'Nastavi' : 'Igraj', ''], open: d.done ? again : open });
  const cards = [
    { id: 'gSud', level: sLv, ms: lv[sLv]?.solvedAt ? lv[sLv].elapsed : null, badge: [solved === 3 ? '✓ 3 od 3' : `${solved} od 3`, solved === 3 ? 'ok' : ''],
      open: () => next < 0 ? go('menu') : openDaily(next) },
    { id: 'gDin', level: T_BOARD[tLv], ms: tl[tLv]?.solvedAt ? tl[tLv].elapsed : null, badge: [tSolved === 3 ? '✓ 3 od 3' : `${tSolved} od 3`, tSolved === 3 ? 'ok' : ''],
      open: () => tNext < 0 ? go('tmenu') : openTango(tNext) },
    daily('gNit', 4, n, openNit, nitGame),
    { id: 'gMino', level: M_BOARD[mLv], ms: ml[mLv]?.solvedAt ? ml[mLv].elapsed : null, badge: [mSolved === 3 ? '✓ 3 od 3' : `${mSolved} od 3`, mSolved === 3 ? 'ok' : ''],
      open: () => mNext < 0 ? minoGame() : openMino(mNext) },
    daily('gPas', 6, p, openPas, pasGame, p.ms != null ? pScoreText(p.ms) : ''), daily('gMj', 7, j, openMj, mjGame)];
  for (const c of cards) {
    Object.assign($(c.id).querySelector('.gbadge'), { textContent: c.badge[0], className: 'gbadge ' + c.badge[1] });
    $(c.id).onclick = () => c.open();
  }
  const games = xwGames(), keys = xwOwn(games).sort((a, b) => games[b].at - games[a].at), topics = xwGet('xwTopics'), day = xwDay();
  // The daily crossword on top: its sheet, topic and where it stands; then your topics (two beside it, else three).
  $('dXwDay').hidden = !day;
  if (day) {
    xwSheet($('dXwDay').firstChild, day.key.slice(4));
    $('dXwDay').querySelector('b').textContent = `Na današnji dan: ${day.t.tema}`;
    Object.assign($('dXwDay').querySelector('small'), { textContent: day.g ? xwDayState(day) : day.t.uvod, className: day.g?.done ? 'solved' : '' });
    $('dXwDay').onclick = xwDayOpen;
  }
  $('dXw').replaceChildren(...keys.slice(0, day ? 2 : 3).map(k => {
    const p = xwProgress(k, games), row = li(topics[k].tema, p.done ? `${XW_LV[p.lvl][0]} ✓` : `${p.n} od ${p.words.length}`, p.done ? 'solved' : '');
    row.firstChild.prepend(stairs(p.lvl));
    return row;
  }));
  if (!keys.length) $('dXw').append(li('Tema po izboru', 'Složi prvu', 'muted'));
  const open = keys.find(k => !xwProgress(k, games).done);
  Object.assign($('dXwGo'), day && !day.g?.done ? { textContent: day.g ? 'Nastavi dnevnu' : 'Igraj dnevnu', onclick: xwDayOpen }
    : open ? { textContent: `Nastavi: ${topics[open].tema}`, onclick: () => xwOpen(open) } : { textContent: 'Odaberi temu', onclick: () => go('xw') });
  const recent = saved().slice(0, 3);
  $('dRecent').replaceChildren(...recent.length ? recent.map(historyItem) : [li('Još nema sudokua', '', 'muted')]);
  // The podiums: each card's top three and you (6 small requests), asked anew each time.
  const ask = ++todayAsk;
  for (const c of cards) lbRows(dayKey(), c.level, 3, c.ms != null && lbName() ? { name: lbName(), ms: c.ms } : undefined)
    .catch(() => null).then(b => ask === todayAsk && throne($(c.id), b, c.note));
}
$('tabGames').onclick = () => go('games');
$('tabPast').onclick = () => go('past');
$('menuBack').onclick = () => go('games');
$('tileSudoku').onclick = () => go('menu');
$('tileTango').onclick = () => go('tmenu');

// Igre: a tile per game, with how today's daily stands.
function showGames() {
  const solved = loadDays().levels.filter(st => st?.solvedAt).length, tSolved = tToday().filter(g => g?.solvedAt).length;
  Object.assign($('tileSudoku').lastChild, { textContent: solved === 3 ? 'Dnevni riješen ✓' : `Dnevni ${solved} od 3`, className: solved === 3 ? 'solved' : '' });
  Object.assign($('tileTango').lastChild, { textContent: tSolved === 3 ? 'Dnevni riješen ✓' : `Dnevni ${tSolved} od 3`, className: tSolved === 3 ? 'solved' : '' });
  xwTile();
  const n = tLoad('nitDaily'), nDone = n?.date === dayKey() && n.solvedAt;
  Object.assign($('tileNit').lastChild, { className: nDone ? 'solved' : '',
    textContent: nDone ? `✓ ${clock(n.elapsed)} · ${daysWord(streak(Object.keys(nitDone())))}` : n?.date === dayKey() && n.elapsed ? `U tijeku · ${clock(n.elapsed)}` : 'Dnevni čeka' });
  const mSolved = mToday().filter(g => g?.solvedAt).length;
  Object.assign($('tileMino').lastChild, { textContent: mSolved === 3 ? 'Dnevni riješen ✓' : `Dnevni ${mSolved} od 3`, className: mSolved === 3 ? 'solved' : '' });
  const p = tLoad('pasDaily'), pDone = p?.date === dayKey() && p.endedAt;
  Object.assign($('tilePas').lastChild, { className: pDone ? 'solved' : '',
    textContent: pDone ? `✓ ${pScoreText(pasDone()[p.date])} · ${daysWord(streak(Object.keys(pasDone())))}` : p?.date === dayKey() && p.elapsed ? `U tijeku · ${clock(p.elapsed)}` : 'Dnevni čeka' });
  const j = tLoad('mjDaily'), jDone = j?.date === dayKey() && j.solvedAt;
  Object.assign($('tileMj').lastChild, { className: jDone ? 'solved' : '',
    textContent: jDone ? `✓ ${clock(j.elapsed)} · ${daysWord(streak(Object.keys(mjDays())))}` : j?.date === dayKey() && j.elapsed ? `U tijeku · ${clock(j.elapsed)}` : 'Dnevni čeka' });
  if (matchMedia('(min-width: 1100px)').matches) showToday();
}
matchMedia('(min-width: 1100px)').onchange = () => view === 'games' && showGames();   // a window made wider gets Danas
// Povijest: Dinango's, Nit's, Minolovac's, Pasijans's and Mahjong's finished dailies (newest first), then every sudoku.
// Pasijans's: the cards up first when not all (its number is pScore), then the time.
const pasLine = v => v < P_HOUR ? `Riješeno za ${clock(v)}` : `${52 - Math.floor(v / P_HOUR)} od 52 · ${clock(v % P_HOUR)}`;
function showPast() {
  [['tango', tangoDone(), 'tileTango'], ['nit', nitDone(), 'tileNit'], ['mino', minoDone(), 'tileMino'], ['pas', pasDone(), 'tilePas'], ['mj', mjDays(), 'tileMj']].forEach(([g, d, tile]) => {
    const done = (g === 'tango' || g === 'mino' ? Object.entries(d).flatMap(([date, v]) => tDoneMs(v).map((ms, lv) => [date, ms, lv]).filter(x => x[1] != null).reverse()) : Object.entries(d))
      .sort((a, b) => a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0);
    $(g + 'PastTitle').hidden = $(g + 'Past').hidden = !done.length;
    $(g + 'Past').replaceChildren(...done.map(([date, ms, lv]) => {
      const li = document.createElement('li'), row = Object.assign(document.createElement('span'), { className: 'hrow' });
      row.append($(tile).firstChild.cloneNode(true), Object.assign(document.createElement('span'), { className: 'hmeta' }));
      row.firstChild.style.cssText = 'width: 56px; height: 56px; flex: none';
      row.lastChild.append(Object.assign(document.createElement('b'), { className: 'solved', textContent: g === 'pas' ? `${pasLine(ms)} ✓` : `Riješeno za ${clock(ms)} ✓` }),
        Object.assign(document.createElement('small'), { textContent: (lv === undefined ? 'Dnevni' : DAILY[lv][0]) + ' · ' + new Date(date + 'T12:00').toLocaleDateString('hr', { day: 'numeric', month: 'numeric', year: 'numeric' }) }));
      li.append(row);
      return li;
    }));
  });
  showHistory();
}

// "Instaliraj", only in a browser tab: never once the app runs installed. Chrome says when it can install
// (beforeinstallprompt, kept for the button, its own bar suppressed); Safari on iPhone / iPad has no such
// event, so there the button says how. Elsewhere (Firefox) nothing to offer, no button.
let installEvt = null;
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
$('installBtn').hidden = installed() || navigator.standalone !== false;   // navigator.standalone: iOS Safari only
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('installBtn').hidden = installed(); });
addEventListener('appinstalled', () => { installEvt = null; $('installBtn').hidden = true; });
$('installBtn').onclick = async () => {
  if (!installEvt) return say('Na iPhoneu: dodirni *Dijeli* (kvadrat sa strelicom), pa *Dodaj na početni zaslon*.', 8000);
  installEvt.prompt();
  await installEvt.userChoice;   // installed or not, the event is used up
  installEvt = null;
  $('installBtn').hidden = true;
};

// --- Ljestvica: today's dailies by time, on Supabase (the factoriotree project, schema sudokuscan: one row
// per device, day and level; insert and read only, the device id is never served). The name is the
// opt-in: asked once on the solved card, then every solved daily goes, through a queue kept until the
// network takes it. ---
const LB = 'https://fgllmnemukhouwyebfop.supabase.co/rest/v1/scores?', LB_KEY = 'sb_publishable_TM5hyGtUvXFuuljv8oKcBg_8HJCdpyB';   // a publishable key: public by design
const lb = (q, o = {}) => fetch(LB + q, { ...o, headers: { apikey: LB_KEY, 'Accept-Profile': 'sudokuscan', 'Content-Profile': 'sudokuscan',
  'Content-Type': 'application/json', ...o.headers } });
const lbName = () => { try { return localStorage.sudokuName || ''; } catch { return ''; } };
// Level 3 is Dinango's daily, 4 Nit's, 5 Minolovac's (up to 26. 11. 2026; then 11-13 per level, as Dinango's 8-10), 6 Pasijans's, 7 Mahjong's (one a day each); the solved card's result is lbNow: { day, level, ms }.
// Pasijans's ms is cards first, then time (pScore): shown as such (lvClock).
const lvName = l => l >= 11 ? 'Minolovac ' + M_LV[l - 11][0].toLowerCase() : l >= 8 ? 'Dinango ' + DAILY[l - 8][0].toLowerCase() : l === 3 ? 'Dinango' : l === 4 ? 'Nit' : l === 5 ? 'Minolovac' : l === 6 ? 'Pasijans' : l === 7 ? 'Mahjong' : DAILY[l][0].toLowerCase();
const lvClock = (l, ms) => l === 6 ? pScoreText(ms) : clock(ms);
let lbNow = null;
function lbQueue(day, level, ms) {
  try {
    const q = JSON.parse(localStorage.sudokuLbQueue || '[]'), device = localStorage.sudokuDevice ||= crypto.randomUUID();
    localStorage.sudokuLbQueue = JSON.stringify([...q, { day, level, name: lbName(), ms, device }]);
  } catch {}
}
// Send what waits, oldest first. Kept only without network or on a server error; anything else is done
// with (409: it is in already; 400: the table's checks refused it).
async function lbFlush() {
  let q = [];
  try { q = JSON.parse(localStorage.sudokuLbQueue || '[]'); } catch {}
  while (q.length) {
    const r = await lb('', { method: 'POST', body: JSON.stringify(q[0]) }).catch(() => null);
    if (!r || r.status >= 500) return false;
    q.shift();
    try { localStorage.sudokuLbQueue = JSON.stringify(q); } catch {}
  }
  if (authGet()) claimDevice();
  return true;
}

// --- Prijava: Google through Supabase Auth, plain fetch like the Ljestvica (ponytail: no supabase-js for four
// calls). Google sends the browser back with the tokens in the address (#access_token=…); they live in
// localStorage.sudokuAuth and are refreshed a minute before they run out. The project's Site URL belongs to
// another app, so redirect_to is always given (localhost works once it is on the project's Redirect URLs).
// Odjava forgets only the tokens: everything played stays on the device. ---
const AUTH = 'https://fgllmnemukhouwyebfop.supabase.co/auth/v1/';
const authGet = () => { try { return JSON.parse(localStorage.sudokuAuth || 'null'); } catch { return null; } };
const authSet = a => { try { a ? localStorage.sudokuAuth = JSON.stringify(a) : localStorage.removeItem('sudokuAuth'); } catch {} showAcct(); };
const authApi = (path, o = {}) => fetch(AUTH + path, { ...o, headers: { apikey: LB_KEY, 'Content-Type': 'application/json', ...o.headers } });
function signIn() {
  const back = location.hostname === 'localhost' ? location.origin + location.pathname : 'https://cvurbic.github.io/sudoku-scan/';
  location.href = AUTH + 'authorize?provider=google&redirect_to=' + encodeURIComponent(back);
}
// A fresh access token; null when signed out, offline at expiry, or the refresh was refused (then signed out).
async function authToken() {
  const a = authGet();
  if (!a) return null;
  if (a.expires_at - 60 > Date.now() / 1000) return a.access_token;
  const r = await authApi('token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: a.refresh_token }) }).catch(() => null);
  if (!r || r.status >= 500) return null;   // no network: keep the session for later
  if (!r.ok) { authSet(null); return null; }
  const t = await r.json();
  authSet({ ...a, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at });
  return t.access_token;
}
function signOut() {
  const a = authGet();
  authSet(null);
  if (a) authApi('logout', { method: 'POST', headers: { Authorization: 'Bearer ' + a.access_token } }).catch(() => {});
}
// Back from Google: the tokens out of the address at once, then whose they are.
async function authReturn() {
  const h = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  if (!h.has('access_token') && !h.has('error')) return;
  history.replaceState(null, '', location.pathname);
  if (!h.has('access_token')) return say('Prijava nije uspjela: ' + (h.get('error_description') || h.get('error')), Infinity);
  const at = h.get('access_token'), r = await authApi('user', { headers: { Authorization: 'Bearer ' + at } }).catch(() => null);
  if (!r?.ok) return say('Prijava nije uspjela. Pokušaj ponovno.', Infinity);
  const u = await r.json();
  authSet({ access_token: at, refresh_token: h.get('refresh_token'), expires_at: +h.get('expires_at') || Date.now() / 1000 + +h.get('expires_in'), id: u.id, email: u.email });
  say(`Prijavljen si kao *${u.email}*.`);
  claimDevice();
  syncStart();   // sync.js
}
// The Ljestvica's rows sent from this device (sudokuDevice, never served) become the account's. Inserts stay
// anonymous, so again after every send while signed in.
async function claimDevice() {
  const t = await authToken(), dev = (() => { try { return localStorage.sudokuDevice; } catch {} })();
  if (t && dev) fetch(LB.replace('scores?', 'rpc/claim_device'), { method: 'POST', body: JSON.stringify({ dev }),
    headers: { apikey: LB_KEY, Authorization: 'Bearer ' + t, 'Content-Profile': 'sudokuscan', 'Content-Type': 'application/json' } }).catch(() => {});
}
// The rail's row (bar's icon on the phone) and its dialog: Google when signed out, the account and Odjava when in.
// The name is the Ljestvica's (sudokuName), else the email's first part.
function showAcct() {
  const a = authGet(), name = lbName() || a?.email.split('@')[0] || '';
  for (const b of [$('acctRail'), $('acctBar')]) {
    b.classList.toggle('in', !!a);
    b.querySelector('.av').textContent = (name[0] || '').toUpperCase();
    b.title = b.ariaLabel = a ? 'Račun: ' + a.email : 'Prijava';
  }
  $('acctRail').querySelector('.t').textContent = a ? name : 'Prijava';
  $('acct').classList.toggle('in', !!a);
  $('acctWho').hidden = !name;
  $('acctWho').querySelector('.av').textContent = (name[0] || '').toUpperCase();
  $('acctName').textContent = name;
  $('acctSub').textContent = a ? a.email : 'Ime na ljestvici ostaje isto';
  const t = typeof syncedAt === 'number' && syncedAt, min = t && Math.round((Date.now() - t) / 60000);   // sync.js
  $('acctSync').classList.toggle('off', !t);
  $('acctSync').lastChild.textContent = !t ? 'Još nije spremljeno' : min < 1 ? 'Spremljeno upravo' : `Spremljeno prije ${min} min`;
  $('acctFine').textContent = a ? 'Odjava ne briše ništa s ovog uređaja.' : 'Bez prijave sve ostaje samo na ovom uređaju.';
}
for (const b of [$('acctRail'), $('acctBar')]) b.onclick = () => { showAcct(); $('acct').showModal(); };
$('acct').onclick = e => { if (e.target === $('acct')) $('acct').close(); };   // the backdrop (the content sits in a div)
$('acctGoogle').onclick = signIn;
$('acctOut').onclick = () => { signOut(); $('acct').close(); say('Odjavljen si. Sve odigrano ostaje na ovom uređaju.'); };
showAcct();
authReturn();

// A day and level's top n as list rows, your own (mine: { name, ms }) marked, or below them if you are
// further down (equal times share a place). mine.ghost: solved on a later day, not on the board: your row
// where it would have been, "(3)", the others keeping theirs. → { rows, all: players, place: yours }; rejects when it did not load.
async function lbRows(day, level, n, mine) {
  const where = `day=eq.${day}&level=eq.${level}`, ok = r => r.ok ? r : Promise.reject(),
    count = q => lb(`select=id&${q}`, { method: 'HEAD', headers: { Prefer: 'count=exact' } }).then(ok).then(r => +r.headers.get('content-range').split('/')[1]);
  const [top, faster, all] = await Promise.all([lb(`select=name,ms&${where}&order=ms,created_at&limit=${n}`).then(ok).then(r => r.json()),
    mine ? count(`${where}&ms=lt.${mine.ms}`) : 0, count(where)]);
  const row = (place, r, cls = '') => {
    const li = document.createElement('li');
    li.className = [cls, typeof place === 'number' && place <= 3 && 'p' + place].filter(Boolean).join(' ');   // the podium: medal colours
    li.append(...[place, r.name, lvClock(level, r.ms)].map(t => Object.assign(document.createElement('span'), { textContent: t })));
    return li;
  };
  const ghost = mine?.ghost, me = mine && !ghost ? top.findIndex(r => r.name === mine.name && r.ms === mine.ms) : -1,
    rows = top.map((r, i) => row(top.findIndex(x => x.ms === r.ms) + 1, r, i === me ? 'me' : ''));
  if (ghost) rows.splice(Math.min(faster, rows.length), 0, row(`(${faster + 1})`, { name: mine.name + ' ↺', ms: mine.ms }, 'ghost' + (faster < n ? '' : ' apart')));
  else if (mine && me < 0 && all) rows.push(row(faster + 1, mine, 'me apart'));
  return { rows, all, place: faster + 1 };
}
// An older day's daily solved on the card: not sent; where it would have stood that day.
async function lbLate(day, level, ms) {
  const head = t => $('lbHead').textContent = t;
  $('lboard').hidden = false;
  $('lbJoin').hidden = true;
  $('lbList').replaceChildren();
  head('Učitavam…');
  let b;
  try { b = await lbRows(day, level, 5, { name: lbName() || 'Ti', ms, ghost: true }); } catch { return head('Ljestvica se nije učitala.'); }
  b.rows.forEach((li, i) => li.style.setProperty('--i', i));
  head(b.all ? `Na vrijeme bio bi ${b.place}. od ${b.all + 1}` : 'Taj dan nitko nije igrao: bio bi prvi');
  $('lbList').replaceChildren(...b.rows);
}
// One daily's result to share (Dinango, Nit), as prepShare: made before the tap, the place added once the board answers.
async function dailyShare(game, day, level, ms) {
  const name = lbName(), make = p => ({ url: location.origin + location.pathname,
    text: [`${game} · ${new Date(day + 'T12:00').toLocaleDateString('hr', { day: 'numeric', month: 'numeric' })}`, `${lvClock(level, ms)}${p?.all ? ` (${p.place}. od ${p.all})` : ''}`, 'Možeš li brže?'].join('\n') });
  shareMsg = make();
  if (!name || !await lbFlush()) return;
  shareMsg = make(await lbRows(day, level, 0, { name, ms }).catch(() => null));
}
const players = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'igrač' : 'igrača'}`;
// The solved card's panel: the name first if there is none; else the climb (runClimb), then the top five and you.
let climbAsk = 0;
async function lbShow(day, level, ms) {
  const name = lbName(), head = t => $('lbHead').textContent = t, ask = ++climbAsk;
  $('lboard').hidden = false;
  $('lbJoin').hidden = !!name;
  $('lbClimb').hidden = true;
  delete $('lboard').dataset.climb;
  $('lbList').replaceChildren();
  if (!name) return head('Upiši se na današnju ljestvicu');
  head('Učitavam…');
  if (!await lbFlush()) return head('Bez mreže: rezultat se šalje kad se vratiš.');
  let b, times;
  try {
    [b, times] = await Promise.all([lbRows(day, level, 5, { name, ms }),
      lb(`select=name,ms&day=eq.${day}&level=eq.${level}&order=ms&limit=1000`).then(r => r.ok ? r.json() : Promise.reject())]);
  } catch { return head('Ljestvica se nije učitala.'); }
  if (ask !== climbAsk) return;   // named again, or another card meanwhile
  b.rows.forEach((li, i) => li.style.setProperty('--i', i));   // one after another
  head(`Danas, ${lvName(level)} · ${players(b.all)}`);
  const mine = times.findIndex(r => r.name === name && r.ms === ms);   // your own row is in (sent above): the others without it
  runClimb(times.filter((_, i) => i !== mine), ms, ask, () => $('lbList').replaceChildren(...b.rows));
}
// The climb. others: [{ name, ms }] today at this level, without you. A line, the slow end left, the fast right:
// you run right from the slow end. Few (under 20 with you): a stick figure each, knocked flat as you pass, the
// name of the one just passed, the place; more: a histogram and the percent slower than you. In the top three the
// run stops at 4th and the podium (2-1-3) takes over: you fly in as a spinning ball and take your step, the one hit
// flies to the next step down and knocks that one on, the third flies off ("Ajme!"); first gets a crown (mockup
// notes/mockups/podij.html, V2 Let). Waits for the card to be open (Dinango and Nit open it later); a tap on the
// line, reduced motion, nobody to pass or the card closed: everything left at once. then(): the top five, once landed.
function runClimb(others, ms, ask, then) {
  others = [...others].sort((a, b) => a.ms - b.ms);
  const W = 320, G = 96, Z = 1.3, n = others.length, few = n + 1 < 20, all = [...others.map(o => o.ms), ms].sort((a, b) => a - b);
  // the slow end: the slowest (few) or the 95th percentile, so one left open overnight does not squash the rest
  let lo = all[0], hi = Math.max(ms, few ? all.at(-1) : all[Math.floor(.95 * (all.length - 1))]);
  const pad = (hi - lo) * .08 || 5000; lo -= pad; hi += pad;
  const x = s => 16 + (hi - Math.min(hi, Math.max(lo, s))) / (hi - lo) * (W - 32);
  const faster = others.filter(o => o.ms < ms).length, place = faster + 1, top3 = place <= 3;
  const plot = $('lbPlot'), live = $('lbLive'), gone = () => ask !== climbAsk;
  const mk = (tag, a, parent = plot) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in a) e.setAttribute(k, a[k]); parent.append(e); return e; };
  const short = s => s.length > 9 ? s.slice(0, 8) + '…' : s;
  const set = (s, p, sub) => {
    $('lbClock').textContent = lvClock(lbNow?.level, s);
    $('lbPlace').textContent = few ? p + '.' : Math.round(100 * others.filter(o => o.ms > s).length / n) + '%';
    $('lbLine').textContent = few ? `od ${n + 1} danas` : 'igrača sporije';
    if (sub !== undefined) $('lbSub').textContent = sub;
  };
  const bump = (el, s, d) => !skip && el.animate([{ transform: 'scale(1)' }, { transform: `scale(${s})` }, { transform: 'scale(1)' }], { duration: d, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });

  // A small tween engine: the figures are SVG attributes, redrawn each frame. skip runs whatever is left at once.
  let anims = [], figs = [], skip = reduced() || (place === n + 1 && !top3), landed = false;   // last: nothing to pass
  const lerp = (a, b, k) => a + (b - a) * k, EO = t => 1 - (1 - t) ** 3, EQ = t => 1 - (1 - t) ** 4, back = t => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;
  const run = (d, fn, ease = t => t) => new Promise(res => anims.push({ t0: performance.now(), d, fn, ease, res }));
  const wait = d => run(d, () => {});
  const tw = (f, to, d, ease = EO) => { const from = {}; for (const k in to) from[k] = f[k]; return run(d, k => { for (const p in to) f[p] = lerp(from[p], to[p], k); }, ease); };
  // a jump: x straight on, y on a parabola h above the line between the ends; the props in to along with it
  const arc = (f, x1, y1, h, d, to = {}, each) => { const x0 = f.x, y0 = f.y, from = {}; for (const k in to) from[k] = f[k];
    return run(d, k => { f.x = lerp(x0, x1, k); f.y = lerp(y0, y1, k) - h * 4 * k * (1 - k); for (const p in to) f[p] = lerp(from[p], to[p], k); each?.(k); }); };
  const frame = now => {
    if (gone()) return;
    if (!$('solved').open) skip = true;
    for (const a of [...anims]) { const k = skip || !a.d ? 1 : Math.min(1, (now - a.t0) / a.d); a.fn(a.ease(k), k); if (k === 1) { anims.splice(anims.indexOf(a), 1); a.res(); } }
    figs.forEach(f => f.draw());
    if (!landed || anims.length) requestAnimationFrame(frame);
  };
  // a stick figure, feet at (x, y); r turns it around (0, rc); sx/sy squash it from the feet
  const fig = (parent, label, me) => {
    const root = mk('g', { class: 'cfig' + (me ? ' cme' : '') }, parent), body = mk('g', {}, root), limbs = {};
    mk('circle', { cy: -21, r: 4.3 }, body); mk('line', { y1: -16.7, y2: -7 }, body);
    for (const [k, y, l] of [['aL', -14.5, 8], ['aR', -14.5, 8], ['lL', -7, 7], ['lR', -7, 7]]) { limbs[k] = [mk('g', {}, body), y]; mk('line', { y2: l }, limbs[k][0]); }
    if (label) mk('text', { y: me ? -36 : -30 }, body).textContent = label;
    const crown = me && mk('path', { class: 'ccrown p1', d: 'M-5 -27l1.5-6 2 3 1.5-4 1.5 4 2-3 1.5 6z' }, body);
    const f = { x: 0, y: G, r: 0, rc: 0, sx: 1, sy: 1, o: 1, aL: 12, aR: -12, lL: 8, lR: -8, cr: 0, ph: 0, el: root, draw() {
      root.setAttribute('transform', `translate(${f.x.toFixed(2)} ${f.y.toFixed(2)}) rotate(${f.r.toFixed(1)} 0 ${f.rc})`);
      body.setAttribute('transform', `scale(${(f.sx * Z).toFixed(3)} ${(f.sy * Z).toFixed(3)})`); root.style.opacity = f.o;
      for (const k in limbs) limbs[k][0].setAttribute('transform', `translate(0 ${limbs[k][1]}) rotate(${f[k].toFixed(1)})`);
      if (crown) { crown.style.opacity = f.cr; crown.setAttribute('transform', `translate(0 ${(-18 * (1 - f.cr)).toFixed(1)})`); }
    } };
    figs.push(f); return f;
  };
  const stand = (f, d = 180) => tw(f, { aL: 12, aR: -12, lL: 8, lR: -8, r: 0, sx: 1, sy: 1 }, d);
  const stride = (f, dx) => { f.ph += dx * .34; const s = Math.sin(f.ph); f.lL = 34 * s; f.lR = -34 * s; f.aL = -30 * s; f.aR = 30 * s; };
  const flail = f => k => { f.aL = 140 + 40 * Math.sin(k * 30); f.aR = -140 - 40 * Math.cos(k * 30); };
  const puff = (cx, cy) => { for (let i = 0; i < 5; i++) { const a = Math.PI * (1 + i / 4), c = mk('circle', { class: 'cpuff', r: 1.8 });
    run(380, k => { c.setAttribute('cx', cx + Math.cos(a) * 11 * k); c.setAttribute('cy', cy + Math.sin(a) * 6 * k); c.style.opacity = 1 - k; }, EO).then(() => c.remove()); } };
  const axis = scene => { mk('line', { class: 'cax', x1: 0, x2: W, y1: G, y2: G }, scene); return scene; };

  // The run: everyone today on the line; you from the slow end to your time, or to 4th when the podium waits.
  const people = [], bars = [];
  const race = async () => {
    const scene = axis(mk('g', { class: 'cscene' })), end = top3 ? (others[2].ms + others[3].ms) / 2 : ms;
    mk('text', { class: 'ctk', y: 114 }, scene).textContent = 'sporije';
    mk('text', { class: 'ctk', x: W, y: 114, 'text-anchor': 'end' }, scene).textContent = 'brže';
    if (few) others.forEach((o, i) => { const f = Object.assign(fig(scene), { x: x(o.ms), ms: o.ms, name: o.name, o: 0 }); people.push(f); wait(i * 40).then(() => tw(f, { o: 1 }, 260)); });
    else {
      const B = 24, w = (hi - lo) / B, bins = Array(B).fill(0), bw = (W - 32) / B;
      others.forEach(o => bins[Math.max(0, Math.min(B - 1, (hi - o.ms) / w | 0))]++);
      const mx = Math.max(...bins);
      bins.forEach((c, i) => c && bars.push(Object.assign(mk('rect', { class: 'cbar', x: 16 + i * bw + 1, y: G - c / mx * 34, width: bw - 2, height: c / mx * 34, rx: 1.5 }, scene), { ms: hi - (i + .5) * w })));
    }
    const me = fig(scene, 'ti', true); me.x = x(hi) - 6; me.r = 7;
    await wait(450); if (gone()) return;
    let last = me.x, shown = n + 1, sub;
    await run(2200, e => {
      const s = hi + (end - hi) * e;
      me.x = x(s); stride(me, me.x - last); last = me.x;
      people.forEach(f => { if (f.ms > s && !f.down) { f.down = 1; f.el.classList.add('beaten'); sub = 'Iza tebe: ' + f.name; puff(f.x - 12, G - 2);
        tw(f, { r: -90, lL: -40, lR: -70, aL: 70, aR: 20 }, 420, back); } });   // knocked flat, backwards
      bars.forEach(b => b.classList.toggle('beaten', b.ms > s));
      const p = others.filter(o => o.ms < s).length + 1;
      set(s, p, sub);
      if (few && p !== shown) bump($('lbPlace'), 1.15, 220);
      shown = p;
    }, EQ);
    if (gone()) return;
    await stand(me);
    if (top3) { await wait(400); scene.classList.add('out'); return; }
    if (place === n + 1) return tw(me, { aL: 75, aR: -75 }, 220, back);   // last: a shrug
    me.aL = 150; me.aR = -150; await arc(me, me.x, G, 10, 300); await stand(me);   // a little hop
  };

  // The podium: you take your step, everyone below you one step down, the third off the podium.
  const podium = async () => {
    const L = { 1: [160, 54], 2: [106, 67], 3: [214, 78] }, scene = axis(mk('g', { class: 'cscene out' })), occ = {};
    for (const i of [1, 2, 3]) {
      const [cx, top] = L[i], o = others[i - 1];
      mk('rect', { class: 'cstep', x: cx - 26, y: top, width: 52, height: G - top + 1, rx: 3 }, scene);
      mk('rect', { class: 'cpod p' + i, x: cx - 26, y: top, width: 52, height: 4, rx: 2 }, scene);
      mk('text', { class: 'cnum', x: cx, y: top + 20 }, scene).textContent = i;
      if (o) occ[i] = Object.assign(fig(scene, short(o.name)), { x: cx, y: top });
    }
    const me = fig(scene, 'ti', true); me.x = -12; me.r = 7;
    scene.getBoundingClientRect(); scene.classList.remove('out');
    await wait(300); if (gone()) return;
    let last = me.x;
    await run(500, k => { me.x = lerp(-12, 40, k); stride(me, me.x - last); last = me.x; }, EO);
    await stand(me, 140); if (gone()) return;
    const c0 = n > 3 ? (others[2].ms + others[3].ms) / 2 : hi;
    const into = async (a, i) => {   // a flies, spinning, onto step i; whoever stood there flies on
      const [cx, top] = L[i], b = occ[i], mine = a === me;
      a.rc = -15;
      if (mine) { await tw(a, { sx: .8, sy: .8, aL: 160, aR: -160, lL: 100, lR: -100 }, 160); run(600, k => $('lbClock').textContent = lvClock(lbNow?.level, lerp(c0, ms, k)), EO); }
      await arc(a, cx - 4, top, mine ? 34 : 28, mine ? 440 : 480, { r: a.r + (mine ? 720 : 360) }, mine ? null : flail(a));
      if (gone()) return;
      a.r = 0; occ[i] = a;
      if (b) { puff(cx + 6, top - 12); skip || $('solved').animate([{}, { translate: '-4px 2px' }, { translate: '4px -2px' }, { translate: '-2px 1px' }, {}], 260); }
      const next = !b ? null : i < 3 ? into(b, i + 1) : (async () => {   // the third: off the screen
        b.rc = -15;
        const bub = mk('g', { class: 'cbub', transform: `translate(${b.x + 14} ${b.y - 40})` });
        mk('rect', { x: -18, y: -11, width: 36, height: 16, rx: 8 }, bub); mk('text', { y: 1 }, bub).textContent = 'Ajme!';
        run(900, (k, t) => bub.style.opacity = t < .75 ? Math.min(1, t * 8) : (1 - t) * 4).then(() => bub.remove());
        await arc(b, W + 90, -70, 30, 760, { r: 900 }, flail(b)); b.o = 0;
      })();
      await tw(a, { x: cx, y: top, sx: 1, sy: 1, aL: mine ? 150 : 12, aR: mine ? -150 : -12, lL: 8, lR: -8 }, 260, back);
      a.rc = 0;
      await next;
    };
    await into(me, place);
    if (place === 1) await tw(me, { cr: 1 }, 380, back);
  };

  const land = () => {
    if (gone()) return;
    people.forEach(f => f.el.classList.toggle('ahead', f.ms < ms));
    bars.forEach(b => { b.classList.toggle('beaten', b.ms > ms); b.classList.toggle('ahead', b.ms < ms); });
    set(ms, place, !n ? 'Prvi danas' : top3 && place === 1 ? `${others[0].name} pada s trona` : top3 && n >= 3 ? `${others[2].name} ispada s postolja`
      : few || top3 ? (n - faster ? `Iza tebe: ${players(n - faster)}` : 'Riješeno, i to se broji') : `${players(n + 1)} danas`);
    if (top3) $('lbPlace').textContent = place + '.';
    $('lbPlace').className = top3 ? 'p' + place : '';
    $('lbLine').textContent = few || top3 ? `${place}. od ${n + 1} danas` : 'igrača sporije';   // the percent is in the circle
    live.ariaHidden = null;
    bump($('lbPlace'), 1.25, 300);
    $('lboard').dataset.climb = 'done';
    landed = true;
    then();
  };
  plot.replaceChildren();
  $('lbClimb').hidden = false;
  $('lbPlace').className = '';
  live.ariaHidden = 'true';   // the count on its way is noise to a screen reader; the place, once landed
  set(hi, n + 1, few ? '' : `${players(n + 1)} danas`);
  plot.onclick = () => skip = true;
  const start = async () => {
    if (gone()) return;
    if (!$('solved').open) return setTimeout(start, 100);
    requestAnimationFrame(frame);
    if (!top3 || n > 3) await race();   // in the top three with three or fewer others nobody is left to pass
    if (top3 && !gone()) await podium();
    land();
  };
  start();
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// The menu's Ljestvica: the strip's day (dayOn), one level (remembered), its top eight and you; solved on a
// later day, you as a ghost row where you would have been. Your row comes from your own record of that day
// (ponytail: shown even if that time was solved before the name was set, so never sent; a sent flag in
// the record if that ever confuses). Under it, your places on the last 7 days at that level, from one
// request. Asked again on every menu (ponytail: 4 small requests; a short cache if Supabase's free tier ever minds).
let rankLvl = 0, ranksAsk = 0;
try { rankLvl = +localStorage.sudokuRankLvl || 0; } catch {}
async function showRanks() {
  const day = dayOn, lvl = rankLvl, ask = ++ranksAsk, name = lbName(), mine = dailyDone()[`${day}/${lvl}`], late = dailyLate()[`${day}/${lvl}`];
  $('ranksDate').textContent = day === dayKey() ? 'danas' : `${new Date(day + 'T12:00').toLocaleDateString('hr', { weekday: 'short' })} ${+day.slice(8)}. ${+day.slice(5, 7)}.`;
  [...$('ranksLv').children].forEach((b, i) => b.ariaPressed = String(i === lvl));
  $('weekLv').textContent = DAILY[lvl][0];
  const from = new Date();
  from.setDate(from.getDate() - 6);
  const [b, week] = await Promise.all([
    lbRows(day, lvl, 8, late ? { name: name || 'Ti', ms: late.ms, ghost: true } : name && mine ? { name, ms: mine.ms } : null).catch(() => null),
    lb(`select=day,ms&level=eq.${lvl}&day=gte.${dayKey(from)}`).then(r => r.ok ? r.json() : null).catch(() => null)]);
  if (ask !== ranksAsk) return;   // another day or level was asked for meanwhile
  $('ranks').ariaBusy = 'false';
  $('ranksCount').textContent = !b ? 'Nije se učitalo' : b.all ? players(b.all) : 'Još nitko';
  const rows = b?.rows ?? [], ol = $('ranksList');
  if (ol.innerHTML !== rows.map(li => li.outerHTML).join('')) ol.replaceChildren(...rows);   // the same rows stay put (no fade)
  showWeek(week, lvl);
}
// Your place on each of the last 7 days: medal colours for the podium, "(3)" solved later (where you would
// have been), "–" not played, "…" today's under way. Without the network: ✓ for the days you played.
function showWeek(rows, lvl) {
  const done = dailyDone(), late = dailyLate(), today = readDay().levels[lvl];
  let on = 0, best = Infinity;
  $('weekDays').replaceChildren(...Array.from({ length: 7 }, (_, k) => {
    const d = new Date();
    d.setDate(d.getDate() - 6 + k);
    const day = dayKey(d), mine = done[`${day}/${lvl}`], lt = late[`${day}/${lvl}`], x = mine || lt,
      p = x && rows ? rows.filter(r => r.day === day && r.ms < x.ms).length + 1 : null, cell = document.createElement('span');
    if (mine) { on++; if (p) best = Math.min(best, p); }
    const wait = k === 6 && today?.elapsed && !today.solvedAt;
    cell.append(Object.assign(document.createElement('small'), { textContent: k === 6 ? 'danas' : d.toLocaleDateString('hr', { weekday: 'short' }) }),
      Object.assign(document.createElement('b'), { className: mine ? (p && p <= 3 ? 'p' + p : '') : lt ? 'late' : wait ? 'wait' : 'none',
        textContent: mine ? p ?? '✓' : lt ? (p ? `(${p})` : '↺') : wait ? '…' : '–' }));
    return cell;
  }));
  $('weekSum').firstChild.textContent = `Na vrijeme ${on} od 7 dana`;
  $('weekSum').lastChild.textContent = best < Infinity ? `Najbolje ${best}.` : '';
}
[...$('ranksLv').children].forEach((b, i) => b.onclick = () => {
  rankLvl = i;
  try { localStorage.sudokuRankLvl = i; } catch {}
  $('ranks').ariaBusy = 'true';   // the old rows stay, dimmed, until the new ones are in
  showRanks();
});
$('lbJoin').onsubmit = e => {
  e.preventDefault();
  const name = $('lbName').value.trim();
  if (!name) return $('lbName').focus();
  try { localStorage.sudokuName = name; } catch {}
  lbQueue(lbNow.day, lbNow.level, lbNow.ms);
  lbShow(lbNow.day, lbNow.level, lbNow.ms);
  if (card === 'tango') tangoButtons(); else if (card === 'nit') nitButtons(); else if (card === 'mino') minoButtons(); else if (card === 'pas') pasButtons(); else if (card === 'mj') mjButtons(); else solvedButtons();   // the result to share, now with its place
};
$('aboutName').onchange = () => { try { const n = $('aboutName').value.trim(); if (n) localStorage.sudokuName = n; else delete localStorage.sudokuName; } catch {} };
lbFlush();
addEventListener('online', lbFlush);

// The clock: counts only while a game or one of today's dailies is played, unsolved, the page on screen
// (another app or a locked phone stops it; a gap over 5 s means the page slept), not from the menu
// and with no card over it. Stuck in a Nova igra (NUDGE_MS without a move, Savjet not used yet): once
// per game, a small bubble out of Savjet.
let lastTick = Date.now(), idle = 0, NUDGE_MS = 120000;   // idle: ms since the last move (digit, erase, note, undo)
setInterval(() => {
  const now = Date.now(), dt = now - lastTick;
  lastTick = now;
  if (view === 'nit') {   // Nit's board: the same rules, its own clock
    if (ng.solvedAt || document.hidden || dt > 5000 || document.querySelector('dialog[open]')) return;
    ng.elapsed += dt;
    nSave();
    return $('nitTimer').textContent = clock(ng.elapsed);
  }
  if (view === 'mino') {   // Minolovac's board: the same rules, its own clock (the fines go in at once)
    if (mg.solvedAt || document.hidden || dt > 5000 || document.querySelector('dialog[open]')) return;
    mg.elapsed += dt;
    mSave();
    return $('minoTimer').textContent = clock(mg.elapsed);
  }
  if (view === 'pas') {   // Pasijans: the same rules, its own clock
    if (pg.endedAt || document.hidden || dt > 5000 || document.querySelector('dialog[open]')) return;
    pg.elapsed += dt;
    pSave();
    return $('pasTimer').textContent = clock(pg.elapsed);
  }
  if (view === 'mj') {   // Mahjong: the same rules, its own clock (the fines go in at once)
    if (jg.solvedAt || document.hidden || dt > 5000 || document.querySelector('dialog[open]')) return;
    jg.elapsed += dt;
    mjSave();
    return $('mjTimer').textContent = clock(jg.elapsed);
  }
  if (view === 'tango') {   // Tango's board: the same rules, its own clock
    if (tg.solvedAt || document.hidden || dt > 5000 || document.querySelector('dialog[open]')) return;
    tg.elapsed += dt;
    tSave();
    return $('tangoTimer').textContent = clock(tg.elapsed);
  }
  const st = task?.random ? task : task?.daily === days?.date && daily;   // a game or today's daily
  if (!st || st.solvedAt || document.hidden || dt > 5000 || paused || view !== 'game') return;
  st.elapsed += dt;
  saveState();
  $('timer').textContent = clock(st.elapsed);
  if (!task.random || task.techs || task.nudged || (idle += dt) < NUDGE_MS || document.querySelector('dialog[open]')) return;
  task.nudged = true;
  saveState();
  $('nudge').hidden = false;
  $('nudge').animate([{ opacity: 0, transform: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'scale(0.95)' }, {}],
    { duration: 200, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
}, 1000);
addEventListener('pointerdown', () => $('nudge').hidden = true, true);   // any tap puts it away
