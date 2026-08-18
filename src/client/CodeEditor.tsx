/**
 * Code editor with a line-number gutter and basic HTML/SVG syntax highlighting.
 * The highlighted markup sits in a `<pre>` layer and a transparent-text
 * `<textarea>` overlays it, so editing, selection, and scrolling stay native
 * while the visible text is colored.
 */

import { useCallback, useMemo, useRef } from 'react'
import { highlightHtml } from './highlighter.ts'
import styles from './StudioPanel.module.css'

export interface CodeEditorProps {
  value: string
  onChange(next: string): void
  placeholder?: string
}

export function CodeEditor({ value, onChange, placeholder }: CodeEditorProps) {
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
