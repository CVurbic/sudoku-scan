// End-to-end check in headless Chrome: OCR on real photos, solver, hints, check against solution.
// Usage: node test.js   (set CHROME to override the Chrome path)
const puppeteer = require('puppeteer-core');
const assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PRINTED = '070500106001040000005701000102000030304912605050000201000109400000030500503006090';
// handwritten.jpg: printed givens + the full grid written in by hand
const HW_GIVENS = '000000082830060017010090003000700051020508030540003000300080060690030074450000000';
const HW_FULL = '764351982839264517215897643983726451126548739547913826372489165698135274451672398';

const server = http.createServer((q, s) => fs.readFile(path.join(__dirname, q.url === '/' ? 'index.html' : q.url),
  (e, d) => e ? (s.writeHead(404), s.end()) : (s.writeHead(200), s.end(d)))).listen(8768);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR', e.message));
  const open = async (task) => {
    await page.goto('http://localhost:8768/');
    await page.evaluate(t => t ? localStorage.sudokuTask = JSON.stringify(t) : localStorage.clear(), task);
    await page.reload();
    await page.waitForFunction(() => !document.getElementById('file').disabled, { timeout: 120000 });
  };
  const scan = async f => {
    await (await page.$('#file')).uploadFile(path.join(__dirname, 'test', f));
    await page.waitForFunction(() => !/Tražim/.test(document.getElementById('status').textContent));
  };
  const grid = () => page.evaluate(() => [...document.querySelectorAll('#grid input')].map(i => i.value || '0').join(''));
  const cls = c => page.evaluate(c => [...document.querySelectorAll('#grid input')].map((x, i) => x.classList.contains(c) ? i : -1).filter(i => i >= 0), c);

  // 1. Printed puzzle: exact OCR, unique solution, hints step to the end and are always right.
  await open(null);
  await scan('printed.jpg');
  assert.strictEqual(await grid(), PRINTED, 'printed OCR');
  await page.click('#setTask');
  const solution = await page.evaluate(() => task.solution.join(''));
  // Tries during the first step ("5 in the top-right box goes to r2c8"): r1c8 clashes with row 1's 5, r2c8 is right.
  const typeIn = async (cell, d) => {   // tap the cell, then the pad key
    await page.evaluate(cell => document.querySelectorAll('#grid input')[cell].click(), cell);
    await page.evaluate(d => [...document.querySelectorAll('#pad button')].find(b => b.textContent === (d || '⌫')).click(), d);
  };
  const said = () => page.$eval('#explain', e => e.textContent);
  await page.click('#hintBtn');
  await typeIn(7, '5');
  assert.ok((await said()).startsWith('Ne može: 5 već postoji u redu 1'), await said());
  await typeIn(7, '');
  await typeIn(16, '5');
  assert.ok((await said()).startsWith('Točno! Tehnika: Jedino mjesto'), await said());
  console.log('scan tries: wrong → "Ne može: 5 već postoji u redu 1…", right → "Točno! Tehnika: Jedino mjesto…"');

  // Each step takes 3 presses (where to look → why → answer); the answer must always be right.
  let steps = 0, reveals = 0;
  const techs = {};
  for (let press = 0; press < 400; press++) {
    await page.click('#hintBtn');
    const text = await page.$eval('#explain', e => e.textContent);
    if (text === 'Sve je riješeno!') break;
    if (press < 3) console.log(`first step, level ${press + 1}:`, text.replace(/\n/g, ' | '));
    const [cell] = await cls('hint');
    if (cell === undefined) {   // levels 1-2: marks but no answer yet
      const tech = text.match(/Tehnika: ([^(]+)/)?.[1].trim();
      if (tech) techs[tech] = (techs[tech] || 0) + 1;
      continue;
    }
    steps++;
    if (text.startsWith('Ovdje treba naprednija')) reveals++;
    assert.strictEqual((await grid())[cell], solution[cell], `step ${steps}: ${text}`);
  }
  assert.strictEqual(await grid(), solution);
  console.log(`printed: OCR 81/81, solved in ${steps} steps (${reveals} reveals), techniques shown:`, JSON.stringify(techs));

  // History: one entry for this puzzle, solved; the same puzzle again stays one entry; opening it brings it back.
  const hist = () => page.evaluate(() => saved().map(e => ({ key: e.key, givens: e.givens, done: [...e.done].filter(d => +d).length })));
  assert.deepStrictEqual(await hist(), [{ key: solution, givens: PRINTED, done: [...PRINTED].filter(d => d === '0').length }], 'history entry');
  await page.evaluate(() => remember(task.solution, task.givens, Array(81).fill(0)));
  assert.strictEqual((await hist()).length, 1, 'no duplicate');
  await page.click('#newBtn');
  await page.click('#historyBtn');
  assert.strictEqual(await page.$eval('.hmeta b', b => b.textContent), 'Riješeno');
  await page.click('.hrow');
  assert.deepStrictEqual([await page.evaluate(() => task.givens.join('')), await grid()], [PRINTED, solution], 'opened from history');
  console.log('history: one entry per puzzle, solved, reopens');

  // 1b. Harder puzzles: hint() steps (incl. Pointing / Naked Pair) must always give the solution digit.
  const hard = await page.evaluate(puzzles => {
    const techs = {};
    let reveals = 0;
    for (const p of puzzles) {
      const g = [...p].map(Number), sol = solve(g)[0];
      while (g.some(d => !d)) {
        const h = hint(g) || reveal(g, sol);
        if (h.digit !== sol[h.cell]) return { bad: `${p}: ${h.tech?.name} put ${h.digit} at ${h.cell}` };
        if (h.tech) techs[h.tech.name] = (techs[h.tech.name] || 0) + 1; else reveals++;
        g[h.cell] = h.digit;
      }
    }
    return { techs, reveals };
  }, ['000000010400000000020000000000050407008000300001090000300400200050100000000806000',
    '400000805030000000000700000020000060000080400000010000000603070500200000104000000',
    '100007090030020008009600500005300900010080002600004000300000010040000007007000300',
    '000105000140000670080002400063070010900000003010090520007200080026000035000409000',
    '000000907000420180000705026100904000050000040000507009920108000034059000507000000']);
  assert.ok(!hard.bad, hard.bad);
  console.log(`hard puzzles: every step right, techniques ${JSON.stringify(hard.techs)}, reveals ${hard.reveals}`);
  assert.ok(hard.techs['Pokazivački par'] && hard.techs['Goli par'], 'advanced techniques used');

  // 2. Handwritten progress: every entry is right, so nothing may be flagged wrong.
  const hwSolution = await page.evaluate(g => solve([...g].map(Number))[0].join(''), HW_GIVENS);
  assert.strictEqual(hwSolution, HW_FULL, 'handwritten puzzle solution');
  const hwTask = { givens: [...HW_GIVENS].map(Number), solution: [...HW_FULL].map(Number) };
  await open(hwTask);
  await scan('handwritten.jpg');
  const ok = (await cls('ok')).length, maybe = await cls('maybe'), wrong = await cls('wrong');
  console.log(`handwritten: ok ${ok}, maybe ${maybe.length} [${maybe.map(i => `r${(i / 9 | 0) + 1}c${i % 9 + 1}`)}], wrong ${wrong.length}`);
  assert.strictEqual(wrong.length, 0, `correct handwriting flagged wrong: ${wrong.map(i => `r${(i / 9 | 0) + 1}c${i % 9 + 1}`)}`);

  // 3. Same photo, but pretend r4c1 (a clear handwritten 9) should be 1 → must be flagged wrong.
  hwTask.solution[27] = 1;
  await open(hwTask);
  await scan('handwritten.jpg');
  assert.deepStrictEqual(await cls('wrong'), [27], 'wrong entry not caught');
  console.log('wrong entry caught');

  // 3b. No task yet: the scan tells printed from handwritten, "Provjeri moje brojeve" takes the printed
  //     ones as the task and judges the handwritten ones.
  await open(null);
  await scan('handwritten.jpg');
  const entries = await cls('entry'), split = [...HW_GIVENS].map((d, i) => +d ? -1 : i).filter(i => i >= 0);
  const missed = split.filter(i => !entries.includes(i)).length, extra = entries.filter(i => !split.includes(i)).length;
  console.log(`printed/handwritten: ${split.length - missed}/${split.length} handwritten found, ${extra} printed called handwritten`);
  assert.ok(missed + extra <= 2, 'printed/handwritten split');
  assert.strictEqual(await page.$eval('#setTask', b => b.textContent), 'Provjeri moje brojeve');
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('#grid input')]
    .every(x => x.classList.contains('given') === (!!x.value && !x.classList.contains('entry')))), 'every printed digit grey');
  // The user fixes the split: tap each wrong one, pad "Ovo je moj broj / tiskani broj".
  for (const i of [...split.filter(i => !entries.includes(i)), ...entries.filter(i => !split.includes(i))]) {
    await page.evaluate(i => document.querySelectorAll('#grid input')[i].click(), i);
    await page.click('#padKind');
  }
  assert.deepStrictEqual(await cls('entry'), split, 'split after fixing');
  await page.click('#setTask');
  assert.strictEqual(await page.evaluate(() => task.givens.join('')), HW_GIVENS, 'task = printed digits');
  const checked = { ok: (await cls('ok')).length, wrong: (await cls('wrong')).length };
  console.log(`check: ok ${checked.ok}, wrong ${checked.wrong}`);
  assert.strictEqual(checked.wrong, 0, 'correct handwriting flagged wrong');

  // 4. Live camera: printed.jpg turned 90° as a fake camera stream (MJPEG of the same frame) → the
  //    reading freezes, "Riješi" draws all 81 digits, tapping a cell + the number pad changes it.
  const jpg = await page.evaluate(async () => {
    const im = await createImageBitmap(await (await fetch('/test/printed.jpg')).blob()), c = document.createElement('canvas');
    const k = 960 / Math.max(im.width, im.height), w = im.width * k | 0, h = im.height * k | 0, x = c.getContext('2d');
    [c.width, c.height] = [h, w];
    x.translate(h / 2, w / 2); x.rotate(Math.PI / 2); x.drawImage(im, -w / 2, -h / 2, w, h);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  });
  await page.evaluate(() => localStorage.clear());
  await browser.close();
  const mjpeg = path.join(require('os').tmpdir(), 'sudoku-test.mjpeg');
  fs.writeFileSync(mjpeg, Buffer.concat(Array(300).fill(Buffer.from(jpg, 'base64'))));
  const cam = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${mjpeg}`] });
  const lp = await cam.newPage();
  lp.on('pageerror', e => console.log('PAGE ERROR', e.message));
  await lp.goto('http://localhost:8768/');
  await lp.waitForFunction(() => !document.getElementById('liveBtn').disabled, { timeout: 120000 });
  await lp.click('#liveBtn');
  await lp.waitForFunction(() => live?.frozen, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 500));   // the picture slides up (liftGrid)
  const frozen = await lp.evaluate(() => ({ digits: live.frozen.digits.join(''), solution: live.frozen.board?.solution.join(''), rot: live.frozen.rot }));
  assert.strictEqual(frozen.digits, PRINTED, 'live reading');
  assert.strictEqual(frozen.solution, solution, 'live solution');
  assert.strictEqual(await lp.evaluate(() => overlay.width === overlay.height), true, 'picture = the straightened grid');
  // Tap r1c1 on screen (empty, solution 4): a wrong 9 makes it unsolvable, 4 makes it solvable again.
  const tap = async i => {   // screen point of a cell centre, through the same projection the overlay uses
    const [x, y] = await lp.evaluate(i => {
      const f = live.frozen, o = overlay, r = o.getBoundingClientRect(), s = Math.min(r.width / o.width, r.height / o.height);
      const [vx, vy] = painter(o.getContext('2d')).P((i % 9 + 0.5) * S, ((i / 9 | 0) + 0.5) * S);
      return [r.left + (r.width - o.width * s) / 2 + vx * s, r.top + (r.height - o.height * s) / 2 + vy * s];
    }, i);
    await lp.mouse.click(x, y);
  };
  const pad = d => lp.evaluate(d => [...document.querySelectorAll('#pad button')].find(b => b.textContent === String(d)).click(), d);
  await tap(0);
  assert.deepStrictEqual(await lp.evaluate(() => [live.frozen.sel, pad.hidden]), [0, false], 'tap selects r1c1 and opens the pad');
  await pad('9');
  assert.deepStrictEqual(await lp.evaluate(() => [live.frozen.digits[0], !!live.frozen.board]), [9, false], 'wrong 9 → unsolvable');
  await tap(0);
  await pad('4');
  assert.deepStrictEqual(await lp.evaluate(() => [live.frozen.digits[0], !!live.frozen.board]), [4, true], '4 → solvable');
  // Tap a printed digit → "Ovo je moj broj" makes it handwritten (judged: right), again → printed.
  const own = await lp.evaluate(() => live.frozen.digits.findIndex((d, i) => d && solve(live.frozen.digits.map((x, j) => j === i ? 0 : x)).length === 1));
  await tap(own);
  await lp.click('#padKind');
  assert.deepStrictEqual(await lp.evaluate(i => [live.frozen.printed[i], live.frozen.entry[i]], own), [false, 'ok'], 'pad: printed → mine');
  await tap(own);
  await lp.click('#padKind');
  assert.strictEqual(await lp.evaluate(i => live.frozen.printed[i], own), true, 'pad: mine → printed');
  // Rescan → a fresh reading; "Potvrdi" puts it on the home board as the task and closes the camera.
  await lp.click('#liveRescan');
  assert.deepStrictEqual(await lp.evaluate(() => [live.frozen, video.paused]), [null, false], 'rescan unfreezes');
  await lp.waitForFunction(() => live?.frozen, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 500));
  await lp.click('#liveConfirm');
  const home = () => lp.evaluate(() => [...document.querySelectorAll('#grid input')].map(i => i.value || '0').join(''));
  assert.deepStrictEqual(await lp.evaluate(() => [live, task.givens.join(''), task.solution.join('')]), [null, PRINTED, solution], 'Potvrdi → task on the home board');
  assert.strictEqual(await home(), PRINTED, 'home board shows the reading');
  assert.deepStrictEqual(await lp.evaluate(() => saved().map(e => e.key)), [solution], 'history: one entry');
  // Home: candidates on and off; the explanation of a step can be hidden.
  await lp.click('#candsBtn');
  assert.ok(await lp.evaluate(() => !cands.hidden && [...cands.querySelectorAll('span span')].filter(s => s.textContent).length > 100), 'candidates shown');
  await lp.click('#candsBtn');
  await lp.click('#hintBtn');
  // Held: see-through, also after the finger slides off the bubble; lifted: back.
  const at = await lp.evaluate(() => { const r = explain.getBoundingClientRect(); return [r.left + 20, r.top + 10]; });
  const peeking = () => lp.evaluate(() => explainBox.classList.contains('peek'));
  await lp.mouse.move(...at); await lp.mouse.down();
  const held = await peeking();
  await lp.mouse.move(at[0], 5, { steps: 5 });
  const slid = await peeking();
  await lp.mouse.up();
  assert.deepStrictEqual([held, slid, await peeking()], [true, true, false], 'hold to see under the bubble');
  await lp.click('#explainToggle');
  assert.deepStrictEqual(await lp.evaluate(() => [getComputedStyle(explainBox).display, explainBtn.ariaPressed]), ['none', 'false'], 'Sakrij removes the bubble');
  await lp.click('#explainBtn');
  assert.deepStrictEqual(await lp.evaluate(() => [getComputedStyle(explainBox).display, explainBtn.ariaPressed]), ['flex', 'true'], 'Objašnjenje brings it back');
  // An answer given at home survives scanning the paper again (history).
  await lp.click('#hintBtn'); await lp.click('#hintBtn');
  const answered = await lp.evaluate(() => hintState.h.cell);
  await lp.click('#liveBtn');
  await lp.waitForFunction(() => live?.frozen, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 500));
  await lp.click('#liveConfirm');
  assert.strictEqual((await home())[answered], solution[answered], 'answer kept across scans');
  assert.strictEqual(await lp.evaluate(() => saved().length), 1, 'still one history entry');
  console.log(`live: frozen, rot ${frozen.rot}, tap + pad fix, printed/own toggle, Potvrdi → home, candidates, explanation toggle, answers kept, one history entry`);
  await cam.close(); fs.unlinkSync(mjpeg); server.close();
  console.log('ALL OK');
})().catch(e => { console.error(e.message); process.exit(1); });
