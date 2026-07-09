/**
 * Lightweight, fully-offline codebase retrieval — a local-first alternative to
 * a neural-embedding RAG index. Files are ranked against a query with a BM25
 * scorer over tokenized content plus a filename/symbol boost, so the agent gets
 * the most relevant files/snippets in one call instead of blindly grepping.
 *
 * Pure functions only (no IO) so they are trivially testable; the caller feeds
 * in the already-read file contents.
 */

export interface IndexedFile {
  path: string;
  content: string;
}

export interface RankedFile {
  path: string;
  score: number;
  /** Best-matching snippet (a few lines around the densest match region). */
  snippet: string;
  /** 1-indexed line the snippet starts at. */
  snippetLine: number;
}

// Split identifiers into subtokens too: `getUserName` → get, user, name, plus
// the whole lowercased token. This makes camelCase/snake_case queries match.
const tokenize = (text: string): string[] => {
  const out: string[] = [];
  const words = text.match(/[A-Za-z_][A-Za-z0-9_]*|\d+/g) || [];
  for (const w of words) {
    const lower = w.toLowerCase();
    out.push(lower);
    // camelCase / PascalCase splits
    const camel = w.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    // snake_case splits
    const parts = camel.split(/[_\s]+/).filter(Boolean);
    if (parts.length > 1) {
      for (const p of parts) out.push(p.toLowerCase());
    }
  }
  return out;
};

const BM25_K1 = 1.5;
const BM25_B = 0.75;

/**
 * Rank files against a free-text query with BM25 + a filename/symbol boost.
 * Returns the top `limit` files, each with a representative snippet.
 */
export function rankFiles(files: IndexedFile[], query: string, limit = 10): RankedFile[] {
  const queryTerms = Array.from(new Set(tokenize(query)));
  if (queryTerms.length === 0 || files.length === 0) return [];

  // Document frequency per term.
  const docTokens: string[][] = files.map(f => tokenize(f.content));
  const docLengths = docTokens.map(t => t.length);
  const avgLen = docLengths.reduce((a, b) => a + b, 0) / Math.max(1, files.length);

  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    const seen = new Set(tokens);
    for (const term of queryTerms) {
      if (seen.has(term)) df.set(term, (df.get(term) || 0) + 1);
    }
  }

  const idf = (term: string): number => {
    const n = df.get(term) || 0;
    // BM25 idf with +1 to keep it positive.
    return Math.log(1 + (files.length - n + 0.5) / (n + 0.5));
  };

  const results: RankedFile[] = [];
  for (let i = 0; i < files.length; i += 1) {
    const tokens = docTokens[i];
    if (tokens.length === 0) continue;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const freq = tf.get(term) || 0;
      if (freq === 0) continue;
      const numerator = freq * (BM25_K1 + 1);
      const denominator = freq + BM25_K1 * (1 - BM25_B + BM25_B * (docLengths[i] / (avgLen || 1)));
      score += idf(term) * (numerator / denominator);
    }
    if (score <= 0) continue;

    // Filename / path boost: a query term appearing in the path is a strong signal.
    const pathLower = files[i].path.toLowerCase();
    let pathBoost = 0;
    for (const term of queryTerms) {
      if (pathLower.includes(term)) pathBoost += 2.5;
    }
    score += pathBoost;

    const { snippet, line } = bestSnippet(files[i].content, queryTerms);
    results.push({ path: files[i].path, score, snippet, snippetLine: line });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// Find the line window with the most query-term hits and return a few lines
// around it as a snippet.
function bestSnippet(content: string, queryTerms: string[]): { snippet: string; line: number } {
  const lines = content.split('\n');
  const termSet = new Set(queryTerms);
  const lineScores = lines.map(line => {
    const toks = tokenize(line);
    let s = 0;
    for (const t of toks) if (termSet.has(t)) s += 1;
    return s;
  });

  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < lines.length; i += 1) {
    // Small window sum to prefer dense regions.
    const windowScore = (lineScores[i - 1] || 0) + lineScores[i] * 2 + (lineScores[i + 1] || 0);
    if (windowScore > bestScore) {
      bestScore = windowScore;
      bestIdx = i;
    }
  }

  const from = Math.max(0, bestIdx - 2);
  const to = Math.min(lines.length - 1, bestIdx + 2);
  const snippet = lines
    .slice(from, to + 1)
    .map((l, idx) => `${String(from + idx + 1).padStart(5, ' ')}| ${l.slice(0, 200)}`)
    .join('\n');
  return { snippet, line: from + 1 };
}

/**
 * Find references to a symbol as whole-word matches across the indexed files.
 * Returns file:line hits with a little surrounding context. Deterministic and
 * offline — a reliable substitute for cross-file LSP "find references".
 */
export function findSymbolReferences(
  files: IndexedFile[],
  symbol: string,
  contextLines = 1,
  maxHits = 100
): string[] {
  const clean = symbol.trim();
  if (!clean) return [];
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`);
  const hits: string[] = [];
  for (const file of files) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      re.lastIndex = 0;
      if (re.test(lines[i])) {
        const from = Math.max(0, i - contextLines);
        const to = Math.min(lines.length - 1, i + contextLines);
        const block = [`${file.path}:${i + 1}:`];
        for (let ci = from; ci <= to; ci += 1) {
          const marker = ci === i ? '>' : ' ';
          block.push(`${marker} ${String(ci + 1).padStart(5, ' ')}| ${lines[ci].slice(0, 200)}`);
        }
        hits.push(block.join('\n'));
        if (hits.length >= maxHits) return hits;
      }
    }
  }
  return hits;
}
