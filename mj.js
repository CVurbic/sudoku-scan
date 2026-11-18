// --- Mahjong: take the tiles off in pairs of the same face (any two flowers, any two seasons). A tile can
// go when nothing lies on it and its left or its right side is open. One a day (144 on an upright pyramid,
// 8 × 10, 4 layers), the same for everyone; Nova igra: Brzi (72) or Kornjača (144). Every deal is made
// backwards (pairs taken off a full board, both picked while free), so the order they came off in is a solution.
// A spot: [hx, hy, z] on a half grid (a tile is 2 × 2), so the half steps (the turtle's head) stay whole.
// Everything here starts with mj: the game files share one global scope. ---
const mjRect = (c0, c1, r0, r1, z) => { const out = []; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push([c * 2, r * 2, z]); return out; };
// A layout with each spot's neighbours worked out once: up (on it, one layer higher), l and r (beside it).
function mjLay(pos) {
  const side = d => pos.map(t => pos.flatMap((u, j) => u[2] === t[2] && u[0] === t[0] + d && Math.abs(u[1] - t[1]) < 2 ? [j] : []));
  return { pos, l: side(-2), r: side(2),
    up: pos.map(t => pos.flatMap((u, j) => u[2] === t[2] + 1 && Math.abs(u[0] - t[0]) < 2 && Math.abs(u[1] - t[1]) < 2 ? [j] : [])) };
}
const MJ = {
  daily: mjLay([...mjRect(0, 7, 0, 9, 0).filter(([x, y]) => !((x === 0 || x === 14) && (y === 0 || y === 18))),   // 76
    ...mjRect(1, 6, 1, 8, 1), ...mjRect(2, 5, 3, 6, 2), ...mjRect(3, 4, 4, 5, 3)]),                                  // 48, 16, 4
  quick: mjLay([...mjRect(0, 5, 0, 7, 0), ...mjRect(1, 4, 1.5, 5.5, 1), ...mjRect(2, 3, 3, 4, 2)]),                  // 48, 20, 4
  turtle: mjLay([...[[1, 12], [3, 10], [2, 11], [1, 12], [1, 12], [2, 11], [3, 10], [1, 12]].flatMap(([a, b], r) => mjRect(a, b, r, r, 0)),
    [0, 7, 0], [26, 7, 0], [28, 7, 0],                                                                               // the head, the tail
    ...mjRect(4, 9, 1, 6, 1), ...mjRect(5, 8, 2, 5, 2), ...mjRect(6, 7, 3, 4, 3), [13, 7, 4]]),
};
// Faces: d circles, b bamboo, c characters (1–9), w winds (E S W N), r dragons (red, green, white), f flowers, s seasons.
const MJ_KINDS = [...'dbc'].flatMap(s => [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => s + n)).concat('w0', 'w1', 'w2', 'w3', 'r0', 'r1', 'r2');
const MJ_BONUS = ['f0', 'f1', 'f2', 'f3', 's0', 's1', 's2', 's3'];
const mjFour = ks => ks.flatMap(k => [k, k, k, k]).concat(MJ_BONUS);
const MJ_SET = { daily: mjFour(MJ_KINDS), turtle: mjFour(MJ_KINDS),
  quick: mjFour([...'dbc'].flatMap(s => [1, 2, 3, 4].map(n => s + n)).concat('r0', 'r1', 'r2', 'w0')) };   // whole fours, 72
const mjGrp = f => 'fs'.includes(f[0]) ? f[0] : f;
const mjFree = (L, live, i) => live[i] && !L.up[i].some(j => live[j]) && !(L.l[i].some(j => live[j]) && L.r[i].some(j => live[j]));
const mjFrees = (L, live) => L.pos.flatMap((_, i) => mjFree(L, live, i) ? [i] : []);
// Why tile i can't go: the tiles on it, or (none on it) the ones closing it on both sides.
const mjWhy = (L, live, i) => { const up = L.up[i].filter(j => live[j]); return up.length ? up : [...L.l[i], ...L.r[i]].filter(j => live[j]); };
// The free pairs that match (0 = stuck).
const mjPairs = (L, face, live) => { const fr = mjFrees(L, live); return fr.flatMap((i, k) => fr.slice(k + 1).filter(j => mjGrp(face[i]) === mjGrp(face[j])).map(j => [i, j])); };

// The faces as pairs that match, in a random order.
function mjPairUp(faces, r) {
  const by = {};
  faces.forEach(f => (by[mjGrp(f)] ||= []).push(f));
  return shuffle(Object.values(by).flatMap(g => { shuffle(g, r); return g.flatMap((f, k) => k % 2 ? [] : [[f, g[k + 1]]]); }), r);
}
// One free spot, the higher layers a little likelier (fewer like faces piled in one column: less "solvable, but stuck").
const mjPick = (L, fr, r) => { let s = r() * fr.reduce((s, i) => s + 1 + L.pos[i][2], 0); return fr.find(i => (s -= 1 + L.pos[i][2]) < 0) ?? fr[fr.length - 1]; };
// Deal faces onto the spots at, backwards: take two free spots at once, give them a pair, take them off. A dead
// end (under two free) starts again, 50 times at most. → { face (per spot of L), path: the pairs, first move first } or null.
function mjDeal(L, at, faces, r) {
  for (let k = 0; k < 50; k++) {
    const live = L.pos.map(() => false), face = L.pos.map(() => null), path = [], pairs = mjPairUp(faces, r);
    at.forEach(i => live[i] = true);
    for (const [a, b] of pairs) {
      const fr = at.filter(i => mjFree(L, live, i));
      if (fr.length < 2) break;
      const i = mjPick(L, fr, r), j = mjPick(L, fr.filter(x => x !== i), r);
      face[i] = a; face[j] = b; live[i] = live[j] = false;
      path.push([i, j]);   // taken off a full board: the order is a game
    }
    if (path.length === pairs.length) return { face, path };
  }
  return null;
}
// A new board of layout lay ('daily', 'quick', 'turtle'); the daily's seed is 'mj#' + its date.
const mjMake = (lay, seed) => mjDeal(MJ[lay], MJ[lay].pos.map((_, i) => i), MJ_SET[lay], rng(hash(seed)));
// Promiješaj: the tiles left dealt anew onto the spots left (the removed keep their faces, for Poništi). Not
// always possible (two tiles stacked, one column left): null, and the button goes out.
function mjShuffle(L, face, live, seed) {
  const at = L.pos.flatMap((_, i) => live[i] ? [i] : []), d = mjDeal(L, at, at.map(i => face[i]), rng(hash(seed)));
  return d && { face: face.map((f, i) => live[i] ? d.face[i] : f), path: d.path };
}
// Savjet: the first pair of the deal's way still on the board and free; off that way (another copy taken), the
// free pair that frees the most tiles; none: null.
function mjHint(L, face, live, path) {
  const p = path.find(([i, j]) => mjFree(L, live, i) && mjFree(L, live, j));
  if (p) return p;
  const n = l => mjFrees(L, l).length;
  return mjPairs(L, face, live).map(([i, j]) => { const l = [...live]; l[i] = l[j] = false; return [n(l), i, j]; })
    .sort((a, b) => b[0] - a[0])[0]?.slice(1) ?? null;
}
