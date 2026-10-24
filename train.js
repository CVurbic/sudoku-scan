// Trains the digit CNN used by index.html → model/model.json + model/weights.bin.
// Data: MNIST 1-9 (handwritten) + digits 1-9 rendered in system fonts (printed); class 9 = rotated digit.
// Runs inside index.html in headless Chrome, so training uses the app's own toMnist() preprocessing.
// Own photos: put them in moje-slike/ as name.jpg + name.txt (the 81 digits as you see them in the
// photo, 9 rows, 0 = empty). Their cells are read with the current model's pipeline and weighted
// ×3. Keep test/ photos out of it, or test.js stops being an honest check.
// Usage: npm i && node train.js   (set CHROME to override the Chrome path)
const puppeteer = require('puppeteer-core');
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const MNIST = 'https://storage.googleapis.com/cvdf-datasets/mnist/';
const CACHE = path.join(__dirname, '.mnist'), MINE = path.join(__dirname, 'moje-slike');

async function download(name) {
  const f = path.join(CACHE, name);
  if (!fs.existsSync(f)) {
    fs.mkdirSync(CACHE, { recursive: true });
    const gz = Buffer.from(await (await fetch(MNIST + name + '.gz')).arrayBuffer());
    fs.writeFileSync(f, zlib.gunzipSync(gz));
  }
}

(async () => {
  await download('train-images-idx3-ubyte');
  await download('train-labels-idx1-ubyte');
  // A bad label file poisons training (×3 weight), so: valid sudoku if complete, never a test/ photo,
  // and (in the page) it must mostly agree with what the current model reads.
  const testPhotos = fs.readdirSync(path.join(__dirname, 'test')).map(f => fs.readFileSync(path.join(__dirname, 'test', f)));
  const mine = fs.existsSync(MINE) ? fs.readdirSync(MINE).filter(f => /\.(jpe?g|png)$/i.test(f)).flatMap(f => {
    const skip = why => (console.log(`moje-slike/${f}: ${why}, preskačem`), []);
    const txt = path.join(MINE, f.replace(/\.\w+$/, '.txt'));
    if (!fs.existsSync(txt)) return skip('nema .txt');
    const labels = fs.readFileSync(txt, 'utf8').replace(/\D/g, '').split('').map(Number);
    if (labels.length !== 81) return skip('.txt nema 81 znamenku');
    const img = fs.readFileSync(path.join(MINE, f));
    if (testPhotos.some(t => t.equals(img))) return skip('ista je kao fotka u test/ (test mora ostati pošten)');
    const unit = (k, j, kind) => labels[kind === 0 ? k * 9 + j : kind === 1 ? j * 9 + k : ((k / 3 | 0) * 3 + (j / 3 | 0)) * 9 + k % 3 * 3 + j % 3];
    const bad = !labels.includes(0) && [0, 1, 2].some(kind => [...Array(9).keys()].some(k => new Set([...Array(9).keys()].map(j => unit(k, j, kind))).size !== 9));
    if (bad) return skip('.txt nije ispravno riješen sudoku (tipfeler?)');
    return [['/moje-slike/' + encodeURIComponent(f), labels]];
  }) : [];
  const server = http.createServer((q, s) => fs.readFile(path.join(__dirname, decodeURIComponent(q.url === '/' ? 'index.html' : q.url)),
    (e, d) => e ? (s.writeHead(404), s.end()) : (s.writeHead(200), s.end(d)))).listen(8766);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 0 });   // training is one long call
  const page = await browser.newPage();
  page.on('console', m => console.log(m.text()));
  await page.goto('http://localhost:8766/');
  await page.waitForFunction(() => typeof cv !== 'undefined' && cv.Mat, { timeout: 120000 });
  if (mine.length) await page.waitForFunction(() => model, { timeout: 120000 });   // own photos are read with the current model

  const res = await page.evaluate(async mine => {
    const load = async u => new Uint8Array(await (await fetch(u)).arrayBuffer());
    const imgs = await load('.mnist/train-images-idx3-ubyte'), labels = await load('.mnist/train-labels-idx1-ubyte');
    const X = [], Y = [];
    // Class 9 = "turned": digits rotated 90/180/270°, so the app can tell which way up the paper is.
    // 180° is skipped for 1, 6, 8, 9 (upside down they look like a valid upright digit).
    const turns = [cv.ROTATE_90_CLOCKWISE, cv.ROTATE_180, cv.ROTATE_90_COUNTERCLOCKWISE];
    const add = (bin, d) => {
      X.push(toMnist(bin)); Y.push(d - 1);
      if (Math.random() > 0.15) return;
      const ok = [1, 6, 8, 9].includes(d) ? [turns[0], turns[2]] : turns, t = new cv.Mat();
      cv.rotate(bin, t, ok[Math.random() * ok.length | 0]);
      X.push(toMnist(t)); Y.push(9);
      t.delete();
    };

    for (const [u, labels] of mine) {
      const probs = await readGrid(await (await fetch(u)).blob()), name = decodeURIComponent(u);
      if (!probs) { console.log(`${name}: mreža nije pronađena`); continue; }
      const seen = probs.flatMap((p, i) => p && labels[i] ? [p.indexOf(Math.max(...p)) + 1 === labels[i]] : []);
      if (seen.filter(Boolean).length < 0.6 * seen.length) { console.log(`${name}: slaže se s očitanjem samo ${seen.filter(Boolean).length}/${seen.length}, .txt je vjerojatno od drugog sudokua ili krivo okrenut; preskačem`); continue; }
      let n = 0;
      labels.forEach((d, i) => d && lastVecs[i].forEach(v => { for (let r = 0; r < 3; r++) { X.push(v); Y.push(d - 1); } n++; }));
      console.log(`${decodeURIComponent(u)}: ${n} primjera`);
    }

    // MNIST re-run through toMnist after binarising, so it looks like what the app feeds the model.
    // Each digit twice: as is, and randomly rotated + sheared (real handwriting is slanted).
    for (let i = 0; i < 60000; i++) {
      const d = labels[8 + i];
      if (!d) continue;
      const m = cv.matFromArray(28, 28, cv.CV_8U, Array.from(imgs.subarray(16 + i * 784, 16 + (i + 1) * 784)));
      const big = new cv.Mat();
      cv.copyMakeBorder(m, big, 8, 8, 8, 8, cv.BORDER_CONSTANT, new cv.Scalar(0));
      const t = (Math.random() - 0.5) * 0.4, sh = (Math.random() - 0.5) * 0.5;
      const M = cv.matFromArray(2, 3, cv.CV_64F, [Math.cos(t), -Math.sin(t) + sh, 0, Math.sin(t), Math.cos(t), 0]);
      M.data64F[2] = 22 - M.data64F[0] * 22 - M.data64F[1] * 22; M.data64F[5] = 22 - M.data64F[3] * 22 - M.data64F[4] * 22;
      cv.warpAffine(big, big, M, new cv.Size(44, 44));
      for (const x of [m, big]) { cv.threshold(x, x, 100, 255, cv.THRESH_BINARY); if (cv.countNonZero(x)) add(x, d); }
      m.delete(); big.delete(); M.delete();
    }

    // Printed and handwriting-style font digits: random size, rotation, offset and stroke weight.
    const fonts = ['Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New', 'Tahoma', 'Cambria', 'Calibri',
      'Segoe UI', 'Consolas', 'Book Antiqua', 'Century Gothic', 'Franklin Gothic Medium', 'Garamond', 'Bookman Old Style', 'Lucida Console',
      'Segoe Script', 'Segoe Print', 'Ink Free', 'Lucida Handwriting', 'Bradley Hand ITC', 'Comic Sans MS', 'MV Boli', 'Kristen ITC'];
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d', { willReadFrequently: true });
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    for (const font of fonts) for (const weight of ['normal', 'bold']) for (let d = 1; d <= 9; d++) for (let a = 0; a < 25; a++) {
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64);
      x.translate(32 + (Math.random() - 0.5) * 6, 32 + (Math.random() - 0.5) * 6);
      x.rotate((Math.random() - 0.5) * 0.3);
      const ink = Math.random() * 120 | 0;
      x.fillStyle = `rgb(${ink},${ink},${ink})`; x.font = `${weight} ${28 + Math.random() * 16 | 0}px ${font}`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(d, 0, 0);
      const m = cv.imread(c);
      cv.cvtColor(m, m, cv.COLOR_RGBA2GRAY);
      if (a % 2) {   // blurry newsprint photo, binarised the way the app does it
        cv.GaussianBlur(m, m, new cv.Size(0, 0), 1 + Math.random() * 2.5);
        const [block, k] = THRESHOLDS[Math.random() * THRESHOLDS.length | 0];
        cv.adaptiveThreshold(m, m, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, block, k);
      } else {
        cv.threshold(m, m, 128 + ink / 2, 255, cv.THRESH_BINARY_INV);
        if (a % 3 === 1) cv.dilate(m, m, kernel); else if (a % 3 === 2) cv.erode(m, m, kernel);
      }
      if (cv.countNonZero(m)) add(m, d);
      m.delete();
    }

    // Pen strokes for European handwriting that MNIST lacks: 1 with a long up-flag (else read as 4),
    // 4 open or closed at the top (so the crossbar is what tells 4 from 1), 7 with a crossbar.
    // Shapes are polylines in a unit frame (y 0 = top, 1 = bottom), drawn with random size, slant,
    // stroke width and wobble.
    const R = (a, b) => a + Math.random() * (b - a), chance = p => Math.random() < p;
    const shapes = {
      1: () => {
        const f = R(0.2, 0.55), a = R(0.55, 1.2);   // flatter flags look like a 7
        return [[[-f * Math.cos(a), f * Math.sin(a)], [0, 0], [0, 1]], ...(chance(0.3) ? [[[-0.2, 1], [0.2, 1]]] : [])];
      },
      4: () => chance(0.5)
        ? [[[-0.3, 0], [-0.35, 0.6], [0.35, 0.6]], [[0.12, R(0, 0.25)], [0.12, 1]]]   // open top
        : [[[0.15, 0], [-0.35, 0.62], [0.35, 0.62]], [[0.15, 0], [0.15, 1]]],          // closed
      7: () => {
        const end = R(-0.2, 0.05), mid = 0.35 + (end - 0.35) / 2;
        return [[[-0.35, chance(0.3) ? 0.15 : 0], [-0.35, 0], [0.35, 0], [end, 1]], ...(chance(0.6) ? [[[mid - 0.2, 0.5], [mid + 0.2, 0.5]]] : [])];
      },
    };
    for (const [d, count] of [[1, 1500], [4, 2000], [7, 1000]]) for (let a = 0; a < count; a++) {
      const h = R(26, 44), w = R(2, 5);
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.fillStyle = '#fff'; x.fillRect(0, 0, 64, 64);
      x.setTransform(h, 0, R(-0.35, 0.25) * h, h, 32 + R(-3, 3), 32 - h / 2 + R(-3, 3));   // scale + slant
      x.lineWidth = w / h; x.lineCap = x.lineJoin = 'round'; x.strokeStyle = '#000';
      for (const line of shapes[d]()) {
        x.beginPath();
        for (const [px, py] of line) x.lineTo(px + R(-0.04, 0.04), py + R(-0.04, 0.04));
        x.stroke();
      }
      const m = cv.imread(c);
      cv.cvtColor(m, m, cv.COLOR_RGBA2GRAY);
      cv.threshold(m, m, 128, 255, cv.THRESH_BINARY_INV);
      if (cv.countNonZero(m)) add(m, d);
      m.delete();
    }
    kernel.delete();
    console.log(`samples: ${X.length}`);

    const order = X.map((_, i) => i).sort(() => Math.random() - 0.5);
    const xs = new Float32Array(X.length * 784), ys = new Float32Array(X.length);
    order.forEach((j, i) => { xs.set(X[j], i * 784); ys[i] = Y[j]; });

    const model = tf.sequential({ layers: [
      tf.layers.conv2d({ inputShape: [28, 28, 1], filters: 16, kernelSize: 3, activation: 'relu' }),
      tf.layers.maxPooling2d({ poolSize: 2 }),
      tf.layers.conv2d({ filters: 32, kernelSize: 3, activation: 'relu' }),
      tf.layers.maxPooling2d({ poolSize: 2 }),
      tf.layers.flatten(),
      tf.layers.dropout({ rate: 0.25 }),
      tf.layers.dense({ units: 64, activation: 'relu' }),
      tf.layers.dense({ units: 10, activation: 'softmax' }),
    ] });
    model.compile({ optimizer: 'adam', loss: 'sparseCategoricalCrossentropy', metrics: ['accuracy'] });
    const t = Date.now();
    await model.fit(tf.tensor4d(xs, [X.length, 28, 28, 1]), tf.tensor1d(ys), {
      epochs: 6, batchSize: 128, validationSplit: 0.1,
      callbacks: { onEpochEnd: (e, l) => console.log(`epoch ${e + 1}: val_acc ${l.val_acc.toFixed(4)} (${(Date.now() - t) / 1000 | 0}s)`) },
    });

    let art;
    await model.save(tf.io.withSaveHandler(async a => { art = a; return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } }; }));
    return { topology: art.modelTopology, specs: art.weightSpecs, weights: Array.from(new Uint8Array(art.weightData)) };
  }, mine);

  fs.mkdirSync(path.join(__dirname, 'model'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'model/weights.bin'), Buffer.from(res.weights));
  fs.writeFileSync(path.join(__dirname, 'model/model.json'), JSON.stringify({
    format: 'layers-model', generatedBy: 'train.js', modelTopology: res.topology,
    weightsManifest: [{ paths: ['weights.bin'], weights: res.specs }],
  }));
  console.log('saved model/');
  await browser.close(); server.close();
})();
