/**
 * Robust string-replacement engine for the AI `replaceInFile` tool.
 *
 * Models frequently emit a `search` string whose whitespace, indentation, or
 * escaping does not byte-for-byte match the file. A naive exact-match edit
 * fails, the model retries, and loop iterations are wasted — the single biggest
 * source of poor edit quality. This module ports OpenCode's cascading replacer
 * strategy: a series of increasingly fuzzy matchers is tried in order until one
 * produces a span that actually exists in the file, with guards against
 * matching a disproportionately large region.
 *
 * Ported from opencode `packages/opencode/src/tool/edit.ts`.
 */

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>

// Similarity thresholds for block-anchor fallback matching.
const SINGLE_CANDIDATE_SIMILARITY_THRESHOLD = 0.65
const MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD = 0.65

function levenshtein(a: string, b: string): number {
  if (a === '' || b === '') {
    return Math.max(a.length, b.length)
  }
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[a.length][b.length]
}

const SimpleReplacer: Replacer = function* (_content, find) {
  yield find
}

const LineTrimmedReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n')
  const searchLines = find.split('\n')

  if (searchLines[searchLines.length - 1] === '') {
    searchLines.pop()
  }

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true
    for (let j = 0; j < searchLines.length; j++) {
      if (originalLines[i + j].trim() !== searchLines[j].trim()) {
        matches = false
        break
      }
    }
    if (matches) {
      let matchStartIndex = 0
      for (let k = 0; k < i; k++) {
        matchStartIndex += originalLines[k].length + 1
      }
      let matchEndIndex = matchStartIndex
      for (let k = 0; k < searchLines.length; k++) {
        matchEndIndex += originalLines[i + k].length
        if (k < searchLines.length - 1) {
          matchEndIndex += 1
        }
      }
      yield content.substring(matchStartIndex, matchEndIndex)
    }
  }
}

const BlockAnchorReplacer: Replacer = function* (content, find) {
  const originalLines = content.split('\n')
  const searchLines = find.split('\n')

  if (searchLines.length < 3) {
    return
  }
  if (searchLines[searchLines.length - 1] === '') {
    searchLines.pop()
  }

  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length
  const maxLineDelta = Math.max(1, Math.floor(searchBlockSize * 0.25))

  const candidates: Array<{ startLine: number; endLine: number }> = []
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) {
      continue
    }
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        const actualBlockSize = j - i + 1
        if (Math.abs(actualBlockSize - searchBlockSize) <= maxLineDelta) {
          candidates.push({ startLine: i, endLine: j })
        }
        break
      }
    }
  }

  if (candidates.length === 0) {
    return
  }

  const spanFor = (startLine: number, endLine: number) => {
    let matchStartIndex = 0
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += originalLines[k].length + 1
    }
    let matchEndIndex = matchStartIndex
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k].length
      if (k < endLine) {
        matchEndIndex += 1
      }
    }
    return content.substring(matchStartIndex, matchEndIndex)
  }

  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0]
    const actualBlockSize = endLine - startLine + 1
    let similarity = 0
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2)
    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) continue
        const distance = levenshtein(originalLine, searchLine)
        similarity += (1 - distance / maxLen) / linesToCheck
        if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) break
      }
    } else {
      similarity = 1.0
    }
    if (similarity >= SINGLE_CANDIDATE_SIMILARITY_THRESHOLD) {
      yield spanFor(startLine, endLine)
    }
    return
  }

  let bestMatch: { startLine: number; endLine: number } | null = null
  let maxSimilarity = -1
  for (const candidate of candidates) {
    const { startLine, endLine } = candidate
    const actualBlockSize = endLine - startLine + 1
    let similarity = 0
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2)
    if (linesToCheck > 0) {
      for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
        const originalLine = originalLines[startLine + j].trim()
        const searchLine = searchLines[j].trim()
        const maxLen = Math.max(originalLine.length, searchLine.length)
        if (maxLen === 0) continue
        const distance = levenshtein(originalLine, searchLine)
        similarity += 1 - distance / maxLen
      }
      similarity /= linesToCheck
    } else {
      similarity = 1.0
    }
    if (similarity > maxSimilarity) {
      maxSimilarity = similarity
      bestMatch = candidate
    }
  }

  if (maxSimilarity >= MULTIPLE_CANDIDATES_SIMILARITY_THRESHOLD && bestMatch) {
    yield spanFor(bestMatch.startLine, bestMatch.endLine)
  }
}

const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
  const normalizeWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim()
  const normalizedFind = normalizeWhitespace(find)

  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (normalizeWhitespace(line) === normalizedFind) {
      yield line
    } else {
      const normalizedLine = normalizeWhitespace(line)
      if (normalizedLine.includes(normalizedFind)) {
        const words = find.trim().split(/\s+/)
        if (words.length > 0) {
          const pattern = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
          try {
            const regex = new RegExp(pattern)
            const match = line.match(regex)
            if (match) {
              yield match[0]
            }
          } catch {
            /* invalid regex, skip */
          }
        }
      }
    }
  }

  const findLines = find.split('\n')
  if (findLines.length > 1) {
    for (let i = 0; i <= lines.length - findLines.length; i++) {
      const block = lines.slice(i, i + findLines.length)
      if (normalizeWhitespace(block.join('\n')) === normalizedFind) {
        yield block.join('\n')
      }
    }
  }
}

const IndentationFlexibleReplacer: Replacer = function* (content, find) {
  const removeIndentation = (text: string) => {
    const lines = text.split('\n')
    const nonEmptyLines = lines.filter(line => line.trim().length > 0)
    if (nonEmptyLines.length === 0) return text
    const minIndent = Math.min(
      ...nonEmptyLines.map(line => {
        const match = line.match(/^(\s*)/)
        return match ? match[1].length : 0
      })
    )
    return lines.map(line => (line.trim().length === 0 ? line : line.slice(minIndent))).join('\n')
  }

  const normalizedFind = removeIndentation(find)
  const contentLines = content.split('\n')
  const findLines = find.split('\n')

  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join('\n')
    if (removeIndentation(block) === normalizedFind) {
      yield block
    }
  }
}

const EscapeNormalizedReplacer: Replacer = function* (content, find) {
  const unescapeString = (str: string): string =>
    str.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (match, capturedChar) => {
      switch (capturedChar) {
        case 'n':
          return '\n'
        case 't':
          return '\t'
        case 'r':
          return '\r'
        case "'":
          return "'"
        case '"':
          return '"'
        case '`':
          return '`'
        case '\\':
          return '\\'
        case '\n':
          return '\n'
        case '$':
          return '$'
        default:
          return match
      }
    })

  const unescapedFind = unescapeString(find)
  if (content.includes(unescapedFind)) {
    yield unescapedFind
  }

  const lines = content.split('\n')
  const findLines = unescapedFind.split('\n')
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join('\n')
    if (unescapeString(block) === unescapedFind) {
      yield block
    }
  }
}

const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
  const trimmedFind = find.trim()
  if (trimmedFind === find) {
    return
  }
  if (content.includes(trimmedFind)) {
    yield trimmedFind
  }
  const lines = content.split('\n')
  const findLines = find.split('\n')
  for (let i = 0; i <= lines.length - findLines.length; i++) {
    const block = lines.slice(i, i + findLines.length).join('\n')
    if (block.trim() === trimmedFind) {
      yield block
    }
  }
}

const ContextAwareReplacer: Replacer = function* (content, find) {
  const findLines = find.split('\n')
  if (findLines.length < 3) {
    return
  }
  if (findLines[findLines.length - 1] === '') {
    findLines.pop()
  }

  const contentLines = content.split('\n')
  const firstLine = findLines[0].trim()
  const lastLine = findLines[findLines.length - 1].trim()

  for (let i = 0; i < contentLines.length; i++) {
    if (contentLines[i].trim() !== firstLine) continue
    for (let j = i + 2; j < contentLines.length; j++) {
      if (contentLines[j].trim() === lastLine) {
        const blockLines = contentLines.slice(i, j + 1)
        const block = blockLines.join('\n')
        if (blockLines.length === findLines.length) {
          let matchingLines = 0
          let totalNonEmptyLines = 0
          for (let k = 1; k < blockLines.length - 1; k++) {
            const blockLine = blockLines[k].trim()
            const findLine = findLines[k].trim()
            if (blockLine.length > 0 || findLine.length > 0) {
              totalNonEmptyLines++
              if (blockLine === findLine) {
                matchingLines++
              }
            }
          }
          if (totalNonEmptyLines === 0 || matchingLines / totalNonEmptyLines >= 0.5) {
            yield block
            break
          }
        }
        break
      }
    }
  }
}

const MultiOccurrenceReplacer: Replacer = function* (content, find) {
  let startIndex = 0
  while (true) {
    const index = content.indexOf(find, startIndex)
    if (index === -1) break
    yield find
    startIndex = index + find.length
  }
}

function isDisproportionateMatch(search: string, oldString: string): boolean {
  const oldLines = oldString.split('\n').length
  const searchLines = search.split('\n').length
  if (searchLines >= Math.max(oldLines + 3, oldLines * 2)) return true
  if (oldLines === 1) return false
  return search.trim().length > Math.max(oldString.trim().length + 500, oldString.trim().length * 4)
}

export interface ReplaceOutcome {
  ok: boolean
  content?: string
  replacements?: number
  /** Which strategy matched, for diagnostics/telemetry. */
  strategy?: string
  /** Present when ok is false. */
  error?: string
}

const REPLACERS: Array<[string, Replacer]> = [
  ['exact', SimpleReplacer],
  ['line-trimmed', LineTrimmedReplacer],
  ['block-anchor', BlockAnchorReplacer],
  ['whitespace-normalized', WhitespaceNormalizedReplacer],
  ['indentation-flexible', IndentationFlexibleReplacer],
  ['escape-normalized', EscapeNormalizedReplacer],
  ['trimmed-boundary', TrimmedBoundaryReplacer],
  ['context-aware', ContextAwareReplacer],
  ['multi-occurrence', MultiOccurrenceReplacer]
]

/**
 * Apply a robust replacement. Tries exact match first, then cascades through
 * fuzzy strategies. Returns the updated content, or a descriptive error the
 * agent loop can feed back to the model.
 */
export function robustReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false
): ReplaceOutcome {
  if (oldString === newString) {
    return { ok: false, error: 'search and replace text are identical - no change would occur.' }
  }
  if (oldString === '') {
    return { ok: false, error: 'search text cannot be empty when editing an existing file.' }
  }

  let notFound = true

  for (const [strategy, replacer] of REPLACERS) {
    for (const search of replacer(content, oldString)) {
      const index = content.indexOf(search)
      if (index === -1) continue
      notFound = false
      if (isDisproportionateMatch(search, oldString)) {
        return {
          ok: false,
          error:
            'Refusing replacement because the matched region is much larger than the search text. Re-read the file and provide the full exact search text for the intended change.'
        }
      }
      if (replaceAll) {
        const count = content.split(search).length - 1
        return { ok: true, content: content.split(search).join(newString), replacements: count, strategy }
      }
      const lastIndex = content.lastIndexOf(search)
      // Match must be unique for a single (non-replaceAll) replacement.
      if (index !== lastIndex) continue
      return {
        ok: true,
        content: content.substring(0, index) + newString + content.substring(index + search.length),
        replacements: 1,
        strategy
      }
    }
  }

  if (notFound) {
    return {
      ok: false,
      error:
        'Search text not found. It must match the file content — re-read the file with readFile to see the current text, then retry with the exact search string (including surrounding lines to make it unique).'
    }
  }
  return {
    ok: false,
    error:
      'Found multiple matches for the search text. Provide more surrounding context to identify a single unique location, or set allOccurrences to replace every match.'
  }
}
