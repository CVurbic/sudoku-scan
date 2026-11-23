// Sinkronizacija: the signed-in player's progress in sudokuscan.saves (one row: { data: { v: key → the raw
// localStorage string, at: key → when it last changed here }, updated_at }). Only the keys below go; the rest
// (device id, queue, tokens, camera, view, theme, learned digits) stays on the device. Loaded after app.js.
//
// The merge never loses progress, whichever device pushes first:
// - done maps, history and the Sudoku days are unions (the better result where both have one);
// - a daily board: the newer day, then solved, then the longer played (never by change time: a device that
//   only looked at today writes a fresh board, and that must not beat one solved elsewhere);
// - Nova igra, the current task and small settings: changed last wins (unknown time: the local one).
// ponytail: deletions (Povijest's Obriši) come back from the other devices; tombstones if that bothers anyone.

const SYNC_DONE = ['sudokuDailyDone', 'sudokuDailyLate', 'nitDone', 'minoDone', 'mjDone', 'pasDone', 'tangoDone'];
const SYNC_BOARD = ['tangoDaily0', 'tangoDaily1', 'tangoDaily2', 'nitDaily', 'minoDaily', 'pasDaily', 'mjDaily'];
const SYNC_LAST = ['sudokuTask', 'tangoGame', 'nitGame', 'minoGame', 'pasGame', 'mjGame', 'sudokuName', 'sudokuTips', 'sudokuQuiet'];
const SYNC_KEYS = [...SYNC_DONE, ...SYNC_BOARD, ...SYNC_LAST, 'sudokuHistory', 'sudokuDays'];
const SYNC_SAFE = new Set([...SYNC_DONE, 'sudokuHistory', 'sudokuDays']);   // re-read from localStorage at every write: safe to replace mid-game

const sorted = m => JSON.stringify(Object.fromEntries(Object.keys(m).sort().map(d => [d, m[d]])));   // the same text whichever side came first
const sjson = s => { try { return JSON.parse(s); } catch { return null; } };
const sms = x => x == null ? Infinity : typeof x === 'number' ? x : x.ms ?? Infinity;   // a done entry: ms, or { ms }; lower is better (pasDone's pScore too)
// Two boards of the same game (a daily, or a Sudoku day's level): the newer day, then solved, then the longer played.
function syncBoard(a, b) {
  if (!a || !b) return a || b || null;
  if ((a.date || '') !== (b.date || '')) return (a.date || '') > (b.date || '') ? a : b;
  const da = !!(a.solvedAt || a.endedAt), db = !!(b.solvedAt || b.endedAt);
  if (da !== db) return da ? a : b;
  return (b.elapsed || 0) > (a.elapsed || 0) ? b : a;
}
// One key's two raw strings (null = missing) and change times → the merged raw string.
function syncKey(k, a, b, ta = 0, tb = 0) {
  if (a == null || b == null || a === b) return a ?? b;
  const x = sjson(a), y = sjson(b);
  if (SYNC_DONE.includes(k)) {
    if (!x || !y) return x ? a : b;
    const m = { ...y, ...x };
    for (const d in y) if (d in x) {
      if (k === 'tangoDone') {   // date → ms (before 23. 11.: one number, Srednje) or [ms or null] per level
        const p = Array.isArray(x[d]) ? x[d] : [null, x[d], null], q = Array.isArray(y[d]) ? y[d] : [null, y[d], null];
        m[d] = [0, 1, 2].map(i => p[i] == null ? q[i] ?? null : q[i] == null ? p[i] : Math.min(p[i], q[i]));
      } else m[d] = sms(y[d]) < sms(x[d]) ? y[d] : x[d];
    }
    return sorted(m);
  }
  if (k === 'sudokuHistory') {
    if (!Array.isArray(x) || !Array.isArray(y)) return Array.isArray(x) ? a : b;
    const m = new Map();
    for (const e of [...x, ...y]) { const o = m.get(e.key); if (!o || (e.last || 0) > (o.last || 0)) m.set(e.key, e); }
    return JSON.stringify([...m.values()].sort((p, q) => (q.last || 0) - (p.last || 0) || (p.key < q.key ? -1 : 1)).slice(0, 100));   // sudoku.js HISTORY_MAX
  }
  if (k === 'sudokuDays') {   // date → [3 × level board or null]
    if (!x || !y) return x ? a : b;
    const m = { ...y, ...x };
    for (const d in y) if (d in x) m[d] = [0, 1, 2].map(i => syncBoard(x[d]?.[i], y[d]?.[i]));
    return sorted(m);
  }
  if (SYNC_BOARD.includes(k)) return syncBoard(x, y) === y ? b : a;
  if (k === 'sudokuName' && !a !== !b) return a || b;   // a name beats none
  return tb > ta ? b : a;   // the rest: changed last wins; a tie (or no times yet) keeps the first, the local one
}
// Two snapshots { v, at } → the merged one.
function syncMerge(L, R) {
  const v = {}, at = {};
  for (const k of SYNC_KEYS) {
    const m = syncKey(k, L.v[k] ?? null, R.v?.[k] ?? null, L.at[k] || 0, R.at?.[k] || 0);
    if (m != null) v[k] = m;
    const t = Math.max(L.at[k] || 0, R.at?.[k] || 0);
    if (t) at[k] = t;
  }
  return { v, at };
}

// --- The glue: this device's snapshot, the row on the server, a push after every change. ---
const SAVES = 'https://fgllmnemukhouwyebfop.supabase.co/rest/v1/saves';
let syncSeen, syncOn = false, syncBusy = null, syncTimer, syncDirty = false;   // syncSeen: the row's updated_at as last read (null: no row yet)
const syncLast = {};   // key → the raw string as last seen here
const syncAt = () => sjson(localStorage.sudokuSyncAt) || {};
function syncLocal() {
  const v = {}, at = syncAt();
  for (const k of SYNC_KEYS) { const s = localStorage.getItem(k); if (s != null) v[k] = s; }
  return { v, at };
}
// What changed here since the last look gets its time (the merge's "changed last").
function syncScan() {
  const at = syncAt();
  let changed = false;
  for (const k of SYNC_KEYS) {
    const s = localStorage.getItem(k);
    if (k in syncLast && s !== syncLast[k]) { at[k] = Date.now(); changed = true; }
    syncLast[k] = s;
  }
  if (changed) { try { localStorage.sudokuSyncAt = JSON.stringify(at); } catch {} syncDirty = true; }
  return changed;
}
async function syncApi(q, o = {}) {
  const t = await authToken();
  if (!t) return null;
  return fetch(SAVES + q, { ...o, headers: { apikey: LB_KEY, Authorization: 'Bearer ' + t, 'Accept-Profile': 'sudokuscan', 'Content-Profile': 'sudokuscan',
    'Content-Type': 'application/json', Prefer: 'return=representation', ...o.headers } }).catch(() => null);
}
async function syncRead() {
  const r = await syncApi(`?select=data,updated_at&user_id=eq.${authGet().id}`);
  if (!r?.ok) return null;
  const [row] = await r.json();
  syncSeen = row?.updated_at ?? null;
  return row?.data || { v: {}, at: {} };
}
// Merged values into localStorage: all of them at the start (then a reload, so every game reads them),
// later only the keys whose writers re-read localStorage. → whether anything changed.
const syncCanon = s => { const o = sjson(s); return o && typeof o === 'object' && !Array.isArray(o) ? sorted(o) : s; };   // only the key order differs: no change
function syncWrite(M, keys) {
  let changed = false;
  for (const k of keys) {
    const s = M.v[k];
    if (s != null && syncCanon(s) !== syncCanon(localStorage.getItem(k))) { try { localStorage.setItem(k, s); changed = true; } catch {} }
    syncLast[k] = localStorage.getItem(k);
  }
  try { localStorage.sudokuSyncAt = JSON.stringify({ ...syncAt(), ...M.at }); } catch {}
  return changed;
}
// Read, merge, write back; the write only if the row is still the one read (else again, at most 3 times).
async function syncPush(first) {
  for (let i = 0; i < 3; i++) {
    syncScan();
    const R = await syncRead();
    if (!R) return false;
    const M = syncMerge(syncLocal(), R);
    if (first && syncWrite(M, SYNC_KEYS) && !sessionStorage.syncReloaded) { sessionStorage.syncReloaded = '1'; location.reload(); return true; }
    if (!first) syncWrite(M, SYNC_KEYS.filter(k => SYNC_SAFE.has(k)));
    syncDirty = false;
    if (SYNC_KEYS.every(k => M.v[k] == R.v?.[k] && (M.at[k] || 0) === (R.at?.[k] || 0))) return true;   // nothing new (jsonb reorders keys: compare each)
    const body = JSON.stringify({ user_id: authGet().id, data: M, updated_at: new Date().toISOString() });
    const r = syncSeen == null ? await syncApi('', { method: 'POST', body })
      : await syncApi(`?user_id=eq.${authGet().id}&updated_at=eq.${encodeURIComponent(syncSeen)}`, { method: 'PATCH', body });
    if (!r) return false;
    if (r.ok && (await r.json()).length) return true;
    if (!r.ok && r.status !== 409) return false;   // 409: the other device made the row first; 0 rows: it wrote since → again
  }
  return false;
}
var syncedAt = 0;   // the last time the server had all of this device's (the account dialog says so); var: app.js reads it
const syncNow = first => syncBusy ||= syncPush(first).then(ok => { if (ok) syncedAt = Date.now(); }).finally(() => { syncBusy = null; });
// Signed in: once at the start, then every change (looked for every 4 s) after 3 s of quiet, and on leaving.
function syncStart() {
  if (syncOn || !authGet()) return;
  syncOn = true;
  syncScan();
  syncNow(true).then(() => { sessionStorage.removeItem('syncReloaded'); showAcct(); });
  setInterval(() => {
    if (!authGet()) return;
    if (syncScan()) { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), 3000); }
  }, 4000);
  addEventListener('visibilitychange', () => { if (document.hidden && authGet() && (syncScan() || syncDirty)) syncNow(); });
}
syncStart();
