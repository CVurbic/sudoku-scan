// Trains the printed-vs-handwritten classifier used by index.html → model/printed/.
// Data: the Wicht dataset (run bench.js once to download it). "mixed" photos have printed givens with
// handwritten fill-ins, so each cell's kind is known (given in the v2 version = printed); the plain v2
// photos are printed only (a grid with nothing handwritten must not grow fake entries). Cells are read
// with the app's own pipeline (digit model must exist). Training: *_train; scored on mixed_test,
// v2_test and test/handwritten.jpg.
// Usage: node train-printed.js   (set CHROME to override the Chrome path)
const puppeteer = require('puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DATA = path.join(__dirname, '.data');
const dat = f => fs.readFileSync(f, 'utf8').split('\n').slice(2, 11).join('').replace(/\s/g, '').split('').map(Number);
const list = (set, sub) => fs.readdirSync(path.join(DATA, set, sub)).filter(f => f.endsWith('.jpg'))
  .map(f => ({ name: f, url: `/.data/${set}/${sub}/${f}`, truth: dat(path.join(DATA, set, sub, f.replace('.jpg', '.dat'))) }));
const givens = Object.fromEntries([...list('v2_train', 'v2_train'), ...list('v2_test', 'v2_test')].map(x => [x.name, x.truth]));
// printed = 1, handwritten = 0, empty = -1
const kinds = x => x.truth.map((d, i) => !d ? -1 : givens[x.name][i] ? 1 : 0);
const printedOnly = x => ({ url: x.url, kinds: x.truth.map(d => d ? 1 : -1), truth: x.truth });
const train = [...list('v2_mixed_train', 'mixed').filter(x => givens[x.name]).map(x => ({ url: x.url, kinds: kinds(x), truth: x.truth })),
  ...list('v2_train', 'v2_train').map(printedOnly)];
const testPrinted = list('v2_test', 'v2_test').map(printedOnly);
const test = list('v2_mixed_test', 'mixed').filter(x => givens[x.name]).map(x => ({ url: x.url, kinds: kinds(x), truth: x.truth }));
// test/handwritten.jpg: printed givens + the full grid written in by hand (same as test.js)
const HW_GIVENS = '000000082830060017010090003000700051020508030540003000300080060690030074450000000';
const HW_FULL = '764351982839264517215897643983726451126548739547913826372489165698135274451672398';
const own = [{ url: '/test/handwritten.jpg', truth: [...HW_FULL].map(Number), kinds: [...HW_GIVENS].map(d => +d ? 1 : 0) }];

const server = http.createServer((q, s) => fs.readFile(path.join(__dirname, decodeURIComponent(q.url === '/' ? 'index.html' : q.url)),
  (e, d) => e ? (s.writeHead(404), s.end()) : (s.writeHead(200), s.end(d)))).listen(8785);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 0 });
  const page = await browser.newPage();
  page.on('console', m => console.log(m.text()));
  await page.goto('http://localhost:8785/');
  await page.waitForFunction(() => typeof model !== 'undefined' && model && featModel, { timeout: 120000 });

  const res = await page.evaluate(async (train, test, testPrinted, own) => {
    // Photo → [{ v, s, kind }] for cells with a digit; skipped if the reading doesn't match the truth
    // (wrong grid or turn would mislabel everything).
    const cells = async ({ url, truth, kinds }) => {
      const probs = await readGrid(await (await fetch(url)).blob());
      if (!probs) return [];
      const seen = probs.flatMap((p, i) => p ? [p.indexOf(Math.max(...p)) + 1 === truth[i]] : []);
      if (seen.filter(Boolean).length < 0.8 * seen.length) return [];
      return lastFeats.flatMap((f, i) => f && kinds[i] >= 0 ? [{ v: f.v, s: f.s, kind: kinds[i] }] : []);
    };
    const X = [], S = [], Y = [];
    for (const photo of train) for (const c of await cells(photo)) {
      X.push(c.v); S.push(c.s); Y.push(c.kind);
      // the same cell as if photographed in grey (pencil, black pen, b/w camera): shape must carry it
      X.push(c.v); S.push([0, ...c.s.slice(1)]); Y.push(c.kind);
    }
    console.log(`training cells: ${X.length / 2} (printed ${Y.filter(Boolean).length / 2})`);

    const img = tf.input({ shape: [28, 28, 1] }), sc = tf.input({ shape: [4] });
    let x = tf.layers.conv2d({ filters: 8, kernelSize: 3, activation: 'relu' }).apply(img);
    x = tf.layers.maxPooling2d({ poolSize: 2 }).apply(x);
    x = tf.layers.conv2d({ filters: 16, kernelSize: 3, activation: 'relu' }).apply(x);
    x = tf.layers.maxPooling2d({ poolSize: 2 }).apply(x);
    x = tf.layers.flatten().apply(x);
    x = tf.layers.dense({ units: 32, activation: 'relu' }).apply(x);
    let y = tf.layers.concatenate().apply([x, sc]);
    y = tf.layers.dense({ units: 16, activation: 'relu' }).apply(y);
    y = tf.layers.dense({ units: 1, activation: 'sigmoid' }).apply(y);
    const net = tf.model({ inputs: [img, sc], outputs: y });
    net.compile({ optimizer: 'adam', loss: 'binaryCrossentropy', metrics: ['accuracy'] });
    const flat = a => a.flatMap(v => Array.from(v));
    await net.fit([tf.tensor4d(flat(X), [X.length, 28, 28, 1]), tf.tensor2d(S)], tf.tensor2d(Y, [Y.length, 1]), {
      epochs: 10, batchSize: 64, shuffle: true, validationSplit: 0.1,
      callbacks: { onEpochEnd: (e, l) => console.log(`epoch ${e + 1}: val_acc ${l.val_acc.toFixed(4)}`) },
    });

    const score = async (photos, name) => {
      let right = 0, n = 0, wrongP = 0, wrongH = 0;
      for (const photo of photos) {
        const cs = await cells(photo);
        if (!cs.length) continue;
        const p = net.predict([tf.tensor4d(flat(cs.map(c => c.v)), [cs.length, 28, 28, 1]), tf.tensor2d(cs.map(c => c.s))]).dataSync();
        cs.forEach((c, k) => { n++; if ((p[k] > 0.5) === !!c.kind) right++; else if (c.kind) wrongP++; else wrongH++; });
      }
      console.log(`${name}: ${right}/${n} right (${(100 * right / n).toFixed(1)}%); printed called handwritten ${wrongP}, handwritten called printed ${wrongH}`);
    };
    await score(test, 'mixed_test');
    await score(testPrinted, 'v2_test (printed only)');
    await score(own, 'test/handwritten.jpg');

    let art;
    await net.save(tf.io.withSaveHandler(async a => { art = a; return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } }; }));
    return { topology: art.modelTopology, specs: art.weightSpecs, weights: Array.from(new Uint8Array(art.weightData)) };
  }, train, test, testPrinted, own);

  const out = path.join(__dirname, 'model', 'printed');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'weights.bin'), Buffer.from(res.weights));
  fs.writeFileSync(path.join(out, 'model.json'), JSON.stringify({
    format: 'layers-model', generatedBy: 'train-printed.js', modelTopology: res.topology,
    weightsManifest: [{ paths: ['weights.bin'], weights: res.specs }],
  }));
  console.log('saved model/printed/');
  await browser.close(); server.close();
})();
