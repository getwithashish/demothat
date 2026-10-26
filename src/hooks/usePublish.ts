// Renderer-side access to instant publishing.
//
// Everything goes through the preload bridge; nothing here decides a price. The dialog
// quotes one from `shared/publish-cost.ts` (the same formula the server charges from),
// and the number that counts arrives in the completion payload.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { components } from '../../shared/api-types'
import type { SubtitleCue } from '../../shared/subtitles'

export type PublicationView = components['schemas']['PublicationView']
export type PublicationAnalytics = components['schemas']['PublicationAnalytics']
export type PublicationKind = components['schemas']['PublicationKind']
export type PublishingCapabilities = components['schemas']['PublishingCapabilities']
export type PublicationAnalyticsRange = '7d' | '30d' | '90d' | 'all'

export interface PublishStatus {
  configured: boolean
  pro: boolean
  publishing: PublishingCapabilities | null
  error: string | null
}

export interface PublishProgress {
  stage: string
  stagePercent: number
  estimatedCost?: number
}

export interface PublishRequest {
  filePath: string
  kind: PublicationKind
  storageDays: number
  title?: string
  durationSec?: number
  captions?: SubtitleCue[]
}

export type PublishOutcome =
  | { ok: true; publication: PublicationView; captionsIncluded: boolean }
  | { ok: false; reason: 'canceled' | 'failed' | 'rejected'; error: string; cost?: number; balance?: number }

/**
 * Publishing status, the run itself, the library and its analytics.
 *
 * The status is read once when the hook mounts and again after a successful publish:
 * the balance the server knows about changes when credits are spent, and the dialog
 * should not keep showing the pre-publish number.
 */
export function usePublish() {
  const [status, setStatus] = useState<PublishStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [isPublishing, setPublishing] = useState(false)
  const [progress, setProgress] = useState<PublishProgress | null>(null)
  const [publications, setPublications] = useState<PublicationView[]>([])
  const [isLoadingList, setLoadingList] = useState(false)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refreshStatus = useCallback(async (): Promise<PublishStatus | null> => {
    try {
      const next = await window.electronAPI.publishStatus()
      if (mounted.current) {
        setStatus(next)
        setStatusError(next.error)
      }
      return next
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (mounted.current) setStatusError(message)
      return null
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // Progress for whichever run is in flight.
  useEffect(() => {
    const off = window.electronAPI.onPublishProgress((payload) => {
      if (!mounted.current) return
      setProgress({
        stage: payload.stage,
        stagePercent: payload.stagePercent,
        ...(payload.estimatedCost !== undefined ? { estimatedCost: payload.estimatedCost } : {}),
      })
    })
    // Wrapped rather than returned directly: the preload's unsubscribe returns the
    // IpcRenderer, which is not a valid effect destructor.
    return () => {
      off()
    }
  }, [])

  const start = useCallback(async (request: PublishRequest): Promise<PublishOutcome> => {
    setPublishing(true)
    setProgress({ stage: 'Preparing', stagePercent: 0 })
    try {
      const outcome = (await window.electronAPI.startPublish(request)) as PublishOutcome
      if (outcome.ok) {
        // The list is stale the moment something is published.
        setPublications((current) => [...current, outcome.publication])
        void refreshStatus()
      }
      return outcome
    } catch (error) {
      return {
        ok: false,
        reason: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      if (mounted.current) {
        setPublishing(false)
        setProgress(null)
      }
    }
  }, [refreshStatus])

  const cancel = useCallback(() => {
    window.electronAPI.cancelPublish()
  }, [])

  const loadList = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    setLoadingList(true)
    try {
      const result = await window.electronAPI.listPublications()
      if (!mounted.current) return { ok: false }
      if (result.ok) {
        setPublications(result.publications)
        return { ok: true }
      }
      return { ok: false, error: result.error }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      if (mounted.current) setLoadingList(false)
    }
  }, [])

  const remove = useCallback(
    async (publicationId: string): Promise<{ ok: boolean; error?: string; creditsRefunded?: number }> => {
      try {
        const result = await window.electronAPI.deletePublication(publicationId)
        if (!result.ok) return { ok: false, error: result.error }
        setPublications((current) =>
          current.map((publication) =>
            publication.publicationId === publicationId ? result.publication : publication,
          ),
        )
        return { ok: true, creditsRefunded: result.creditsRefunded }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    [],
  )

  const analytics = useCallback(
    async (
      publicationId: string,
      range: PublicationAnalyticsRange,
    ): Promise<{ ok: true; analytics: PublicationAnalytics } | { ok: false; error: string }> => {
      try {
        return await window.electronAPI.publicationAnalytics(publicationId, range)
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    [],
  )

  return {
    status,
    statusError,
    isPublishing,
    progress,
    publications,
    isLoadingList,
    refreshStatus,
    start,
    cancel,
    loadList,
    remove,
    analytics,
  }
}
