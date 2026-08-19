/**
 * The composer-toolbar entry button that opens Visual HTML/SVG Studio. It sits
 * beside the access-mode control and reflects the shared open state with a
 * light selected style.
 */

import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { StudioState } from './studio.ts'
import styles from './StudioPanel.module.css'

export interface StudioEntryButtonProps {
  useOpen: SnapshotSelectorHook<StudioState>
  toggle(): void
}

export function StudioEntryButton({ useOpen, toggle }: StudioEntryButtonProps) {
  const open = useOpen(value => value.open)
  return (
    <button
      type="button"
      className={open ? `${styles.entryBtn} ${styles.entryBtnActive}` : styles.entryBtn}
      data-tooltip="打开 Visual Studio"
      aria-label="打开 Visual Studio"
      aria-pressed={open}
      onClick={toggle}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m18 16 4-4-4-4" />
        <path d="m6 8-4 4 4 4" />
        <path d="m14.5 4-5 16" />
      </svg>
    </button>
  )
}
