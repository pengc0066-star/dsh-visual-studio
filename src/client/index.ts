/**
 * Visual HTML/SVG Studio plugin, browser half: registers the Studio panel into
 * the frame-wide `shell.overlay` seat and injects the host-I/O and
 * session-routing face the panel consumes. The panel is a pure props consumer;
 * `ctx` stays in this apply closure.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: merges the `shell.overlay` SlotMap entry declared by ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { StudioPanel } from './StudioPanel.tsx'
import type { StudioInjected } from './studio.ts'

/** The logical RPC channel the node half serves (protocol constant, shared by name). */
const STUDIO_CHANNEL = '/visual-studio'

/** Required services: the slot registry (the panel's composition seat). */
export const inject = ['slots']

/**
 * Client plugin body: register the Studio panel into `shell.overlay` and bind
 * the file/session callbacks over the Connection transport.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    {
      name: 'shell.overlay',
      id: 'visual-studio',
      order: 50,
      inject: (): StudioInjected => {
        const connection = ctx.get('connection') as ConnectionHandle | undefined
        if (connection === undefined) {
          const unavailable = async (): Promise<never> => { throw new Error('connection service unavailable') }
          return {
            listFiles: unavailable,
            readFile: unavailable,
            writeFile: unavailable,
            createFile: unavailable,
            submitAnnotation: async () => false,
          }
        }

        const call = async (endpoint: string, payload: unknown): Promise<unknown> => {
          const result = await connection.rpc.call(STUDIO_CHANNEL, endpoint, payload)
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        }

        return {
          listFiles: async (root) => {
            const value = await call('list', { root }) as { files: string[] }
            return value.files
          },
          readFile: async (root, path) => {
            const value = await call('read', { root, path }) as { content: string }
            return value.content
          },
          writeFile: async (root, path, content) => {
            return await call('write', { root, path, content }) as { backup?: string }
          },
          createFile: async (root, path) => {
            const value = await call('create', { root, path }) as { path: string }
            return value.path
          },
          submitAnnotation: async (sessionId, text) => {
            const response = await connection.api.sessions.prompt({
              sessionId: sessionId as SessionId,
              mode: 'queue',
              content: [{ type: 'text', text }],
            })
            return response.result.ok
          },
        }
      },
    },
    StudioPanel,
  ))
}
