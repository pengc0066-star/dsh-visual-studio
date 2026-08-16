/**
 * Visual HTML/SVG Studio plugin, node half.
 *
 * Registers the `/visual-studio` Connection RPC channel (loopback authority)
 * that the browser half calls to list, read, write, and create workspace
 * HTML/SVG files. The channel is owned through the plugin fiber, so unload
 * removes the route; the handler itself is the tested
 * {@link createStudioHandler}. Annotation submission does not run through this
 * channel — the browser half sends it as an ordinary `session.prompt`, which
 * already routes to the current agent.
 * @module @deepseek-ai/dsh-visual-studio
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { createStudioHandler } from './host/file-service.ts'

/** Stable Cordis plugin name. */
export const name = 'visual-studio'

/** Required services: the Host Connection transport that owns generic RPC. */
export const inject = ['connection']

/** The logical RPC channel prefix both halves share. */
export const STUDIO_CHANNEL = '/visual-studio'

/**
 * Mount the file-service RPC channel. Registration runs through the caller's
 * fiber effect, so plugin unload disposes the route.
 * @param ctx - Host Cordis context carrying the Connection service.
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.connection.rpc.handle(STUDIO_CHANNEL, createStudioHandler(), { authority: 'loopback' }),
    'visual-studio: file rpc channel',
  )
}
