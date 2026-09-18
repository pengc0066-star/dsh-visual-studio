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

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ArtifactRegistry } from './artifact-service.ts'
import type { ArtifactEventLog } from './artifact-log.ts'

/** The Studio's file-write conflict error code (merge-extensible union). */
declare module '@deepseek-ai/dsh-host-apiproxy/api' {
  interface RpcErrorDetailsMap {
    /** The file's content changed since the client read it. */
    'file-conflict': { path: string }
  }
}

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

/** An error the RPC handler folds into a `file-conflict` result. */
export class FileConflictError extends Error {
  /**
   * @param path - the path whose content changed since the client read it.
   */
  constructor(readonly path: string) {
    super(`file was modified: ${path}`)
    this.name = 'FileConflictError'
  }
}

/** SHA-256 hex digest of a text content (the Studio's content version). */
export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
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

/** Read one workspace file's text and its content hash (version). */
export async function readSourceFileVersioned(root: string, path: string): Promise<{ content: string; hash: string }> {
  const content = await readSourceFile(root, path)
  return { content, hash: hashContent(content) }
}

/**
 * Write one source file, keeping a timestamped sibling backup of the prior
 * content when the file already existed. When `expectedHash` is provided, the
 * current content hash is checked first and a mismatch throws
 * {@link FileConflictError} instead of overwriting.
 * @param root - absolute workspace root.
 * @param path - absolute target file path.
 * @param content - UTF-8 content to write.
 * @param expectedHash - content hash the client read; omitted skips the check.
 * @returns the backup path and the new content hash.
 */
export async function writeSourceFile(root: string, path: string, content: string, expectedHash?: string): Promise<{ backup?: string; hash: string }> {
  const target = assertWithinWorkspace(root, path)
  await mkdir(dirname(target), { recursive: true })
  if (expectedHash !== undefined) {
    let currentHash: string
    try {
      currentHash = hashContent(await readFile(target, 'utf8'))
    } catch (error) {
      // A missing file means the client expected an existing one → conflict.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new FileConflictError(target)
      throw error
    }
    if (currentHash !== expectedHash) throw new FileConflictError(target)
  }
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
  const hash = hashContent(content)
  return { ...(backup !== undefined ? { backup } : {}), hash }
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

/** List a file's pre-overwrite backups, oldest first. */
export async function listBackups(root: string, path: string): Promise<string[]> {
  const target = assertWithinWorkspace(root, path)
  const prefix = `${basename(target)}${BACKUP_MARKER}`
  const entries = await readdir(dirname(target))
  return entries
    .filter(name => name.startsWith(prefix))
    .map(name => join(dirname(target), name))
    .sort()
}

/**
 * Restore one specific backup over the file, keeping a fresh backup of the
 * current content first. The backup must be a sibling backup of the target.
 * When `expectedHash` is provided, the current content hash is checked first so
 * a later modification is never silently overwritten.
 * @param root - absolute workspace root.
 * @param path - absolute target file path.
 * @param backupPath - absolute backup path to restore.
 * @param expectedHash - content hash the client read; omitted skips the check.
 * @returns whether the backup was restored, the backup used, and the new hash.
 */
export async function restoreBackup(root: string, path: string, backupPath: string, expectedHash?: string): Promise<{ restored: boolean; backup?: string; hash?: string }> {
  const target = assertWithinWorkspace(root, path)
  const backup = assertWithinWorkspace(root, backupPath)
  const prefix = `${basename(target)}${BACKUP_MARKER}`
  if (!basename(backup).startsWith(prefix)) {
    throw new WorkspacePathError(backupPath, `not a backup of ${target}`)
  }
  const content = await readFile(backup, 'utf8')
  const result = await writeSourceFile(root, target, content, expectedHash)
  return { restored: true, backup, hash: result.hash }
}

/**
 * Restore the most recent backup over the file, checking the current content
 * hash first when `expectedHash` is provided.
 * @param root - absolute workspace root.
 * @param path - absolute target file path.
 * @param expectedHash - content hash the client read; omitted skips the check.
 * @returns whether a backup was restored, the backup used, and the new hash.
 */
export async function restorePrevious(root: string, path: string, expectedHash?: string): Promise<{ restored: boolean; backup?: string; hash?: string }> {
  const backups = await listBackups(root, path)
  if (backups.length === 0) return { restored: false }
  return await restoreBackup(root, path, backups[backups.length - 1] as string, expectedHash)
}

/** Fold a thrown error into a failure result with a valid RPC error code. */
function failureOf(error: unknown): RpcResult<unknown> {
  if (error instanceof WorkspacePathError) {
    return { ok: false, error: { code: 'workspace-invalid-path', message: error.message, details: { path: error.path } } }
  }
  if (error instanceof FileConflictError) {
    return { ok: false, error: { code: 'file-conflict', message: error.message, details: { path: error.path } } }
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
 * `readBytes`, `write`, `create`, `artifacts.list`, `backups.list`,
 * `backups.restore`. Every business error folds into a failure result; the
 * handler never throws.
 * @returns a Connection RPC handler over workspace source files.
 */
export function createStudioHandler(registry?: ArtifactRegistry, log?: ArtifactEventLog): ConnectionRpcHandler {
  return async (endpoint, payload): Promise<RpcResult<unknown>> => {
    try {
      switch (endpoint) {
        case 'list': {
          const { root } = payload as { root: string }
          return { ok: true, value: { files: await listSourceFiles(root) } }
        }
        case 'read': {
          const { root, path } = parseTarget(payload)
          return { ok: true, value: await readSourceFileVersioned(root, path) }
        }
        case 'readBytes': {
          const { root, path } = parseTarget(payload)
          return { ok: true, value: { base64: await readSourceFileBase64(root, path) } }
        }
        case 'write': {
          const { root, path } = parseTarget(payload)
          const body = (payload ?? {}) as { content?: unknown; expectedHash?: unknown; sessionId?: unknown }
          const content = body.content
          if (typeof content !== 'string') throw new WorkspacePathError(path, 'payload requires string content')
          const expectedHash = typeof body.expectedHash === 'string' ? body.expectedHash : undefined
          const result = await writeSourceFile(root, path, content, expectedHash)
          if (log !== undefined && typeof body.sessionId === 'string') {
            await log.append({
              sessionId: body.sessionId,
              path,
              cwd: root,
              ...(expectedHash !== undefined ? { beforeVersion: expectedHash } : {}),
              afterVersion: result.hash,
              operation: 'save',
              at: Date.now(),
            })
          }
          return { ok: true, value: result }
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
        case 'backups.list': {
          const { root, path } = parseTarget(payload)
          return { ok: true, value: { backups: await listBackups(root, path) } }
        }
        case 'backups.restore': {
          const { root, path } = parseTarget(payload)
          const body = (payload ?? {}) as { backup?: unknown; expectedHash?: unknown; sessionId?: unknown }
          const expectedHash = typeof body.expectedHash === 'string' ? body.expectedHash : undefined
          const result = typeof body.backup === 'string'
            ? await restoreBackup(root, path, body.backup, expectedHash)
            : await restorePrevious(root, path, expectedHash)
          if (log !== undefined && result.restored && typeof body.sessionId === 'string') {
            await log.append({
              sessionId: body.sessionId,
              path,
              cwd: root,
              ...(expectedHash !== undefined ? { beforeVersion: expectedHash } : {}),
              ...(result.hash !== undefined ? { afterVersion: result.hash } : {}),
              operation: 'restore',
              at: Date.now(),
            })
          }
          return { ok: true, value: result }
        }
        default:
          return { ok: false, error: { code: 'internal', message: `unknown visual-studio endpoint: ${endpoint}`, details: {} } }
      }
    } catch (error) {
      return failureOf(error)
    }
  }
}
