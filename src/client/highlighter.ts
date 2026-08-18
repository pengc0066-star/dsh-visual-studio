/**
 * Minimal HTML/SVG syntax highlighter for the Studio code editor. It is a pure
 * string -> string function (no DOM, no React), so it is unit-testable. It
 * tokenizes comments, tags, tag names, attribute names, and string values, and
 * wraps each token in a span whose class the CSS Module colors.
 * @module @deepseek-ai/dsh-visual-studio/client/highlighter
 */

/** CSS class emitted for one token kind (styled by the editor's CSS module). */
export const TOKEN_CLASS = {
  comment: 'vs-tok-comment',
  tag: 'vs-tok-tag',
  attr: 'vs-tok-attr',
  string: 'vs-tok-string',
  punct: 'vs-tok-punct',
} as const

/** Escape HTML special characters for safe interpolation into highlighted markup. */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Segment splitter: comments and tags are matched whole; the gaps are text. */
const SEGMENT = /(<!--[\s\S]*?-->)|(<![^>]*>)|(<[^>]+>)/g

/**
 * Highlight the interior of one tag (`<div a="b">`, `</div>`, `<path/>`).
 * Tag names, attribute names (identifier immediately before `=`), string
 * values, and the `<`, `</`, `>`, `/>` delimiters each get a span; everything
 * else stays plain escaped text.
 * @param tag - one matched `<...>` segment.
 * @returns the highlighted tag markup.
 */
function highlightTag(tag: string): string {
  const re = /(<\/?)|([A-Za-z_:][\w:.-]*)(?=\s*=\s*)|([A-Za-z][\w:.-]*)|(\/?>)|("[^"]*"|'[^']*')/g
  let out = ''
  let last = 0
  let match: RegExpExecArray | null
  re.lastIndex = 0
  while ((match = re.exec(tag)) !== null) {
    if (match.index > last) out += escapeHtml(tag.slice(last, match.index))
    const [whole, open, attr, name, close, str] = match
    if (open !== undefined) out += `<span class="${TOKEN_CLASS.punct}">${escapeHtml(open)}</span>`
    else if (attr !== undefined) out += `<span class="${TOKEN_CLASS.attr}">${escapeHtml(attr)}</span>`
    else if (name !== undefined) out += `<span class="${TOKEN_CLASS.tag}">${escapeHtml(name)}</span>`
    else if (close !== undefined) out += `<span class="${TOKEN_CLASS.punct}">${escapeHtml(close)}</span>`
    else if (str !== undefined) out += `<span class="${TOKEN_CLASS.string}">${escapeHtml(str)}</span>`
    last = match.index + whole.length
  }
  if (last < tag.length) out += escapeHtml(tag.slice(last))
  return out
}

/**
 * Highlight HTML/SVG source for display in the editor overlay. The output is
 * escaped HTML safe to set through `dangerouslySetInnerHTML`.
 * @param source - raw HTML/SVG text.
 * @returns the highlighted, escaped markup.
 */
export function highlightHtml(source: string): string {
  let out = ''
  let last = 0
  let match: RegExpExecArray | null
  SEGMENT.lastIndex = 0
  while ((match = SEGMENT.exec(source)) !== null) {
    if (match.index > last) out += escapeHtml(source.slice(last, match.index))
    const [whole, comment, prolog, tag] = match
    if (comment !== undefined || prolog !== undefined) {
      out += `<span class="${TOKEN_CLASS.comment}">${escapeHtml(whole)}</span>`
    } else if (tag !== undefined) {
      out += highlightTag(tag)
    }
    last = match.index + whole.length
  }
  if (last < source.length) out += escapeHtml(source.slice(last))
  return out
}
