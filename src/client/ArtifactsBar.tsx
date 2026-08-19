/**
 * The artifacts bar shown above the composer: a compact, collapsible list of
 * the files the current session's agent created or modified. Clicking an item
 * opens it in the Studio panel.
 */

import { useEffect, useState } from 'react'
import type { ArtifactRecord } from './studio.ts'
import styles from './StudioPanel.module.css'

export interface ArtifactsBarProps {
  sessionId: string
  listArtifacts(sessionId: string): Promise<ArtifactRecord[]>
  openFile(path: string): void
}

/** Human-friendly relative time ("刚刚", "N 分钟前", …). */
function relativeTime(at: number): string {
  const diff = Date.now() - at
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / 86_400_000)} 天前`
}

/** Precise timestamp for the hover tooltip. */
function preciseTime(at: number): string {
  return new Date(at).toLocaleString()
}

/** A small file-type glyph for one artifact kind. */
function kindIcon(kind: ArtifactRecord['kind']) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
  if (kind === 'image') {
    return (
      <svg {...common}>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
    )
  }
  if (kind === 'html' || kind === 'svg') {
    return (
      <svg {...common}>
        <path d="m18 16 4-4-4-4" />
        <path d="m6 8-4 4 4 4" />
        <path d="m14.5 4-5 16" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M15 2v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </svg>
  )
}

export function ArtifactsBar({ sessionId, listArtifacts, openFile }: ArtifactsBarProps) {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([])
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      listArtifacts(sessionId)
        .then(next => { if (!cancelled) setArtifacts(next) })
        .catch(() => { /* transient read failures are ignored */ })
    }
    load()
    const timer = setInterval(load, 2000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [sessionId, listArtifacts])

  if (artifacts.length === 0) return null

  return (
    <div className={styles.artifactsBar}>
      <button
        type="button"
        className={styles.artifactsToggle}
        onClick={() => setCollapsed(value => !value)}
        aria-expanded={!collapsed}
      >
        <span>{collapsed ? '›' : '⌄'}</span> 产物（{artifacts.length}）
      </button>
      {!collapsed && (
        <div className={styles.artifactsList}>
          {artifacts.map(artifact => (
            <button
              key={artifact.path}
              type="button"
              className={styles.artifactItem}
              onClick={() => openFile(artifact.path)}
              title={`${artifact.path}\n创建: ${preciseTime(artifact.createdAt)}\n更新: ${preciseTime(artifact.updatedAt)}\n版本: v${artifact.version}`}
            >
              <span className={styles.artifactIcon}>{kindIcon(artifact.kind)}</span>
              <span className={styles.artifactName}>{artifact.name}</span>
              <span className={styles.artifactMeta}>v{artifact.version} · {relativeTime(artifact.updatedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
