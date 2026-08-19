/**
 * Host-side workspace file service for the Visual HTML/SVG Studio.
 *
 * The node half of this package registers a `/visual-studio` Connection RPC
 * channel (loopback authority) whose endpoints list/read/write/create HTML and
 * SVG files strictly inside one workspace root. Writes keep a timestamped
 * sibling backup before overwriting, so a bad save is recoverable. Every
 * function is a plain module export so the unit tests exercise the exact code
 * the RPC handler runs.
 * @module @deepseek-ai/dsh-visual-studio/host/file-service
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ArtifactRegistry } from './artifact-service.ts'

/** File extensions the Studio opens and edits. */
const SOURCE_EXTENSIONS = new Set(['.html', '.htm', '.svg'])

/** Maximum files a single list walk returns (a runaway workspace stays bounded). */
const MAX_LIST_FILES = 5000

/** Maximum directory depth the recursive list walks. */
const MAX_LIST_DEPTH = 24

/** Name fragment distinguishing a pre-overwrite backup from the live source. */
const BACKUP_MARKER = '.dsh-visual-studio-backup-'

/** An error the RPC handler folds into a `workspace-invalid-path` result. */
export class WorkspacePathError extends Error {
  /**
   * @param path - the offending path (reported in RPC details).
   * @param message - the human-readable reason.
   */
  constructor(readonly path: string, message: string) {
    super(message)
    this.name = 'WorkspacePathError'
  }
}

/**
 * Assert that an absolute target path stays inside a workspace root and return
 * its normalized absolute form. A target equal to the root (or a relative path
 * that escapes it with `..`) is rejected.
 * @param root - absolute workspace root.
 * @param target - absolute target path.
 * @returns the normalized absolute target.
 * @throws {WorkspacePathError} when the target is not inside the root.
 */
export function assertWithinWorkspace(root: string, target: string): string {
  if (!isAbsolute(root)) throw new WorkspacePathError(target, `workspace root is not absolute: ${root}`)
  if (!isAbsolute(target)) throw new WorkspacePathError(target, `target is not absolute: ${target}`)
  const absRoot = resolve(root)
  const absTarget = resolve(target)
  const rel = relative(absRoot, absTarget)
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new WorkspacePathError(target, `path outside workspace: ${target}`)
  }
  return absTarget
}

/** Whether a path's extension is one the Studio manages. */
function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(path).toLowerCase())
}

/**
 * Recursively collect HTML/SVG files under a directory, depth- and count-bounded.
 * @param dir - absolute directory to walk.
 * @param out - accumulated absolute file paths.
 * @param depth - current depth (0 at the root).
 */
async function walkSourceFiles(dir: string, out: string[], depth: number): Promise<void> {
  if (depth > MAX_LIST_DEPTH || out.length >= MAX_LIST_FILES) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // An unreadable subdirectory is skipped, not fatal: listing is best-effort.
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_LIST_FILES) return
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkSourceFiles(abs, out, depth + 1)
    } else if (entry.isFile() && isSourceFile(abs)) {
      out.push(abs)
    }
  }
}

/**
 * List every HTML/SVG file under a workspace root.
 * @param root - absolute workspace root.
 * @returns absolute paths, sorted, relative to nothing (callers shorten).
 */
export async function listSourceFiles(root: string): Promise<string[]> {
  assertWithinWorkspace(root, root)
  const out: string[] = []
  await walkSourceFiles(resolve(root), out, 0)
  return out.sort()
}

/**
 * Read one source file's text from inside the workspace.
 * @param root - absolute workspace root.
 * @param path - absolute target file path.
 * @returns the file's UTF-8 text.
 */
export async function readSourceFile(root: string, path: string): Promise<string> {
  const target = assertWithinWorkspace(root, path)
  return await readFile(target, 'utf8')
}

/** Read one workspace file's bytes as base64 (for image preview). */
export async function readSourceFileBase64(root: string, path: string): Promise<string> {
  const target = assertWithinWorkspace(root, path)
  return (await readFile(target)).toString('base64')
}

/**
 * Write one source file, keeping a timestamped sibling backup of the prior
 * content when the file already existed.
 * @param root - absolute workspace root.
 * @param path - absolute target file path.
 * @param content - UTF-8 content to write.
 * @returns the backup path, or `undefined` when no prior file existed.
 */
export async function writeSourceFile(root: string, path: string, content: string): Promise<{ backup?: string }> {
  const target = assertWithinWorkspace(root, path)
  await mkdir(dirname(target), { recursive: true })
  let backup: string | undefined
  try {
    const before = await readFile(target)
    backup = `${target}${BACKUP_MARKER}${Date.now()}`
    await writeFile(backup, before)
  } catch (error) {
    // No prior file (ENOENT) means nothing to back up; other errors surface on
    // the write below rather than being masked here.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await writeFile(target, content, 'utf8')
  return backup === undefined ? {} : { backup }
}

/**
 * Create one empty source file, refusing to overwrite an existing one.
 * @param root - absolute workspace root.
 * @param path - absolute target file path.
 * @returns the created file's absolute path.
 */
export async function createSourceFile(root: string, path: string): Promise<string> {
  const target = assertWithinWorkspace(root, path)
  if (!isSourceFile(target)) throw new WorkspacePathError(target, `unsupported source extension: ${extname(target)}`)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, '', { flag: 'wx', encoding: 'utf8' })
  return target
}

/** Fold a thrown error into a failure result with a valid RPC error code. */
function failureOf(error: unknown): RpcResult<unknown> {
  if (error instanceof WorkspacePathError) {
    return { ok: false, error: { code: 'workspace-invalid-path', message: error.message, details: { path: error.path } } }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

/** Read the `root` and `path` string fields the endpoints share. */
function parseTarget(payload: unknown): { root: string; path: string } {
  const p = (payload ?? {}) as Record<string, unknown>
  if (typeof p.root !== 'string' || typeof p.path !== 'string') {
    throw new WorkspacePathError(String(p.path ?? ''), 'payload requires string root and path')
  }
  return { root: p.root, path: p.path }
}

/**
 * Build the `/visual-studio` Connection RPC handler. Endpoints: `list`, `read`,
 * `write`, `create`. Every business error folds into a failure result; the
 * handler never throws.
 * @returns a Connection RPC handler over workspace source files.
 */
export function createStudioHandler(registry?: ArtifactRegistry): ConnectionRpcHandler {
  return async (endpoint, payload): Promise<RpcResult<unknown>> => {
    try {
      switch (endpoint) {
        case 'list': {
          const { root } = payload as { root: string }
          return { ok: true, value: { files: await listSourceFiles(root) } }
        }
        case 'read': {
          const { root, path } = parseTarget(payload)
          return { ok: true, value: { content: await readSourceFile(root, path) } }
        }
        case 'readBytes': {
          const { root, path } = parseTarget(payload)
          return { ok: true, value: { base64: await readSourceFileBase64(root, path) } }
        }
        case 'write': {
          const { root, path } = parseTarget(payload)
          const content = (payload as { content?: unknown }).content
          if (typeof content !== 'string') throw new WorkspacePathError(path, 'payload requires string content')
          return { ok: true, value: await writeSourceFile(root, path, content) }
        }
        case 'create': {
          const { root, path } = parseTarget(payload)
          return { ok: true, value: { path: await createSourceFile(root, path) } }
        }
        case 'artifacts.list': {
          const { sessionId } = payload as { sessionId: string }
          const artifacts = registry === undefined ? [] : registry.list(sessionId)
          return { ok: true, value: { artifacts } }
        }
        default:
          return { ok: false, error: { code: 'internal', message: `unknown visual-studio endpoint: ${endpoint}`, details: {} } }
      }
    } catch (error) {
      return failureOf(error)
    }
  }
}
