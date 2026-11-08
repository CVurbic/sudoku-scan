// End-to-end check in headless Chrome: OCR on real photos, solver, hints, check against solution.
// Usage: node test.js   (set CHROME to override the Chrome path)
const puppeteer = require('puppeteer-core');
const assert = require('assert'), http = require('http'), fs = require('fs'), path = require('path');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PRINTED = '070500106001040000005701000102000030304912605050000201000109400000030500503006090';
// handwritten.jpg: printed givens + the full grid written in by hand
const HW_GIVENS = '000000082830060017010090003000700051020508030540003000300080060690030074450000000';
const HW_FULL = '764351982839264517215897643983726451126548739547913826372489165698135274451672398';

const server = http.createServer((q, s) => fs.readFile(path.join(__dirname, (u => u === '/' ? 'index.html' : u)(q.url.split('?')[0])),   // ?s= share links
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
    await page.waitForFunction(() => !/Tražim/.test(document.getElementById('msg').textContent));
  };
  const grid = () => page.evaluate(() => [...document.querySelectorAll('#grid input')].map(i => i.value || '0').join(''));
  const cls = c => page.evaluate(c => [...document.querySelectorAll('#grid input')].map((x, i) => x.classList.contains(c) ? i : -1).filter(i => i >= 0), c);

  // 0. "Instaliraj" in a browser tab once Chrome offers the install (it does here too: no service worker
  //    needed); the tap opens Chrome's prompt (faked: a real one would wait for a click) and the button goes.
  //    Safari on iPhone (navigator.standalone false) has no such event: the button gives instructions.
  await open(null);
  await page.evaluate(() => { const e = new Event('beforeinstallprompt'); e.prompt = () => { window.prompted = true; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); dispatchEvent(e); });
  assert.strictEqual(await page.evaluate(() => installBtn.hidden), false, 'install: offered → button');
  await page.click('#installBtn');
  assert.deepStrictEqual(await page.evaluate(() => [window.prompted, installBtn.hidden]), [true, true], 'install: prompt, then gone');
  const ios = await browser.newPage();
  await ios.evaluateOnNewDocument(() => {   // Safari: navigator.standalone, and never a beforeinstallprompt
    Object.defineProperty(Navigator.prototype, 'standalone', { get: () => false });
    addEventListener('beforeinstallprompt', e => e.stopImmediatePropagation(), true);
  });
  await ios.goto('http://localhost:8768/');
  await ios.click('#installBtn');
  assert.ok(await ios.evaluate(() => /Dodaj na početni zaslon/.test(msg.textContent)), 'install: iPhone instructions');
  await ios.close();
  console.log('install: button on the offer, Chrome prompt, then gone; iPhone instructions');

  // 0-keys. A computer keyboard: the cursor steps onto printed cells, wraps over the edge, stays after a digit;
  //         nothing happens under the veil, behind a dialog or off the board.
  await page.evaluate(g => { clearBoard(); const d = [...g].map(Number); task = { givens: d, solution: solve(d)[0] }; showTask(); go('game'); }, PRINTED);
  const sel_ = () => page.evaluate('sel'), press = k => page.keyboard.press(k);
  await press('ArrowRight');
  assert.strictEqual(await sel_(), 0, 'keys: the first arrow shows the cursor');
  await press('ArrowRight');
  assert.strictEqual(await sel_(), 1, 'keys: stops on a printed cell');
  await press('9');
  assert.deepStrictEqual([(await grid())[1], await sel_()], ['7', 1], 'keys: a printed cell stays as it is');
  await press('ArrowLeft');
  const first = String(await page.evaluate('task.solution[0]'));
  await press(first);
  assert.deepStrictEqual([(await grid())[0], await sel_(), (await cls('ok')).includes(0)], [first, 0, true], 'keys: digit in, cursor stays');
  await page.keyboard.down('Control'); await press('z'); await page.keyboard.up('Control');
  assert.deepStrictEqual([(await grid())[0], await sel_()], ['0', 0], 'keys: Ctrl+Z, cursor stays');
  await press('ArrowLeft');
  assert.strictEqual(await sel_(), 8, 'keys: over the left edge');
  await press('ArrowUp');
  assert.strictEqual(await sel_(), 80, 'keys: over the top edge');
  await press('n'); await press('1'); await press('n');
  assert.deepStrictEqual(await page.evaluate('[noting, notes[80], sel]'), [false, [1], 80], 'keys: N, a note, N');
  await press('Backspace');
  await press('Escape');
  assert.strictEqual(await sel_(), null, 'keys: Esc');
  await page.evaluate(() => pause(true));
  await press('ArrowRight');
  assert.strictEqual(await sel_(), null, 'keys: nothing under the veil');
  await page.evaluate(() => { pause(false); $('more').showModal(); });
  await press('ArrowRight');
  assert.strictEqual(await sel_(), null, 'keys: nothing behind a dialog');
  await page.evaluate(() => { $('more').close(); go('menu'); });
  await press('ArrowRight');
  assert.strictEqual(await sel_(), null, 'keys: nothing off the board');
  await page.evaluate(() => { clearBoard(); go('game'); });
  await page.setViewport({ width: 1280, height: 800 });
  assert.deepStrictEqual(await page.evaluate(() => [keysNotes.hidden, keysUndo.hidden, getComputedStyle(keys).display]), [true, true, 'block'], 'keys: the sheet, without notes and undo before a task');
  await page.setViewport({ width: 800, height: 600 });
  console.log('keys: arrows, digits, notes, Ctrl+Z, Esc; not under the veil, a dialog or off the board');
  await open(null);

  // 0a. Theme: Igre's button goes Auto → Svijetla → Tamna → Auto; the choice is kept over a reload, its colours win
  //     over the phone's (headless is light: Tamna must turn the ground dark), Auto gives the phone's back.
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);   // a light phone, whatever this machine is
  const theme = () => page.evaluate(() => [document.documentElement.dataset.theme || '', localStorage.theme || '', getComputedStyle(document.body).backgroundColor, themeBar.title]);
  assert.deepStrictEqual(await theme(), ['', '', 'rgb(244, 243, 241)', 'Tema: Auto'], 'theme: Auto at first');
  await page.click('#themeBar');
  assert.deepStrictEqual(await theme(), ['light', 'light', 'rgb(244, 243, 241)', 'Tema: Svijetla'], 'theme: Svijetla');
  await page.click('#themeBar');
  await page.reload();
  assert.deepStrictEqual(await theme(), ['dark', 'dark', 'rgb(17, 17, 16)', 'Tema: Tamna'], 'theme: Tamna, kept over a reload');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.click('#themeBar');
  assert.deepStrictEqual(await theme(), ['', '', 'rgb(17, 17, 16)', 'Tema: Auto'], 'theme: Auto follows the phone (dark)');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.click('#themeBar');
  assert.deepStrictEqual(await theme(), ['light', 'light', 'rgb(244, 243, 241)', 'Tema: Svijetla'], 'theme: Svijetla over the phone');
  await page.click('#themeBar'); await page.click('#themeBar');   // back to Auto for the rest
  await page.emulateMediaFeatures([]);
  console.log('theme: Auto → Svijetla → Tamna, kept, wins over the phone');

  // 0b. Share: ⋯ → Podijeli gives a link (?s=) to this very sudoku; opened elsewhere (no history) it is a
  //     game with help; the address drops ?s; a broken link says so.
  await page.evaluate(() => { localStorage.sudokuTask = JSON.stringify({ givens: [...'070500106001040000005701000102000030304912605050000201000109400000030500503006090'].map(Number), solution: solve([...'070500106001040000005701000102000030304912605050000201000109400000030500503006090'].map(Number))[0] }); localStorage.sudokuView = 'game'; });
  await page.reload();
  const link = await page.evaluate(() => shareLink(task.givens));
  assert.ok(/\?s=[0-9a-z]{40,55}$/.test(link), 'share link: ' + link);
  await page.evaluate(() => localStorage.clear());
  await page.goto(link);
  assert.deepStrictEqual(await page.evaluate(() => [task.givens.join(''), task.random, game.hidden, location.search, gameName.textContent.startsWith('Nova igra · ')]),
    [PRINTED, true, false, '', true], 'shared link opens that sudoku as a game');
  await page.goto('http://localhost:8768/?s=zz');
  assert.ok(await page.evaluate(() => !menu.hidden && /ne vodi/.test(msg.textContent)), 'broken link: menu + message');
  // A daily's link: that day, its card on the level (solo); another day, a game like any link.
  await page.goto(await page.evaluate(l => l + `&d=${dayKey()}.2`, link));
  assert.deepStrictEqual(await page.evaluate(() => [task?.daily === dayKey(), task?.level, paused, view, location.search]), [true, 2, true, 'game', ''], 'shared daily today: on the board, under the veil');
  await page.goto(link + '&d=2000-01-01.2');
  assert.deepStrictEqual(await page.evaluate(() => [task.random, paused]), [true, false], 'shared daily of another day: a game');
  console.log('share: link to this sudoku, opens as a game elsewhere, ?s dropped, broken link says so');
  await open(null);

  // 1. Printed puzzle: exact OCR, unique solution, hints step to the end and are always right.
  await scan('printed.jpg');
  assert.strictEqual(await grid(), PRINTED, 'printed OCR');
  // The same photo inverted (light on dark, as a dark-mode screenshot) reads the same.
  const dark = await page.evaluate(async () => {
    const im = await createImageBitmap(await (await fetch('/test/printed.jpg')).blob()), c = document.createElement('canvas');
    [c.width, c.height] = [im.width, im.height];
    const x = c.getContext('2d');
    x.filter = 'invert(1)';
    x.drawImage(im, 0, 0);
    const probs = await readGrid(await new Promise(r => c.toBlob(r, 'image/jpeg')));
    return probs?.map(best).join('');
  });
  assert.strictEqual(dark, PRINTED, 'inverted photo OCR');
  await page.click('#setTask');
  const solution = await page.evaluate(() => task.solution.join(''));
  const pill = await page.$eval('#diff', d => [d.hidden, d.textContent]);
  assert.ok(!pill[0] && /^Težina\d+% · /.test(pill[1]), 'difficulty pill: ' + pill[1]);
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
  let steps = 0, reveals = 0, celebrated = 0;
  const techs = {};
  for (let press = 0; press < 400; press++) {
    await page.click('#hintBtn');
    if (await page.evaluate(() => solved.open)) { celebrated++; await page.click('#solvedClose'); }   // the last answer completes the board
    const text = await page.$eval('#explain', e => e.textContent);
    if (text === 'Sve je riješeno!') break;
    if (press < 3) console.log(`first step, level ${press + 1}:`, text.replace(/\n/g, ' | '));
    if (press < 3) assert.strictEqual(await page.$eval('#hintLabel', l => l.textContent), ['Zašto?', 'Odgovor', 'Savjet'][press], 'Savjet label follows the level');
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
  assert.strictEqual(celebrated, 1, '"Riješeno!" once');
  console.log(`printed: OCR 81/81, solved in ${steps} steps (${reveals} reveals), techniques shown:`, JSON.stringify(techs));

  // History: one entry for this puzzle, solved; the same puzzle again stays one entry; opening it brings it back.
  const hist = () => page.evaluate(() => saved().map(e => ({ key: e.key, givens: e.givens, done: [...e.done].filter(d => +d).length })));
  assert.deepStrictEqual(await hist(), [{ key: solution, givens: PRINTED, done: [...PRINTED].filter(d => d === '0').length }], 'history entry');
  await page.evaluate(() => remember(task.solution, task.givens, Array(81).fill(0)));
  assert.strictEqual((await hist()).length, 1, 'no duplicate');
  await page.click('#backBtn');
  assert.deepStrictEqual(await page.evaluate(() => [menu.hidden, game.hidden, homeResume.hidden, recent.children.length]), [false, true, true, 1], 'menu: solved, so no Nastavi; in Nedavno');
  await page.$eval('#historyAll', b => b.scrollIntoView({ block: 'center' }));   // out from under the sticky dock (600 px window)
  await page.click('#historyAll');
  assert.strictEqual(await page.$eval('#historyList .hmeta b', b => b.textContent), 'Riješeno ✓');
  await page.click('#historyList .hrow');
  assert.deepStrictEqual([await page.evaluate(() => task.givens.join('')), await grid()], [PRINTED, solution], 'opened from history');
  console.log('history: one entry per puzzle, solved, reopens; Savjet label Savjet → Zašto? → Odgovor');

  // 1b. "Nova igra": a random sudoku with help and a clock; notes, undo, same-digit light, spent digits,
  //     the board (wrong digits and notes too) back after a reload.
  await page.click('#backBtn');
  await page.click('#newLevels button');   // Lagano
  await page.waitForFunction(() => task?.random && !game.hidden);
  assert.ok(await page.evaluate(() => toast.classList.contains('on') && /Savjet/.test(msg.textContent)), 'first games: the Savjet tip');
  assert.deepStrictEqual(await page.evaluate(() => [hintBtn.hidden, undoBtn.hidden, undoBtn.disabled, solve(task.givens).length]), [false, false, true, 1], 'game: help, undo, one solution');
  const empty = await page.evaluate(() => task.givens.findIndex(d => !d));
  await page.evaluate(i => inputs[i].click(), empty);
  await page.click('#padNotes');
  for (const d of ['3', '5']) await page.evaluate(d => [...document.querySelectorAll('#pad button')].find(b => b.textContent === d).click(), d);
  assert.deepStrictEqual(await page.evaluate(i => [notes[i], sel, cands.classList.contains('mine'), candCells[i].textContent], empty), [[3, 5], empty, true, '35'], 'notes: pencilled in, pad stays');
  await page.click('#padNotes');
  const wrongD = await page.evaluate(i => task.solution[i] % 9 + 1, empty);
  await page.evaluate(d => [...document.querySelectorAll('#pad button')].find(b => b.textContent === String(d)).click(), wrongD);
  assert.deepStrictEqual(await page.evaluate(i => [inputs[i].classList.contains('wrong'), notes[i].length, toast.classList.contains('on')], empty), [true, 0, false], 'game: judged, notes gone, the tip with them');
  await page.click('#undoBtn');
  assert.deepStrictEqual(await page.evaluate(i => [inputs[i].value, notes[i]], empty), ['', [3, 5]], 'undo: digit out, notes back');
  const given = await page.evaluate(() => task.givens.findIndex(Boolean));
  await page.evaluate(i => inputs[i].click(), given);
  assert.ok(await page.evaluate(i => inputs.every((x, j) => x.classList.contains('same') === (x.value === inputs[i].value)) && inputs.some(x => x.classList.contains('peer')), given), 'same digit + peers lit');
  // Number first: no cell picked → the digit is armed (all of it lit); each empty cell tapped gets it; the
  // same key again puts it away.
  const key = d => page.evaluate(d => [...document.querySelectorAll('#pad button')].find(b => b.textContent === String(d)).click(), d);
  const [e1, e2] = await page.evaluate(() => inputs.flatMap((x, i) => x.value ? [] : [i]).slice(0, 2));
  const d1 = await page.evaluate(i => task.solution[i], e1);
  await key(d1);
  assert.deepStrictEqual(await page.evaluate(d => [armed, padKeys[d - 1].ariaPressed, inputs.every(x => x.classList.contains('same') === (x.value === String(d)))], d1),
    [d1, 'true', true], 'number first: armed, its digit lit');
  for (const i of [e1, e2]) await page.evaluate(i => inputs[i].click(), i);
  assert.deepStrictEqual(await page.evaluate(([a, b]) => [inputs[a].value, inputs[a].classList.contains('ok'), inputs[b].value, sel, armed], [e1, e2]),
    [String(d1), true, String(d1), null, d1], 'number first: each empty cell tapped gets it');
  await page.click('#undoBtn');
  await page.click('#undoBtn');
  await key(d1);
  assert.deepStrictEqual(await page.evaluate(([a, b]) => [armed, inputs[a].value, inputs[b].value], [e1, e2]), [0, '', ''], 'number first: put away');
  await page.evaluate(([i, d]) => { sel = i; setCell(d); }, [empty, wrongD]);
  await new Promise(r => setTimeout(r, 1300));
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('file').disabled, { timeout: 120000 });
  assert.deepStrictEqual(await page.evaluate(i => [task.random, inputs[i].classList.contains('wrong'), task.elapsed > 0, gameName.textContent, game.hidden], empty), [true, true, true, 'Nova igra · Lagano', false], 'game back after reload');
  // ‹ Izbornik keeps the game: "Nastavi" (not repeated in Nedavno) brings it back as it was; the clock waits in the menu.
  const before = await grid();
  await page.click('#backBtn');
  const menuNow = await page.evaluate(() => [homeResume.hidden, resumeText.textContent, recent.children.length, historyAll.textContent]);
  assert.ok(!menuNow[0] && /^Nova igra · Lagano · 1 od \d+ · \d+:\d\d$/.test(menuNow[1]) && menuNow[2] === 1 && /^Sva povijest \(2\)/.test(menuNow[3]), 'menu: Nastavi + Nedavno without it: ' + JSON.stringify(menuNow));
  const waited = await page.evaluate(() => task.elapsed);
  await new Promise(r => setTimeout(r, 1500));
  assert.strictEqual(await page.evaluate(() => task.elapsed), waited, 'clock stops in the menu');
  // A reload in the menu stays in the menu (the game waits behind Nastavi).
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('file').disabled, { timeout: 120000 });
  assert.deepStrictEqual(await page.evaluate(() => [menu.hidden, game.hidden, homeResume.hidden]), [false, true, false], 'reload in the menu: still the menu');
  // Nedavno: two rows at most; all of them behind "Sva povijest".
  await page.evaluate(() => { localStorage.sudokuHistory = JSON.stringify([...saved(), ...[1, 2, 3].map(k => ({ key: 'x' + k, givens: '0'.repeat(81), done: '0'.repeat(81), first: k, last: k, diff: 10 }))]); showMenu(); });
  assert.deepStrictEqual(await page.evaluate(() => [recent.children.length, historyAll.textContent.startsWith('Sva povijest (5)')]), [2, true], 'Nedavno: 2 rows, all in Sva povijest');
  await page.click('#homeResume');
  assert.deepStrictEqual([await page.evaluate(() => game.hidden), await grid()], [false, before], 'Nastavi: the game as it was');
  // Stuck (NUDGE_MS without a move, shortened here): the bubble out of Savjet, once per game; a tap puts it away.
  await page.evaluate(() => { NUDGE_MS = 1500; idle = 0; });
  await page.waitForFunction(() => !nudge.hidden, { timeout: 5000 });
  await page.mouse.click(5, 300);
  assert.ok(await page.evaluate(() => nudge.hidden && task.nudged), 'nudge: shown, a tap hides it');
  await new Promise(r => setTimeout(r, 2500));
  assert.ok(await page.evaluate(() => nudge.hidden), 'nudge: once per game');
  // Savjet's techniques on the card, not as a minus.
  for (let k = 0; k < 3; k++) await page.click('#hintBtn');
  await page.evaluate(() => task.solution.forEach((d, i) => { if (!task.givens[i]) { sel = i; setCell(d); } }));
  const won = await page.evaluate(() => [solved.open, solvedText.textContent, solvedNext.hidden, solvedClose.hidden, padKeys.slice(0, 9).every(b => b.classList.contains('spent')), saved()[0].random, solvedTechs.hidden, techList.textContent]);
  assert.ok(won[0] && /^Vrijeme: \d+:\d\d$/.test(won[1]) && !won[2] && won[3] && won[4] && won[5] && !won[6] && /^\D+\d+×/.test(won[7]), 'game won: ' + JSON.stringify(won));
  await page.click('#solvedNext');
  await page.waitForFunction(k => task?.random && task.solution.join('') !== k && !task.elapsed, {}, solution);
  console.log('game: tip, help, notes, undo, light, reload, menu (Nastavi, Nedavno ≤ 2, clock paused), stuck bubble once, techniques on the card, next one');
  await page.click('#backBtn');

  // 1a. Daily sudokus: for a date the same three puzzles on every run, each with one solution, easy < medium < hard.
  const gen = await page.evaluate(() => {
    const lv = [0, 1, 2].map(l => makeDaily('2026-10-26', l)), again = makeDaily('2026-10-26', 0);
    return { same: lv[0].givens.join('') === again.givens.join(''), unique: lv.every(p => solve(p.givens).length === 1), diffs: lv.map(p => p.diff) };
  });
  assert.ok(gen.same && gen.unique && gen.diffs[0] < 30 && gen.diffs[1] >= 30 && gen.diffs[1] < 55 && gen.diffs[2] >= 55 && gen.diffs[2] < 80, 'daily generator: ' + JSON.stringify(gen));
  // Teško from HARD_TRIES (pool.js): the day's listed try, unique, in range, made in one go.
  const pooled = await page.evaluate(() => { const t = performance.now(), p = makeDaily('2027-03-14', 2);
    return { ms: performance.now() - t, unique: solve(p.givens).length === 1, diff: p.diff, days: HARD_TRIES.length / 2 }; });
  assert.ok(pooled.unique && pooled.diff >= 55 && pooled.diff < 80 && pooled.days >= 730 && pooled.ms < 2000, 'pooled Teško: ' + JSON.stringify(pooled));
  // The menu's boards (layouts.js, pool.js): the givens' cells of what the generator makes, today and some day ahead; all days listed.
  const layouts = await page.evaluate(() => [dayKey(), '2027-06-30', '2028-10-01'].flatMap(d => [0, 1, 2].map(l =>
    dayLayout(d, l).join('') === makeDaily(d, l).givens.map(x => +!!x).join(''))).concat(DAILY_LAYOUTS.length === HARD_TRIES.length / 2 * 48, dayLayout('2030-01-01', 0) === null));
  assert.ok(layouts.every(Boolean), 'daily layouts: ' + layouts);
  // A board in the menu: that daily on the board under the veil (no digits, ▶ Kreni); the clock waits for it.
  // Then solo: no help buttons, a clashing digit shows red but is not judged, the clock runs, solving shows time + streak.
  await page.click('#homeDays button');   // Lagano's board
  await page.waitForFunction(() => task?.daily && !game.hidden);
  await new Promise(r => setTimeout(r, 1200));
  assert.deepStrictEqual(await page.evaluate(() => [task.level, paused, veil.hidden, veilGo.textContent, veilNote.textContent, getComputedStyle(inputs[task.givens.findIndex(Boolean)]).color, daily.elapsed]),
    [0, true, false, 'Kreni', 'Sam, bez pomoći. Sat kreće s Kreni.', 'rgba(0, 0, 0, 0)', 0], 'daily: on the board under the veil, no digits, the clock waits');
  await page.click('#veilGo');
  await page.evaluate(() => { NUDGE_MS = 1000; idle = 0; });
  assert.deepStrictEqual(await page.evaluate(() => ['hintBtn', 'solveBtn', 'candsBtn', 'explainBtn'].map(id => $(id).hidden)), [true, true, true, true], 'daily: no help');
  const clash = await page.evaluate(() => {   // an empty cell + a digit already in its row
    const i = task.givens.findIndex(d => !d), d = task.givens.find((x, j) => x && (j / 9 | 0) === (i / 9 | 0));
    sel = i; setCell(d);
    return [inputs[i].classList.contains('bad'), inputs[i].classList.contains('wrong')];
  });
  assert.deepStrictEqual(clash, [true, false], 'daily: duplicate red, nothing judged');
  await new Promise(r => setTimeout(r, 2200));
  assert.ok(await page.evaluate(() => daily.elapsed >= 1000 && nudge.hidden), 'daily: the clock runs, no stuck bubble');
  await page.click('#backBtn');
  await page.click('#homeResume');   // Nastavi on today's daily: under the veil again ("Nastavi"); the clock stands
  const stood = await page.evaluate(() => daily.elapsed);
  await new Promise(r => setTimeout(r, 2200));
  assert.deepStrictEqual(await page.evaluate(() => [daily.elapsed, paused, veilGo.textContent, pauseBtn.hidden]), [stood, true, 'Nastavi', false], 'daily: back under the veil, the clock stands');
  await page.click('#veilGo');
  await page.click('#pauseBtn');   // ‖ by the clock: the veil again
  assert.deepStrictEqual(await page.evaluate(() => [paused, veilNote.textContent]), [true, 'Pauza. Sat stoji dok ne nastaviš.'], 'daily: ‖ pauses');
  await page.click('#veilGo');
  // Ljestvica against a stand-in for Supabase (fetch replaced in the page: nothing reaches the real table):
  // six players faster than you, one unique row per device/day/level, offline on demand.
  await page.evaluate(() => {
    const real = fetch, rows = [100, 200, 200, 400, 500, 600].map((ms, i) => ({ day: dayKey(), level: 0, name: 'P' + i, ms, device: 'd' + i }));
    window.lbDb = rows; window.lbOffline = false;
    window.fetch = async (url, o = {}) => {
      if (!String(url).startsWith(LB)) return real(url, o);
      if (lbOffline) throw new TypeError('Failed to fetch');
      const q = new URLSearchParams(url.slice(LB.length)), b = o.body && JSON.parse(o.body);
      if (o.method === 'POST') return rows.some(r => r.device === b.device && r.day === b.day && r.level === b.level) ? new Response('', { status: 409 }) : (rows.push(b), new Response(null, { status: 201 }));
      const dq = q.get('day'), hit = rows.filter(r => (dq.startsWith('gte.') ? r.day >= dq.slice(4) : r.day === dq.slice(3)) && r.level === +q.get('level').slice(3) && (!q.get('ms') || r.ms < +q.get('ms').slice(3)));
      if (o.method === 'HEAD') return new Response(null, { headers: { 'content-range': `*/${hit.length}` } });
      return Response.json(hit.sort((x, y) => x.ms - y.ms).slice(0, q.get('limit') ? +q.get('limit') : undefined).map(({ day, name, ms }) => ({ day, name, ms })));
    };
  });
  await page.evaluate(() => task.solution.forEach((d, i) => { if (!task.givens[i]) { sel = i; setCell(d); } }));
  const card = await page.evaluate(() => [solved.open, solvedText.textContent]);
  assert.ok(card[0] && /^Riješeno za \d+:\d\d · 1 dan zaredom/.test(card[1]), 'daily solved card: ' + card[1]);
  // No name yet: asked, nothing sent. Named: top five (equal times share a place) + your row apart.
  assert.deepStrictEqual(await page.evaluate(() => [lboard.hidden, lbJoin.hidden, lbHead.textContent, lbDb.length]), [false, false, 'Upiši se na današnju ljestvicu', 6], 'board: name asked first');
  await page.type('#lbName', '  Chris ');
  await page.click('#lbJoin button');
  await page.waitForFunction(() => lbList.children.length);
  const board = await page.evaluate(() => [lbJoin.hidden, lbHead.textContent, [...lbList.children].map(li => li.className + ':' + [...li.children].map(s => s.textContent).join('|'))]);
  assert.deepStrictEqual(board.slice(0, 2), [true, 'Danas, lagano · 7 igrača'], 'board: head');
  assert.deepStrictEqual(board[2].slice(0, 4), ['p1:1|P0|0:00', 'p2:2|P1|0:00', 'p2:2|P2|0:00', ':4|P3|0:00'], 'board: top, shared place, medals');
  assert.ok(/^me apart:7\|Chris\|\d+:\d\d$/.test(board[2][5]), 'board: your row ' + board[2][5]);
  // The queue: kept offline, sent when back; a second send of the same (409) is done with too.
  const queue = await page.evaluate(async () => {
    lbOffline = true; lbQueue(dayKey(), 1, 90000);
    const off = [await lbFlush(), JSON.parse(localStorage.sudokuLbQueue).length];
    lbOffline = false; lbQueue(dayKey(), 1, 90000);
    return [...off, await lbFlush(), localStorage.sudokuLbQueue, lbDb.filter(r => r.level === 1 && r.name === 'Chris').length];
  });
  assert.deepStrictEqual(queue, [false, 1, true, '[]', 1], 'board: offline queue, 409');
  // The buttons: on to Srednje, the result to share quietly (this level, its place, a link to this daily); all three done: Podijeli first, all three, the app's link.
  assert.deepStrictEqual(await page.evaluate(() => [solvedClose.hidden, solvedLevel.hidden, solvedLevel.textContent, solvedShare.hidden, solvedShare.className, solvedShare.textContent]),
    [true, false, 'Srednje', false, 'quiet', 'Podijeli rezultat'], 'solved daily: buttons');
  await page.waitForFunction(() => /\(7\. od 7\)/.test(shareMsg.text));
  const shared = await page.evaluate(async () => { navigator.share = async d => window.sent = d; solvedShare.click(); await new Promise(r => setTimeout(r)); return sent; });
  assert.ok(/^Sudoku Scan · dnevni \d+\. \d+\.\nLagano \d+:\d\d \(7\. od 7\)\nMožeš li brže\?$/.test(shared.text) && shared.url.endsWith(`&d=${await page.evaluate(() => dayKey())}.0`), 'share: ' + JSON.stringify(shared));
  const allDone = await page.evaluate(async () => {
    const keep = days.levels.slice();
    days.levels[1] = { elapsed: 61000, solvedAt: 1 }; days.levels[2] = { elapsed: 125000, solvedAt: 1 };
    solvedButtons();
    await new Promise(r => setTimeout(r, 300));
    const r = [solvedLevel.hidden, solvedShare.className, solvedShare.textContent, shareMsg.text.split('\n').slice(1), shareMsg.url === location.origin + location.pathname];
    days.levels = keep; solvedButtons();
    return r;
  });
  assert.deepStrictEqual(allDone.slice(0, 3), [true, '', 'Podijeli'], 'all three done: Podijeli first');
  assert.ok(/^Lagano .+,Srednje 1:01 \(\d+\. od \d+\),Teško 2:05$/.test(allDone[3].join()) && allDone[4], 'all three done: ' + allDone[3].join(' | '));
  await page.click('#solvedMenu');
  // The menu's Ljestvica: the strip's day, one level: top eight + you (marked where your own record says so),
  // medals on the podium; another level; yesterday from the strip. Under it, your places on the last 7 days.
  const ranks = () => page.evaluate(async () => { await showRanks();
    return [ranksDate.textContent === 'danas', ranksCount.textContent, [...ranksList.children].map(li => li.className + ':' + li.children[1].textContent).join(','),
      weekDays.lastChild.lastChild.textContent, weekSum.textContent]; });
  await page.evaluate(() => { dayOn = dayKey(); rankLvl = 0; });
  assert.deepStrictEqual(await ranks(), [true, '7 igrača', 'p1:P0,p2:P1,p2:P2,:P3,:P4,:P5,me:Chris', '7', 'Na vrijeme 1 od 7 danaNajbolje 7.'], 'ranks: today, Lagano');
  await page.evaluate(() => ranksLv.children[1].click());
  assert.deepStrictEqual(await ranks(), [true, '1 igrač', 'p1:Chris', '–', 'Na vrijeme 0 od 7 dana'], 'ranks: Srednje');
  await page.evaluate(() => { ranksLv.children[0].click(); dayStrip.children[STRIP - 2].click(); });
  assert.deepStrictEqual(await ranks(), [false, 'Još nitko', '', '7', 'Na vrijeme 1 od 7 danaNajbolje 7.'], 'ranks: yesterday from the strip');
  assert.deepStrictEqual(await page.evaluate(() => [dayStrip.children.length, dayStrip.lastChild.firstChild.textContent, $('dayLate').hidden, dayStrip.lastChild.querySelector('.marks i').className]),
    [14, 'danas', false, 'f'], 'strip: two weeks, today last, yesterday says "naknadno", today Lagano solved');
  // Today's daily typed in by hand: it is the daily again (solved already: no veil), no task with help.
  const retyped = await page.evaluate(() => {
    clearBoard();
    days.levels[0].givens.forEach((d, i) => inputs[i].value = d || '');
    entryLabel();
    setTask.click();
    return [task?.daily === dayKey(), task?.level, paused];
  });
  assert.deepStrictEqual(retyped, [true, 0, false], 'daily typed in: it is the daily (solved: no veil), no task with help');
  // Yesterday's daily, played now: its card says so; solved, the result is yours only (not sent, no
  // streak), the card says where you would have been, you as a ghost row; then on to today's.
  const late = await page.evaluate(async () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const day = dayKey(d), sentBefore = lbDb.length;
    lbDb.push({ day, level: 0, name: 'Y', ms: 1, device: 'y' }, { day, level: 0, name: 'Z', ms: 9e8, device: 'z' });
    openDaily(0, day);
    const said = veilNote.textContent.startsWith('Naknadno');
    veilGo.click();
    daily.elapsed = 5000;   // between Y (1 ms) and Z
    task.solution.forEach((v, i) => { if (!task.givens[i]) { sel = i; setCell(v); } });
    while (!lbList.children.length) await new Promise(r => setTimeout(r, 50));
    const r = [said, solved.open, /^Riješeno za \d+:\d\d · naknadno, samo tvoj rezultat$/.test(solvedText.textContent), lbHead.textContent,
      [...lbList.children].map(li => li.className + ':' + li.firstChild.textContent).join(','), lbDb.length - sentBefore, !!dailyLate()[`${day}/0`], !dailyDone()[`${day}/0`],
      solvedShare.hidden, solvedLevel.textContent];
    solvedMenu.click();
    return r.concat(dayStrip.children[STRIP - 2].querySelector('.marks i').className, homeDays.firstChild.lastChild.textContent.startsWith('↺'));
  });
  assert.deepStrictEqual(late, [true, true, true, 'Na vrijeme bio bi 2. od 3', 'p1:1,ghost:(2),p2:2', 2, true, true, true, 'Današnji', 'l', true],
    'yesterday\'s daily: yours only, "bio bi 2.", ghost row, on to today\'s; the strip marks it');
  await page.evaluate(() => { dayOn = dayKey(); days = readDay(); });
  console.log(`daily: same puzzles per date, levels ${gen.diffs.join("/")}%, on the board under the veil + Kreni, solo, duplicates only, clock (stands under the veil, ‖ pauses), "${card[1]}"; board: name once, top five + you, offline queue; menu Ljestvica: days, levels; typed in again → the daily`);

  // 1b. Harder puzzles: hint() steps (incl. Pointing / Naked Pair) must always give the solution digit.
  const hard = await page.evaluate((puzzles, printed) => {
    const techs = {};
    let reveals = 0;
    for (const p of puzzles) {
      const g = [...p].map(Number), sol = solve(g)[0];
      while (g.some(d => !d)) {
        for (const e of eliminations(g)) for (const [i, d] of e.removed) if (d === sol[i]) return { bad: `${p}: ${e.tech.name} ruled out ${d} at ${i}` };
        const h = hint(g) || reveal(g, sol);
        if (h.digit !== sol[h.cell]) return { bad: `${p}: ${h.tech?.name} put ${h.digit} at ${h.cell}` };
        if (h.tech) techs[h.tech.name] = (techs[h.tech.name] || 0) + 1; else reveals++;
        g[h.cell] = h.digit;
      }
    }
    return { techs, reveals, diffs: puzzles.map(p => difficulty([...p].map(Number), solve([...p].map(Number))[0])), easy: (g => difficulty(g, solve(g)[0]))([...printed].map(Number)) };
  }, ['000000010400000000020000000000050407008000300001090000300400200050100000000806000',
    '400000805030000000000700000020000060000080400000010000000603070500200000104000000',
    '100007090030020008009600500005300900010080002600004000300000010040000007007000300',
    '000105000140000670080002400063070010900000003010090520007200080026000035000409000',
    '000000907000420180000705026100904000050000040000507009920108000034059000507000000'], PRINTED);
  assert.ok(!hard.bad, hard.bad);
  console.log(`hard puzzles: every step right, techniques ${JSON.stringify(hard.techs)}, reveals ${hard.reveals}; difficulty ${hard.diffs.join('/')}%, printed.jpg ${hard.easy}%`);
  assert.ok(hard.diffs.every(d => d >= 0 && d <= 100) && hard.easy < Math.max(...hard.diffs), 'difficulty ranks the newspaper puzzle below the hard ones');
  assert.ok(hard.techs['Pokazivački par'] && hard.techs['Goli par'], 'advanced techniques used');

  // 1c. X-Wing and Y-Wing (positions from the Teško generator), explained step by step: Dalje walks the
  //     parts, each with its marks; the last one is the single; Odgovor puts the right digit.
  const WINGS = [['Pravokutnik', '060078000000600005800000040000900200320004180040010006400030000200107090030200010', '560478901004600805800000640000900204320004189040012006400030062200107090030200010'],
    ['Kliješta', '000500000080970002004000650900008000000000015030000207000002000046080700001040800', '000504378583976142004803659917258463000037915035091287000162534246385791351749826']];
  const wp = await browser.newPage();
  await wp.setViewport({ width: 390, height: 844 });
  await wp.goto('http://localhost:8768/');
  for (const [name, givens, known] of WINGS) {
    await wp.evaluate(gv => { const g = [...gv].map(Number); localStorage.sudokuTask = JSON.stringify({ givens: g, solution: solve(g)[0] }); localStorage.sudokuView = 'game'; }, givens);
    await wp.reload();
    await wp.evaluate(k => [...k].forEach((d, i) => { if (d !== '0' && !task.givens[i]) inputs[i].value = d; }), known);
    await wp.click('#hintBtn'); await wp.click('#hintBtn');
    const parts = [];
    for (;;) {
      parts.push(await wp.evaluate(() => [stepCount.textContent, hintLines.children.length, cands.querySelectorAll('.k, .x').length, explainBox.className]));
      if (await wp.evaluate(() => stepNext.hidden)) break;
      await wp.click('#stepNext');
    }
    await wp.click('#hintBtn');
    const done = await wp.evaluate(() => [hintState.h.tech.name, inputs[hintState.h.cell].value === String(task.solution[hintState.h.cell]), explainSteps.hidden, hintLines.children.length]);
    assert.deepStrictEqual(done, [name, true, true, 0], `${name}: answer`);
    assert.ok(parts.length >= 7 && parts.every(([c, , marks], k) => c === `${k + 1} od ${parts.length}` && marks > 0) && parts.some(([, lines]) => lines) &&
      parts.slice(0, 3).every(([, , , cls]) => /below/.test(cls)), `${name}: parts ${JSON.stringify(parts)}`);
  }
  await wp.close();
  console.log(`X-Wing, Y-Wing: explained in parts with Dalje, marks and lines, the bubble under the board; answer right`);

  // 1d. Tango: a fresh start is Igre. The daily is one board per date (one solution, finished by Savjet's steps
  //     alone, at least 4 printed), solo; three alike turn red; solved → the card (Igre, Sudoku, share), the tile
  //     and Povijest. Then Nova igra with Savjet: a wrong cell first, then every step right to the end.
  await open(null);
  assert.strictEqual(await page.evaluate(() => view), 'games', 'start: Igre');
  assert.deepStrictEqual(await page.evaluate(() => [...Array(20)].map((_, d) => {
    const a = tMake(`tango#2026-11-${d}`), g = a.giv.slice();
    for (let h; (h = tHint(g, a.signs)); ) { if (h.v !== a.sol[h.k]) return 'wrong step'; g[h.k] = h.v; }
    return [JSON.stringify(a) === JSON.stringify(tMake(`tango#2026-11-${d}`)), tSolve(a.giv, a.signs).length, g.join() === a.sol.join(), a.giv.filter(x => x >= 0).length >= 4].join();
  }).filter(r => r !== 'true,1,true,true')), [], 'tango: same board per date, one solution, Savjet finishes it');
  // Nit: one board per date; the path goes over all 36 cells, one step at a time; the knots and walls leave
  // it one way only (that very path), 7-12 knots, the first and last at the ends, made in well under a second.
  assert.deepStrictEqual(await page.evaluate(() => [...Array(20)].map((_, d) => {
    const t = performance.now(), a = nMake(`nit#2026-11-${d}`), ms = performance.now() - t, s = nSolve(a.knots, a.walls);
    return [JSON.stringify(a) === JSON.stringify(nMake(`nit#2026-11-${d}`)), new Set(a.path).size === 36 && a.path.every((k, i) => !i || nNear(a.path[i - 1]).includes(k)),
      s.length === 1 && s[0].join() === a.path.join(), a.knots.length >= 7 && a.knots.length <= 12 && a.knots[0] === a.path[0] && a.knots.at(-1) === a.path[35], ms < 500].join();
  }).filter(r => r !== 'true,true,true,true,true')), [], 'nit: same board per date, a full path, one solution, 7-12 knots, fast');
  console.log('nit: a board per date, the path over every cell, one way only');
  await page.click('#tileTango');
  assert.deepStrictEqual(await page.evaluate(() => [view, tangoName.textContent, tHintBtn.hidden]), ['tango', 'Dinango · dnevni', true], 'tango daily: solo');
  const three = await page.evaluate(() => { const L = T_LINES.find(L => L.slice(0, 3).every(k => tg.giv[k] < 0)).slice(0, 3); L.forEach(k => tCells[k].click()); return L; });
  assert.strictEqual(await page.evaluate(k => tCells[k].classList.contains('bad'), three[2]), false, 'tango: the cell just tapped is not red yet');
  await page.waitForFunction(L => L.every(k => tCells[k].classList.contains('bad')), { timeout: 3000 }, three);   // after T_WAIT: three alike are red
  await page.click('#tClearBtn');
  await page.evaluate(() => tg.sol.forEach((v, k) => { if (tg.giv[k] < 0) { tCells[k].click(); if (v) tCells[k].click(); } }));
  await page.waitForFunction(() => solved.open);   // after the wave
  assert.deepStrictEqual(await page.evaluate(() => [solved.open, /^Riješeno za \d+:\d\d · 1 dan zaredom$/.test(solvedText.textContent), solvedMenu.textContent, solvedLevel.textContent, solvedShare.textContent, lbHead.textContent]),
    [true, true, 'Igre', 'Sudoku', 'Podijeli rezultat', 'Upiši se na današnju ljestvicu'], 'tango solved: the card');
  await page.click('#solvedMenu');
  assert.deepStrictEqual(await page.evaluate(() => [view, tileTango.lastChild.className]), ['games', 'solved'], 'tango: the tile says solved');
  await page.click('#tabPast');
  assert.strictEqual(await page.$$eval('#tangoPast li', x => x.length), 1, 'tango: in Povijest');
  await page.click('#tabGames');
  await page.click('#tileTango');
  await page.click('#tangoNew');
  assert.deepStrictEqual(await page.evaluate(() => [tangoName.textContent, tHintBtn.hidden]), ['Dinango · Nova igra', false], 'tango game: with Savjet');
  await page.evaluate(() => { const k = tg.values.findIndex(v => v < 0); tCells[k].click(); if (tg.sol[k] === 0) tCells[k].click(); });
  await page.click('#tHintBtn');
  assert.strictEqual(await page.evaluate(() => tTip.title), 'Nešto ne štima', 'tango Savjet: a wrong cell first');
  await page.reload();
  assert.deepStrictEqual(await page.evaluate(() => [view, tangoName.textContent]), ['tango', 'Dinango · Nova igra'], 'tango: a reload goes on');
  assert.strictEqual(await page.evaluate(() => {
    for (let i = 0; i < 40 && !tg.solvedAt; i++) { tHintBtn.click(); if (tTip.v >= 0 && tTip.v !== tg.sol[tTip.k]) return 'wrong step'; tTipDo.click(); }
    return [!!tg.solvedAt, tb.classList.contains('won')].join();
  }), 'true,true', 'tango game: Savjet to the end, the wave');
  await page.waitForFunction(() => solved.open);
  assert.deepStrictEqual(await page.evaluate(() => [solvedNext.hidden, solvedShare.hidden, getComputedStyle(solvedDino).display !== 'none', solvedFor.textContent, getComputedStyle(document.querySelector('#solved .tick')).display]),
    [false, true, true, '♥ za U', 'none'], 'tango game: then the card, the little dino and U\'s line, Nova igra');
  await page.click('#solvedMenu');
  console.log('tango: Igre first, a board per date (unique, Savjet finishes it), solo daily, red rules, card, tile, Povijest, game with Savjet');

  // 1d2. Nit: the tile opens today's board, the thread starts on 1. A drag (the mouse as a finger, cells skipped
  //      by a fast move walked one by one) draws it; a knot out of turn stops it; dragging back over it takes it
  //      back; Poništi undoes a drag; the whole path solves it → the knots pop, the card, the tile says ✓.
  await page.click('#tabGames');
  await page.click('#tileNit');
  assert.deepStrictEqual(await page.evaluate(() => [view, nitName.textContent, ng.date === dayKey(), ng.line.length]), ['nit', 'Nit · dnevni', true, 1], 'nit: the daily on 1');
  const nCell = k => page.evaluate(k => { const r = nb.getBoundingClientRect(), u = r.width / 380; return [r.left + (40 + k % 6 * 60) * u, r.top + (40 + (k / 6 | 0) * 60) * u]; }, k);
  const nDrag = async (cells, steps = 3) => {
    let [x, y] = await nCell(cells[0]);
    await page.mouse.move(x, y); await page.mouse.down();
    for (const k of cells.slice(1)) { [x, y] = await nCell(k); await page.mouse.move(x, y, { steps }); }
    await page.mouse.up();
  };
  const nPath = await page.evaluate(() => ng.path), nLine = () => page.evaluate(() => ng.line.join());
  await nDrag([nPath[0], nPath[5]], 1);   // one jump: walked cell by cell where the way is free
  const jumped = await page.evaluate(() => ng.line.length);
  await nDrag([nPath[0]]);   // back to 1
  await nDrag(nPath.slice(0, 12));
  assert.strictEqual(await nLine(), nPath.slice(0, 12).join(), 'nit: the drag draws the thread');
  const outOfTurn = await page.evaluate(() => { const k = ng.knots.at(-1); return nNear(ng.line.at(-1)).includes(k) ? null : (nTo(k), ng.line.at(-1) === k); });
  assert.notStrictEqual(outOfTurn, true, 'nit: the last knot out of turn stops the thread');
  await nDrag([nPath[11], nPath[10], nPath[9]]);
  assert.strictEqual(await nLine(), nPath.slice(0, 10).join(), 'nit: back over the thread takes it back');
  await page.click('#nUndoBtn');
  assert.strictEqual(await nLine(), nPath.slice(0, 12).join(), 'nit: Poništi undoes the last drag');
  await nDrag(nPath.slice(11));
  await page.waitForFunction(() => solved.open);
  assert.deepStrictEqual(await page.evaluate(() => [!!ng.solvedAt, nb.classList.contains('won'), /^Riješeno za \d+:\d\d · 1 dan zaredom$/.test(solvedText.textContent), solvedMenu.textContent, solvedNext.hidden, ntools.hidden,
    solvedShare.hidden, solvedShare.textContent, lboard.hidden, lbHead.textContent, lbNow.level, shareMsg.text.split('\n')[0].startsWith('Nit · ')]),
    [true, true, true, 'Igre', true, true, false, 'Podijeli', false, 'Upiši se na današnju ljestvicu', 4, true], 'nit solved: knots pop, the card with Ljestvica (level 4) and Podijeli');
  await page.click('#solvedMenu');
  assert.deepStrictEqual(await page.evaluate(() => [view, tileNit.lastChild.className, /^✓ \d+:\d\d · 1 dan$/.test(tileNit.lastChild.textContent)]), ['games', 'solved', true], 'nit: the tile says solved');
  await page.click('#tabPast');
  assert.deepStrictEqual(await page.evaluate(() => [nitPast.children.length, nitPastTitle.hidden, tangoPast.children.length]), [1, false, 1], 'nit: in Povijest, beside Dinango');
  await page.click('#tabGames');
  // Savjet (a game only): the next cell, Stavi draws it; a thread off the solution → back to its last right cell; to the end.
  // (nTip is the open tip; the box is $('nTip'))
  assert.strictEqual(await page.evaluate(() => { openNit(); return nHintBtn.hidden; }), true, 'nit daily: no Savjet');
  await page.click('#nitNew');
  assert.deepStrictEqual(await page.evaluate(() => {
    nHintBtn.click();
    const r = [nitName.textContent, nTip.title, nTip.k === ng.path[1], !!nb.querySelector('.nring'), $('nTip').hidden];
    nTipDo.click();
    return [...r, ng.line.join() === ng.path.slice(0, 2).join(), $('nTip').hidden];
  }), ['Nit · Nova igra', 'Sljedeći korak', true, true, false, true, true], 'nit Savjet: the next cell, Stavi');
  assert.strictEqual(await page.evaluate(() => {
    for (let i = 1; i < 30; i++) for (const j of nNear(ng.path[i])) {
      ng.line = ng.path.slice(0, i + 1);
      if (j === ng.path[i + 1] || ng.line.includes(j) || !nTo(j)) continue;
      nChanged(); nHintBtn.click();
      const r = [nTip.title, nTip.k === ng.path[i]];
      nTipDo.click();
      return [...r, ng.line.join() === ng.path.slice(0, i + 1).join()].join();
    }
    return 'no wrong step found';
  }), 'Nit je skrenula,true,true', 'nit Savjet: off the solution → Vrati');
  assert.strictEqual(await page.evaluate(() => { for (let i = 0; i < 40 && !ng.solvedAt; i++) { nHintBtn.click(); nTipDo.click(); } return !!ng.solvedAt; }), true, 'nit Savjet: to the end');
  await page.waitForFunction(() => solved.open);
  assert.deepStrictEqual(await page.evaluate(() => [solvedNext.hidden, solvedShare.hidden, lboard.hidden]), [false, true, true], 'nit game: the card without a board, Nova igra');
  await page.click('#solvedMenu');
  console.log(`nit: the tile opens the daily, drag (a jump walked: ${jumped} cells), knots in turn, back, Poništi, solved → card (Ljestvica, Podijeli), tile, Povijest, Savjet in a game`);

  // 1e. Križaljke: a topic from the server (answered here: no Claude in the test), woven on the device with
  // LJ/NJ/DŽ as one cell; on-screen keys fill a word, a wrong full word goes red, a reload goes on, all solved → done.
  const XW = 'AKTIVA PASIVA KONTO SALDO PRIHOD RASHOD OBVEZE FAKTURA PDV DOBIT GUBITAK STORNO OIB BRUTO NETO DUG IBAN KASA POREZ RAČUN KNJIGA KNJIŽENJE PLAĆANJE BUDŽET'.split(' ');
  await page.setRequestInterception(true);
  // the real server may have answered before this (today's daily): forgotten, so the fake one below is asked
  await page.evaluate(() => { const t = xwGet('xwTopics'); delete t[xwDayKey()]; xwSet('xwTopics', t); xwDayAsk = null; });
  const DAY = ['TIHANOĆ', 'BOR', 'JASLICE', 'BADNJAK', 'KOLEDA', 'BETLEHEM', 'ANĐEO', 'MARIJA', 'JOSIP', 'ADVENT', 'PASTIRI', 'ZVIJEZDA', 'CHAPLIN'];
  // two-word answers: several, as the day's grid (seeded by the date) may leave any one of them out
  const TWO = { TIHANOĆ: [4, 3], BETLEHEM: [4, 4], PASTIRI: [3, 4], ZVIJEZDA: [4, 4] };
  let dayAsks = 0;   // the daily's hints come on the second ask (made the hour after its terms)
  const xwRoute = r => !r.url().includes('/functions/v1/krizaljka') ? r.continue()
    : r.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey, content-type' },
      body: r.method() === 'OPTIONS' ? '' : r.url().includes('?dan=') ? (dayAsks++, JSON.stringify({ tema: 'Božić', uvod: 'Badnjak, polnoćka i Tiha noć.', sutra: 'Sveti Stjepan',
        pojmovi: DAY.map((w, i) => ({ slova: w.match(/LJ|NJ|DŽ|./gu), trag: 'Dnevni trag ' + i, ...dayAsks > 1 ? { trag2: 'Dnevni savjet ' + i } : {}, ...TWO[w] ? { rijeci: TWO[w] } : {} })) }))
        : r.method() === 'GET' ? JSON.stringify([{ kljuc: 'knjigovodstvo', tema: 'Knjigovodstvo', broj: 24, igrano: 1284 }, { kljuc: 'žabe', tema: 'Žabe', broj: 31, igrano: 2 }])
        : r.postData().includes('savjeti') ? JSON.stringify({ savjeti: XW.map(w => 'Savjet za ' + w.length) })
        : JSON.stringify({ tema: 'Knjigovodstvo', pojmovi: XW.map(w => ({ slova: w.match(/LJ|NJ|DŽ|./gu), trag: 'Trag ' + w.length })) }) });
  page.on('request', xwRoute);
  await page.click('#tileXw');
  await page.waitForFunction(() => xwPop.childElementCount === 2);
  assert.deepStrictEqual(await page.evaluate(() => [xwPop.firstChild.textContent, xwChips.childElementCount, xwChips.hidden]),
    ['1Knjigovodstvo24 pojma1.284 igrača', 2, false], 'xw: everyone\'s topics ranked, quick picks');
  await page.type('#xwTopic', 'zab');
  assert.deepStrictEqual(await page.evaluate(() => [xwFound.textContent, xwGo.hidden]), ['Žabe31 pojam2 igrača', false], 'xw: the field finds a topic without č ć ž, offers a new one');
  await page.evaluate(() => { xwTopic.value = ''; });
  await page.type('#xwTopic', 'Knjigovodstvo');
  assert.strictEqual(await page.evaluate(() => xwGo.hidden), true, 'xw: no new topic when it is already there');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => view === 'xwplay');
  assert.deepStrictEqual(await page.evaluate(() => [xw.lvl, xwLv.value, xw.g.cols <= 9 && xw.g.rows <= 11, xw.words.every(w => w.i < 12), xw.words.length >= 6]),
    [0, '0', true, true, true], 'xw: a new topic starts at Lagano, a small grid of the easier half');
  await page.waitForFunction(() => !xwHint.hidden);   // the hints come in the background
  assert.strictEqual(await page.evaluate(() => { xwHint.click(); return xwClue.querySelector('em')?.textContent === xw.sel.hint && xwHint.hidden; }), true, 'xw: Savjet shows the second clue');
  await page.evaluate(() => { for (const ch of xw.sel.cells) [...xwKb.querySelectorAll('button')].find(b => b.textContent === ch).click(); });
  assert.strictEqual(await page.evaluate(() => xwSide.textContent.startsWith('1 od ')), true, 'xw: a word typed is solved');
  await page.evaluate(() => { for (let i = xw.sel.cells.length; i--;) [...xwKb.querySelectorAll('button')].find(b => b.textContent === 'Đ').click(); });
  assert.ok(await page.evaluate(() => document.querySelectorAll('#xg .bad').length > 0), 'xw: a wrong full word is red');
  await page.reload();
  assert.deepStrictEqual(await page.evaluate(() => [view, xwSide.textContent.startsWith('1 od ')]), ['xwplay', true], 'xw: a reload goes on');
  assert.deepStrictEqual(await page.evaluate(() => {
    for (const w of xw.words) w.cells.forEach((ch, j) => { xw.sel = w; xw.k = w.at[j]; xwPut(ch); });   // cell by cell: the cursor skips filled ones
    return [xwDone.hidden, xwKb.hidden, xwDoneT.textContent, xwDoneS.textContent.endsWith('· 1 savjet'), xwNextLv.textContent, !!xwDoneSt.querySelector('.stairs .grow')];
  }), [false, true, 'Lagano riješeno ✓', true, 'Sljedeće: Srednje', true], 'xw: all solved → done, the hint counted, on to Srednje');
  await page.click('#xwNextLv');
  assert.deepStrictEqual(await page.evaluate(() => [xw.lvl, xw.words.length >= 10, xw.words.some(w => w.cells.includes('NJ')), [...xwLv.options].map(o => o.textContent).join()]),
    [1, true, true, 'Lagano ✓,Srednje,Teško'], 'xw: Srednje, all the terms (NJ one cell), Lagano ticked');
  // Teško: nothing on the way; the grid full with one wrong letter → "Ima 1 krivo slovo", where only when asked; no Savjet.
  await page.evaluate(() => { xwLv.value = '2'; xwLv.dispatchEvent(new Event('change')); });
  assert.deepStrictEqual(await page.evaluate(() => {
    const last = xw.words.at(-1), k = last.at[0];
    for (const w of xw.words) w.cells.forEach((ch, j) => { xw.sel = w; xw.k = w.at[j]; if (w.at[j] !== k) xwPut(ch); });
    xw.sel = last; xw.k = k; xwPut(last.cells[0] === 'Đ' ? 'A' : 'Đ');
    const r = [xw.lvl, xwCheck.hidden, xwCheck.querySelector('b').textContent, document.querySelectorAll('#xg .bad, #xg .ok').length, xwHint.hidden];
    xwShow.click();
    return [...r, document.querySelectorAll('#xg .bad').length];
  }), [2, false, 'Ima 1 krivo slovo', 0, true, 1], 'xw Teško: the count once full, nothing marked until "Pokaži gdje", no Savjet');
  await page.click('#xwBack');
  assert.strictEqual(await page.evaluate(() => xwCards.firstChild.querySelectorAll('.stairs i.f').length), 3, 'xw: the card shows Teško as three stairs');
  // Dnevna: a calendar sheet on top of Križaljke (not among your topics); Srednje, the same grid from the date on every
  // device, no clock, no levels, Savjet once its hints are made; a two-word answer has a dashed edge and (4, 3); solved →
  // the card with how many hints and tomorrow, no board.
  await page.waitForFunction(() => !xwDaily.hidden);
  assert.deepStrictEqual(await page.evaluate(() => [xwDaily.querySelector('.cal .d').textContent === String(new Date().getDate()), xwDaily.querySelector('b').textContent, xwCards.childElementCount]),
    [true, 'Božić', 1], 'xw daily: the sheet on top, not among your topics');
  assert.ok(await page.evaluate(() => xwGet('xwTopics')[xwDayKey()].pojmovi.every(p => !('trag2' in p))), 'xw daily: first loaded without hints');
  await page.click('#xwDaily');
  await page.waitForFunction(() => !xwHint.hidden);   // asked for again on opening: now with hints
  assert.deepStrictEqual(await page.evaluate(() => { const a = JSON.stringify(xw.g.lay); xwNew(xw.key, 1); return [xw.lvl, xwLvBox.hidden, !!document.getElementById('xwTimer'), xwHint.hidden, xwName.textContent, JSON.stringify(xw.g.lay) === a]; }),
    [1, true, false, false, 'Na današnji dan · Božić', true], 'xw daily: Srednje, the same grid again (seeded by the date), no clock, Savjet');
  await page.evaluate(() => xwHint.click());
  assert.deepStrictEqual(await page.evaluate(() => { const w = xw.words.find(w => w.rijeci); xw.sel = w; drawXw();
    return [!!document.querySelector(`#xg [data-k="${w.at[w.rijeci[0] - 1]}"]`).className.match(/ b[ad]\b/),
      document.querySelectorAll('#xg .ba, #xg .bd').length === xw.words.filter(w => w.rijeci).length, xwClue.textContent.includes(`(${w.rijeci.join(', ')})`), xwKb.textContent.includes('QW')]; }),
    [true, true, true, true], 'xw daily: a two-word answer has one dashed edge after its first word and (4, 3) by its clue; the keys have Q W');
  await page.evaluate(() => { for (const w of xw.words) w.cells.forEach((ch, j) => { xw.sel = w; xw.k = w.at[j]; xwPut(ch); }); });
  await page.waitForFunction(() => solved.open);
  assert.deepStrictEqual(await page.evaluate(() => [solvedText.textContent, solvedMenu.textContent, solvedTomorrow.querySelector('b').textContent,
    getComputedStyle(solvedTomorrow).display !== 'none', solvedShare.hidden, lboard.hidden, shareMsg.text.split('\n')[1], getComputedStyle(solvedFor).display]),
    ['1 savjet', 'Križaljke', 'Sutra: Sveti Stjepan', true, false, true, '✓ 1 savjet', 'none'], 'xw daily solved: the card with the hints, tomorrow, Podijeli, no board (no Dinango line)');
  await page.click('#solvedMenu');
  assert.deepStrictEqual(await page.evaluate(() => [view, xwDaily.querySelector('.xdgo small').textContent]), ['xw', 'Riješeno · 1 savjet ✓'], 'xw daily: Križaljke says it is solved');
  await page.click('#xwHome');
  assert.ok(await page.evaluate(() => tileXw.lastChild.textContent.startsWith('Knjigovodstvo · Teško ')), 'xw: the tile says the topic and its level');
  page.off('request', xwRoute);
  await page.setRequestInterception(false);
  console.log('križaljke: topic from the server, levels (Lagano small and easy, Srednje, Teško checked at the end), Savjet, NJ as one cell, keys, red wrong word, reload, done → next level, tile');

  // 1f. A big screen: the rail and Danas; a game folds the rail, leaving it opens it again; the fold is kept.
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluate(() => { localStorage.removeItem('railMini'); go('games'); });
  assert.deepStrictEqual(await page.evaluate(() => [getComputedStyle(rail).display, getComputedStyle(tabs).display, dSudoku.children.length, dXw.textContent.includes('Knjigovodstvo'), /^DnevniRiješeno za \d+:\d\d ✓$/.test(dNit.firstChild.textContent), dNitGo.textContent, getComputedStyle(document.querySelector('.dcards')).gridTemplateColumns.split(' ').length]),
    ['flex', 'none', 3, true, true, 'Nova igra', 4], 'rail: shown, no tab bar, Danas with the dailies, the crossword and Nit (four in a row)');
  await page.evaluate(() => rail.querySelector('[data-v="tango"]').click());   // not by position: the rail is still animating its width
  assert.deepStrictEqual(await page.evaluate(() => [view, document.body.classList.contains('railmini')]), ['tango', true], 'rail: a game folds it');
  await page.evaluate(() => rail.querySelector('[data-v="games"]').click());
  assert.strictEqual(await page.evaluate(() => document.body.classList.contains('railmini')), false, 'rail: open again after the game');
  await page.evaluate(() => $('railFold').click());
  await page.reload();
  assert.deepStrictEqual(await page.evaluate(() => [document.body.classList.contains('railmini'), rail.querySelector('[aria-current]').dataset.v]), [true, 'games'], 'rail: the fold is kept');
  // The crossword on a big screen: every clue beside the grid, arrows, Tab, space, a clicked clue, N then J → NJ in one cell.
  await page.evaluate(() => xwNew('knjigovodstvo'));
  assert.deepStrictEqual(await page.evaluate(() => [xwA.children.length + xwD.children.length === xw.words.length, getComputedStyle(xwKb).display, getComputedStyle(xwA.parentNode).display]),
    [true, 'none', 'block'], 'xw big: the clue lists, no keys on screen');
  assert.strictEqual(await page.evaluate(() => {
    const w = xw.words.find(w => w.dir === 'a'), [r, c] = w.at[0].split(',').map(Number);
    xw.sel = w; xw.k = w.at[0]; drawXw();
    dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    return xw.k === `${r},${c + 1}` && xw.sel === w;
  }), true, 'xw big: an arrow moves along the word');
  assert.strictEqual(await page.evaluate(() => { const s = xw.sel; dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })); return xw.sel === xw.words[xw.words.indexOf(s) + 1]; }), true, 'xw big: Tab → the next clue');
  assert.strictEqual(await page.evaluate(() => { xwD.firstChild.click(); return xw.sel.dir === 'd' && xwD.firstChild.className === 'on'; }), true, 'xw big: a clicked clue is chosen');
  assert.strictEqual(await page.evaluate(() => {
    const w = xw.words.find(w => w.cells.indexOf('NJ') > 0), j = w.cells.indexOf('NJ');
    xw.sel = w; xw.k = w.at[j]; drawXw();
    for (const key of ['n', 'j']) dispatchEvent(new KeyboardEvent('keydown', { key }));
    return xw.g.fill[w.at[j]];
  }), 'NJ', 'xw big: N then J is NJ in one cell');
  await page.evaluate(() => go('games'));
  await page.evaluate(() => localStorage.removeItem('railMini'));
  await page.setViewport({ width: 800, height: 600 });
  console.log('rail: from 1100px, Danas, folds in a game, the fold kept');

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

  // 3c. A solved paper whose split missed (every digit printed): a duplicate = maybe a mistake on paper;
  //     none → "Provjeri" opens the "Riješeno!" card.
  await open(null);
  await scan('handwritten.jpg');
  console.log('solved paper: ' + await page.$eval('#msg', m => m.textContent));
  const fill = g => page.evaluate(g => {
    document.querySelectorAll('#grid input').forEach((x, i) => { x.value = g[i]; x.classList.remove('entry', 'low'); x.classList.add('given'); });
    markConflicts(); entryLabel();
  }, g);
  await fill('9' + HW_FULL.slice(1));   // r1 already has a 9
  assert.strictEqual(await page.$eval('#setTask', b => b.textContent), 'Provjeri');
  await page.click('#setTask');
  assert.ok(await page.evaluate(() => !task && /greška na papiru/.test(msg.textContent)), 'solved paper: a duplicate');
  await fill(HW_FULL);
  await page.click('#setTask');
  assert.deepStrictEqual(await page.evaluate(() => [task.givens.join(''), solved.open, solvedText.textContent]), [HW_FULL, true, 'Sve je točno.'], 'solved paper: Riješeno card');
  console.log('solved paper: duplicate flagged, right one → Riješeno');

  // 3d. Screenshots (PNG): this app in dark mode, light digits on dark, bold = given, regular = typed;
  //     a screen with only givens has no typed digits (the paper model would call some handwritten).
  await open(null);
  await scan('screenshot-dark.png');
  assert.strictEqual(await grid(), '341259786789364125562871934475692813236780459198543672913427568657938241824005397', 'dark screenshot OCR');
  const typedIn = ['100000011', '001010001', '100100100', '000001110', '100000101', '000110110', '101000010', '001011010', '011000000'].join('')
    .split('').flatMap((k, i) => k === '0' && ![41, 75, 76].includes(i) ? [i] : []);
  assert.deepStrictEqual(await cls('entry'), typedIn, 'dark screenshot: bold given, regular typed');
  // The same game with pencil notes (and highlighted cells): the plain picture's best "grid" is one 3×3 box,
  // the inverted one is the whole grid; notes are no digits.
  await open(null);
  await scan('screenshot-notes.png');
  const noted = '300059086089360025500800934005692813236080459198543672913000568657938241824005397';
  assert.strictEqual(await grid(), noted, 'screenshot with notes OCR');
  assert.deepStrictEqual(await cls('entry'), typedIn.filter(i => +noted[i]), 'screenshot with notes: given / typed');
  const onlyGivens = await page.evaluate(async g => {
    const c = document.createElement('canvas'), x = c.getContext('2d'), s = 100;
    c.width = 1080; c.height = 1500;
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.translate(90, 300); x.font = '60px Arial'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#111';
    [...g].forEach((d, i) => +d && x.fillText(d, (i % 9 + 0.5) * s, ((i / 9 | 0) + 0.55) * s));
    for (let k = 0; k <= 9; k++) { x.lineWidth = k % 3 ? 2 : 6; x.beginPath(); x.moveTo(k * s, 0); x.lineTo(k * s, 900); x.moveTo(0, k * s); x.lineTo(900, k * s); x.stroke(); }
    const probs = await readGrid(await new Promise(r => c.toBlob(r)));
    return [probs.map(best).join(''), lastPrinted.some(k => k === false)];
  }, PRINTED);
  assert.deepStrictEqual(onlyGivens, [PRINTED, false], 'screenshot, givens only: all printed');
  console.log('screenshots: dark one read, bold/regular told apart; givens only all printed');

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
  assert.strictEqual(await lp.evaluate(() => view), 'games', 'a fresh start: Igre');
  await lp.click('#tileSudoku');   // Skeniraj lives on the sudoku's screen
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
  // A solved paper (all 81, every one printed): no duplicates → "Točno riješeno"; a duplicate → maybe a mistake on paper.
  const verdict = d => lp.evaluate(d => {
    const f = live.frozen;
    f.digits = [...d].map(Number); f.conf = f.conf.map(() => 1); f.printed = f.printed.map(() => true);
    resolve(); showFrozen();
    return [tipMain.textContent, tipSub.textContent, liveConfirm.disabled];
  }, d);
  const [right, dupe] = [await verdict(solution), await verdict(solution[1] + solution.slice(1))];
  assert.ok(right[0] === 'Točno riješeno ✓' && !right[2], 'live: solved paper ' + right);
  assert.ok(dupe[0] === 'Isti broj dvaput (crveno)' && /greška je na papiru/.test(dupe[1]) && dupe[2], 'live: solved paper with a duplicate ' + dupe);
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
  const sheet = async () => { await lp.click('#moreBtn'); await new Promise(r => setTimeout(r, 300)); };
  const unsheet = async () => { await lp.evaluate(() => more.close()); await new Promise(r => setTimeout(r, 300)); };
  await sheet();
  await lp.click('#candsBtn');
  assert.ok(await lp.evaluate(() => !cands.hidden && [...cands.querySelectorAll('span span')].filter(s => s.textContent).length > 100), 'candidates shown');
  await lp.click('#candsBtn');
  assert.ok(await lp.evaluate(() => !paperBtn.hidden && more.open), 'sheet: stays open for its switches; paper check for a scanned sudoku');
  await unsheet();
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
  assert.deepStrictEqual(await lp.evaluate(() => [getComputedStyle(explainBox).display, explainBtn.ariaPressed, /skriveno/.test(msg.textContent), msgAct.textContent]),
    ['none', 'false', true, 'Vrati'], 'Sakrij removes the bubble and says where it went');
  await sheet();
  await lp.click('#explainBtn');
  await unsheet();
  assert.deepStrictEqual(await lp.evaluate(() => [getComputedStyle(explainBox).display, explainBtn.ariaPressed]), ['flex', 'true'], 'Objašnjenje brings it back');
  // An answer given at home survives scanning the paper again (history).
  await lp.click('#hintBtn'); await lp.click('#hintBtn');
  const answered = await lp.evaluate(() => hintState.h.cell);
  await sheet();
  await lp.click('#paperBtn');   // ⋯ → Provjeri papir kamerom
  await lp.waitForFunction(() => live?.frozen, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 500));
  await lp.click('#liveConfirm');
  assert.strictEqual((await home())[answered], solution[answered], 'answer kept across scans');
  assert.strictEqual(await lp.evaluate(() => saved().length), 1, 'still one history entry');
  // Počni ispočetka: the user's digits go, the task stays.
  await sheet();
  await lp.click('#restartBtn');
  assert.deepStrictEqual([await home(), await lp.evaluate(() => task.givens.join(''))], [PRINTED, PRINTED], 'Počni ispočetka');
  // The explanation off from before (not hidden in this game): Savjet says so once, with "Uključi".
  await new Promise(r => setTimeout(r, 300));
  await lp.evaluate(() => { setQuiet(true); quietTold = null; });
  await lp.click('#hintBtn');
  assert.deepStrictEqual(await lp.evaluate(() => [/isključeno/.test(msg.textContent), msgAct.textContent]), [true, 'Uključi'], 'Savjet: the explanation is off');
  await lp.click('#msgAct');
  assert.strictEqual(await lp.evaluate(() => explainBtn.ariaPressed), 'true', 'Uključi brings it back');
  // The sheet: a short drag snaps back, a long one closes it.
  const dragSheet = async dy => {
    await sheet();
    const r = await lp.evaluate(() => { const b = document.querySelector('.grab').getBoundingClientRect(); return [b.x + b.width / 2, b.y + 10]; });
    await lp.mouse.move(...r); await lp.mouse.down();
    await lp.mouse.move(r[0], r[1] + dy, { steps: 10 }); await lp.mouse.up();
    await new Promise(r => setTimeout(r, 400));
    return lp.evaluate(() => more.open);
  };
  assert.strictEqual(await dragSheet(12), true, 'sheet: a short slow drag snaps back');
  await unsheet();
  assert.strictEqual(await dragSheet(150), false, 'sheet: dragged down, closed');
  console.log(`live: frozen, rot ${frozen.rot}, tap + pad fix, printed/own toggle, Potvrdi → game, ⋯: candidates, explanation, paper check, restart; answers kept, one history entry`);
  await cam.close(); fs.unlinkSync(mjpeg); server.close();
  console.log('ALL OK');
})().catch(e => { console.error(e.message); process.exit(1); });
