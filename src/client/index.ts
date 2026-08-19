/**
 * Visual HTML/SVG Studio plugin, browser half: registers the Studio panel into
 * the frame-wide `shell.overlay` seat, a compact entry button into the
 * composer tool row, and the artifacts bar above the composer. All three share
 * one open-state source; the panel and bars are pure props consumers and `ctx`
 * stays in this apply closure.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: merges the `shell.overlay` SlotMap entry declared by ui-layout.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: merges the `conversation.input.*` SlotMap entries declared by ui-conversation.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { StudioPanel } from './StudioPanel.tsx'
import { StudioEntryButton } from './StudioEntryButton.tsx'
import { ArtifactsBar } from './ArtifactsBar.tsx'
import type { ArtifactRecord, OpenController, StudioInjected, StudioPanelFace, StudioState } from './studio.ts'

/** The logical RPC channel the node half serves (protocol constant, shared by name). */
const STUDIO_CHANNEL = '/visual-studio'

/** Required services: the slot registry (the panel and bar composition seats). */
export const inject = ['slots']

/** Create a host-observable open-state controller (getSnapshot + subscribe + verbs). */
function createOpenController(): OpenController {
  let state: StudioState = { open: false, pendingFile: null, currentPath: null }
  const listeners = new Set<() => void>()
  const emit = (): void => { for (const listener of [...listeners]) listener() }
  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setOpen: (open) => {
      if (state.open === open) return
      state = { ...state, open }
      emit()
    },
    toggle: () => {
      state = { ...state, open: !state.open }
      emit()
    },
    openFile: (path) => {
      state = { open: true, pendingFile: path, currentPath: path }
      emit()
    },
    setCurrentPath: (path) => {
      if (state.currentPath === path) return
      state = { ...state, currentPath: path }
      emit()
    },
    consumePendingFile: () => {
      const pending = state.pendingFile
      state = { ...state, pendingFile: null }
      return pending
    },
  }
}

/** Build the file/session/artifact callbacks over the Connection transport. */
function createFileFace(ctx: ClientContext): StudioInjected {
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  if (connection === undefined) {
    const unavailable = async (): Promise<never> => { throw new Error('connection service unavailable') }
    return {
      listFiles: unavailable,
      readFile: unavailable,
      readFileBytes: unavailable,
      writeFile: unavailable,
      createFile: unavailable,
      restorePrevious: async () => ({ restored: false }),
      submitAnnotation: async () => false,
      listArtifacts: async () => [],
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
    readFileBytes: async (root, path) => {
      const value = await call('readBytes', { root, path }) as { base64: string }
      return value.base64
    },
    writeFile: async (root, path, content) => {
      return await call('write', { root, path, content }) as { backup?: string }
    },
    createFile: async (root, path) => {
      const value = await call('create', { root, path }) as { path: string }
      return value.path
    },
    restorePrevious: async (root, path) => {
      return await call('backups.restore', { root, path }) as { restored: boolean }
    },
    submitAnnotation: async (sessionId, text) => {
      const response = await connection.api.sessions.prompt({
        sessionId: sessionId as SessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
      })
      return response.result.ok
    },
    listArtifacts: async (sessionId) => {
      const value = await call('artifacts.list', { sessionId }) as { artifacts: ArtifactRecord[] }
      return value.artifacts
    },
  }
}

/**
 * Client plugin body: register the Studio panel, the entry button, and the
 * artifacts bar, all sharing one open-state source.
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
        consumePendingFile: () => open.consumePendingFile(),
        setCurrentPath: (path) => open.setCurrentPath(path),
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

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    {
      name: 'conversation.input.dock',
      id: 'visual-studio-artifacts',
      order: 50,
      inject: (): {
        hooks: { open: OpenController }
        listArtifacts: (sessionId: string) => Promise<ArtifactRecord[]>
        openFile: (path: string) => void
      } => ({
        hooks: { open },
        listArtifacts: fileFace.listArtifacts,
        openFile: (path) => open.openFile(path),
      }),
    },
    ArtifactsBar,
  ))
}
