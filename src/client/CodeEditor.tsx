/**
 * Code editor with a line-number gutter and basic HTML/SVG syntax highlighting.
 * The highlighted markup sits in a `<pre>` layer and a transparent-text
 * `<textarea>` overlays it, so editing, selection, and scrolling stay native
 * while the visible text is colored.
 */

import { useCallback, useMemo, useRef } from 'react'
import { highlightHtml } from './highlighter.ts'
import styles from './StudioPanel.module.css'

/** A text selection in the editor, as line numbers plus the selected text. */
export interface EditorSelection {
  startLine: number
  endLine: number
  text: string
}

export interface CodeEditorProps {
  value: string
  onChange(next: string): void
  placeholder?: string
  onSelectionChange?(selection: EditorSelection | null): void
}

export function CodeEditor({ value, onChange, placeholder, onSelectionChange }: CodeEditorProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  const highlighted = useMemo(() => `${highlightHtml(value)}\n`, [value])
  const lineNumbers = useMemo(() => {
    const count = value.split('\n').length
    return Array.from({ length: count }, (_, index) => index + 1)
  }, [value])

  const syncScroll = useCallback((scrollTop: number, scrollLeft: number) => {
    const pre = preRef.current
    if (pre !== null) {
      pre.scrollTop = scrollTop
      pre.scrollLeft = scrollLeft
    }
    const gutter = gutterRef.current
    if (gutter !== null) gutter.scrollTop = scrollTop
  }, [])

  const reportSelection = useCallback((textarea: HTMLTextAreaElement) => {
    if (onSelectionChange === undefined) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    if (start === end) {
      onSelectionChange(null)
      return
    }
    const lineOf = (index: number): number => value.slice(0, index).split('\n').length
    onSelectionChange({
      startLine: lineOf(start),
      endLine: lineOf(end),
      text: value.slice(start, end),
    })
  }, [value, onSelectionChange])

  return (
    <div className={styles.codeEditor}>
      <div className={styles.gutter} ref={gutterRef} aria-hidden>
        {lineNumbers.map(number => <div key={number} className={styles.gutterLine}>{number}</div>)}
      </div>
      <div className={styles.codeBody}>
        <pre ref={preRef} className={styles.code} aria-hidden dangerouslySetInnerHTML={{ __html: highlighted }} />
        <textarea
          className={styles.codeInput}
          value={value}
          onChange={event => onChange(event.target.value)}
          onScroll={event => syncScroll(event.currentTarget.scrollTop, event.currentTarget.scrollLeft)}
          onSelect={event => reportSelection(event.currentTarget)}
          onBlur={() => onSelectionChange?.(null)}
          spellCheck={false}
          wrap="off"
          autoCapitalize="off"
          autoComplete="off"
          aria-label="源码编辑器"
          placeholder={placeholder}
        />
      </div>
    </div>
  )
}
