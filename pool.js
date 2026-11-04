// HARD_TRIES for sudoku.js: per day from NEW_TECH, the first Teško try (dailyTry) in the level's range whose
// hardest technique is needed at least twice. Runs the app's own sudoku code in Node, no browser.
// Usage: node pool.js [days=730] [from day=0] > tries.txt   (~6 s a day), then paste the string into HARD_TRIES.
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/sudoku.js', 'utf8');
const cut = (a, b) => { const i = src.indexOf(a); return src.slice(i, src.indexOf(b, i)); };
const ctx = {};
vm.createContext(ctx);
vm.runInContext(cut('// --- Sudoku logic.', '// Digits 1-9') + cut('const DAILY =', 'const dayKey') +
  ';this.m = { dailyTry, makeDaily, hint, reveal, BANDS, DAILY, NEW_TECH, HARD_TRIES };', ctx);
const { dailyTry, makeDaily, hint, reveal, BANDS, DAILY, NEW_TECH, HARD_TRIES } = ctx.m;

// node pool.js layouts > layouts.js: where each day's givens stand, per level (only the cells, no digits), for the
// menu's boards; as many days as HARD_TRIES has. 81 bits as 16 base-36 characters, three levels a day. (~10 min)
if (process.argv[2] === 'layouts') {
  let out = '';
  for (let day = 0; day < HARD_TRIES.length / 2; day++) {
    const date = new Date(Date.parse(NEW_TECH) + day * 864e5).toISOString().slice(0, 10);
    for (let lvl = 0; lvl < 3; lvl++)
      out += BigInt('0b' + makeDaily(date, lvl).givens.map(d => +!!d).join('')).toString(36).padStart(16, '0');
    process.stderr.write(date + '\n');
  }
  console.log(`// Made by pool.js (node pool.js layouts > layouts.js): per day from NEW_TECH, the givens' cells of the three dailies.\nconst DAILY_LAYOUTS = '${out}';`);
  process.exit();
}

// How often the hardest technique was needed (as difficulty() counts it).
function hardestCount({ givens, solution }) {
  const g = givens.slice();
  let hardest = 0, n = 0;
  while (g.some(d => !d)) {
    const h = hint(g) || reveal(g, solution), k = BANDS.findIndex(([t]) => t.includes(h.tech));
    if (k > hardest) { hardest = k; n = 0; }
    if (k === hardest) n++;
    g[h.cell] = h.digit;
  }
  return n;
}

const [, , lo, hi] = DAILY[2], days = +process.argv[2] || 730, from = +process.argv[3] || 0;
let out = '';
for (let day = from; day < from + days; day++) {
  const date = new Date(Date.parse(NEW_TECH) + day * 864e5).toISOString().slice(0, 10);
  let k = 0;
  for (; k < 36 * 36; k++) {
    const p = dailyTry(date, 2, k);
    if (p.diff >= lo && p.diff < hi && hardestCount(p) >= 2) break;
  }
  if (k === 36 * 36) throw new Error(`${date}: no try passed`);
  out += k.toString(36).padStart(2, '0');
  process.stderr.write(`${date} ${k}\n`);
}
console.log(out);
