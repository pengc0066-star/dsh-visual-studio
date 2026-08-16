/**
 * Pure, browser-safe helpers for the Visual HTML/SVG Studio: the annotation
 * message formatter and the wire types shared between the plugin apply face
 * and the presentation component. No React, no DOM — everything here is
 * unit-testable by feeding plain data.
 * @module @deepseek-ai/dsh-visual-studio/client/studio
 */

/** Element facts the sandboxed preview inspector reports for one click. */
export interface InspectPayload {
  /** Lowercase element tag name, e.g. `div` or `svg`. */
  tag: string
  /** Breadcrumb path, e.g. `html > body > div#app > button`. */
  path: string
  /** A stable CSS selector for this element. */
  selector: string
  /** The element's `outerHTML`, truncated to a bounded length. */
  html: string
  /** Trimmed `textContent`, truncated to a bounded length. */
  text: string
  /** Selected computed styles the agent may need to reproduce the look. */
  styles: Record<string, string>
  /** Element bounding box in preview-relative coordinates. */
  rect: { x: number; y: number; width: number; height: number }
}

/** Lifecycle state of one submitted annotation. */
export type AnnotationStatus = 'pending' | 'processed'

/** One user annotation over an inspected element or page coordinate. */
export interface Annotation {
  /** Stable client-generated id. */
  id: string
  /** Absolute path of the source file the annotation addresses. */
  filePath: string
  /** The inspected element's stable selector (empty for page-coordinate notes). */
  selector: string
  /** The inspected element facts at submission time. */
  payload: InspectPayload | null
  /** The user's own note. */
  note: string
  /** Whether the agent has since addressed the note. */
  status: AnnotationStatus
  /** Epoch milliseconds of submission. */
  createdAt: number
}

/** Bound file/annotation callbacks the plugin apply face injects into the panel. */
export interface StudioInjected {
  /** List every HTML/SVG file under a workspace root. */
  listFiles(root: string): Promise<string[]>
  /** Read one workspace file's text. */
  readFile(root: string, path: string): Promise<string>
  /** Write one workspace file, keeping a backup of the prior content. */
  writeFile(root: string, path: string, content: string): Promise<{ backup?: string }>
  /** Create one empty workspace file (refuses to overwrite). */
  createFile(root: string, path: string): Promise<string>
  /** Send the annotation text to the current agent session as a user message. */
  submitAnnotation(sessionId: string, text: string): Promise<boolean>
}

/** Maximum characters kept of an element's outerHTML in an annotation. */
const MAX_HTML = 2000
/** Maximum characters kept of an element's text content in an annotation. */
const MAX_TEXT = 500

/**
 * Bound an arbitrary string for a lossless annotation payload.
 * @param value - the string to bound.
 * @param max - maximum characters.
 * @returns the string, truncated with a marker when it exceeded `max`.
 */
export function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

/** Render one computed-style entry as `key: value`. */
function styleLine(entry: [string, string]): string {
  return `${entry[0]}: ${entry[1]}`
}

/**
 * Format an annotation into the message text the agent session receives.
 * @param filePath - absolute path of the source file.
 * @param payload - inspected element facts, or `null` for a page-coordinate note.
 * @param note - the user's own annotation text.
 * @returns the plain-text message submitted as a user prompt.
 */
export function formatAnnotationMessage(filePath: string, payload: InspectPayload | null, note: string): string {
  const lines = [
    '[Visual HTML/SVG Studio 批注]',
    `文件: ${filePath}`,
  ]
  if (payload !== null) {
    lines.push(
      `Selector: ${payload.selector}`,
      `元素路径: ${payload.path}`,
      `元素 HTML/SVG: ${truncate(payload.html, MAX_HTML)}`,
      `元素文本: ${truncate(payload.text, MAX_TEXT)}`,
      `位置尺寸: x=${payload.rect.x} y=${payload.rect.y} width=${payload.rect.width} height=${payload.rect.height}`,
      `Computed styles: ${Object.entries(payload.styles).map(styleLine).join('; ') || '(none)'}`,
    )
  }
  lines.push(`批注: ${note}`)
  return lines.join('\n')
}
