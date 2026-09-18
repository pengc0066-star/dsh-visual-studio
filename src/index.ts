/**
 * Visual HTML/SVG Studio plugin, node half.
 *
 * Registers the `/visual-studio` Connection RPC channel (loopback authority)
 * that the browser half calls to list, read, write, and create workspace files,
 * and to read the session artifact registry. The artifact registry is a
 * projection of an append-only event log under the harness home, fed by the
 * `fs/observed` event (emitted by the `write`/`edit` tools) and replayed on
 * startup so artifacts survive a restart.
 * @module @deepseek-ai/dsh-visual-studio
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
// Type-only: activates the `fs/observed` Events merge.
import type {} from '@deepseek-ai/dsh-fs'
import { ArtifactRegistry } from './host/artifact-service.ts'
import { ArtifactEventLog } from './host/artifact-log.ts'
import { createStudioHandler } from './host/file-service.ts'

/** Stable Cordis plugin name. */
export const name = 'visual-studio'

/** Required services: the Host Connection transport that owns generic RPC. */
export const inject = ['connection']

/** The logical RPC channel prefix both halves share. */
export const STUDIO_CHANNEL = '/visual-studio'

/** Narrow the `fs/observed` actor to the fields the registry needs. */
interface ObservedActor {
  name?: string
  agent?: { id?: string; session?: { header?: { cwd?: string } } }
}

/**
 * Mount the artifact registry and the file-service RPC channel. The event
 * listener and the route are both owned through the plugin fiber.
 * @param ctx - Host Cordis context carrying the Connection service.
 */
export function apply(ctx: Context): void {
  const log = new ArtifactEventLog()
  log.loadSync()
  const registry = new ArtifactRegistry()
  registry.replay(log.events)
  ctx.on('fs/observed', (target, observation, actor) => {
    const observed = actor as ObservedActor | undefined
    if (observed?.name !== 'write' && observed?.name !== 'edit') return
    const sessionId = observed.agent?.id
    if (sessionId === undefined) return
    const cwd = observed.agent?.session?.header?.cwd
    const path = target.displayPath
    const at = Date.now()
    const fsVersion = observation.kind === 'present' ? observation.version : undefined
    registry.observe(sessionId, cwd, path, at)
    void log.append({
      sessionId,
      path,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(fsVersion !== undefined ? { fsVersion } : {}),
      at,
    }).catch(() => { /* append failure is non-fatal: the in-memory registry still served the write */ })
  })
  ctx.effect(
    () => ctx.connection.rpc.handle(STUDIO_CHANNEL, createStudioHandler(registry), { authority: 'loopback' }),
    'visual-studio: file rpc channel',
  )
}
