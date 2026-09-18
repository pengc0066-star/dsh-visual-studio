/**
 * Host-side append-only event log for session artifacts. The node half records
 * every `fs/observed` write/edit as one JSONL line, so the artifact registry can
 * be rebuilt after a restart (recovery) and queried as history (replay), while
 * load-time validation surfaces version/sequence conflicts instead of silently
 * dropping them.
 * @module @deepseek-ai/dsh-visual-studio/host/artifact-log
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** One persisted observation event (one JSONL line). */
export interface ArtifactEvent {
  /** Monotonic sequence number assigned on append. */
  seq: number
  /** The agent session id that observed the file. */
  sessionId: string
  /** Absolute display path of the observed file. */
  path: string
  /** Workspace root at observation time (for the relative path). */
  cwd?: string
  /** Filesystem version reported by `fs/observed` (for conflict detection). */
  fsVersion?: string
  /** Epoch ms of the observation. */
  at: number
}

/** Resolve the harness home: `$DSH_HOME`, then `~/.dsh`. */
function resolveDshHome(): string {
  const env = process.env.DSH_HOME?.trim()
  if (env === undefined || env === '') return join(homedir(), '.dsh')
  if (env === '~') return homedir()
  if (env.startsWith('~/') || env.startsWith('~\\')) return join(homedir(), env.slice(2))
  return env
}

/** Absolute path of the default artifact log under the harness home. */
export function defaultArtifactLogPath(): string {
  return join(resolveDshHome(), 'visual-studio', 'artifacts.jsonl')
}

/**
 * Parse one log line into an event, or `null` when it is not a valid event.
 * @param line - one JSONL line (without the trailing newline).
 */
export function parseEvent(line: string): ArtifactEvent | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const e = value as Record<string, unknown>
  if (
    typeof e.seq !== 'number' || !Number.isSafeInteger(e.seq)
    || typeof e.sessionId !== 'string' || typeof e.path !== 'string'
    || typeof e.at !== 'number'
  ) {
    return null
  }
  return {
    seq: e.seq,
    sessionId: e.sessionId,
    path: e.path,
    ...(typeof e.cwd === 'string' ? { cwd: e.cwd } : {}),
    ...(typeof e.fsVersion === 'string' ? { fsVersion: e.fsVersion } : {}),
    at: e.at,
  }
}

/** Numeric part of an fs version string like `v12`, or NaN when unparsable. */
function versionNumber(fsVersion: string): number {
  const match = /^v(\d+)$/.exec(fsVersion)
  return match === null ? Number.NaN : Number(match[1])
}

/** Append-only JSONL event log with load-time integrity validation. */
export class ArtifactEventLog {
  /** Valid events in sequence order (loaded plus appended). */
  readonly events: ArtifactEvent[] = []
  /** Conflicts detected during load (never silently dropped). */
  readonly conflicts: string[] = []
  private queue: Promise<void> = Promise.resolve()
  private nextSeq = 0

  /**
   * @param filePath - absolute JSONL path; defaults under the harness home.
   */
  constructor(readonly filePath: string = defaultArtifactLogPath()) {}

  /**
   * Synchronously load and validate the existing log once, before any
   * observation can arrive. A missing log is a fresh history; an unreadable
   * log is reported as a conflict and treated as empty.
   */
  loadSync(): void {
    let text: string
    try {
      text = readFileSync(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.conflicts.push(`log unreadable: ${error instanceof Error ? error.message : String(error)}`)
      }
      return
    }
    let expected = 1
    const lastByKey = new Map<string, { at: number; cwd?: string; fsVersion?: string }>()
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      const event = parseEvent(line)
      if (event === null) {
        this.conflicts.push(`corrupt line at seq ${expected}`)
        expected += 1
        continue
      }
      if (event.seq !== expected) {
        this.conflicts.push(`seq gap: expected ${expected}, got ${event.seq}`)
        expected = event.seq
      }
      const key = `${event.sessionId}\u0000${event.path}`
      const prev = lastByKey.get(key)
      if (prev !== undefined) {
        if (event.at < prev.at) {
          this.conflicts.push(`time regression for ${event.path}`)
        }
        if (prev.cwd !== undefined && event.cwd !== undefined && prev.cwd !== event.cwd) {
          this.conflicts.push(`cwd changed for ${event.path}: ${prev.cwd} -> ${event.cwd}`)
        }
        if (prev.fsVersion !== undefined && event.fsVersion !== undefined) {
          const prevNum = versionNumber(prev.fsVersion)
          const nextNum = versionNumber(event.fsVersion)
          if (Number.isFinite(prevNum) && Number.isFinite(nextNum) && nextNum < prevNum) {
            this.conflicts.push(`fs version regression for ${event.path}: ${event.fsVersion} < ${prev.fsVersion}`)
          }
        }
      }
      lastByKey.set(key, {
        at: event.at,
        ...(event.cwd !== undefined ? { cwd: event.cwd } : {}),
        ...(event.fsVersion !== undefined ? { fsVersion: event.fsVersion } : {}),
      })
      this.events.push(event)
      this.nextSeq = event.seq
      expected = event.seq + 1
    }
  }

  /**
   * Append one observation event, assigning the next sequence number. Appends
   * are serialized so the on-disk sequence order matches the in-memory order.
   * @param event - the event without its sequence number.
   * @returns the full event including the assigned sequence number.
   */
  append(event: Omit<ArtifactEvent, 'seq'>): Promise<ArtifactEvent> {
    const task = this.queue.then(async () => {
      const seq = this.nextSeq + 1
      const full: ArtifactEvent = { seq, ...event }
      await mkdir(dirname(this.filePath), { recursive: true })
      await appendFile(this.filePath, `${JSON.stringify(full)}\n`, 'utf8')
      this.events.push(full)
      this.nextSeq = seq
      return full
    })
    // A failed append must not wedge the queue; the next append still runs.
    this.queue = task.then(() => undefined, () => undefined)
    return task
  }
}
