// Claude writes the terms for a topic: { tema, pojmovi: [{ slova: ['K','NJ',…], trag }] }, cleaned here.
import Anthropic from "npm:@anthropic-ai/sdk";

const CELL = /^(LJ|NJ|DŽ|[A-ZČĆŽŠĐ])$/;
const client = new Anthropic();   // ANTHROPIC_API_KEY from the function's secrets
const SYSTEM = `You write the word list for a Croatian crossword on a topic the user picks. Give about 40 terms that belong to this topic specifically, the ones someone who wants to know the topic should know, from easy to harder. Prefer the topic's own names and terms (for dinosaurs: the dinosaurs, their periods and features) over general words that merely relate to it.

For each term:
- "slova": the answer split into crossword cells, uppercase. LJ, NJ and DŽ are one cell when they are one Croatian letter (KNJIGA → K, NJ, I, G, A), two cells when they are two letters (INJEKCIJA → I, N, J, E, K, C, I, J, A). 2 to 12 cells, one word, no spaces, hyphens or digits. Abbreviations are fine when Croatian uses them (PDV, OIB, KPR, not CPR). A term that is two words goes in only if one word carries it (VELIKI PRASAK: no; PRASAK alone is not the term).
- "trag": the clue, at most 90 characters, in standard Croatian (not Serbian or English words). It teaches: it explains the term so that someone who did not know the word learns it by solving. It never contains the answer or a word from the same root.

Every answer is a real Croatian word or name as written in Croatian, and every clue is factually correct; leave out anything you are not sure of. Use the nominative singular unless the term is normally plural. No two terms with the same answer.
If the topic is empty, makes no sense, or is not something to learn about, return an empty "pojmovi".
"tema" is the topic as a short title in Croatian (for example "Knjigovodstvo").`;
const FORMAT = { type: "json_schema", schema: {
  type: "object", additionalProperties: false, required: ["tema", "pojmovi"],
  properties: {
    tema: { type: "string" },
    pojmovi: { type: "array", items: { type: "object", additionalProperties: false, required: ["slova", "trag"],
      properties: { slova: { type: "array", items: { type: "string" } }, trag: { type: "string" } } } },
  },
} } as const;

export type Pojam = { slova: string[]; trag: string };

// Returns the cleaned terms, or a message for the user in "greska" (status beside it).
export async function pojmovi(tema: string, model: string, effort: "low" | "medium" = "medium") {
  let msg;
  try {
    msg = await client.messages.create({
      model,
      max_tokens: 16000,
      output_config: { effort, format: FORMAT },
      system: SYSTEM,
      messages: [{ role: "user", content: "Tema: " + tema }],
    });
  } catch (e) {
    console.error(e);
    return { greska: "Generator trenutno ne radi. Probaj malo kasnije.", status: 502 };
  }
  if (msg.stop_reason === "refusal") return { greska: "Ta tema ne može.", status: 422 };
  const text = msg.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return { greska: "Generator nije vratio pojmove.", status: 502 };
  const out = JSON.parse(text.text) as { tema: string; pojmovi: Pojam[] };

  // Keep only clean terms: valid cells, 2–12 of them, no repeats, a clue without the answer in it
  const seen = new Set<string>();
  const clean = out.pojmovi.filter(({ slova, trag }) => {
    const w = slova.join("");
    if (slova.length < 2 || slova.length > 12 || !slova.every((c) => CELL.test(c)) || seen.has(w)) return false;
    // the answer as a clue word, or starting one (REP may stand in REPTIL; DINOSAUR may not in DINOSAURA)
    if (!trag.trim() || trag.toUpperCase().split(/[^A-ZČĆŽŠĐ]+/).some((x) => x === w || (w.length > 3 && x.startsWith(w)))) return false;
    seen.add(w);
    return true;
  });
  return { tema: out.tema || tema, pojmovi: clean, usage: msg.usage, poslano: out.pojmovi.length };
}
