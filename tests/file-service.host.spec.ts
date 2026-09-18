import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertWithinWorkspace,
  createSourceFile,
  createStudioHandler,
  listBackups,
  listSourceFiles,
  readSourceFile,
  restoreBackup,
  writeSourceFile,
  WorkspacePathError,
} from '../src/host/file-service.ts'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'visual-studio-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('assertWithinWorkspace', () => {
  it('accepts a path inside the root', () => {
    expect(assertWithinWorkspace(root, join(root, 'a', 'b.html'))).toBe(join(root, 'a', 'b.html'))
  })

  it('rejects a path outside the root', () => {
    expect(() => assertWithinWorkspace(root, join(tmpdir(), 'elsewhere', 'x.html'))).toThrow(WorkspacePathError)
  })

  it('rejects a .. escape and a non-absolute path', () => {
    expect(() => assertWithinWorkspace(root, join(root, '..', 'x.html'))).toThrow(/outside workspace/)
    expect(() => assertWithinWorkspace(root, 'relative/x.html')).toThrow(/not absolute/)
  })
})

describe('listSourceFiles', () => {
  it('collects html and svg files recursively, skipping other extensions', async () => {
    await writeFile(join(root, 'a.html'), '<html></html>')
    await mkdir(join(root, 'nested'), { recursive: true })
    await writeFile(join(root, 'nested', 'b.svg'), '<svg></svg>')
    await writeFile(join(root, 'nested', 'c.css'), 'body {}')
    const files = await listSourceFiles(root)
    expect(files).toEqual([join(root, 'a.html'), join(root, 'nested', 'b.svg')])
  })
})

describe('readSourceFile', () => {
  it('reads a file inside the workspace', async () => {
    await writeFile(join(root, 'a.html'), '<p>hi</p>')
    await expect(readSourceFile(root, join(root, 'a.html'))).resolves.toBe('<p>hi</p>')
  })

  it('rejects a file outside the workspace', async () => {
    await expect(readSourceFile(root, join(tmpdir(), 'a.html'))).rejects.toThrow(WorkspacePathError)
  })
})

describe('writeSourceFile', () => {
  it('writes content and keeps a backup of the prior file', async () => {
    await writeFile(join(root, 'a.html'), 'old')
    const { backup } = await writeSourceFile(root, join(root, 'a.html'), 'new')
    await expect(readFile(join(root, 'a.html'), 'utf8')).resolves.toBe('new')
    expect(backup).toBeDefined()
    await expect(readFile(backup as string, 'utf8')).resolves.toBe('old')
  })

  it('writes a new file without a backup', async () => {
    const { backup } = await writeSourceFile(root, join(root, 'a.html'), 'new')
    expect(backup).toBeUndefined()
    await expect(readFile(join(root, 'a.html'), 'utf8')).resolves.toBe('new')
  })
})

describe('createSourceFile', () => {
  it('creates an empty file and refuses to overwrite', async () => {
    const created = await createSourceFile(root, join(root, 'new.svg'))
    await expect(readFile(created, 'utf8')).resolves.toBe('')
    await expect(createSourceFile(root, created)).rejects.toThrow()
  })

  it('rejects a non-source extension', async () => {
    await expect(createSourceFile(root, join(root, 'x.js'))).rejects.toThrow(/unsupported source extension/)
  })
})

describe('createStudioHandler', () => {
  it('dispatches list/read/write/create and folds errors into results', async () => {
    const handler = createStudioHandler()
    await writeFile(join(root, 'a.html'), 'v1')

    await expect(handler('list', { root }, new AbortController().signal)).resolves.toEqual({
      ok: true,
      value: { files: [join(root, 'a.html')] },
    })
    await expect(handler('read', { root, path: join(root, 'a.html') }, new AbortController().signal)).resolves.toEqual({
      ok: true,
      value: { content: 'v1' },
    })
    const write = await handler('write', { root, path: join(root, 'a.html'), content: 'v2' }, new AbortController().signal)
    expect(write.ok).toBe(true)
    await expect(readFile(join(root, 'a.html'), 'utf8')).resolves.toBe('v2')

    const outside = await handler('read', { root, path: join(tmpdir(), 'x.html') }, new AbortController().signal)
    expect(outside).toMatchObject({ ok: false, error: { code: 'workspace-invalid-path' } })
  })

  it('reports an unknown endpoint', async () => {
    const handler = createStudioHandler()
    const result = await handler('nope', {}, new AbortController().signal)
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
  })
})

describe('backup list and restore', () => {
  it('lists backups and restores a specific one', async () => {
    await writeFile(join(root, 'a.html'), 'v1')
    await writeSourceFile(root, join(root, 'a.html'), 'v2')
    await writeSourceFile(root, join(root, 'a.html'), 'v3')

    const backups = await listBackups(root, join(root, 'a.html'))
    expect(backups).toHaveLength(2)

    const result = await restoreBackup(root, join(root, 'a.html'), backups[0] as string)
    expect(result.restored).toBe(true)
    await expect(readFile(join(root, 'a.html'), 'utf8')).resolves.toBe('v1')
  })

  it('rejects restoring a path that is not a backup of the target', async () => {
    await writeFile(join(root, 'a.html'), 'v1')
    await writeFile(join(root, 'other.txt'), 'x')
    await expect(restoreBackup(root, join(root, 'a.html'), join(root, 'other.txt'))).rejects.toThrow(/not a backup/)
  })

  it('exposes backups.list and backups.restore over RPC', async () => {
    const handler = createStudioHandler()
    await writeFile(join(root, 'a.html'), 'v1')
    await writeSourceFile(root, join(root, 'a.html'), 'v2')

    const list = await handler('backups.list', { root, path: join(root, 'a.html') }, new AbortController().signal)
    expect(list.ok).toBe(true)
    const backups = (list as { ok: true; value: { backups: string[] } }).value.backups
    expect(backups).toHaveLength(1)

    const restore = await handler('backups.restore', { root, path: join(root, 'a.html'), backup: backups[0] }, new AbortController().signal)
    expect(restore.ok).toBe(true)
    await expect(readFile(join(root, 'a.html'), 'utf8')).resolves.toBe('v1')
  })
})
