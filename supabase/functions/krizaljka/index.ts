// Moja križaljka: POST { tema } → { tema, pojmovi: [{ slova: ['K','NJ',…], trag }] }.
// Each topic is asked once and kept in sudokuscan.krizaljke, which also caps new topics per day.
// Secrets: ANTHROPIC_API_KEY (dashboard); SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come with every function.
// Deploy: npx supabase functions deploy krizaljka --project-ref fgllmnemukhouwyebfop --no-verify-jwt
import { pojmovi } from "../_shared/pojmovi.ts";

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
  if (req.method !== "POST") return reply({ greska: "POST" }, 405);
  const raw = String((await req.json().catch(() => ({}))).tema ?? "").trim().replace(/\s+/g, " ");
  if (raw.length < 2 || raw.length > 60) return reply({ greska: "Tema treba imati 2 do 60 znakova." }, 400);
  const key = raw.toLowerCase();

  const got = await db("?select=tema,pojmovi&kljuc=eq." + encodeURIComponent(key));
  if (!got.ok) { console.error("baza", got.status, await got.text()); return reply({ greska: "Baza trenutno ne radi." }, 502); }
  const kept = await got.json();
  if (kept[0]) return reply(kept[0]);
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
