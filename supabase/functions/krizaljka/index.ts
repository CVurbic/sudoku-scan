// Moja križaljka: POST { tema } → { tema, pojmovi: [{ slova: ['K','NJ',…], trag }] }; POST { tema, savjeti: true } → its hints; GET → every topic,
// most played first: [{ kljuc, tema, broj, igrano }] (no terms, so the list stays small).
// Each topic is asked once and kept in sudokuscan.krizaljke, which also caps new topics per day.
// Every topic is public (Chris, 2. 11.: no filter; a bad one is deleted by hand in the dashboard).
// Dnevna (sudokuscan.dnevne): GET ?dan=2026-12-25 → { tema, uvod, pojmovi, sutra } (today ±1 in Zagreb only);
// POST { dnevna: true } → one step for today … today+3, the earliest first: a missing day is made (~100 s of the 150 s a call
// may run), a made one without hints gets them (~55 s). pg_cron calls it every hour. Anyone may call it: it only ever adds
// what is missing, and claims a day before making it.
// Secrets: ANTHROPIC_API_KEY (dashboard); SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come with every function.
// Deploy: npx supabase functions deploy krizaljka --project-ref fgllmnemukhouwyebfop --no-verify-jwt
import { type Pojam, pojmovi, savjeti } from "../_shared/pojmovi.ts";
import { dnevna } from "../_shared/dnevna.ts";

const MODEL = "claude-haiku-5-5";
const DAY_CAP = 100;   // new topics per day for everyone together (a topic already asked costs nothing)
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DB = Deno.env.get("SUPABASE_URL") + "/rest/v1/", KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = (q: string, o: RequestInit = {}) => fetch(DB + q, { ...o, headers: {
  apikey: KEY, Authorization: "Bearer " + KEY, "Accept-Profile": "sudokuscan", "Content-Profile": "sudokuscan",
  "Content-Type": "application/json", ...o.headers } });

const zagreb = (plus: number) => new Date(Date.now() + plus * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Zagreb" });   // "2026-12-25"

// A missing day is claimed with an empty row (so two calls at once do not both pay), made, written; its hints come the next call.
// ponytail: two calls at once on the same hints both pay for them, as with a topic's.
async function slozi() {
  await db("dnevne?pojmovi=is.null&stvoreno=lt." + new Date(Date.now() - 300e3).toISOString(), { method: "DELETE" });   // a claim left by a run that died
  const got = await db("dnevne?select=datum,pojmovi&order=datum&datum=gte." + zagreb(0));
  if (!got.ok) return { greska: "baza " + got.status };
  const rows = await got.json() as { datum: string; pojmovi: Pojam[] | null }[], days = [0, 1, 2, 3].map(zagreb);
  const day = days.find((d) => !rows.some((r) => r.datum === d));
  const bare = rows.find((r) => days.includes(r.datum) && r.pojmovi?.some((p) => !("trag2" in p)));
  if (bare && (!day || bare.datum < day)) {
    const h = await savjeti("događaji na dan " + bare.datum, bare.pojmovi!, MODEL);
    if ("greska" in h) return { datum: bare.datum, greska: h.greska };
    const put = await db("dnevne?datum=eq." + bare.datum, { method: "PATCH", body: JSON.stringify({ pojmovi: bare.pojmovi!.map((p, i) => ({ ...p, trag2: h.savjeti[i] })) }) });
    return put.ok ? { datum: bare.datum, savjeti: true } : { datum: bare.datum, greska: "baza " + put.status };
  }
  if (!day) return { gotovo: true };
  const claim = await db("dnevne", { method: "POST", body: JSON.stringify({ datum: day }), headers: { Prefer: "resolution=ignore-duplicates,return=representation" } });
  if (!claim.ok || !(await claim.json()).length) return { zauzeto: day };
  const res = await dnevna(day, MODEL);
  if ("greska" in res) {
    await db("dnevne?datum=eq." + day, { method: "DELETE" });
    return { datum: day, greska: res.greska };
  }
  const put = await db("dnevne?datum=eq." + day, { method: "PATCH", body: JSON.stringify({ tema: res.tema, uvod: res.uvod, pojmovi: res.pojmovi }) });
  return put.ok ? { datum: day, tema: res.tema, broj: res.pojmovi.length } : { datum: day, greska: "baza " + put.status };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const dan = new URL(req.url).searchParams.get("dan");
  if (req.method === "GET" && dan) {   // the daily, and tomorrow's title (the card says what comes next)
    if (![-1, 0, 1].map(zagreb).includes(dan)) return reply({ greska: "Taj dan nije dostupan." }, 400);
    const next = new Date(new Date(dan + "T12:00Z").getTime() + 864e5).toISOString().slice(0, 10);
    const got = await db(`dnevne?select=datum,tema,uvod,pojmovi&pojmovi=not.is.null&datum=in.(${dan},${next})`);
    if (!got.ok) return reply({ greska: "Baza trenutno ne radi." }, 502);
    const rows = await got.json() as { datum: string; tema: string; uvod: string; pojmovi: Pojam[] }[], today = rows.find((r) => r.datum === dan);
    if (!today) return reply({ greska: "Današnja još nije složena." }, 404);
    return reply({ tema: today.tema, uvod: today.uvod, pojmovi: today.pojmovi, sutra: rows.find((r) => r.datum === next)?.tema ?? null });
  }
  if (req.method === "GET") {
    // ponytail: the whole list in one go, a search on the server once there are thousands of topics
    const all = await db("krizaljke?select=kljuc,tema,broj,igrano&order=igrano.desc,stvoreno.desc&limit=2000");
    return all.ok ? reply(await all.json()) : reply({ greska: "Baza trenutno ne radi." }, 502);
  }
  if (req.method !== "POST") return reply({ greska: "GET ili POST" }, 405);
  const body = await req.json().catch(() => ({}));
  if (body.dnevna) return reply(await slozi());
  const raw = String(body.tema ?? "").trim().replace(/\s+/g, " ");
  if (raw.length < 2 || raw.length > 60) return reply({ greska: "Tema treba imati 2 do 60 znakova." }, 400);
  const key = raw.toLowerCase();

  const got = await db("krizaljke?select=tema,pojmovi&kljuc=eq." + encodeURIComponent(key));
  if (!got.ok) { console.error("baza", got.status, await got.text()); return reply({ greska: "Baza trenutno ne radi." }, 502); }
  const kept = await got.json();
  // POST { tema, savjeti: true } → { savjeti: [trag2 per term, "" where none] }: written once per topic (~55 s), then kept with its terms.
  // ponytail: two first askers at once both pay for them; the second write just repeats the first.
  if (body.savjeti) {
    if (!kept[0]) return reply({ greska: "Nema te teme." }, 404);
    const terms: Pojam[] = kept[0].pojmovi;
    if (terms.every((p) => "trag2" in p)) return reply({ savjeti: terms.map((p) => p.trag2) });
    const h = await savjeti(kept[0].tema, terms, MODEL);
    if ("greska" in h) return reply({ greska: h.greska }, h.status);
    const withHints = terms.map((p, i) => ({ ...p, trag2: h.savjeti[i] }));
    const put = await db("krizaljke?kljuc=eq." + encodeURIComponent(key), { method: "PATCH", body: JSON.stringify({ pojmovi: withHints }) });
    if (!put.ok) console.error("savjeti", put.status, await put.text());   // the player still gets them now
    return reply({ savjeti: h.savjeti });
  }
  if (kept[0]) {   // a device takes a topic once (it keeps it), so this counts players
    await fetch(Deno.env.get("SUPABASE_URL") + "/rest/v1/rpc/krizaljka_igrano", { method: "POST", body: JSON.stringify({ k: key }),
      headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Profile": "sudokuscan", "Content-Type": "application/json" } });
    return reply(kept[0]);
  }
  const today = new Date().toISOString().slice(0, 10);
  const cnt = await db("krizaljke?select=kljuc&stvoreno=gte." + today, { method: "HEAD", headers: { Prefer: "count=exact" } });
  const n = +(cnt.headers.get("content-range")?.split("/")[1] ?? DAY_CAP);
  if (n >= DAY_CAP) return reply({ greska: "Danas je stvoreno previše novih tema. Probaj sutra ili odaberi neku već postojeću." }, 429);

  const res = await pojmovi(raw, MODEL);
  if ("greska" in res) return reply({ greska: res.greska }, res.status);
  if (res.pojmovi.length < 12) return reply({ greska: "Za tu temu nema dovoljno pojmova. Probaj širu temu." }, 422);

  const row = { kljuc: key, tema: res.tema, pojmovi: res.pojmovi };
  await db("krizaljke", { method: "POST", body: JSON.stringify(row), headers: { Prefer: "resolution=ignore-duplicates" } });
  return reply({ tema: row.tema, pojmovi: row.pojmovi });
});
