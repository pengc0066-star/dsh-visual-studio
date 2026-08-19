/**
 * The Visual HTML/SVG Studio panel: a centered modal with a workspace file
 * picker, source editor (line numbers + highlighting), sandboxed centered
 * preview, element inspector, annotations, undo/redo, and viewport switch. The
 * component is a pure props consumer — all host I/O and session routing arrive
 * through the injected face from the plugin apply closure.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { CodeEditor } from './CodeEditor.tsx'
import type { EditorSelection } from './CodeEditor.tsx'
import { formatAnnotationMessage, imageMime, kindOfPath, relativePathOf } from './studio.ts'
import type { Annotation, AnnotationMeta, InspectPayload, StudioPanelFace, StudioState } from './studio.ts'
import { INSPECT_EVENT, INSPECT_TOGGLE, ZOOM_EVENT, previewDocument } from './inspector.ts'
import styles from './StudioPanel.module.css'

/** Component props: the injected file/session face plus the global standard kit. */
export interface StudioPanelProps extends StudioPanelFace {
  useSessions: SnapshotSelectorHook<SessionListState>
  useWorkspaces: SnapshotSelectorHook<WorkspaceListState>
  useOpen: SnapshotSelectorHook<StudioState>
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
  const { useSessions, useOpen, listFiles, readFile, readFileBytes, writeFile, createFile, restorePrevious, submitAnnotation, listArtifacts, close, consumePendingFile, setCurrentPath } = props
  const open = useOpen(value => value.open)
  const sessionId = useSessions(s => s.current)
  const cwd = useSessions(s => (s.current === undefined ? undefined : s.byId[s.current]?.cwd))

  const [codeCollapsed, setCodeCollapsed] = useState(false)
  const [files, setFiles] = useState<string[]>([])
  const [currentFile, setCurrentFile] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState<number | undefined>(undefined)
  const [content, setContent] = useState('')
  const [preview, setPreview] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageBox, setImageBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [textSelection, setTextSelection] = useState<EditorSelection | null>(null)
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
  const imageDrag = useRef<{ x: number; y: number } | null>(null)
  const loadedPathRef = useRef<string | null>(null)

  const currentKind = currentFile === null ? null : kindOfPath(currentFile)
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
      setSelected(null)
      setImageBox(null)
      setTextSelection(null)
      setError(null)
      setCurrentPath(path)
      loadedPathRef.current = path
      if (kindOfPath(path) === 'image') {
        const base64 = await readFileBytes(cwd, path)
        setCurrentFile(path)
        setContent('')
        setPreview('')
        setImageUrl(`data:${imageMime(path)};base64,${base64}`)
        setSaved('')
        setHistory([])
        setHistoryIndex(-1)
      } else {
        const text = await readFile(cwd, path)
        setCurrentFile(path)
        setContent(text)
        setPreview(text)
        setImageUrl(null)
        setSaved(text)
        setHistory([text])
        setHistoryIndex(0)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [cwd, readFile, readFileBytes, setCurrentPath])

  // Open the file queued by the artifacts bar (or entry button) once visible.
  useEffect(() => {
    if (!open) return
    const pending = consumePendingFile()
    if (pending !== null) void openFile(pending)
  }, [open, consumePendingFile, openFile])

  // Resolve the open file's artifact version for annotation metadata.
  useEffect(() => {
    if (currentFile === null || sessionId === undefined) {
      setCurrentVersion(undefined)
      return
    }
    let cancelled = false
    listArtifacts(sessionId).then(artifacts => {
      if (cancelled) return
      const match = artifacts.find(artifact => artifact.path === currentFile)
      setCurrentVersion(match?.version)
    }).catch(() => { /* version is best-effort */ })
    return () => { cancelled = true }
  }, [currentFile, sessionId, listArtifacts])

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

  /** Normalized image coordinates from a mouse event, in percent. */
  const imagePoint = useCallback((event: ReactMouseEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.round(((event.clientX - rect.left) / rect.width) * 100)
    const y = Math.round(((event.clientY - rect.top) / rect.height) * 100)
    return { x, y }
  }, [])

  const onImageMouseDown = useCallback((event: ReactMouseEvent<HTMLImageElement>) => {
    const point = imagePoint(event)
    imageDrag.current = point
    setImageBox({ x: point.x, y: point.y, width: 0, height: 0 })
    setSelected(null)
  }, [imagePoint])

  const onImageMouseMove = useCallback((event: ReactMouseEvent<HTMLImageElement>) => {
    const start = imageDrag.current
    if (start === null) return
    const point = imagePoint(event)
    setImageBox({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    })
  }, [imagePoint])

  const onImageMouseUp = useCallback(() => {
    imageDrag.current = null
  }, [])

  /** Restore the most recent pre-overwrite backup over the open file. */
  const restore = useCallback(async () => {
    if (cwd === undefined || currentFile === null) return
    try {
      const result = await restorePrevious(cwd, currentFile)
      if (!result.restored) {
        setError('没有可恢复的上一版本')
        return
      }
      await openFile(currentFile)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [cwd, currentFile, restorePrevious, openFile])

  /** Submit the current annotation back to the agent session. */
  const submitNote = useCallback(async () => {
    if (note.trim() === '') return
    if (sessionId === undefined) {
      setError('当前没有可用会话，无法提交批注')
      return
    }
    if (currentFile === null) {
      setError('请先打开一个文件再提交批注')
      return
    }
    const meta: AnnotationMeta = {
      ...(currentVersion !== undefined ? { version: currentVersion } : {}),
      ...(currentKind !== null ? { kind: currentKind } : {}),
      ...(currentKind === 'image' && imageBox !== null
        ? { location: imageBox.width === 0 && imageBox.height === 0 ? `x=${imageBox.x}% y=${imageBox.y}%` : `x=${imageBox.x}% y=${imageBox.y}% w=${imageBox.width}% h=${imageBox.height}%` }
        : {}),
      ...(currentKind !== 'image' && currentKind !== 'html' && currentKind !== 'svg' && textSelection !== null
        ? { location: `L${textSelection.startLine}-L${textSelection.endLine}` }
        : {}),
    }
    const message = formatAnnotationMessage(currentFile, selected, note.trim(), meta)
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
  }, [sessionId, currentFile, selected, note, submitAnnotation, currentVersion, currentKind, imageBox])

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

  if (!open) return null

  const isDirty = content !== saved
  const hasLocation = currentKind === 'image'
    ? imageBox !== null
    : (currentKind === 'html' || currentKind === 'svg')
      ? selected !== null
      : true

  // Annotations for the current document only (same artifact id).
  const currentAnnotations = currentFile === null ? [] : annotations.filter(a => a.filePath === currentFile)

  // Development assertion: the open path, loaded content source, and annotation
  // scope must reference one document identity.
  useEffect(() => {
    if (currentFile !== null && loadedPathRef.current !== currentFile) {
      console.warn(`[visual-studio] 文档身份不一致: 打开 ${currentFile}，但内容/预览来自 ${loadedPathRef.current}`)
    }
    const foreign = annotations.filter(a => currentFile === null || a.filePath !== currentFile)
    if (currentFile !== null && foreign.length > 0) {
      console.warn(`[visual-studio] 批注作用域含其他文件: ${foreign.map(a => a.filePath).join(', ')}`)
    }
  }, [currentFile, content, preview, imageUrl, annotations])

  return (
    <div className={styles.backdrop} onClick={close}>
      <div className={styles.panel} onClick={event => event.stopPropagation()}>
        <div className={styles.toolbar}>
          <span className={styles.title}>Visual Studio</span>

          <div className={styles.toolbarGroup}>
            <div className={styles.pathDisplay} title={currentFile ?? undefined}>
              {currentFile === null ? '未选择文件' : relativePathOf(cwd, currentFile)}
            </div>
            <select
              className={styles.select}
              value={currentFile ?? ''}
              aria-label="打开文件"
              onChange={event => { if (event.target.value !== '') void openFile(event.target.value) }}
            >
              <option value="" disabled>打开文件…</option>
              {files.map(file => (
                <option key={file} value={file}>{relativePathOf(cwd, file)}</option>
              ))}
              {currentFile !== null && !files.includes(currentFile) && (
                <option value={currentFile}>{relativePathOf(cwd, currentFile)}</option>
              )}
            </select>
            <button type="button" className={styles.btn} onClick={createNew}>新建</button>
            <button type="button" className={styles.btn} onClick={save} disabled={currentFile === null || !isDirty}>保存</button>
            <button type="button" className={styles.btn} onClick={refresh} disabled={currentFile === null}>刷新</button>
            <button type="button" className={styles.btn} data-tooltip="恢复上一版本" onClick={() => void restore()} disabled={currentFile === null}>恢复</button>
          </div>

          <div className={styles.toolbarDivider} />

          <div className={styles.toolbarGroup}>
            <button type="button" className={styles.btn} onClick={undo} disabled={historyIndex <= 0}>撤销</button>
            <button type="button" className={styles.btn} onClick={redo} disabled={historyIndex >= history.length - 1}>重做</button>
          </div>

          <div className={styles.toolbarDivider} />

          <div className={styles.spacer} />

          <div className={styles.toolbarGroup}>
            <button
              type="button"
              className={inspectMode ? `${styles.btn} ${styles.btnActive}` : styles.btn}
              onClick={toggleInspect}
            >
              {inspectMode ? '检查中' : '元素检查'}
            </button>
            <button
              type="button"
              className={viewport === 'mobile' ? `${styles.btn} ${styles.btnActive}` : styles.btn}
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
              className={`${styles.btn} ${styles.iconBtn}`}
              data-tooltip="关闭"
              aria-label="关闭"
              onClick={close}
            >
              ×
            </button>
          </div>
        </div>

        {error !== null && <div className={styles.error}>{error}</div>}

        <div className={styles.body}>
          <div className={codeCollapsed ? `${styles.codePane} ${styles.codePaneCollapsed}` : styles.codePane}>
            {!codeCollapsed && (currentFile === null
              ? <div className={styles.emptyState}>选择文件后在此编辑源码</div>
              : currentKind === 'image'
                ? <div className={styles.emptyState}>图片文件（无源码编辑）</div>
                : <CodeEditor value={content} onChange={onEdit} placeholder="在此编辑源码" onSelectionChange={setTextSelection} />)}
          </div>

          <div className={styles.codeDivider}>
            <button
              type="button"
              className={styles.dividerBtn}
              data-tooltip={codeCollapsed ? '展开代码' : '折叠代码'}
              aria-label={codeCollapsed ? '展开代码' : '折叠代码'}
              onClick={() => setCodeCollapsed(v => !v)}
            >
              {codeCollapsed ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 3v18" />
                  <path d="m14 9 3 3-3 3" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 3v18" />
                  <path d="m16 15-3-3 3-3" />
                </svg>
              )}
            </button>
          </div>

          <div className={`${styles.preview} ${viewport === 'mobile' ? styles.mobile : ''}`}>
            {currentFile === null
              ? <div className={styles.emptyState}>选择文件后在此预览</div>
              : currentKind === 'image'
                ? (
                  <div className={styles.imageStage}>
                    <img
                      className={styles.imagePreview}
                      src={imageUrl ?? undefined}
                      alt={currentFile}
                      draggable={false}
                      onMouseDown={onImageMouseDown}
                      onMouseMove={onImageMouseMove}
                      onMouseUp={onImageMouseUp}
                      onMouseLeave={onImageMouseUp}
                      style={{ transform: `scale(${zoom})` }}
                    />
                    {imageBox !== null && (imageBox.width > 0 || imageBox.height > 0) && (
                      <div
                        className={styles.imageBoxOverlay}
                        style={{ left: `${imageBox.x}%`, top: `${imageBox.y}%`, width: `${imageBox.width}%`, height: `${imageBox.height}%` }}
                      />
                    )}
                  </div>
                )
                : currentKind === 'html' || currentKind === 'svg'
                  ? (
                    <iframe
                      ref={iframeRef}
                      title="Visual Studio preview"
                      sandbox="allow-scripts"
                      srcDoc={srcdoc}
                      onLoad={applyFrameState}
                    />
                  )
                  : <div className={styles.emptyState}>文本文件（在左侧编辑）</div>}
          </div>

          <aside className={styles.inspector}>
            <div className={styles.section}>
              <div className={styles.sectionTitle}>元素检查</div>
              {currentKind === 'image' ? (
                imageBox === null
                  ? <div className={styles.kv}>点击或拖拽图片进行点选/框选批注</div>
                  : <div className={styles.kv}><span className={styles.kvLabel}>定位 </span>x={imageBox.x}% y={imageBox.y}%{imageBox.width > 0 || imageBox.height > 0 ? ` w=${imageBox.width}% h=${imageBox.height}%` : ''}</div>
              ) : currentKind === 'html' || currentKind === 'svg' ? (
                selected === null
                  ? <div className={styles.kv}>在预览中开启「元素检查」后点击任意元素</div>
                  : (
                    <>
                      <div className={styles.kv}><span className={styles.kvLabel}>标签 </span>{selected.tag}</div>
                      <div className={styles.kv}><span className={styles.kvLabel}>路径 </span>{selected.path}</div>
                      <div className={styles.kv}><span className={styles.kvLabel}>选择器 </span>{selected.selector}</div>
                      <div className={styles.kv}><span className={styles.kvLabel}>尺寸 </span>{selected.rect.width}×{selected.rect.height}</div>
                    </>
                  )
              ) : (
                textSelection === null
                  ? <div className={styles.kv}>在左侧编辑器中选中文本后批注</div>
                  : <div className={styles.kv}><span className={styles.kvLabel}>定位 </span>L{textSelection.startLine}-L{textSelection.endLine}</div>
              )}
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>添加批注</div>
              <textarea
                className={styles.noteInput}
                value={note}
                onChange={event => setNote(event.target.value)}
                placeholder={currentKind === 'image' ? '点击图片定位后输入批注' : currentKind === 'html' || currentKind === 'svg' ? '先在预览中选中元素，再输入批注' : '输入批注（例如：这段描述需要改）'}
                rows={3}
              />
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={() => void submitNote()}
                disabled={currentFile === null || note.trim() === '' || !hasLocation}
              >
                提交给 Agent
              </button>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>历史批注（{currentAnnotations.length}）</div>
              {currentAnnotations.length === 0 && <div className={styles.kv}>暂无批注</div>}
              {currentAnnotations.map(annotation => (
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
    </div>
  )
}
