import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { ArtifactEventLog, defaultArtifactLogPath, parseEvent } from '../src/host/artifact-log.ts'

let dirs: string[] = []

async function tempLogPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-vs-log-'))
  dirs.push(dir)
  return join(dir, 'artifacts.jsonl')
}

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('parseEvent', () => {
  it('parses a valid line and keeps optional fields', () => {
    const line = JSON.stringify({ seq: 1, sessionId: 's', path: '/p/a.html', cwd: '/p', fsVersion: 'v2', at: 5 })
    expect(parseEvent(line)).toEqual({ seq: 1, sessionId: 's', path: '/p/a.html', cwd: '/p', fsVersion: 'v2', at: 5 })
  })

  it('rejects malformed lines and lines missing required fields', () => {
    expect(parseEvent('not json')).toBeNull()
    expect(parseEvent(JSON.stringify({ seq: 'x' }))).toBeNull()
    expect(parseEvent(JSON.stringify({ seq: 1, sessionId: 's', path: '/p/a.html' }))).toBeNull() // no at
    expect(parseEvent(JSON.stringify({ seq: 1, sessionId: 's', path: '/p/a.html', at: 5 }))).not.toBeNull()
  })
})

describe('defaultArtifactLogPath', () => {
  it('prefers DSH_HOME', () => {
    vi.stubEnv('DSH_HOME', 'C:\\Users\\me\\.dsh')
    expect(defaultArtifactLogPath()).toBe(join('C:\\Users\\me\\.dsh', 'visual-studio', 'artifacts.jsonl'))
  })

  it('falls back to ~/.dsh when DSH_HOME is unset or blank', () => {
    vi.stubEnv('DSH_HOME', '')
    expect(defaultArtifactLogPath()).toBe(join(homedir(), '.dsh', 'visual-studio', 'artifacts.jsonl'))
  })
})

describe('ArtifactEventLog', () => {
  it('loads an empty (missing) log with no events and no conflicts', () => {
    const log = new ArtifactEventLog(join(tmpdir(), 'definitely-missing-artifacts.jsonl'))
    log.loadSync()
    expect(log.events).toEqual([])
    expect(log.conflicts).toEqual([])
  })

  it('round-trips appended events through a reload', async () => {
    const filePath = await tempLogPath()
    const log = new ArtifactEventLog(filePath)
    log.loadSync()
    await log.append({ sessionId: 's1', path: '/p/a.html', cwd: '/p', fsVersion: 'v1', at: 100 })
    await log.append({ sessionId: 's1', path: '/p/b.svg', at: 200 })

    const reloaded = new ArtifactEventLog(filePath)
    reloaded.loadSync()
    expect(reloaded.events).toEqual([
      { seq: 1, sessionId: 's1', path: '/p/a.html', cwd: '/p', fsVersion: 'v1', at: 100 },
      { seq: 2, sessionId: 's1', path: '/p/b.svg', at: 200 },
    ])
    expect(reloaded.conflicts).toEqual([])
  })

  it('serializes concurrent appends into sequential numbers', async () => {
    const filePath = await tempLogPath()
    const log = new ArtifactEventLog(filePath)
    log.loadSync()
    const results = await Promise.all([
      log.append({ sessionId: 's1', path: '/p/a.html', at: 100 }),
      log.append({ sessionId: 's1', path: '/p/b.html', at: 200 }),
      log.append({ sessionId: 's1', path: '/p/c.html', at: 300 }),
    ])
    expect(results.map(event => event.seq)).toEqual([1, 2, 3])
    const reloaded = new ArtifactEventLog(filePath)
    reloaded.loadSync()
    expect(reloaded.events).toHaveLength(3)
  })

  it('reports a corrupt line and keeps the valid events around it', async () => {
    const filePath = await tempLogPath()
    await writeFile(filePath, [
      JSON.stringify({ seq: 1, sessionId: 's1', path: '/p/a.html', at: 100 }),
      'not-json',
      JSON.stringify({ seq: 3, sessionId: 's1', path: '/p/b.svg', at: 200 }),
    ].join('\n') + '\n')
    const log = new ArtifactEventLog(filePath)
    log.loadSync()
    expect(log.events).toHaveLength(2)
    expect(log.conflicts).toEqual(['corrupt line at seq 2'])
  })

  it('reports a sequence gap', async () => {
    const filePath = await tempLogPath()
    await writeFile(filePath, [
      JSON.stringify({ seq: 1, sessionId: 's1', path: '/p/a.html', at: 100 }),
      JSON.stringify({ seq: 3, sessionId: 's1', path: '/p/b.svg', at: 200 }),
    ].join('\n') + '\n')
    const log = new ArtifactEventLog(filePath)
    log.loadSync()
    expect(log.conflicts).toEqual(['seq gap: expected 2, got 3'])
    expect(log.events).toHaveLength(2)
  })

  it('reports an fs version regression for the same path', async () => {
    const filePath = await tempLogPath()
    await writeFile(filePath, [
      JSON.stringify({ seq: 1, sessionId: 's1', path: '/p/a.html', fsVersion: 'v3', at: 100 }),
      JSON.stringify({ seq: 2, sessionId: 's1', path: '/p/a.html', fsVersion: 'v2', at: 200 }),
    ].join('\n') + '\n')
    const log = new ArtifactEventLog(filePath)
    log.loadSync()
    expect(log.conflicts).toEqual(['fs version regression for /p/a.html: v2 < v3'])
  })

  it('reports a time regression for the same path', async () => {
    const filePath = await tempLogPath()
    await writeFile(filePath, [
      JSON.stringify({ seq: 1, sessionId: 's1', path: '/p/a.html', at: 200 }),
      JSON.stringify({ seq: 2, sessionId: 's1', path: '/p/a.html', at: 100 }),
    ].join('\n') + '\n')
    const log = new ArtifactEventLog(filePath)
    log.loadSync()
    expect(log.conflicts).toEqual(['time regression for /p/a.html'])
  })

  it('reports a cwd change for the same path', async () => {
    const filePath = await tempLogPath()
    await writeFile(filePath, [
      JSON.stringify({ seq: 1, sessionId: 's1', path: '/p/a.html', cwd: '/p', at: 100 }),
      JSON.stringify({ seq: 2, sessionId: 's1', path: '/p/a.html', cwd: '/q', at: 200 }),
    ].join('\n') + '\n')
    const log = new ArtifactEventLog(filePath)
    log.loadSync()
    expect(log.conflicts).toEqual(['cwd changed for /p/a.html: /p -> /q'])
  })
})
