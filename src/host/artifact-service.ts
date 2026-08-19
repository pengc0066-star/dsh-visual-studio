/**
 * Host-side session-artifact registry for the Visual HTML/SVG Studio. The node
 * half feeds it from the `fs/observed` event (emitted by the `write` and
 * `edit` tools), merging repeated writes to one path into a single artifact
 * whose version increments. Excluded dependency/cache/build/test/hidden paths
 * are never recorded.
 * @module @deepseek-ai/dsh-visual-studio/host/artifact-service
 */

import { basename, extname } from 'node:path'

/** The deliverable kind of one artifact, driving the Studio's open behavior. */
export type ArtifactKind = 'html' | 'svg' | 'image' | 'text' | 'other'

/** One deliverable file the current session's agent created or modified. */
export interface ArtifactRecord {
  /** Absolute display path. */
  path: string
  /** File name (display). */
  name: string
  /** Deliverable kind. */
  kind: ArtifactKind
  /** Monotonically increasing revision for this path. */
  version: number
  /** Epoch ms of first observation. */
  createdAt: number
  /** Epoch ms of most recent observation. */
  updatedAt: number
}

/** Path segments that are never deliverable (dependencies, caches, build output). */
const EXCLUDED_SEGMENTS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'coverage', 'out',
  '.next', '.cache', '__pycache__', 'vendor', '.venv', 'target', 'tmp', '.dsh',
])

/** Files that are test/fixture or minimized build output. */
const EXCLUDED_FILE = /\.(test|spec|min)\.[a-z0-9]+$/i

/** File kinds by extension. */
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'])
const TEXT_EXT = new Set([
  '.md', '.txt', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.yml', '.yaml',
  '.toml', '.xml', '.csv', '.log', '.env', '.py', '.sh', '.go', '.rs', '.java',
  '.c', '.h', '.cpp', '.hpp', '.sql', '.rb', '.php',
])

/** Split an absolute path into slash-normalized segments. */
function segments(path: string): string[] {
  return path.replaceAll('\\', '/').split('/')
}

/**
 * Whether a path should be excluded from the artifact registry.
 * @param path - absolute display path.
 * @returns true for dependency/cache/build/test/hidden paths.
 */
export function isExcludedPath(path: string): boolean {
  const parts = segments(path)
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') continue
    if (part.startsWith('.')) return true // hidden file or directory
    if (EXCLUDED_SEGMENTS.has(part)) return true
  }
  const name = parts[parts.length - 1] ?? ''
  return EXCLUDED_FILE.test(name)
}

/** Classify a file path into its deliverable kind. */
export function classifyKind(path: string): ArtifactKind {
  const ext = extname(path).toLowerCase()
  if (ext === '.html' || ext === '.htm') return 'html'
  if (ext === '.svg') return 'svg'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (TEXT_EXT.has(ext) || ext === '') return 'text'
  return 'other'
}

/** In-memory per-session artifact registry. */
export class ArtifactRegistry {
  private readonly bySession = new Map<string, Map<string, ArtifactRecord>>()

  /**
   * Record one observed write/edit for a session path, merging or creating.
   * @param sessionId - the agent session id that touched the file.
   * @param path - absolute display path.
   * @param at - observation time (epoch ms).
   */
  observe(sessionId: string, path: string, at = Date.now()): void {
    if (sessionId === '' || path === '' || isExcludedPath(path)) return
    let session = this.bySession.get(sessionId)
    if (session === undefined) {
      session = new Map()
      this.bySession.set(sessionId, session)
    }
    const existing = session.get(path)
    if (existing !== undefined) {
      existing.version += 1
      existing.updatedAt = at
      return
    }
    session.set(path, {
      path,
      name: basename(path),
      kind: classifyKind(path),
      version: 1,
      createdAt: at,
      updatedAt: at,
    })
  }

  /**
   * List one session's artifacts, newest first.
   * @param sessionId - the agent session id.
   * @returns artifact records.
   */
  list(sessionId: string): ArtifactRecord[] {
    const session = this.bySession.get(sessionId)
    if (session === undefined) return []
    return [...session.values()].sort((left, right) => right.updatedAt - left.updatedAt)
  }
}
