// What you have published, and what happened to it.
//
// This is the view that makes publishing worth charging for: per link, who watched,
// from where, on what, for how long, and how many reached the end. The numbers are the
// server's own aggregation over viewer sessions, fetched on demand — nothing here
// derives a metric locally, because a locally-derived number could disagree with the
// one the API reports and there would be no way to tell which was right.
//
// A publication outlives its link on purpose: deleting a video stops it being served but
// keeps the analytics, so "who watched it while it was up?" stays answerable.

import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../ui/button'
import { Loader2, Trash, Link, CircleCheck, CircleX, Clock, Eye } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import { formatBytes } from '../../../../shared/publish-cost'
import type { PublicationAnalytics, PublicationAnalyticsRange, PublicationView } from '../../../hooks/usePublish'

interface SharedLinksDialogProps {
  isOpen: boolean
  onClose: () => void
  publications: PublicationView[]
  isLoadingList: boolean
  onRefresh: () => Promise<{ ok: boolean; error?: string }>
  onDelete: (publicationId: string) => Promise<{ ok: boolean; error?: string; creditsRefunded?: number }>
  onAnalytics: (
    publicationId: string,
    range: PublicationAnalyticsRange,
  ) => Promise<{ ok: true; analytics: PublicationAnalytics } | { ok: false; error: string }>
  onCopied?: (label: string) => void
}

const RANGES: PublicationAnalyticsRange[] = ['7d', '30d', '90d', 'all']

/** A publication's state as a user would say it. */
function statusLabel(publication: PublicationView): string {
  switch (publication.status) {
    case 'active':
      return `Live until ${formatDate(publication.expiresAt)}`
    case 'awaiting_upload':
      return 'Never finished uploading'
    case 'revoked':
      return 'Deleted'
    case 'expired':
      return 'Term ended'
    case 'failed':
      return 'Never published'
    default:
      return publication.status
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Seconds as a compact duration, for watch time. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${Math.round(seconds % 60)}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** "of 90s" under the average watch time, when the video's length is known. */
function watchSub(analytics: PublicationAnalytics): string {
  // `durationSec` is nullable in the contract: a publication need not know how long
  // the video is, and the analytics are still exact without it.
  const durationSec = analytics.durationSec
  if (typeof durationSec !== 'number' || !(durationSec > 0)) return ''
  return `of ${Math.round(durationSec)}s`
}

export function SharedLinksDialog({
  isOpen,
  onClose,
  publications,
  isLoadingList,
  onRefresh,
  onDelete,
  onAnalytics,
  onCopied,
}: SharedLinksDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [range, setRange] = useState<PublicationAnalyticsRange>('30d')
  const [analytics, setAnalytics] = useState<PublicationAnalytics | null>(null)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)
  const [isLoadingAnalytics, setLoadingAnalytics] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [deleteNote, setDeleteNote] = useState<string | null>(null)

  // Load the list once each time the view is opened: a publication deleted from
  // another window, or one that expired, should not linger here.
  useEffect(() => {
    if (!isOpen) return
    setSelectedId(null)
    setAnalytics(null)
    setAnalyticsError(null)
    setDeleteNote(null)
    setConfirmingDelete(null)
    void onRefresh()
  }, [isOpen, onRefresh])

  // Analytics on selection or range change, and only for a publication that exists.
  useEffect(() => {
    if (!isOpen || selectedId === null) return
    let cancelled = false
    setLoadingAnalytics(true)
    setAnalyticsError(null)
    void onAnalytics(selectedId, range).then((result) => {
      if (cancelled) return
      if (result.ok) setAnalytics(result.analytics)
      else {
        setAnalytics(null)
        setAnalyticsError(result.error)
      }
      setLoadingAnalytics(false)
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, selectedId, range, onAnalytics])

  const selected = useMemo(
    () => publications.find((publication) => publication.publicationId === selectedId) ?? null,
    [publications, selectedId],
  )

  if (!isOpen) return null

  const totalCredits = publications
    .filter((publication) => publication.status === 'active')
    .reduce((total, publication) => total + (publication.creditsCharged ?? publication.estimatedCost), 0)

  return (
    <div className="modal-backdrop flex items-center justify-center">
      <div
        className="card-clean pointer-events-auto m-4 flex h-[80vh] w-full max-w-4xl flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <div className="flex items-center gap-2">
            <Link size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-accent" />
            <h2 className="text-sm font-semibold text-fg">Shared links</h2>
            {publications.length > 0 && (
              <span className="text-xs text-muted">
                {publications.length} published · {totalCredits} credits spent
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => void onRefresh()} disabled={isLoadingList}>
              {isLoadingList ? (
                <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="animate-spin" />
              ) : (
                'Refresh'
              )}
            </Button>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* The list */}
          <div className="w-80 shrink-0 overflow-y-auto border-r border-border/60">
            {publications.length === 0 && !isLoadingList && (
              <p className="p-5 text-xs text-muted">
                Nothing published yet. Export a video and use Publish to make a share link.
              </p>
            )}
            {publications.map((publication) => {
              const live = publication.status === 'active'
              return (
                <button
                  key={publication.publicationId}
                  type="button"
                  onClick={() => setSelectedId(publication.publicationId)}
                  className={
                    'block w-full border-b border-border/40 px-4 py-3 text-left transition-colors ' +
                    (selectedId === publication.publicationId ? 'bg-accent/10' : 'hover:bg-ctl/50')
                  }
                >
                  <div className="flex items-center gap-1.5">
                    {live ? (
                      <CircleCheck size={14} strokeWidth={ICON_STROKE} className="text-accent" />
                    ) : (
                      <CircleX size={14} strokeWidth={ICON_STROKE} className="text-muted" />
                    )}
                    <span className="truncate text-sm font-medium text-fg">{publication.title}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{statusLabel(publication)}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {publication.sizeBytes !== undefined ? `${formatBytes(publication.sizeBytes)} · ` : ''}
                    {publication.creditsCharged ?? publication.estimatedCost} credits · {kindName(publication.kind)}
                  </div>
                </button>
              )
            })}
          </div>

          {/* The detail and the numbers */}
          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            {selected === null && (
              <p className="text-xs text-muted">Choose a publication to see its links and analytics.</p>
            )}

            {selected !== null && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-fg">{selected.title}</h3>
                  <p className="text-xs text-muted">
                    {statusLabel(selected)} · {formatDate(selected.createdAt)} ·{' '}
                    {selected.hasCaptions ? 'with captions' : 'no captions'}
                  </p>
                </div>

                <div className="space-y-1 text-xs">
                  {(selected.links.pageUrl ?? selected.links.embedUrl) !== undefined && (
                    <LinkLine
                      label={selected.links.pageUrl !== undefined ? 'Landing page' : 'Player'}
                      value={(selected.links.pageUrl ?? selected.links.embedUrl) as string}
                      onCopied={onCopied}
                    />
                  )}
                  <LinkLine label="Video download" value={selected.links.videoDownloadUrl} onCopied={onCopied} />
                  {selected.links.captionsDownloadUrl !== undefined && (
                    <LinkLine
                      label="Captions download"
                      value={selected.links.captionsDownloadUrl}
                      onCopied={onCopied}
                    />
                  )}
                  {selected.links.embedCode !== undefined && (
                    <LinkLine label="Embed code" value={selected.links.embedCode} onCopied={onCopied} />
                  )}
                </div>

                {/* Delete */}
                <div className="rounded-ctl border border-border/60 p-3">
                  {confirmingDelete !== selected.publicationId ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-muted">
                        Deleting removes the video at once and stops it costing storage.
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setConfirmingDelete(selected.publicationId)}
                        disabled={selected.status !== 'active'}
                      >
                        <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
                        Delete
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-fg">
                        Delete this link? The video is removed immediately and cannot be restored, and{' '}
                        <strong>
                          the {selected.creditsCharged ?? selected.estimatedCost} credits are not returned
                        </strong>{' '}
                        — the term was paid for when it was published.
                      </p>
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(null)}>
                          Keep it
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            void onDelete(selected.publicationId).then((result) => {
                              setConfirmingDelete(null)
                              setDeleteNote(
                                result.ok
                                  ? 'Deleted. The credits were not returned, as stated.'
                                  : (result.error ?? 'Could not delete it.'),
                              )
                              if (result.ok) setAnalytics(null)
                            })
                          }}
                        >
                          Delete link
                        </Button>
                      </div>
                    </div>
                  )}
                  {deleteNote !== null && <p className="mt-2 text-xs text-muted">{deleteNote}</p>}
                </div>

                {/* Analytics */}
                <div className="border-t border-border/60 pt-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-xs font-medium text-muted">Who watched</h4>
                    <div className="flex gap-1">
                      {RANGES.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setRange(option)}
                          className={
                            'rounded-ctl border px-2 py-0.5 text-xs transition-colors ' +
                            (range === option ? 'border-accent bg-accent/10 text-fg' : 'border-border/60 text-muted')
                          }
                        >
                          {option === 'all' ? 'All time' : option}
                        </button>
                      ))}
                    </div>
                  </div>

                  {isLoadingAnalytics && (
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="animate-spin" />
                      Loading analytics…
                    </div>
                  )}
                  {analyticsError !== null && <p className="text-xs text-muted">{analyticsError}</p>}

                  {!isLoadingAnalytics && analyticsError === null && analytics !== null && (
                    <div className="space-y-4">
                      {analytics.totals.views === 0 ? (
                        <p className="text-xs text-muted">
                          No views in this window yet. Analytics appear as soon as someone opens the link.
                        </p>
                      ) : (
                        <>
                          <div className="grid grid-cols-3 gap-3">
                            <Stat
                              icon={<Eye size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
                              label="Views"
                              value={String(analytics.totals.views)}
                              sub={`${analytics.totals.uniqueViewers} ${
                                analytics.totals.uniqueViewers === 1 ? 'viewer' : 'viewers'
                              }`}
                            />
                            <Stat
                              icon={<Clock size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
                              label="Average watch"
                              value={formatDuration(analytics.totals.avgWatchSeconds)}
                              sub={watchSub(analytics)}
                            />
                            <Stat
                              icon={<CircleCheck size={ICON_SIZE} strokeWidth={ICON_STROKE} />}
                              label="Finished it"
                              value={`${Math.round(analytics.totals.completionRate * 100)}%`}
                              sub={`${analytics.totals.completions} ${
                                analytics.totals.completions === 1 ? 'viewer' : 'viewers'
                              }`}
                            />
                          </div>

                          <p className="text-xs text-muted">
                            Viewers are counted per browser tab, so one person opening the link twice counts twice. No
                            cookies or personal data are collected.
                          </p>

                          {/* A day-by-day view, drawn from the series the API returns. */}
                          {analytics.timeseries.length > 0 && (
                            <div>
                              <div className="mb-1 text-xs text-muted">Views per day</div>
                              <div className="flex items-end gap-1">
                                {analytics.timeseries.map((point) => {
                                  const peak = Math.max(...analytics.timeseries.map((row) => row.views), 1)
                                  return (
                                    <div
                                      key={point.date}
                                      title={`${point.date}: ${point.views} views, ${point.uniqueViewers} viewers`}
                                      className="w-3 rounded-t bg-accent/60"
                                      style={{ height: `${Math.max(2, (point.views / peak) * 48)}px` }}
                                    />
                                  )
                                })}
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-4">
                            <DimensionTable title="Countries" rows={analytics.countries} empty="Not reported" />
                            <DimensionTable title="Devices" rows={analytics.devices} empty="Not reported" />
                          </div>

                          <div>
                            <div className="mb-1 text-xs text-muted">Where they came from</div>
                            {analytics.referrers.length === 0 ? (
                              <p className="text-xs text-muted">Not reported</p>
                            ) : (
                              <ul className="space-y-0.5">
                                {analytics.referrers.map((row) => (
                                  <li key={row.key} className="flex justify-between text-xs text-fg">
                                    <span className="truncate">
                                      {row.key === 'unknown' ? 'Direct or unknown' : row.key}
                                    </span>
                                    <span className="text-muted">{row.uniqueViewers}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function LinkLine({ label, value, onCopied }: { label: string; value: string; onCopied?: (label: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-ctl border border-border/50 px-2 py-1">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="truncate font-mono" title={value}>
        {value}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => onCopied?.(label))
        }}
      >
        Copy
      </Button>
    </div>
  )
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-ctl border border-border/60 p-2.5">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-medium text-fg">{value}</div>
      {sub !== undefined && sub.length > 0 && <div className="text-xs text-muted">{sub}</div>}
    </div>
  )
}

function DimensionTable({
  title,
  rows,
  empty,
}: {
  title: string
  rows: { key: string; uniqueViewers: number }[]
  empty: string
}) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted">{title}</div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((row) => (
            <li key={row.key} className="flex justify-between text-xs text-fg">
              <span className="truncate capitalize">{row.key}</span>
              <span className="text-muted">{row.uniqueViewers}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function kindName(kind: PublicationView['kind']): string {
  switch (kind) {
    case 'page':
      return 'landing page'
    case 'embed':
      return 'embed'
    case 'links':
      return 'links'
    default:
      return 'link'
  }
}
