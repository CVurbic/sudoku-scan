// Moja križaljka: POST { tema } → { tema, pojmovi: [{ slova: ['K','NJ',…], trag }] }; POST { tema, savjeti: true } → its hints; GET → every topic,
// most played first: [{ kljuc, tema, broj, igrano }] (no terms, so the list stays small).
// Each topic is asked once and kept in sudokuscan.krizaljke, which also caps new topics per day.
// Every topic is public (Chris, 2. 11.: no filter; a bad one is deleted by hand in the dashboard).
// Secrets: ANTHROPIC_API_KEY (dashboard); SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come with every function.
// Deploy: npx supabase functions deploy krizaljka --project-ref fgllmnemukhouwyebfop --no-verify-jwt
import { type Pojam, pojmovi, savjeti } from "../_shared/pojmovi.ts";

const MODEL = "claude-haiku-5-5";
const DAY_CAP = 100;   // new topics per day for everyone together (a topic already asked costs nothing)
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DB = Deno.env.get("SUPABASE_URL") + "/rest/v1/krizaljke", KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = (q: string, o: RequestInit = {}) => fetch(DB + q, { ...o, headers: {
  apikey: KEY, Authorization: "Bearer " + KEY, "Accept-Profile": "sudokuscan", "Content-Profile": "sudokuscan",
  "Content-Type": "application/json", ...o.headers } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method === "GET") {
    // ponytail: the whole list in one go, a search on the server once there are thousands of topics
    const all = await db("?select=kljuc,tema,broj,igrano&order=igrano.desc,stvoreno.desc&limit=2000");
    return all.ok ? reply(await all.json()) : reply({ greska: "Baza trenutno ne radi." }, 502);
  }
  if (req.method !== "POST") return reply({ greska: "GET ili POST" }, 405);
  const body = await req.json().catch(() => ({}));
  const raw = String(body.tema ?? "").trim().replace(/\s+/g, " ");
  if (raw.length < 2 || raw.length > 60) return reply({ greska: "Tema treba imati 2 do 60 znakova." }, 400);
  const key = raw.toLowerCase();

  const got = await db("?select=tema,pojmovi&kljuc=eq." + encodeURIComponent(key));
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
    const put = await db("?kljuc=eq." + encodeURIComponent(key), { method: "PATCH", body: JSON.stringify({ pojmovi: withHints }) });
    if (!put.ok) console.error("savjeti", put.status, await put.text());   // the player still gets them now
    return reply({ savjeti: h.savjeti });
  }
  if (kept[0]) {   // a device takes a topic once (it keeps it), so this counts players
    await fetch(Deno.env.get("SUPABASE_URL") + "/rest/v1/rpc/krizaljka_igrano", { method: "POST", body: JSON.stringify({ k: key }),
      headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Profile": "sudokuscan", "Content-Type": "application/json" } });
    return reply(kept[0]);
  }
  const today = new Date().toISOString().slice(0, 10);
  const cnt = await db("?select=kljuc&stvoreno=gte." + today, { method: "HEAD", headers: { Prefer: "count=exact" } });
  const n = +(cnt.headers.get("content-range")?.split("/")[1] ?? DAY_CAP);
  if (n >= DAY_CAP) return reply({ greska: "Danas je stvoreno previše novih tema. Probaj sutra ili odaberi neku već postojeću." }, 429);

  const res = await pojmovi(raw, MODEL);
  if ("greska" in res) return reply({ greska: res.greska }, res.status);
  if (res.pojmovi.length < 12) return reply({ greska: "Za tu temu nema dovoljno pojmova. Probaj širu temu." }, 422);

  const row = { kljuc: key, tema: res.tema, pojmovi: res.pojmovi };
  await db("", { method: "POST", body: JSON.stringify(row), headers: { Prefer: "resolution=ignore-duplicates" } });
  return reply({ tema: row.tema, pojmovi: row.pojmovi });
});
