/**
 * Visual HTML/SVG Studio plugin, browser half: registers the Studio panel into
 * the frame-wide `shell.overlay` seat and a compact entry button into the
 * composer tool row, sharing one open-state source between them. The panel and
 * button are pure props consumers; `ctx` stays in this apply closure.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: merges the `shell.overlay` SlotMap entry declared by ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: merges the `conversation.input.left` SlotMap entry declared by ui-conversation.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { StudioPanel } from './StudioPanel.tsx'
import { StudioEntryButton } from './StudioEntryButton.tsx'
import type { OpenController, StudioInjected, StudioPanelFace } from './studio.ts'

/** The logical RPC channel the node half serves (protocol constant, shared by name). */
const STUDIO_CHANNEL = '/visual-studio'

/** Required services: the slot registry (the panel and entry composition seats). */
export const inject = ['slots']

/** Create a tiny host-observable boolean controller (getSnapshot + subscribe + verbs). */
function createOpenController(): OpenController {
  let open = false
  const listeners = new Set<() => void>()
  const emit = (): void => { for (const listener of [...listeners]) listener() }
  return {
    getSnapshot: () => open,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setOpen: (next) => {
      if (open === next) return
      open = next
      emit()
    },
    toggle: () => {
      open = !open
      emit()
    },
  }
}

/** Build the file/session callbacks over the Connection transport. */
function createFileFace(ctx: ClientContext): StudioInjected {
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
}

/**
 * Client plugin body: register the Studio panel into `shell.overlay` and the
 * entry button into `conversation.input.left`, sharing one open-state source.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const open = createOpenController()
  const fileFace = createFileFace(ctx)

  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    {
      name: 'shell.overlay',
      id: 'visual-studio',
      order: 50,
      inject: (): StudioPanelFace & { hooks: { open: OpenController } } => ({
        hooks: { open },
        close: () => open.setOpen(false),
        ...fileFace,
      }),
    },
    StudioPanel,
  ))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    {
      name: 'conversation.input.left',
      id: 'visual-studio',
      order: 50,
      inject: (): { hooks: { open: OpenController }; toggle: () => void } => ({
        hooks: { open },
        toggle: () => open.toggle(),
      }),
    },
    StudioEntryButton,
  ))
}
