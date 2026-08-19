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
  /** Artifact id (absolute path) the annotation addresses. */
  filePath: string
  /** Artifact version at submission time, when known. */
  version?: number
  /** The inspected element's stable selector (empty for page-coordinate notes). */
  selector: string
  /** The inspected element facts at submission time. */
  payload: InspectPayload | null
  /** Text selection facts, when the annotation is a text-selection note. */
  selection?: {
    startLine: number
    endLine: number
    startColumn: number
    endColumn: number
    startOffset: number
    endOffset: number
    text: string
  }
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
  /** Read one workspace file's bytes as base64 (for image preview). */
  readFileBytes(root: string, path: string): Promise<string>
  /** Write one workspace file, keeping a backup of the prior content. */
  writeFile(root: string, path: string, content: string): Promise<{ backup?: string }>
  /** Create one empty workspace file (refuses to overwrite). */
  createFile(root: string, path: string): Promise<string>
  /** Restore the most recent pre-overwrite backup over the file. */
  restorePrevious(root: string, path: string): Promise<{ restored: boolean }>
  /** Send the annotation text to the current agent session as a user message. */
  submitAnnotation(sessionId: string, text: string): Promise<boolean>
  /** List the current session's deliverable artifacts. */
  listArtifacts(sessionId: string): Promise<ArtifactRecord[]>
}

/** The deliverable kind of an artifact, driving the Studio's open behavior. */
export type ArtifactKind = 'html' | 'svg' | 'image' | 'text' | 'other'

/** One deliverable file the current session's agent produced (wire shape). */
export interface ArtifactRecord {
  path: string
  relativePath: string
  name: string
  kind: ArtifactKind
  version: number
  createdAt: number
  updatedAt: number
}

/** Optional annotation metadata: artifact version/kind and a location hint. */
export interface AnnotationMeta {
  version?: number
  kind?: ArtifactKind
  /** Human-readable location: selector, `x,y,w,h`, or `L3:C4-L7:C9`. */
  location?: string
  /** Selected text for a text-selection annotation. */
  selection?: string
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'])

/** Classify a file path into its deliverable kind (client-side, mirrors host). */
export function kindOfPath(path: string): ArtifactKind {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'svg') return 'svg'
  if (IMAGE_EXT.has(ext)) return 'image'
  return 'text'
}

/** MIME type for an image path, or `application/octet-stream`. */
export function imageMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
    gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp',
  }
  return map[ext] ?? 'application/octet-stream'
}

/** Normalize to `/` separators and return the workspace-relative path (or the path itself). */
export function relativePathOf(root: string | undefined, path: string): string {
  const normalized = path.replaceAll('\\', '/')
  if (root === undefined) return normalized
  const base = root.replaceAll('\\', '/').replace(/\/+$/, '')
  if (normalized === base) return ''
  if (normalized.startsWith(`${base}/`)) return normalized.slice(base.length + 1)
  return normalized
}

/** The Studio open-state snapshot shared between the entry button, bar, and panel. */
export interface StudioState {
  open: boolean
  /** A file queued to open once the panel mounts (set by the artifacts bar). */
  pendingFile: string | null
  /** The file currently open in the Studio (absolute path), for selected state. */
  currentPath: string | null
}

/**
 * Shared open-state source for the Studio panel, entry button, and artifacts
 * bar. It satisfies the renderer's `HostObservable` face (getSnapshot +
 * subscribe) while carrying the verbs the registrants call.
 */
export interface OpenController {
  getSnapshot(): StudioState
  subscribe(listener: () => void): () => void
  toggle(): void
  setOpen(open: boolean): void
  openFile(path: string): void
  setCurrentPath(path: string | null): void
  consumePendingFile(): string | null
}

/** The panel's inject face: the file/session callbacks plus close/state verbs. */
export interface StudioPanelFace extends StudioInjected {
  /** Hide the Studio panel. */
  close(): void
  /** Take (and clear) the file queued by the artifacts bar. */
  consumePendingFile(): string | null
  /** Publish the currently open path so the artifacts bar can mark it selected. */
  setCurrentPath(path: string | null): void
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
export function formatAnnotationMessage(
  filePath: string,
  payload: InspectPayload | null,
  note: string,
  meta: AnnotationMeta = {},
): string {
  const lines = [
    '[Visual HTML/SVG Studio 批注]',
    `文件: ${filePath}`,
  ]
  if (meta.version !== undefined) lines.push(`版本: v${meta.version}`)
  if (meta.kind !== undefined) lines.push(`类型: ${meta.kind}`)
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
  if (meta.location !== undefined) lines.push(`定位: ${meta.location}`)
  if (meta.selection !== undefined) lines.push(`选中文本: ${truncate(meta.selection, MAX_TEXT)}`)
  lines.push(`批注: ${note}`)
  return lines.join('\n')
}
