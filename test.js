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
  assert.deepStrictEqual(await page.evaluate(() => [dailyDlg.open, pickLvl, location.search]), [true, 2, ''], 'shared daily today: its card');
  await page.goto(link + '&d=2000-01-01.2');
  assert.deepStrictEqual(await page.evaluate(() => [task.random, dailyDlg.open]), [true, false], 'shared daily of another day: a game');
  console.log('share: link to this sudoku, opens as a game elsewhere, ?s dropped, broken link says so');
  await open(null);

  // 1. Printed puzzle: exact OCR, unique solution, hints step to the end and are always right.
  await scan('printed.jpg');
  assert.strictEqual(await grid(), PRINTED, 'printed OCR');
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
  // The card first (rules, three levels, "Kreni"); the clock waits for it. Then solo: no help buttons, a
  // clashing digit shows red but is not judged, the clock runs, solving shows time + streak.
  await page.click('#homeDaily');
  assert.deepStrictEqual(await page.evaluate(() => [dailyDlg.open, dailyGo.textContent, !!task?.daily]), [true, 'Kreni', false], 'daily: card before the start');
  await page.click('#dailyLevels button');   // Lagano
  await page.click('#dailyGo');
  await page.waitForFunction(() => task?.daily && !game.hidden);
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
  await page.click('#homeResume');   // Nastavi on today's daily: its card again; the clock stops while it is open, the level says "U tijeku"
  const paused = await page.evaluate(() => daily.elapsed);
  await new Promise(r => setTimeout(r, 2200));
  assert.deepStrictEqual(await page.evaluate(() => [daily.elapsed, dailyGo.textContent, dailyLevels.children[0].querySelector('small').textContent.startsWith('U tijeku')]),
    [paused, 'Nastavi', true], 'daily: paused behind its card');
  await page.click('#dailyGo');
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
      const hit = rows.filter(r => r.day === q.get('day').slice(3) && r.level === +q.get('level').slice(3) && (!q.get('ms') || r.ms < +q.get('ms').slice(3)));
      if (o.method === 'HEAD') return new Response(null, { headers: { 'content-range': `*/${hit.length}` } });
      return Response.json(hit.sort((x, y) => x.ms - y.ms).slice(0, +q.get('limit')).map(({ name, ms }) => ({ name, ms })));
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
  assert.deepStrictEqual(board[2].slice(0, 4), [':1|P0|0:00', ':2|P1|0:00', ':2|P2|0:00', ':4|P3|0:00'], 'board: top, shared place');
  assert.ok(/^me apart:7\|Chris\|\d+:\d\d$/.test(board[2][5]), 'board: your row ' + board[2][5]);
  // The queue: kept offline, sent when back; a second send of the same (409) is done with too.
  const queue = await page.evaluate(async () => {
    lbOffline = true; lbQueue(dayKey(), 1, 90000);
    const off = [await lbFlush(), JSON.parse(localStorage.sudokuLbQueue).length];
    lbOffline = false; lbQueue(dayKey(), 1, 90000);
    return [...off, await lbFlush(), localStorage.sudokuLbQueue, lbDb.filter(r => r.level === 1 && r.name === 'Chris').length];
  });
  assert.deepStrictEqual(queue, [false, 1, true, '[]', 1], 'board: offline queue, 409');
  await page.click('#solvedMenu');
  // The menu's Ljestvica: all three levels, top three + you (marked where your own record says so); a day back; a week at most.
  const ranks = () => page.evaluate(async () => { await showRanks();
    return [ranksDate.textContent, ...[...ranks.children].map(el => el.querySelector('small').textContent + '=' + [...el.querySelectorAll('li')].map(li => li.className + ':' + li.children[1].textContent).join(','))]; });
  assert.deepStrictEqual(await ranks(), ['Danas', '7 igrača=:P0,:P1,:P2,me apart:Chris', '1 igrač=:Chris', 'Još nitko='], 'ranks: today');
  await page.evaluate(() => ranksPrev.click());
  assert.deepStrictEqual(await ranks(), ['Jučer', 'Još nitko=', 'Još nitko=', 'Još nitko='], 'ranks: yesterday');
  await page.evaluate(() => { for (let i = 0; i < 6; i++) ranksPrev.click(); });
  assert.deepStrictEqual(await page.evaluate(() => [ranksPrev.disabled, ranksNext.disabled]), [true, false], 'ranks: a week back at most');
  console.log(`daily: same puzzles per date, levels ${gen.diffs.join('/')}%, card + Kreni, solo, duplicates only, clock (paused behind the card), "${card[1]}"; board: name once, top five + you, offline queue; menu Ljestvica: days, levels`);

  // 1b. Harder puzzles: hint() steps (incl. Pointing / Naked Pair) must always give the solution digit.
  const hard = await page.evaluate((puzzles, printed) => {
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
