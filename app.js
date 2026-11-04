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
const VIEWS = ['games', 'past', 'menu', 'game', 'tango', 'xw', 'xwplay'];
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
  ({ games: showGames, past: showPast, menu: showMenu, game: placeBubble, tango: drawTango, xw: showXw, xwplay: drawXw })[v]();
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
const RAIL_ON = { games: 'games', past: 'past', menu: 'menu', game: 'menu', tango: 'tango', xw: 'xw', xwplay: 'xw' };
const railMini = () => { try { return localStorage.railMini === '1'; } catch { return false; } };
function showRail() {
  document.body.classList.toggle('railmini', railMini() || ['game', 'tango', 'xwplay'].includes(view));
  // today's, read afresh (days is the day being played, maybe an older one)
  const solved = readDay().levels.filter(st => st?.solvedAt).length, t = tLoad('tangoDaily'), tDone = t?.date === dayKey() && t.solvedAt;
  const games = xwGames(), key = Object.keys(games).sort((a, b) => games[b].at - games[a].at)[0], p = key && xwProgress(key, games);
  const xwText = p ? (p.done ? '✓' : `${p.n} od ${p.words.length}`) : '';
  const state = { menu: [solved === 3 ? '✓' : `${solved} od 3`, solved < 3], tango: [tDone ? '✓' : t?.date === dayKey() && t.elapsed ? 'u tijeku' : 'čeka', !tDone], xw: [xwText, false] };
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
  if (v) v === 'tango' ? openTango() : go(v);
};
function railFold() {
  const mini = !document.body.classList.contains('railmini');
  if (!['game', 'tango', 'xwplay'].includes(view)) try { localStorage.railMini = mini ? '1' : '0'; } catch {}
  document.body.classList.toggle('railmini', mini);
}
$('railFold').onclick = railFold;
addEventListener('keydown', e => { if (e.key === '[' && !e.target.closest('input, textarea') && matchMedia('(min-width: 1100px)').matches) railFold(); });

// Danas (Igre with the rail): each game's card with today's state and one button, the board's leaders, the last sudokus.
let todayAsk = 0;
function showToday() {
  const li = (a, b, cls = '') => { const x = document.createElement('li'); x.append(...[a, b].map((t, i) => Object.assign(document.createElement('span'), { textContent: t, className: i ? cls : '' }))); return x; };
  // A row's sign: a sudoku level's stairs, or Tango's own picture (it has one daily, no levels)
  const dot = (el, l) => { el.firstChild.prepend(l < 3 ? stairs(l) : Object.assign($('tileTango').firstChild.cloneNode(true), { classList: 'tmark' })); return el; };
  $('dDate').textContent = new Date().toLocaleDateString('hr', { weekday: 'long', day: 'numeric', month: 'long' });
  const lv = loadDays().levels, next = lv.findIndex(st => !st?.solvedAt);
  $('dSudoku').replaceChildren(...DAILY.map(([name], i) => dot(li(name, levelText(lv[i]), lv[i]?.solvedAt ? 'solved' : 'muted'), i)));
  Object.assign($('dSudokuGo'), next < 0 ? { textContent: 'Nova igra', onclick: () => go('menu') } : { textContent: `Igraj ${DAILY[next][0].toLowerCase()}`, onclick: () => openDaily(next) });
  const t = tLoad('tangoDaily'), tDone = t?.date === dayKey() && t.solvedAt, run = streak(Object.keys(tangoDone()));
  $('dTango').replaceChildren(li('Dnevni', tDone ? `Riješeno za ${clock(t.elapsed)} ✓` : t?.date === dayKey() && t.elapsed ? `U tijeku · ${clock(t.elapsed)}` : 'Čeka', tDone ? 'solved' : 'muted'),
    ...run ? [li('Niz', daysWord(run) + ' zaredom')] : []);
  Object.assign($('dTangoGo'), tDone ? { textContent: 'Nova igra', onclick: () => tangoGame() } : { textContent: 'Igraj dnevni', onclick: () => openTango() });
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
  // The board: today's fastest per daily (sudoku's three, Dinango), asked anew each time (4 small requests).
  const ask = ++todayAsk;
  Promise.all([0, 1, 2, 3].map(l => lbRows(dayKey(), l, 1).catch(() => null))).then(res => {
    if (ask !== todayAsk) return;
    $('dRanks').replaceChildren(...res.map((b, l) => {
      const top = b?.rows[0], name = lvName(l)[0].toUpperCase() + lvName(l).slice(1);
      return dot(li(top ? `${name} · ${top.children[1].textContent}` : name, !b ? 'Nije se učitalo' : top ? top.children[2].textContent : 'Još nitko', top ? 'time' : 'muted'), l);
    }));
  });
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
  xwTile();
  if (matchMedia('(min-width: 1100px)').matches) showToday();
}
matchMedia('(min-width: 1100px)').onchange = () => view === 'games' && showGames();   // a window made wider gets Danas
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
const lvName = l => l === 3 ? 'Dinango' : DAILY[l][0].toLowerCase();
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
    li.append(...[place, r.name, clock(r.ms)].map(t => Object.assign(document.createElement('span'), { textContent: t })));
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
