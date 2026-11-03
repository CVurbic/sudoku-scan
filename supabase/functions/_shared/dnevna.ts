// Dnevna križaljka "Na današnji dan": what happened on the date (the Croatian Wikipedia's page for it, then the English
// one's "On this day"), and Claude writes ~30 terms from it: { tema, uvod, pojmovi: [{ slova, trag, rijeci? }] }.
// Tried in notes/probe-pojmova/dnevna.ts (3. 11., four rounds): ~85 % good, 65–115 s, ~1–1.5 ¢ a day.
import Anthropic from "npm:@anthropic-ai/sdk";
import { CELL, type Pojam, tells } from "./pojmovi.ts";

const client = new Anthropic();
const UA = { "User-Agent": "SudokuScan/1.0 (https://cvurbic.github.io/sudoku-scan/)" };   // Wikimedia wants a contact
const MJ = ["siječnja", "veljače", "ožujka", "travnja", "svibnja", "lipnja", "srpnja", "kolovoza", "rujna", "listopada", "studenoga", "prosinca"];
// Croatian days that may carry the crossword (fixed dates only; Uskrs, Tijelovo and fašnik move).
const HR_DANI: Record<string, string> = {
  "01-01": "Nova godina", "01-06": "Sveta tri kralja", "02-14": "Valentinovo", "05-01": "Praznik rada", "05-30": "Dan državnosti",
  "06-22": "Dan antifašističke borbe", "08-05": "Dan pobjede i domovinske zahvalnosti", "08-15": "Velika Gospa", "11-01": "Svi sveti",
  "11-11": "Martinje", "12-06": "Sveti Nikola", "12-13": "Sveta Lucija", "12-24": "Badnjak", "12-25": "Božić", "12-26": "Sveti Stjepan", "12-31": "Stara godina",
};

const SYSTEM = `You write the word list for a Croatian daily crossword called "Na današnji dan". Everyone in Croatia plays the same one today. You get today's date, maybe a Croatian holiday or custom, and a numbered list of what happened on this date: first the Croatian Wikipedia's lines (marked "hr", in Croatian), then the English Wikipedia's (events, births, deaths, holidays).

Give 30 to 36 terms, ordered from the easiest (known to most people in Croatia) to the hardest. Fewer good terms are better than 36 with unknown ones.

What to take:
- A big day is only the Croatian holiday or custom given above, or a world event that everyone knows by its date (the Moon landing, the fall of the Berlin Wall). A saint's day or holiday from the list is not a big day by itself; it is one line like the others. If there is a big day, take every real term about it (its customs, food, drink, symbols, songs, people, places), usually 8 to 15, and the rest from the list. Never pad it with general words (church, candle, bell, month, holiday, saint, a name day).
- Otherwise take a mix from the whole list: events, inventions, works, people born or died today, holidays.
- Every person, place and thing must be one an ordinary adult in Croatia has heard of: Croatian and regional history and people (the "hr" lines first), famous world events, famous scientists, artists, writers, athletes. Leave out people known only in their own country or field (an Irish TV host, an American baseball player, a Dutch DJ, a young footballer); a Croatian person goes in only if Croatian schools or media still talk about them.
- Neutral history (a treaty, a battle, an election) is fine. Leave out terrorism, massacres, disasters with many dead, executions, murders, slaughter of animals and today's party politics (court cases, campaigns); no dictator or war criminal is an answer: the crossword is for fun.
- Every term except the big day's customs comes from one numbered line. The answer is a name or word that line is about, and the clue says only what that line and common knowledge say. Do not add facts you are not sure of.

For each term:
- "slova": the answer split into crossword cells, uppercase. LJ, NJ and DŽ are one cell only when they are one Croatian letter (KNJIGA → K, NJ, I, G, A); in foreign names and where they are two letters they are two cells (BENJAMIN → B, E, N, J, A, M, I, N; INJEKCIJA → I, N, J, E, K, C, I, J, A). Letters Q, W, X, Y are allowed. 2 to 12 cells, no spaces, hyphens or digits. Always the nominative (DRENJULA, not DRENJULU). A person is usually their surname (CLINTON), a place its name (BERLIN). An original name keeps its letters, with foreign accents dropped as crosswords do (MOLIÈRE → MOLIERE, WAŁĘSA → WALESA, never a transcription like VALESA); Croatian letters stay (ČAJKOVSKI).
- "rijeci": how many cells each word has. Almost always one word: [its length]. Two or three words only for a title of a work or a fixed name that has no one-word form (TIHA NOĆ → slova T, I, H, A, N, O, Ć and rijeci [4, 3]; STARI MOST → [5, 4]; NOVI ZELAND), at most three such terms. Never a person's full name (BROWN, not JAMES BROWN; KARLO, not KARLO VELIKI) and never a name Croatian writes as one word (HONGKONG → [8]). Never glue words without saying so here.
- "trag": the clue, at most 90 characters, in standard Croatian. It defines exactly the answer (for LONDON: the city where a treaty was signed, not the treaty) and puts it on today's date with its year when it has one ("Pas koji je 1957. prvi kružio oko Zemlje", "Skladatelj rođen 1756."; "na današnji dan" when needed, never "ovaj dan"), so the player learns what happened today. It never contains the answer, any of its words, or a word from the same root.

Names as they are used in Croatia: the Croatian form where Croatian has an established one (PARIZ, BEČ, KOLUMBO, KOPERNIK, MOSKVA, LONDON), otherwise the original spelling (CLINTON, SHAKESPEARE, BEATLES, CHAPLIN, WASHINGTON). Croatian words follow Hrvatski pravopis (not Serbian or English forms).

Before you answer, check every term: is it spelled right letter by letter, is it the form people in Croatia use, is the clue true, grammatical and about exactly this term and today's date, would most players have heard of it? Leave out every term that fails or that you are not sure of. No two terms with the same answer.
"tema": a short title for today, in Croatian ("Martinje", or for a mixed day the most interesting event, e.g. "Lajka u svemiru").
"uvod": one short sentence for the card, in Croatian. On a big day it is about that day; otherwise it starts "Na današnji dan" and names the most interesting event with its year, preferably a Croatian one.`;

const FORMAT = { type: "json_schema", schema: {
  type: "object", additionalProperties: false, required: ["tema", "uvod", "pojmovi"],
  properties: {
    tema: { type: "string" }, uvod: { type: "string" },
    pojmovi: { type: "array", items: { type: "object", additionalProperties: false, required: ["slova", "rijeci", "trag"],
      properties: { slova: { type: "array", items: { type: "string" } }, rijeci: { type: "array", items: { type: "integer" } }, trag: { type: "string" } } } },
  },
} } as const;

type Item = { text: string; year?: number };
// What happened on mm-dd: the Croatian page's bullet lines (labelled by section, markup stripped), then the English "On this day".
async function lines(m: number, d: number) {
  const hr = await fetch(`https://hr.wikipedia.org/w/api.php?action=parse&page=${d}._${MJ[m - 1]}&prop=wikitext&format=json&formatversion=2`, { headers: UA })
    .then((r) => r.json()).catch(() => ({}));
  let sec = "";
  const own = String(hr.parse?.wikitext ?? "").split("\n").flatMap((l) => {
    if (l.startsWith("==")) { sec = /Rođenj/.test(l) ? "rođen" : /Smrt/.test(l) ? "umro" : /Blagdan|Spomendan|Praznic/.test(l) ? "blagdan" : "događaj"; return []; }
    if (!l.startsWith("*")) return [];
    const t = l.replace(/^\*+\s*/, "").replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1").replace(/'{2,}/g, "").replace(/<[^>]+>/g, "").trim();
    return t ? [`hr ${sec}: ${t}`] : [];
  });
  const mm = String(m).padStart(2, "0"), dd = String(d).padStart(2, "0");
  const en = await fetch(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/all/${mm}/${dd}`, { headers: UA })
    .then((r) => r.json() as Promise<Record<string, Item[]>>).catch(() => ({} as Record<string, Item[]>));
  const take = (k: string, n: number, label: string) => (en[k] ?? []).slice(0, n).map((e) => `${label} ${e.year ?? ""}: ${e.text}`.replace(/ :/, ":"));
  // selected = Wikipedia's own picks; births and deaths are long, so the newest few only
  return [...new Set([...own, ...take("selected", 40, "event"), ...take("events", 60, "event"), ...take("holidays", 20, "holiday"), ...take("births", 15, "born"), ...take("deaths", 10, "died")])];
}

// The crossword for a date ("2026-12-25"), or a message in "greska".
export async function dnevna(datum: string, model: string) {
  const [, m, d] = datum.split("-").map(Number), day = HR_DANI[datum.slice(5)];
  const list = await lines(m, d);
  if (list.length < 20) return { greska: "Wikipedija nije dala dovoljno događaja." };
  let msg;
  try {
    msg = await client.messages.stream({
      model, max_tokens: 32000, output_config: { effort: "high", format: FORMAT }, system: SYSTEM,
      messages: [{ role: "user", content: `Datum: ${d}. ${MJ[m - 1]}${day ? `\nHrvatski blagdan ili običaj: ${day}` : ""}\n\n` + list.map((l, i) => `${i + 1}. ${l}`).join("\n") }],
    }).finalMessage();
  } catch (e) {
    console.error(e);
    return { greska: "Generator ne radi." };
  }
  const text = msg.content.find((b) => b.type === "text");
  if (msg.stop_reason !== "end_turn" || !text || text.type !== "text") return { greska: "Generator nije stigao do kraja: " + msg.stop_reason };
  const out = JSON.parse(text.text) as { tema: string; uvod: string; pojmovi: (Pojam & { rijeci: number[] })[] };

  // Keep clean terms: valid cells, 2–12, words that add up, no repeats, a clue without the answer or one of its words
  const seen = new Set<string>();
  const pojmovi = out.pojmovi.flatMap(({ slova, rijeci, trag }) => {
    const w = slova.join(""), multi = rijeci.length > 1 && rijeci.length <= 3 && rijeci.every((n) => n > 0) && rijeci.reduce((a, n) => a + n, 0) === slova.length;
    const words = multi ? rijeci.map((n, i) => slova.slice(rijeci.slice(0, i).reduce((a, x) => a + x, 0), rijeci.slice(0, i).reduce((a, x) => a + x, 0) + n).join("")) : [];
    if (slova.length < 2 || slova.length > 12 || !slova.every((c) => CELL.test(c)) || seen.has(w) || tells(trag, w) || words.some((x) => x.length > 2 && tells(trag, x))) return [];
    if (rijeci.length > 1 && !multi) return [];   // words that do not add up: the answer is not sure
    seen.add(w);
    return [multi ? { slova, trag, rijeci } : { slova, trag }];
  });
  if (pojmovi.length < 15) return { greska: `Premalo pojmova (${pojmovi.length}).` };
  return { tema: out.tema, uvod: out.uvod, pojmovi, usage: msg.usage };
}
