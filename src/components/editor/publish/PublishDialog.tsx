// The Publish dialog: put a rendered video behind a share link.
//
// Three things this dialog is careful about, because each is a place a user could feel
// misled:
//
// **The price is shown before the upload and the charge is shown after it.** The quote
// comes from `shared/publish-cost.ts`, which mirrors the server's formula; the number
// that counts is the one the server reports in the completion payload, and when the two
// differ (the declared size was wrong) the dialog says what was actually charged rather
// than quietly showing the estimate.
//
// **"Credits are not refunded" is on the screen, not in a tooltip.** Deleting a link
// stops the storage costing anything but does not return the term, so saying so up
// front is the difference between a policy and a trap.
//
// **A link is a key.** The slug is the only thing granting access, and anyone who has
// the link can watch. That is stated where the link is handed over.

import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Section } from '../../ui/section'
import { Loader2, CircleCheck, Copy, ExternalLink, Link, Code, Ban, Lock } from 'tabler-icons-react'
import { ICON_SIZE, ICON_STROKE } from '../../ui/icons'
import {
  creditsToUsd,
  describeKind,
  describeTerm,
  estimatePublishCredits,
  fitsSizeLimit,
  formatBytes,
  type PublicationKind,
} from '../../../../shared/publish-cost'
import type { SubtitleCue } from '../../../../shared/subtitles'
import type {
  PublishOutcome,
  PublishProgress,
  PublishRequest,
  PublicationView,
  PublishingCapabilities,
} from '../../../hooks/usePublish'

interface PublishDialogProps {
  isOpen: boolean
  onClose: () => void
  capabilities: PublishingCapabilities | null
  /** The local Pro gate: publishing is a Pro feature. */
  pro: boolean
  configured: boolean
  isPublishing: boolean
  progress: PublishProgress | null
  balance: number
  /** The rendered video to publish, and what it costs to keep. */
  filePath: string | null
  fileSizeBytes: number
  durationSec: number
  /** The project's captions, in export time. Publishable alongside the video. */
  cues: SubtitleCue[]
  defaultTitle: string
  onPublish: (request: PublishRequest) => Promise<PublishOutcome>
  onCancel: () => void
  onUnlock: () => void
  onOpenLibrary: () => void
  onCopied?: (label: string) => void
}

/** Copy-to-clipboard with the feedback the rest of the app uses. */
function CopyButton({
  value,
  label,
  onCopied,
}: {
  value: string
  label: string
  onCopied?: (label: string) => void
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          onCopied?.(label)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? (
        <CircleCheck size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
      ) : (
        <Copy size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
      )}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  )
}

function LinkRow({
  icon,
  label,
  value,
  onCopied,
}: {
  icon: React.ReactNode
  label: string
  value: string
  onCopied?: (label: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
          {icon}
          {label}
        </div>
        <div className="truncate font-mono text-xs text-fg" title={value}>
          {value}
        </div>
      </div>
      <CopyButton value={value} label={label} onCopied={onCopied} />
    </div>
  )
}

/** Where the term ends, in the user's own date format. */
function formatExpiry(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function PublishDialog({
  isOpen,
  onClose,
  capabilities,
  pro,
  configured,
  isPublishing,
  progress,
  balance,
  filePath,
  fileSizeBytes,
  durationSec,
  cues,
  defaultTitle,
  onPublish,
  onCancel,
  onUnlock,
  onOpenLibrary,
  onCopied,
}: PublishDialogProps) {
  const [kind, setKind] = useState<PublicationKind>('page')
  const [storageDays, setStorageDays] = useState<number>(365)
  const [title, setTitle] = useState('')
  const [result, setResult] = useState<PublishOutcome | null>(null)
  const [started, setStarted] = useState(false)

  // The server's defaults drive the form: the first term offered is the shortest and
  // the default is the longest, so a rate change on the server is a change here.
  useEffect(() => {
    if (capabilities === null) return
    setStorageDays(capabilities.defaultDurationDays)
    setKind(capabilities.kinds.includes('page') ? 'page' : (capabilities.kinds[0] ?? 'links'))
  }, [capabilities])

  useEffect(() => {
    if (isOpen) {
      setResult(null)
      setStarted(false)
      setTitle(defaultTitle)
    }
  }, [isOpen, defaultTitle])

  const cost = useMemo(() => {
    if (capabilities === null || fileSizeBytes <= 0) return null
    return estimatePublishCredits(capabilities, { sizeBytes: fileSizeBytes, storageDays, kind })
  }, [capabilities, fileSizeBytes, storageDays, kind])

  if (!isOpen) return null

  const tooBig = capabilities !== null && !fitsSizeLimit(capabilities, fileSizeBytes)
  const canPublish =
    configured &&
    pro &&
    capabilities !== null &&
    capabilities.enabled &&
    filePath !== null &&
    fileSizeBytes > 0 &&
    !tooBig &&
    !isPublishing

  const startPublish = () => {
    if (filePath === null || capabilities === null) return
    setStarted(true)
    void onPublish({
      filePath,
      kind,
      storageDays,
      ...(title.trim().length > 0 ? { title: title.trim() } : {}),
      ...(durationSec > 0 ? { durationSec } : {}),
      ...(cues.length > 0 ? { captions: cues } : {}),
    }).then(setResult)
  }

  const header = (
    <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
      <div className="flex items-center gap-2">
        <Link size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-accent" />
        <h2 className="text-sm font-semibold text-fg">Instant publishing</h2>
      </div>
      <Button variant="ghost" size="sm" onClick={onClose} disabled={isPublishing}>
        Close
      </Button>
    </div>
  )

  // --- Result ------------------------------------------------------------------
  if (result !== null && !isPublishing) {
    if (!result.ok) {
      return (
        <Wrapper>
          {header}
          <div className="space-y-3 p-5">
            <div className="flex items-start gap-2 text-sm text-fg">
              <Ban size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mt-0.5 text-danger" />
              <span>{result.error}</span>
            </div>
            {result.cost !== undefined && (
              <p className="text-xs text-muted">
                This publication costs {result.cost} credits
                {result.balance !== undefined ? ` and the balance is ${result.balance}` : ''}.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setResult(null)}>
                Back
              </Button>
              {result.reason === 'rejected' && (
                <Button size="sm" onClick={onUnlock}>
                  Buy credits
                </Button>
              )}
            </div>
          </div>
        </Wrapper>
      )
    }

    const publication: PublicationView = result.publication
    const charged = publication.creditsCharged ?? publication.estimatedCost
    return (
      <Wrapper>
        {header}
        <div className="space-y-4 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-fg">
            <CircleCheck size={ICON_SIZE} strokeWidth={ICON_STROKE} className="text-accent" />
            Published · {creditsLabel(charged)} charged
            <span className="font-normal text-muted">({formatUsd(creditsToUsd(charged))})</span>
          </div>

          <p className="text-xs text-muted">
            The link works until {formatExpiry(publication.expiresAt)}. Deleting it before then
            stops the video costing any storage, but the credits are not returned.
          </p>

          <div className="rounded-ctl border border-border/60 px-3">
            {publication.links.pageUrl !== undefined && (
              <LinkRow
                icon={<Link size={12} strokeWidth={ICON_STROKE} />}
                label="Landing page"
                value={publication.links.pageUrl}
                onCopied={onCopied}
              />
            )}
            {publication.links.embedUrl !== undefined && (
              <LinkRow
                icon={<Code size={12} strokeWidth={ICON_STROKE} />}
                label="Player"
                value={publication.links.embedUrl}
                onCopied={onCopied}
              />
            )}
            <LinkRow
              icon={<Link size={12} strokeWidth={ICON_STROKE} />}
              label="Video download"
              value={publication.links.videoDownloadUrl}
              onCopied={onCopied}
            />
            {publication.links.captionsDownloadUrl !== undefined && (
              <LinkRow
                icon={<Link size={12} strokeWidth={ICON_STROKE} />}
                label="Captions download"
                value={publication.links.captionsDownloadUrl}
                onCopied={onCopied}
              />
            )}
          </div>

          {publication.links.embedCode !== undefined && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted">Embed code</div>
              <textarea
                readOnly
                value={publication.links.embedCode}
                className="h-20 w-full resize-none rounded-ctl border border-border/60 bg-ctl/40 p-2 font-mono text-xs text-fg"
              />
              <div className="flex gap-2">
                <CopyButton value={publication.links.embedCode} label="Embed code" onCopied={onCopied} />
                {publication.links.embedUrl !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => window.electronAPI.openExternal(publication.links.embedUrl as string)}
                  >
                    <ExternalLink size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mr-2" />
                    Preview
                  </Button>
                )}
              </div>
            </div>
          )}

          <p className="text-xs text-muted">
            Anyone with the link can watch — the link is the key, so share it the way you would a
            file. Captions {publication.hasCaptions ? 'are' : 'are not'} included.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onOpenLibrary}>
              View analytics
            </Button>
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Wrapper>
    )
  }

  // --- Progress ----------------------------------------------------------------
  if (isPublishing || started) {
    return (
      <Wrapper>
        {header}
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-sm text-fg">
            <Loader2 size={ICON_SIZE} strokeWidth={ICON_STROKE} className="animate-spin text-accent" />
            {progress?.stage ?? 'Preparing'}
            {progress !== null && progress.stagePercent > 0 ? ` · ${Math.round(progress.stagePercent)}%` : ''}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-ctl">
            <div
              className="h-full bg-accent transition-all duration-200"
              style={{ width: `${Math.max(2, progress?.stagePercent ?? 0)}%` }}
            />
          </div>
          <p className="text-xs text-muted">
            Nothing is charged until the video has finished uploading. Cancelling before then costs
            nothing.
          </p>
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </Wrapper>
    )
  }

  // --- Settings ----------------------------------------------------------------
  return (
    <Wrapper>
      {header}
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
        {!configured && (
          <Notice>
            This computer is not activated, so it cannot publish. Enter your license key to publish
            videos.
          </Notice>
        )}

        {configured && !pro && (
          <div className="flex items-start justify-between gap-3 rounded-ctl border border-accent/30 bg-accent/5 p-3">
            <div className="flex items-start gap-2 text-sm text-fg">
              <Lock size={ICON_SIZE} strokeWidth={ICON_STROKE} className="mt-0.5 text-accent" />
              <span>
                Publishing is a Pro feature. Buying credits unlocks it, and each publication is
                charged from that balance.
              </span>
            </div>
            <Button size="sm" onClick={onUnlock}>
              Get Pro
            </Button>
          </div>
        )}

        {tooBig && capabilities !== null && (
          <Notice>
            This video is {formatBytes(fileSizeBytes)}, above the {formatBytes(capabilities.maxSizeBytes)}{' '}
            publishing limit. Export a smaller one, or publish a clip.
          </Notice>
        )}

        {capabilities === null && configured && (
          <Notice>The publishing prices could not be read from the server. Try again in a moment.</Notice>
        )}

        {filePath === null && (
          <Notice>Export this project first — publishing sends the exported video.</Notice>
        )}

        {capabilities !== null && (
          <>
            <Section label="What the link should offer">
              <div className="space-y-2">
                {capabilities.kinds.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setKind(option)}
                    disabled={!pro}
                    className={
                      'w-full rounded-ctl border px-3 py-2 text-left transition-colors ' +
                      (kind === option
                        ? 'border-accent bg-accent/10'
                        : 'border-border/60 hover:border-accent/50 disabled:hover:border-border/60')
                    }
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-fg">{kindLabel(option)}</span>
                      <span className="text-xs text-muted">
                        {creditsLabel(costFor(option, capabilities, fileSizeBytes, storageDays))}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">{describeKind(option)}</p>
                  </button>
                ))}
              </div>
            </Section>

            <Section label="How long the link should work">
              <div className="flex flex-wrap gap-2">
                {capabilities.durationsDays.map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setStorageDays(days)}
                    disabled={!pro}
                    className={
                      'rounded-ctl border px-3 py-1.5 text-xs transition-colors ' +
                      (storageDays === days ? 'border-accent bg-accent/10 text-fg' : 'border-border/60 text-muted')
                    }
                  >
                    {describeTerm(days)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                The term covers both the storage and the link: when it ends, the video is deleted and
                the link stops working.
              </p>
            </Section>

            <Section label="Title">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="DemoThat recording"
                maxLength={200}
              />
            </Section>
          </>
        )}

        {cues.length > 0 && (
          <p className="text-xs text-muted">
            The project's {cues.length} captions will be published with the video, so the player shows
            them and viewers can download the track.
          </p>
        )}

        {cost !== null && (
          <div className="flex items-center justify-between border-t border-border/60 pt-3 text-sm">
            <span className="text-muted">
              {formatBytes(fileSizeBytes)}
              {durationSec > 0 ? ` · ${Math.round(durationSec)}s` : ''}
            </span>
            <span className="font-medium text-fg">
              {creditsLabel(cost)}
              <span className="ml-2 font-normal text-muted">({formatUsd(creditsToUsd(cost))})</span>
            </span>
          </div>
        )}
        {cost !== null && (
          <p className="text-xs text-muted">
            Balance after publishing: {Math.max(0, balance - cost)} credits. Final price comes from the
            size the server stores, so it can differ if the file changes.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onOpenLibrary}>
            Shared links
          </Button>
          <Button size="sm" onClick={startPublish} disabled={!canPublish}>
            Publish
          </Button>
        </div>
      </div>
    </Wrapper>
  )
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="modal-backdrop flex items-center justify-center">
      <div
        className="card-clean pointer-events-auto m-4 flex w-full max-w-xl flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-ctl border border-border/60 bg-ctl/40 p-3 text-xs text-muted">{children}</p>
  )
}

function kindLabel(kind: PublicationKind): string {
  switch (kind) {
    case 'page':
      return 'Landing page'
    case 'embed':
      return 'Embeddable player'
    case 'links':
      return 'Download links'
    default:
      return 'Link'
  }
}

/** "1 credit" and "908 credits", because a price is read, not parsed. */
function creditsLabel(credits: number): string {
  return `${credits} credit${credits === 1 ? '' : 's'}`
}

/** The cost of one option, so the three can be compared side by side. */
function costFor(
  kind: PublicationKind,
  capabilities: PublishingCapabilities,
  sizeBytes: number,
  storageDays: number,
): number {
  return estimatePublishCredits(capabilities, { sizeBytes, storageDays, kind })
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}
