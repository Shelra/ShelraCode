/**
 * Requirement extraction from a request, for the completion gate's requirement audit.
 *
 * The hard tasks a mid-tier model fails are the ones whose prompt states five to eight
 * behaviors in prose; the model implements the ones its own tests happen to cover, sees green,
 * and reports done. The gate uses this list to demand one real check per stated behavior
 * instead of "some verification ran". Deterministic and conservative: only sentences that read
 * as obligations, quoted verbatim, never the model's paraphrase.
 *
 * English and Spanish: the owner works in Spanish, and until the audit of 2026-09-23 a Spanish
 * request that named four behaviors extracted no requirement at all.
 */

const OBLIGATION_RE =
  /\b(must|should|has to|have to|needs? to|never|always|only|reject|preserve|return|support|default|throw|treat|allow|stop|record|validate|expose|accept|include|ensure|keep|implement|complete|migrate)\b|(?:^|[\s(¿¡])(debe|deben|deber[ií]a|deber[ií]an|tiene que|tienen que|hay que|nunca|siempre|s[oó]lo|[uú]nicamente|rechaza|rechazar|devuelve|devolver|retorna|retornar|conserva|conservar|preserva|preservar|mant[eé]n|mantiene|mantener|valida|validar|admite|admitir|soporta|soportar|acepta|aceptar|incluye|incluir|aseg[uú]rate|asegura|asegurar|implementa|implementar|elimina|eliminar|quita|quitar|reemplaza|reemplazar|convierte|convertir|ignora|ignorar|lanza|lanzar|registra|registrar|expone|exponer|trata|tratar|permite|permitir|detiene|detener|completa|completar|migra|migrar)(?=$|[\s,.;:!?)])/iu;
/** Sentences that tell the agent how to work, not what the code must do. */
const PROCESS_RE =
  /^(run|do not modify|don't modify|please run|then run|use the|make sure to run|ejecuta|corre|no modifiques|no cambies|no toques|usa el|usa la|aseg[uú]rate de ejecutar|luego ejecuta)\b/iu;
/** A request that lists a whole feature set has as many requirements as items (seen live 2026-09-25: 30 and more). */
const MAX_REQUIREMENTS = 40;
/** A statement longer than this is split at its commas and semicolons, not dropped. */
const MAX_LENGTH = 400;
const CHUNK_LENGTH = 300;
/** A markdown list item: "- x", "* x", "• x", "1. x", "2) x". */
const LIST_ITEM_RE = /^\s*(?:[-*•+]|\d{1,2}[.)])\s+(\S.*)$/u;
/** The longest lead-in an item carries ("Include: Drifting"); a longer one is cut to its end. */
const LEAD_IN_LENGTH = 80;
/** Behavior separators inside one obligation sentence: "trim X, move Y, and preserve Z" / "quita X, mueve Y y conserva Z". */
const BEHAVIOR_SEPARATOR_RE = /,\s+(?:and\s+|y\s+|e\s+)?|;\s+/gu;
/** The last item of a list joined without a comma: "…, move Y and preserve Z" / "…, mueve Y y conserva Z". */
const LAST_ITEM_RE = /\s+(?:and|y|e)\s+/u;

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/gu, " ")
    .split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡`"'(])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

interface Statement {
  text: string;
  /** A list item: it states something wanted without an obligation word ("- Drifting"). */
  listed: boolean;
}

/**
 * A request's statements: its prose, sentence by sentence, and each list item joined to the line that introduces its
 * list ("Include:" and "- Drifting" read "Include: Drifting"). Seen live 2026-09-25: a racing game's request listed 30
 * features under "Include:"; with the line breaks collapsed they made one sentence over 400 characters, which was
 * dropped, and the audit never named them.
 */
function statements(prompt: string): Statement[] {
  const out: Statement[] = [];
  let prose: string[] = [];
  let leadIn: string | null = null;
  let inList = false;
  const flushProse = () => {
    for (const sentence of splitSentences(prose.join(" "))) out.push({ text: sentence, listed: false });
    prose = [];
  };
  for (const line of prompt.split(/\r?\n/u)) {
    const item = LIST_ITEM_RE.exec(line);
    if (item) {
      if (!inList) {
        flushProse();
        // The sentence right before a list that ends with a colon introduces it, and is said by its items.
        const last = out.at(-1);
        leadIn =
          last && !last.listed && last.text.endsWith(":") ? (out.pop() as Statement).text.slice(0, -1).trim() : null;
        if (leadIn && leadIn.length > LEAD_IN_LENGTH) leadIn = `…${leadIn.slice(-LEAD_IN_LENGTH).trim()}`;
        inList = true;
      }
      const text = (item[1] as string).trim();
      out.push({ text: leadIn ? `${leadIn}: ${text}` : text, listed: true });
    } else if (line.trim()) {
      inList = false;
      prose.push(line.trim());
    } else if (!inList) {
      flushProse();
    }
  }
  flushProse();
  return out;
}

/** A statement too long to read as one requirement, cut at its commas and semicolons into readable pieces. */
function pieces(text: string): string[] {
  if (text.length <= MAX_LENGTH) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const part of text.split(/(?<=[,;])\s+/u)) {
    if (current && current.length + part.length + 1 > CHUNK_LENGTH) {
      chunks.push(current);
      current = part;
    } else current = current ? `${current} ${part}` : part;
  }
  if (current) chunks.push(current);
  return chunks.filter((chunk) => chunk.length <= MAX_LENGTH);
}

/**
 * Obligation-shaped sentences and listed items from the request, in order, capped and deduplicated. A list item needs
 * no obligation word: a request lists what it wants.
 */
export function extractRequirements(prompt: string): string[] {
  const seen = new Set<string>();
  const requirements: string[] = [];
  for (const statement of statements(prompt)) {
    const obligation = statement.listed || OBLIGATION_RE.test(statement.text);
    const own = statement.listed ? statement.text.slice(statement.text.lastIndexOf(": ") + 1).trim() : statement.text;
    if (!obligation || PROCESS_RE.test(own)) continue;
    for (const piece of pieces(statement.text)) {
      if (piece.length < (statement.listed ? 3 : 12)) continue;
      const key = piece.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      requirements.push(piece);
      if (requirements.length >= MAX_REQUIREMENTS) return requirements;
    }
  }
  return requirements;
}

/**
 * Rough count of distinct behaviors the requirements name. One sentence that enumerates six
 * behaviors with commas counts as six; the audit fires on this, not on the sentence count.
 */
export function countStatedBehaviors(requirements: readonly string[]): number {
  let total = 0;
  for (const requirement of requirements) {
    const parts = requirement.split(BEHAVIOR_SEPARATOR_RE).filter((part) => part.trim().split(" ").length >= 2);
    // In a list, the final pair is often joined only by "and"/"y": count it as two behaviors. Only the
    // first conjunction splits it ("…por un guion y quitar los guiones del principio y del final").
    const last = parts.length >= 2 ? (parts.at(-1) as string) : "";
    const joint = last.search(LAST_ITEM_RE);
    const lastPair = joint > 0 ? [last.slice(0, joint), last.slice(joint).replace(LAST_ITEM_RE, "")] : ([] as string[]);
    const splitsLastPair = lastPair.length === 2 && lastPair.every((part) => part.trim().split(" ").length >= 2);
    const count = parts.length + (splitsLastPair ? 1 : 0);
    total += Math.max(1, count);
  }
  return total;
}

/** True when the request names enough behaviors that one green run is weak evidence for all of them. */
export function isRequirementDense(prompt: string): boolean {
  return countStatedBehaviors(extractRequirements(prompt)) >= 3;
}
