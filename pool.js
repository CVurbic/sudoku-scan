// HARD_TRIES for index.html: per day from NEW_TECH, the first Teško try (dailyTry) in the level's range whose
// hardest technique is needed at least twice. Runs the app's own sudoku code in Node, no browser.
// Usage: node pool.js [days=730] [from day=0] > tries.txt   (~6 s a day), then paste the string into HARD_TRIES.
const fs = require('fs'), vm = require('vm');
const src = fs.readFileSync(__dirname + '/index.html', 'utf8');
const cut = (a, b) => { const i = src.indexOf(a); return src.slice(i, src.indexOf(b, i)); };
const ctx = {};
vm.createContext(ctx);
vm.runInContext(cut('// --- Sudoku logic.', 'function findGrid') + cut('const DAILY =', 'const dayKey') +
  ';this.m = { dailyTry, hint, reveal, BANDS, DAILY, NEW_TECH };', ctx);
const { dailyTry, hint, reveal, BANDS, DAILY, NEW_TECH } = ctx.m;

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
