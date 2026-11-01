/**
 * Spelling help for search: "chocken" → "chicken", "biriyani" → "biryani". Each word of the search is
 * matched against the words customers can actually find nearby (dish, shop and category names), so a
 * suggestion always leads somewhere.
 */

/** Edits between two words, counting a swap of neighbours ("chikcen") as one. */
function distance(a: string, b: string) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[a.length]![b.length]!;
}

/** How many mistakes a word of this length may hold and still be recognised. */
const allowed = (length: number) => (length <= 3 ? 0 : length <= 5 ? 1 : length <= 9 ? 2 : 3);

/** Lower-case words of three letters or more, from any number of names. */
export function wordsOf(names: string[]) {
  const words = new Set<string>();
  for (const name of names) {
    for (const word of name.toLowerCase().split(/[^a-z]+/)) if (word.length >= 3) words.add(word);
  }
  return words;
}

/**
 * The search with each unknown word replaced by its closest known word, or null when nothing is close
 * enough or nothing would change.
 */
export function suggestSpelling(term: string, known: Set<string>): string | null {
  const parts = term.toLowerCase().trim().split(/\s+/).filter(Boolean);
  let changed = false;
  const fixed = parts.map((part) => {
    if (known.has(part) || part.length < 4 || !/^[a-z]+$/.test(part)) return part;
    let best: string | null = null;
    let bestScore = Infinity;
    for (const word of known) {
      if (Math.abs(word.length - part.length) > allowed(part.length)) continue;
      const score = distance(part, word);
      // Ties go to the word that starts the same way, which is usually what was meant.
      if (score < bestScore || (score === bestScore && best && word[0] === part[0] && best[0] !== part[0])) {
        best = word;
        bestScore = score;
      }
    }
    if (best && bestScore <= allowed(part.length)) {
      changed = true;
      return best;
    }
    return part;
  });
  return changed ? fixed.join(' ') : null;
}
