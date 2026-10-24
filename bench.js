// Accuracy benchmark on the Wicht sudoku dataset (CC-BY-4.0, github.com/wichtounet/sudoku_dataset):
// 200 newspaper photos with printed givens ("v2") + the same photos filled in with handwriting ("mixed").
// Downloads into .data/ on first run. Usage: node bench.js   (set CHROME to override the Chrome path)
const puppeteer = require('puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path'), { execSync } = require('child_process');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DATA = path.join(__dirname, '.data');
const SETS = { v2_train: 'v2_train', v2_test: 'v2_test', v2_mixed_train: 'mixed', v2_mixed_test: 'mixed' };

for (const set of Object.keys(SETS)) {
  if (fs.existsSync(path.join(DATA, set))) continue;
  fs.mkdirSync(path.join(DATA, set), { recursive: true });
  const tar = path.join(DATA, set + '.tar.bz2');
  execSync(`curl -sL -o "${tar}" https://github.com/wichtounet/sudoku_dataset/raw/master/datasets/${set}.tar.bz2`);
  execSync(`tar -xjf "${tar}" -C "${path.join(DATA, set)}"`);
  fs.unlinkSync(tar);
}
const dat = f => fs.readFileSync(f, 'utf8').split('\n').slice(2, 11).join('').replace(/\s/g, '').split('').map(Number);
const images = set => fs.readdirSync(path.join(DATA, set, SETS[set])).filter(f => f.endsWith('.jpg'))
  .map(f => ({ url: `/.data/${set}/${SETS[set]}/${f}`, truth: dat(path.join(DATA, set, SETS[set], f.replace('.jpg', '.dat'))), name: f }));
const printed = [...images('v2_train'), ...images('v2_test')];
const givens = Object.fromEntries(printed.map(x => [x.name, x.truth]));
const mixed = process.env.PRINTED_ONLY ? [] : [...images('v2_mixed_train'), ...images('v2_mixed_test')].filter(x => givens[x.name]);

const server = http.createServer((q, s) => fs.readFile(path.join(__dirname, decodeURIComponent(q.url === '/' ? 'index.html' : q.url)),
  (e, d) => e ? (s.writeHead(404), s.end()) : (s.writeHead(200), s.end(d)))).listen(8770);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  await page.goto('http://localhost:8770/');
  await page.waitForFunction(() => !document.getElementById('file').disabled, { timeout: 120000 });
  const read = url => page.evaluate(async u => readGrid(await (await fetch(u)).blob()), url);
  const best = p => p ? p.indexOf(Math.max(...p)) + 1 : 0;
  const judge = eval(await page.evaluate(() => judge.toString()));
  const pct = (a, b) => `${(100 * a / b).toFixed(1)}%`;

  const reset = () => page.evaluate(() => { memory = []; rebuildMemory(); localStorage.removeItem('sudokuMemory'); });
  const learn = pairs => pairs.length && page.evaluate(p => learn(p), pairs);
  const half = (list, k) => k < list.length / 2 ? 0 : 1;

  // Printed: plain OCR, no task. With learning, each photo's digits are remembered after reading it
  // (as when the user confirms the grid with "Ovo je zadatak").
  async function printedPass(learning) {
    const perImage = [], confusions = {}, late = [0, 0];
    let noGrid = 0, perfect = 0, cells = 0, missed = 0, phantom = 0, misread = 0, unflagged = 0;
    for (const [k, { url, truth }] of printed.entries()) {
      const probs = await read(url);
      if (!probs) { noGrid++; continue; }
      let errs = 0;
      probs.forEach((p, i) => {
        const b = best(p), t = truth[i];
        cells++;
        if (half(printed, k)) late[1]++;
        if (b === t) return;
        errs++;
        if (half(printed, k)) late[0]++;
        confusions[`${t || '_'}→${b || '_'}`] = (confusions[`${t || '_'}→${b || '_'}`] || 0) + 1;
        if (!b) missed++; else if (!t) phantom++; else misread++;
        if (!p || p[b - 1] >= 0.8) unflagged++;
      });
      if (!errs) perfect++;
      perImage.push([errs, url]);
      if (learning) await learn(truth.map((d, i) => [i, d]).filter(([, d]) => d));
    }
    const errs = missed + phantom + misread;
    console.log(`PRINTED${learning ? ' + LEARNING' : ''} (${printed.length} photos): grid not found ${noGrid}, perfect ${perfect} (${pct(perfect, printed.length)})`);
    console.log(`  cell errors ${errs}/${cells} (${pct(errs, cells)}), second half ${pct(late[0], late[1])}: missed digit ${missed}, phantom digit ${phantom}, misread ${misread}; not flagged yellow ${unflagged}`);
    if (learning) return;
    console.log('  top confusions (truth→read, _ = empty):', Object.entries(confusions).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join(' '));
    const h = [1, 4, 21, 82].map((hi, k) => perImage.filter(([e]) => e >= [0, 1, 4, 21][k] && e < hi).length);
    console.log(`  photos by errors: 0 → ${h[0]}, 1-3 → ${h[1]}, 4-20 → ${h[2]}, 21+ → ${h[3]}`);
    console.log('  worst:', perImage.sort((a, b) => b[0] - a[0]).slice(0, 8).map(([e, u]) => `${u.split('/').pop()}:${e}`).join(' '));
  }

  // Handwriting: plain OCR accuracy, then check mode (judge vs known solution) on the handwritten cells.
  // With learning, cells judged 'ok' are remembered, and flagged ones too (the user types what is
  // written there), exactly as the app does.
  async function mixedPass(learning) {
    let hw = 0, hwRight = 0, hwMissed = 0, ok = 0, maybe = 0, wrong = 0, lies = 0, caught = 0, unsure = 0, passed = 0, noGrid = 0;
    const late = [0, 0];
    for (const [k, { url, truth, name }] of mixed.entries()) {
      const probs = await read(url);
      if (!probs) { noGrid++; continue; }
      const oks = [];
      probs.forEach((p, i) => {
        if (givens[name][i] || !truth[i]) return;
        hw++;
        if (half(mixed, k)) late[1]++;
        if (!p) { hwMissed++; return; }
        if (best(p) === truth[i]) hwRight++; else if (half(mixed, k)) late[0]++;
        const j = judge(p, truth[i]);
        j === 'ok' ? ok++ : j === 'maybe' ? maybe++ : wrong++;
        oks.push([i, truth[i]]);
        for (let d = 1; d <= 9; d++) if (d !== truth[i]) {   // pretend the solution says d → entry is an error
          lies++;
          const k = judge(p, d);
          k === 'wrong' ? caught++ : k === 'maybe' ? unsure++ : passed++;
        }
      });
      if (learning) await learn(oks);
    }
    console.log(`HANDWRITTEN${learning ? ' + LEARNING' : ''} (${mixed.length} photos, ${hw} cells): grid not found ${noGrid}`);
    console.log(`  plain OCR right ${pct(hwRight, hw)}, second half wrong ${pct(late[0], late[1])}, cell seen as empty ${hwMissed}`);
    console.log(`  check, correct entries: ok ${pct(ok, hw)}, maybe ${pct(maybe, hw)}, FALSE ALARM ${pct(wrong, hw)}`);
    console.log(`  check, wrong entries:   caught ${pct(caught, lies)}, maybe ${pct(unsure, lies)}, MISSED ${pct(passed, lies)}`);
  }

  for (const learning of [false, true]) {
    await reset();
    await printedPass(learning);
    await reset();
    if (mixed.length) await mixedPass(learning);
  }
  await reset();
  await browser.close(); server.close();
})();
