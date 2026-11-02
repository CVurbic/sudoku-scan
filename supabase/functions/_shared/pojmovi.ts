// Claude writes the terms for a topic: { tema, pojmovi: [{ slova: ['K','NJ',…], trag }] }, cleaned here.
import Anthropic from "npm:@anthropic-ai/sdk";

const CELL = /^(LJ|NJ|DŽ|[A-ZČĆŽŠĐ])$/;
const client = new Anthropic();   // ANTHROPIC_API_KEY from the function's secrets
export const SYSTEM = `You write the word list for a Croatian crossword on a topic the user picks. Give about 40 terms, the ones someone who wants to know this topic should know, from easy to harder.

The terms belong to this topic specifically. At least three quarters are the topic's own names and terms: the people, characters, works, places, species, events, parts and technical words that someone outside the topic would not use. For a book, film, series, game or genre, that means its titles, characters, places, creatures and authors. A general word (a sword, an egg, a bird) goes in only when it is central to the topic, and then its clue says how it belongs to the topic.

For each term:
- "slova": the answer split into crossword cells, uppercase. LJ, NJ and DŽ are one cell when they are one Croatian letter (KNJIGA → K, NJ, I, G, A), two cells when they are two letters (INJEKCIJA → I, N, J, E, K, C, I, J, A). 2 to 12 cells, one word, no spaces, hyphens or digits. Abbreviations are fine when Croatian uses them (PDV, OIB, KPR, not CPR). A term that is two words goes in only if one word carries it (VELIKI PRASAK: no; PRASAK alone is not the term).
- "trag": the clue, at most 90 characters, in standard Croatian. It teaches: it explains the term so that someone who did not know the word learns it by solving. It defines exactly this word, not a neighbouring idea (CARSTVO is ruled by an emperor, not a king). It never contains the answer or a word from the same root.

Write every answer as the Croatian standard (Hrvatski pravopis) writes it: Croatian words where Croatian has them, not Serbian or English ones (PUSTOLOV, not AVANTURISTA; KOSTUR, not SKELET), and names and Latin terms in their Croatian spelling (DIPLODOKUS, not DIPLODOCUS). Foreign names that Croatian keeps as they are (a character or a place from a foreign work) stay as written in the original, in Latin letters.

Before you answer, check every term: is it spelled right letter by letter, is it really used in Croatian, is the clue true and about exactly this word, does it belong to the topic? Leave out every term that fails or that you are not sure of. Use the nominative singular unless the term is normally plural. No two terms with the same answer.
If the topic is empty, makes no sense, or is not something to learn about, return an empty "pojmovi".
"tema" is the topic as a short title in Croatian (for example "Knjigovodstvo").`;
export const FORMAT = { type: "json_schema", schema: {
  type: "object", additionalProperties: false, required: ["tema", "pojmovi"],
  properties: {
    tema: { type: "string" },
    pojmovi: { type: "array", items: { type: "object", additionalProperties: false, required: ["slova", "trag"],
      properties: { slova: { type: "array", items: { type: "string" } }, trag: { type: "string" } } } },
  },
} } as const;

export type Pojam = { slova: string[]; trag: string };

// Returns the cleaned terms, or a message for the user in "greska" (status beside it).
// Haiku 5.5 at high effort (Chris, 2. 11.: the fewest general words, a tenth of Sonnet's price): 55–70 s,
// up to ~15k tokens with its thinking, so a stream with room above 16k (the function may run 150 s).
export async function pojmovi(tema: string, model: string, effort: "low" | "medium" | "high" = "high", system = SYSTEM) {
  let msg;
  try {
    msg = await client.messages.stream({
      model,
      max_tokens: 24000,
      output_config: { effort, format: FORMAT },
      system,
      messages: [{ role: "user", content: "Tema: " + tema }],
    }).finalMessage();
  } catch (e) {
    console.error(e);
    return { greska: "Generator trenutno ne radi. Probaj malo kasnije.", status: 502 };
  }
  if (msg.stop_reason === "refusal") return { greska: "Ta tema ne može.", status: 422 };
  if (msg.stop_reason === "max_tokens") return { greska: "Generator nije stigao do kraja. Probaj ponovo.", status: 502 };   // cut-off JSON
  const text = msg.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return { greska: "Generator nije vratio pojmove.", status: 502 };
  const out = JSON.parse(text.text) as { tema: string; pojmovi: Pojam[] };

  // Keep only clean terms: valid cells, 2–12 of them, no repeats, a clue without the answer in it
  const seen = new Set<string>();
  // The model sometimes puts a whole word in one cell (["SJEME"]); split it again.
  // ponytail: LJ/NJ/DŽ read as one letter there, so INJEKCIJA in one cell would get NJ; the model splits most words itself.
  const split = (c: string) => CELL.test(c) ? [c] : c.toUpperCase().match(/LJ|NJ|DŽ|./gu) ?? [];
  const clean = out.pojmovi.map((p) => ({ ...p, slova: p.slova.flatMap(split) })).filter(({ slova, trag }) => {
    const w = slova.join("");
    if (slova.length < 2 || slova.length > 12 || !slova.every((c) => CELL.test(c)) || seen.has(w)) return false;
    // the answer as a clue word, or starting one (REP may stand in REPTIL; DINOSAUR may not in DINOSAURA)
    if (!trag.trim() || trag.toUpperCase().split(/[^A-ZČĆŽŠĐ]+/).some((x) => x === w || (w.length > 3 && x.startsWith(w)))) return false;
    seen.add(w);
    return true;
  });
  return { tema: out.tema || tema, pojmovi: clean, usage: msg.usage, poslano: out.pojmovi.length };
}
