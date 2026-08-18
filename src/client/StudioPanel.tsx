/**
 * The Visual HTML/SVG Studio panel: workspace file picker, source editor with
 * line numbers and highlighting, sandboxed centered preview, element inspector,
 * annotations, undo/redo, and desktop/mobile viewport switch. The component is
 * a pure props consumer — all host I/O and session routing arrive through the
 * {@link StudioInjected} face from the plugin apply closure.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { CodeEditor } from './CodeEditor.tsx'
import { formatAnnotationMessage } from './studio.ts'
import type { Annotation, InspectPayload, StudioInjected } from './studio.ts'
import { INSPECT_EVENT, INSPECT_TOGGLE, ZOOM_EVENT, previewDocument } from './inspector.ts'
import styles from './StudioPanel.module.css'

/** Component props: the injected file/session face plus the global standard kit. */
export interface StudioPanelProps extends StudioInjected {
  useSessions: SnapshotSelectorHook<SessionListState>
  useWorkspaces: SnapshotSelectorHook<WorkspaceListState>
}

/** Poll interval (ms) for detecting agent edits to the open file. */
const POLL_MS = 2000

/** Debounce (ms) before a keystroke updates the preview and undo history. */
const EDIT_DEBOUNCE_MS = 500

/** Local-storage key keeping annotation state across page reloads. */
const ANNOTATIONS_KEY = 'dsh.visual-studio.annotations'

/** Preview zoom presets. */
const ZOOM_OPTIONS = [0.25, 0.5, 1, 1.5, 2]

/** Build a child absolute path by joining a name onto a workspace root. */
function joinPath(root: string, name: string): string {
  const base = root.replace(/[\\/]+$/, '')
  const leaf = name.replace(/^[\\/]+/, '')
  return `${base}/${leaf}`
}

/** Shorten an absolute path against the workspace root for display. */
function shorten(root: string | undefined, path: string): string {
  if (root === undefined) return path
  const rel = path.startsWith(root) ? path.slice(root.length).replace(/^[\\/]+/, '') : path
  return rel === '' ? path : rel
}

/** Read persisted annotations, tolerating a corrupt or foreign payload. */
function loadAnnotations(): Annotation[] {
  try {
    const raw = localStorage.getItem(ANNOTATIONS_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is Annotation =>
      typeof item === 'object' && item !== null
      && typeof (item as Annotation).id === 'string'
      && typeof (item as Annotation).note === 'string')
  } catch {
    return []
  }
}

export function StudioPanel(props: StudioPanelProps) {
  const { useSessions, listFiles, readFile, writeFile, createFile, submitAnnotation } = props
  const sessionId = useSessions(s => s.current)
  const cwd = useSessions(s => (s.current === undefined ? undefined : s.byId[s.current]?.cwd))

  const [collapsed, setCollapsed] = useState(false)
  const [codeCollapsed, setCodeCollapsed] = useState(false)
  const [files, setFiles] = useState<string[]>([])
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [preview, setPreview] = useState('')
  const [saved, setSaved] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [selected, setSelected] = useState<InspectPayload | null>(null)
  const [inspectMode, setInspectMode] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop')
  const [annotations, setAnnotations] = useState<Annotation[]>(loadAnnotations)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const editTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const srcdoc = useMemo(() => previewDocument(preview), [preview])

  const postToFrame = useCallback((message: unknown) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*')
  }, [])

  const applyFrameState = useCallback(() => {
    postToFrame({ type: INSPECT_TOGGLE, enabled: inspectMode })
    postToFrame({ type: ZOOM_EVENT, scale: zoom })
  }, [inspectMode, zoom, postToFrame])

  // Persist annotations on every change.
  useEffect(() => {
    try {
      localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(annotations))
    } catch {
      // Storage full or blocked — annotations remain session-local only.
    }
  }, [annotations])

  // Load the workspace file list whenever the workspace root changes.
  useEffect(() => {
    if (cwd === undefined) {
      setFiles([])
      return
    }
    let cancelled = false
    listFiles(cwd)
      .then(next => { if (!cancelled) setFiles(next) })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { cancelled = true }
  }, [cwd, listFiles])

  /** Open one absolute file path into the editor and preview. */
  const openFile = useCallback(async (path: string) => {
    if (cwd === undefined) return
    try {
      const text = await readFile(cwd, path)
      setCurrentFile(path)
      setContent(text)
      setPreview(text)
      setSaved(text)
      setHistory([text])
      setHistoryIndex(0)
      setSelected(null)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [cwd, readFile])

  /** Re-read the open file from disk (manual refresh). */
  const refresh = useCallback(async () => {
    if (cwd === undefined || currentFile === null) return
    await openFile(currentFile)
  }, [cwd, currentFile, openFile])

  // Poll the open file so agent edits auto-refresh the preview and mark
  // annotations for that file as processed.
  useEffect(() => {
    if (cwd === undefined || currentFile === null) return
    const timer = setInterval(() => {
      void readFile(cwd, currentFile).then((disk) => {
        setSaved(prev => {
          if (disk === prev) return prev
          setContent(cur => (cur === prev ? disk : cur))
          setPreview(disk)
          setAnnotations(list => list.map(a => a.filePath === currentFile ? { ...a, status: 'processed' as const } : a))
          return disk
        })
      }).catch(() => { /* transient read failures are ignored until the next poll */ })
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [cwd, currentFile, readFile])

  /** Commit a keystroke: update content now, preview and history after a debounce. */
  const onEdit = useCallback((value: string) => {
    setContent(value)
    setError(null)
    if (editTimer.current !== undefined) clearTimeout(editTimer.current)
    editTimer.current = setTimeout(() => {
      setPreview(value)
      setHistory(prev => {
        if (prev[historyIndex] === value) return prev
        const next = [...prev.slice(0, historyIndex + 1), value]
        setHistoryIndex(next.length - 1)
        return next
      })
    }, EDIT_DEBOUNCE_MS)
  }, [historyIndex])

  const undo = useCallback(() => {
    setHistoryIndex(prev => {
      const next = Math.max(0, prev - 1)
      const value = history[next]
      if (value !== undefined) {
        setContent(value)
        setPreview(value)
      }
      return next
    })
  }, [history])

  const redo = useCallback(() => {
    setHistoryIndex(prev => {
      const next = Math.min(history.length - 1, prev + 1)
      const value = history[next]
      if (value !== undefined) {
        setContent(value)
        setPreview(value)
      }
      return next
    })
  }, [history])

  const save = useCallback(async () => {
    if (cwd === undefined || currentFile === null) return
    try {
      await writeFile(cwd, currentFile, content)
      setSaved(content)
      setPreview(content)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [cwd, currentFile, content, writeFile])

  const createNew = useCallback(async () => {
    if (cwd === undefined) return
    const name = window.prompt('新文件（相对路径，如 new.html 或 img/icon.svg）')
    if (name === null || name.trim() === '') return
    try {
      const path = await createFile(cwd, joinPath(cwd, name.trim()))
      setFiles(prev => prev.includes(path) ? prev : [...prev, path].sort())
      await openFile(path)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [cwd, createFile, openFile])

  /** Submit the current annotation back to the agent session. */
  const submitNote = useCallback(async () => {
    if (sessionId === undefined || currentFile === null || note.trim() === '') return
    const message = formatAnnotationMessage(currentFile, selected, note.trim())
    try {
      const ok = await submitAnnotation(sessionId, message)
      if (!ok) {
        setError('批注提交失败：当前会话未接受该消息')
        return
      }
      setAnnotations(prev => [{
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()),
        filePath: currentFile,
        selector: selected?.selector ?? '',
        payload: selected,
        note: note.trim(),
        status: 'pending',
        createdAt: Date.now(),
      }, ...prev])
      setNote('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [sessionId, currentFile, selected, note, submitAnnotation])

  // Route inspector messages from the sandboxed preview iframe.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as unknown
      if (typeof data !== 'object' || data === null) return
      const message = data as { type?: unknown; payload?: unknown }
      if (message.type === INSPECT_EVENT) {
        setSelected(message.payload as InspectPayload)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const toggleInspect = useCallback(() => {
    setInspectMode(prev => {
      const next = !prev
      postToFrame({ type: INSPECT_TOGGLE, enabled: next })
      return next
    })
  }, [postToFrame])

  const changeZoom = useCallback((next: number) => {
    setZoom(next)
    postToFrame({ type: ZOOM_EVENT, scale: next })
  }, [postToFrame])

  const toggleStatus = useCallback((id: string) => {
    setAnnotations(prev => prev.map(a => a.id === id
      ? { ...a, status: a.status === 'pending' ? 'processed' as const : 'pending' as const }
      : a))
  }, [])

  if (collapsed) {
    return (
      <button
        type="button"
        className={styles.reopen}
        data-tooltip="Visual HTML/SVG Studio"
        aria-label="打开 Visual HTML/SVG Studio"
        onClick={() => setCollapsed(false)}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden fill="none">
          <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" />
          <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" />
          <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" />
          <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" fill="currentColor" />
        </svg>
      </button>
    )
  }

  const isDirty = content !== saved

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <span className={styles.title}>Visual Studio</span>

        <div className={styles.toolbarGroup}>
          <select
            className={styles.select}
            value={currentFile ?? ''}
            aria-label="选择文件"
            onChange={event => { if (event.target.value !== '') void openFile(event.target.value) }}
          >
            <option value="" disabled>选择文件…</option>
            {files.map(file => (
              <option key={file} value={file}>{shorten(cwd, file)}</option>
            ))}
          </select>
        </div>

        <div className={styles.toolbarDivider} />

        <div className={styles.toolbarGroup}>
          <button type="button" className={styles.btn} onClick={createNew}>新建</button>
          <button type="button" className={styles.btn} onClick={save} disabled={currentFile === null || !isDirty}>保存</button>
          <button type="button" className={styles.btn} onClick={refresh} disabled={currentFile === null}>刷新</button>
        </div>

        <div className={styles.toolbarDivider} />

        <div className={styles.toolbarGroup}>
          <button type="button" className={styles.btn} onClick={undo} disabled={historyIndex <= 0}>撤销</button>
          <button type="button" className={styles.btn} onClick={redo} disabled={historyIndex >= history.length - 1}>重做</button>
        </div>

        <div className={styles.spacer} />

        <div className={styles.toolbarGroup}>
          <button
            type="button"
            className={styles.iconBtn}
            data-tooltip={codeCollapsed ? '展开代码' : '折叠代码'}
            aria-label={codeCollapsed ? '展开代码' : '折叠代码'}
            onClick={() => setCodeCollapsed(v => !v)}
          >
            {codeCollapsed ? '⟩' : '⟨'}
          </button>
          <button
            type="button"
            className={inspectMode ? styles.btnActive : styles.btn}
            onClick={toggleInspect}
          >
            {inspectMode ? '检查中' : '元素检查'}
          </button>
          <button
            type="button"
            className={viewport === 'mobile' ? styles.btnActive : styles.btn}
            data-tooltip={viewport === 'desktop' ? '切换到手机视口' : '切换到桌面视口'}
            onClick={() => setViewport(v => (v === 'desktop' ? 'mobile' : 'desktop'))}
          >
            {viewport === 'desktop' ? '桌面' : '手机'}
          </button>
          <select
            className={styles.select}
            style={{ flex: 'none', minWidth: 72 }}
            value={String(zoom)}
            aria-label="预览缩放"
            onChange={event => changeZoom(Number(event.target.value))}
          >
            {ZOOM_OPTIONS.map(scale => (
              <option key={scale} value={scale}>{`${Math.round(scale * 100)}%`}</option>
            ))}
          </select>
          <button
            type="button"
            className={styles.iconBtn}
            data-tooltip="收起面板"
            aria-label="收起面板"
            onClick={() => setCollapsed(true)}
          >
            ×
          </button>
        </div>
      </div>

      {error !== null && <div className={styles.error}>{error}</div>}

      <div className={styles.body}>
        <div className={codeCollapsed ? `${styles.codePane} ${styles.codePaneCollapsed}` : styles.codePane}>
          {codeCollapsed ? (
            <div className={styles.codeRail}>
              <button
                type="button"
                className={styles.iconBtn}
                data-tooltip="展开代码"
                aria-label="展开代码"
                onClick={() => setCodeCollapsed(false)}
              >
                ⟩
              </button>
              <span className={styles.kvLabel} style={{ writingMode: 'vertical-rl' }}>代码</span>
            </div>
          ) : (
            <CodeEditor value={content} onChange={onEdit} placeholder="在此编辑 HTML/SVG 源码，或在上方选择文件" />
          )}
        </div>

        <div className={`${styles.preview} ${viewport === 'mobile' ? styles.mobile : ''}`}>
          <iframe
            ref={iframeRef}
            title="Visual Studio preview"
            sandbox="allow-scripts"
            srcDoc={srcdoc}
            onLoad={applyFrameState}
          />
        </div>

        <aside className={styles.inspector}>
          <div className={styles.section}>
            <div className={styles.sectionTitle}>元素检查</div>
            {selected === null ? (
              <div className={styles.kv}>在预览中开启「元素检查」后点击任意元素</div>
            ) : (
              <>
                <div className={styles.kv}><span className={styles.kvLabel}>标签 </span>{selected.tag}</div>
                <div className={styles.kv}><span className={styles.kvLabel}>路径 </span>{selected.path}</div>
                <div className={styles.kv}><span className={styles.kvLabel}>Selector </span>{selected.selector}</div>
                <div className={styles.kv}><span className={styles.kvLabel}>尺寸 </span>{selected.rect.width}×{selected.rect.height}</div>
              </>
            )}
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>添加批注</div>
            <textarea
              className={styles.noteInput}
              value={note}
              onChange={event => setNote(event.target.value)}
              placeholder={selected === null ? '例如：这里间距太大' : `针对 ${selected.tag} 的批注…`}
              rows={3}
            />
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => void submitNote()}
              disabled={currentFile === null || sessionId === undefined || note.trim() === ''}
            >
              提交给 Agent
            </button>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>批注（{annotations.length}）</div>
            {annotations.length === 0 && <div className={styles.kv}>暂无批注</div>}
            {annotations.map(annotation => (
              <div key={annotation.id} className={styles.annotation}>
                <span className={annotation.status === 'pending' ? styles.statusPending : styles.statusProcessed}>
                  {annotation.status === 'pending' ? '未处理' : '已处理'}
                </span>
                <div className={styles.annotationNote}>{annotation.note}</div>
                <div className={styles.annotationMeta}>
                  {shorten(cwd, annotation.filePath)}
                  {annotation.selector !== '' ? ` · ${annotation.selector}` : ''}
                </div>
                <button type="button" className={styles.btn} onClick={() => toggleStatus(annotation.id)}>
                  {annotation.status === 'pending' ? '标记已处理' : '标记未处理'}
                </button>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}
