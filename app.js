// Shared by every game: messages, the screens (Igre, Povijest, Sudoku, its game, Tango) and the tab bar,
// "Instaliraj", the leaderboard, the clock. Loaded first, then sudoku.js, scan.js, tango.js; index.html starts the app.

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
const VIEWS = ['games', 'past', 'menu', 'game', 'tango'];
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
  ({ games: showGames, past: showPast, menu: showMenu, game: placeBubble, tango: drawTango })[v]();
}
$('tabGames').onclick = () => go('games');
$('tabPast').onclick = () => go('past');
$('menuBack').onclick = () => go('games');
$('tileSudoku').onclick = () => go('menu');
$('tileTango').onclick = () => openTango();

// Igre: a tile per game, with how today's daily stands.
function showGames() {
  const solved = loadDays().levels.filter(st => st?.solvedAt).length, t = tLoad('tangoDaily'), tDone = t?.date === dayKey() && t.solvedAt;
  Object.assign($('tileSudoku').lastChild, { textContent: solved === 3 ? 'Dnevni riješen ✓' : `Dnevni ${solved} od 3`, className: solved === 3 ? 'solved' : '' });
  Object.assign($('tileTango').lastChild, { className: tDone ? 'solved' : '',
    textContent: tDone ? `✓ ${clock(t.elapsed)} · ${daysWord(streak(Object.keys(tangoDone())))}` : t?.date === dayKey() && t.elapsed ? `U tijeku · ${clock(t.elapsed)}` : 'Dnevni čeka' });
}
// Povijest: Tango's solved dailies (newest first), then every sudoku.
function showPast() {
  const done = Object.entries(tangoDone()).sort((a, b) => a[0] < b[0] ? 1 : -1);
  $('tangoPastTitle').hidden = $('tangoPast').hidden = !done.length;
  $('tangoPast').replaceChildren(...done.map(([date, ms]) => {
    const li = document.createElement('li'), row = Object.assign(document.createElement('span'), { className: 'hrow' });
    row.append($('tileTango').firstChild.cloneNode(true), Object.assign(document.createElement('span'), { className: 'hmeta' }));
    row.firstChild.style.cssText = 'width: 56px; height: 56px; flex: none';
    row.lastChild.append(Object.assign(document.createElement('b'), { className: 'solved', textContent: `Riješeno za ${clock(ms)} ✓` }),
      Object.assign(document.createElement('small'), { textContent: 'Dnevni · ' + new Date(date + 'T12:00').toLocaleDateString('hr', { day: 'numeric', month: 'numeric', year: 'numeric' }) }));
    li.append(row);
    return li;
  }));
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
// Level 3 is Tango's daily (one a day); the solved card's result is lbNow: { day, level, ms }.
const lvName = l => l === 3 ? 'Tango' : DAILY[l][0].toLowerCase();
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
  return true;
}
// A day and level's top n as list rows, your own (mine: { name, ms }) marked, or below them if you are
// further down (equal times share a place). → { rows, all: players, place: yours }; rejects when it did not load.
async function lbRows(day, level, n, mine) {
  const where = `day=eq.${day}&level=eq.${level}`, ok = r => r.ok ? r : Promise.reject(),
    count = q => lb(`select=id&${q}`, { method: 'HEAD', headers: { Prefer: 'count=exact' } }).then(ok).then(r => +r.headers.get('content-range').split('/')[1]);
  const [top, faster, all] = await Promise.all([lb(`select=name,ms&${where}&order=ms,created_at&limit=${n}`).then(ok).then(r => r.json()),
    mine ? count(`${where}&ms=lt.${mine.ms}`) : 0, count(where)]);
  const row = (place, r, cls = '') => {
    const li = document.createElement('li');
    li.className = cls;
    li.append(...[place, r.name, clock(r.ms)].map(t => Object.assign(document.createElement('span'), { textContent: t })));
    return li;
  };
  const me = mine ? top.findIndex(r => r.name === mine.name && r.ms === mine.ms) : -1,
    rows = top.map((r, i) => row(top.findIndex(x => x.ms === r.ms) + 1, r, i === me ? 'me' : ''));
  if (mine && me < 0 && all) rows.push(row(faster + 1, mine, 'me apart'));
  return { rows, all, place: faster + 1 };
}
const players = n => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'igrač' : 'igrača'}`;
// The solved card's panel: the name first if there is none; else the top five and you.
async function lbShow(day, level, ms) {
  const name = lbName(), head = t => $('lbHead').textContent = t;
  $('lboard').hidden = false;
  $('lbJoin').hidden = !!name;
  $('lbList').replaceChildren();
  if (!name) return head('Upiši se na današnju ljestvicu');
  head('Učitavam…');
  if (!await lbFlush()) return head('Bez mreže: rezultat se šalje kad se vratiš.');
  let b;
  try { b = await lbRows(day, level, 5, { name, ms }); } catch { return head('Ljestvica se nije učitala.'); }
  b.rows.forEach((li, i) => li.style.setProperty('--i', i));   // one after another
  head(`Danas, ${lvName(level)} · ${players(b.all)}`);
  $('lbList').replaceChildren(...b.rows);
}

// The menu's Ljestvica: a day (today, or up to a week back), each level's top three and you. Your row comes
// from your own record of that day (ponytail: shown even if that time was solved before the name was
// set, so never sent; a sent flag in the record if that ever confuses). Asked again on every menu
// (ponytail: 9 small requests; a short cache if Supabase's free tier ever minds).
let ranksOff = 0, ranksAsk = 0;
async function showRanks() {
  const d = new Date();
  d.setDate(d.getDate() - ranksOff);
  const day = dayKey(d), ask = ++ranksAsk, done = dailyDone(), name = lbName();
  $('ranksDate').textContent = ranksOff === 0 ? 'Danas' : ranksOff === 1 ? 'Jučer' : d.toLocaleDateString('hr', { weekday: 'short', day: 'numeric', month: 'numeric' });
  $('ranksPrev').disabled = ranksOff === 6;
  $('ranksNext').disabled = ranksOff === 0;
  const res = await Promise.all(DAILY.map((_, lvl) => {
    const mine = done[`${day}/${lvl}`];
    return lbRows(day, lvl, 3, name && mine ? { name, ms: mine.ms } : null).catch(() => null);
  }));
  if (ask !== ranksAsk) return;   // another day was asked for meanwhile
  $('ranks').ariaBusy = 'false';
  [...$('ranks').children].forEach((el, lvl) => {
    const b = res[lvl], ol = el.querySelector('ol'), rows = b?.rows ?? [];
    el.querySelector('small').textContent = !b ? 'Nije se učitalo' : b.all ? players(b.all) : 'Još nitko';
    if (ol.innerHTML !== rows.map(li => li.outerHTML).join('')) ol.replaceChildren(...rows);   // the same rows stay put (no fade)
  });
}
const stepRanks = by => { ranksOff += by; $('ranks').ariaBusy = 'true'; showRanks(); };   // the old rows stay, dimmed, until the new ones are in
$('ranksPrev').onclick = () => stepRanks(1);
$('ranksNext').onclick = () => stepRanks(-1);
$('lbJoin').onsubmit = e => {
  e.preventDefault();
  const name = $('lbName').value.trim();
  if (!name) return $('lbName').focus();
  try { localStorage.sudokuName = name; } catch {}
  lbQueue(lbNow.day, lbNow.level, lbNow.ms);
  lbShow(lbNow.day, lbNow.level, lbNow.ms);
  if (card === 'tango') tangoButtons(); else solvedButtons();   // the result to share, now with its place
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
  if (view === 'tango') {   // Tango's board: the same rules, its own clock
    if (tg.solvedAt || document.hidden || dt > 5000 || document.querySelector('dialog[open]')) return;
    tg.elapsed += dt;
    tSave();
    return $('tangoTimer').textContent = clock(tg.elapsed);
  }
  const st = task?.random ? task : task?.daily === days?.date && daily;   // a game or today's daily
  if (!st || st.solvedAt || document.hidden || dt > 5000 || $('dailyDlg').open || view !== 'game') return;
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
