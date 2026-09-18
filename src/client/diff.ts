/**
 * Line-based diff for the Studio's before/after comparison view. A plain
 * longest-common-subsequence walk over lines — no dependency, no DOM — so the
 * unit tests feed two strings and assert the unified line stream directly.
 * @module @deepseek-ai/dsh-visual-studio/client/diff
 */

/** One line of a unified diff. */
export interface DiffLine {
  /** Whether the line is unchanged, added, or removed. */
  type: 'context' | 'add' | 'remove'
  /** 1-based line number in the before text; `null` for added lines. */
  before: number | null
  /** 1-based line number in the after text; `null` for removed lines. */
  after: number | null
  text: string
}

/**
 * Compute a line-based diff between two text contents.
 * @param before - the older content.
 * @param after - the newer content.
 * @returns unified diff lines in document order.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)
  const n = a.length
  const m = b.length
  const width = m + 1

  // Flat LCS length table; every index is pre-filled, so the `!` access below
  // is within the loop bounds.
  const table = new Array<number>((n + 1) * width).fill(0)
  const get = (i: number, j: number): number => table[i * width + j]!
  const set = (i: number, j: number, value: number): void => { table[i * width + j] = value }

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      set(i, j, a[i] === b[j]
        ? get(i + 1, j + 1) + 1
        : Math.max(get(i + 1, j), get(i, j + 1)))
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', before: i + 1, after: j + 1, text: a[i]! })
      i++
      j++
    } else if (get(i + 1, j) >= get(i, j + 1)) {
      out.push({ type: 'remove', before: i + 1, after: null, text: a[i]! })
      i++
    } else {
      out.push({ type: 'add', before: null, after: j + 1, text: b[j]! })
      j++
    }
  }
  while (i < n) {
    out.push({ type: 'remove', before: i + 1, after: null, text: a[i]! })
    i++
  }
  while (j < m) {
    out.push({ type: 'add', before: null, after: j + 1, text: b[j]! })
    j++
  }
  return out
}

/** Split into lines, dropping the single trailing empty line a trailing newline produces. */
function splitLines(text: string): string[] {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}
