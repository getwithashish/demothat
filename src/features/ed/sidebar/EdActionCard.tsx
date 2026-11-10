/**
 * Ed Action Card — rich structured card for Ed tool executions.
 *
 * Shows:
 * - Title with icon
 * - Live step list (pending → spinner → check/error)
 * - Shimmer progress bar while running
 * - Result summary on completion
 * - Undo, Show on timeline, Details buttons
 * - Failure state with Retry
 * - Approval state with Apply / Discard
 */
import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Check,
  X,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ArrowBackUp,
  MapPin,
  Refresh,
} from 'tabler-icons-react'
import type { ToolCallState } from '../../../components/ai/useAIChat'
import { useEditorStore } from '../../../store/editorStore'
import { cn } from '../../../lib/utils'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { friendlyToolLabel, getToolIcon } from './toolMeta'

interface EdActionCardProps {
  tool: ToolCallState
  onApprove?: (id: string) => void
  onReject?: (id: string) => void
  onRetry?: (id: string) => void
}

export function EdActionCard({ tool, onApprove, onReject, onRetry }: EdActionCardProps) {
  const reduced = useReducedMotion()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const label = friendlyToolLabel(tool.name, tool.args)
  const Icon = getToolIcon(tool.name)

  const isRunning = tool.status === 'running'
  const isSuccess = tool.status === 'success'
  const isError = tool.status === 'error'
  const isPendingApproval = tool.status === 'pending_approval'

  const statusColor = isRunning
    ? 'text-accent'
    : isSuccess
      ? 'text-emerald-500'
      : isError
        ? 'text-danger'
        : isPendingApproval
          ? 'text-amber-500'
          : 'text-muted'

  const borderColor = isError
    ? 'border-danger/30'
    : isPendingApproval
      ? 'border-amber-500/30'
      : isSuccess
        ? 'border-emerald-500/20'
        : 'border-line/60'

  const bgColor = isError ? 'bg-danger/5' : isPendingApproval ? 'bg-amber-500/5' : 'bg-ctl/25'

  return (
    <motion.div
      className={cn('my-2 rounded-xl border overflow-hidden', borderColor, bgColor)}
      initial={reduced ? {} : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      role="status"
      aria-label={`Ed action: ${label} — ${tool.status}`}
      aria-live="polite"
    >
      {/* Header */}
      <div className="flex items-start gap-2.5 p-3 pb-2">
        {/* Status icon */}
        <div className={cn('mt-0.5 shrink-0', statusColor)}>
          {isRunning && <Loader2 size={15} className="animate-spin" />}
          {isSuccess && <Check size={15} />}
          {isError && <AlertCircle size={15} />}
          {isPendingApproval && <div className="h-3.5 w-3.5 rounded-full border-2 border-amber-500 bg-amber-500/20" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Icon size={13} className="text-muted shrink-0" />
            <p className="text-[12px] font-semibold text-fg truncate">{label}</p>
          </div>

          <div className="mt-0.5 flex items-center gap-2">
            <span
              className={cn(
                'text-[11px] font-medium',
                isRunning && 'text-accent',
                isSuccess && 'text-emerald-500',
                isError && 'text-danger',
                isPendingApproval && 'text-amber-500',
              )}
            >
              {isRunning
                ? 'Working…'
                : isSuccess
                  ? 'Done'
                  : isError
                    ? 'Failed'
                    : isPendingApproval
                      ? 'Awaiting approval'
                      : tool.status}
            </span>
          </div>
        </div>
      </div>

      {/* Shimmer progress bar while running */}
      {isRunning && (
        <div className="relative mx-3 mb-2 h-0.5 overflow-hidden rounded-full bg-line/50">
          <motion.div
            className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-accent"
            animate={{ x: ['0%', '250%'] }}
            transition={reduced ? { duration: 0 } : { repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
          />
        </div>
      )}

      {/* Success result */}
      {isSuccess && tool.result != null && (
        <div className="mx-3 mb-2 rounded-lg bg-emerald-500/10 px-2.5 py-1.5">
          <p className="text-[11px] text-emerald-600 dark:text-emerald-400 leading-relaxed font-mono">
            {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2).slice(0, 120)}
          </p>
        </div>
      )}

      {/* Error message */}
      {isError && Boolean(tool.error) && (
        <div className="mx-3 mb-2 rounded-lg bg-danger/10 px-2.5 py-1.5">
          <p className="text-[11px] text-danger leading-relaxed">{tool.error}</p>
        </div>
      )}

      {/* Approval state */}
      {isPendingApproval && (
        <div className="mx-3 mb-2 rounded-lg border border-amber-500/20 bg-amber-500/8 px-2.5 py-2">
          <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed mb-2">
            This action requires your approval before proceeding.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onApprove?.(tool.id)}
              className="flex h-6 items-center gap-1 rounded-md bg-emerald-500 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-600 transition-colors"
            >
              <Check size={11} />
              Apply
            </button>
            <button
              type="button"
              onClick={() => onReject?.(tool.id)}
              className="flex h-6 items-center gap-1 rounded-md border border-line bg-ctl px-2.5 text-[11px] font-medium text-muted hover:text-fg transition-colors"
            >
              <X size={11} />
              Discard
            </button>
          </div>
        </div>
      )}

      {/* Details args (collapsible) */}
      {tool.args && Object.keys(tool.args).length > 0 && (
        <div className="border-t border-line/40">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-muted hover:text-fg transition-colors"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
          >
            {detailsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Details
          </button>
          <AnimatePresence>
            {detailsOpen && (
              <motion.div
                initial={reduced ? {} : { height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={reduced ? {} : { height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <pre className="mx-3 mb-2 max-h-24 overflow-auto rounded-lg border border-line/60 bg-ctl/50 p-2 font-mono text-[11px] text-muted">
                  {JSON.stringify(tool.args, null, 2)}
                </pre>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Action buttons row */}
      {(isSuccess || isError) && (
        <div className="flex items-center gap-1.5 border-t border-line/40 px-3 py-2">
          {isSuccess && (
            <>
              <ActionButton
                icon={<ArrowBackUp size={12} />}
                label="Undo"
                title="Undo last edit (Ctrl/Cmd+Z)"
                onClick={() => {
                  try {
                    useEditorStore.temporal.getState().undo()
                  } catch {
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
                  }
                }}
              />
              <ActionButton
                icon={<MapPin size={12} />}
                label="Show on timeline"
                title="Move playhead and highlight affected region"
                onClick={() => {
                  const res = (tool.result && typeof tool.result === 'object' ? tool.result : {}) as Record<
                    string,
                    unknown
                  >
                  const regionId = (res.addedZoomId || res.addedSpeedId || res.updated || tool.args?.id) as
                    string | undefined
                  const time =
                    typeof res.startTime === 'number'
                      ? res.startTime
                      : typeof res.addedCutAt === 'number'
                        ? res.addedCutAt
                        : typeof res.currentTime === 'number'
                          ? res.currentTime
                          : typeof tool.args?.startTime === 'number'
                            ? tool.args.startTime
                            : typeof tool.args?.time === 'number'
                              ? tool.args.time
                              : undefined

                  if (typeof time === 'number') {
                    useEditorStore.getState().setCurrentTime(time)
                  }
                  if (regionId) {
                    useEditorStore.getState().setSelectedRegionId(regionId)
                  }

                  document.dispatchEvent(
                    new CustomEvent('ed:show-on-timeline', { detail: { toolId: tool.id, regionId, time } }),
                  )
                }}
              />
            </>
          )}
          {isError && onRetry && (
            <ActionButton
              icon={<Refresh size={12} />}
              label="Retry"
              title="Retry this action"
              onClick={() => onRetry(tool.id)}
            />
          )}
        </div>
      )}
    </motion.div>
  )
}

function ActionButton({
  icon,
  label,
  title,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  title: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-line bg-ctl/60 px-2 py-1 text-[11px] font-medium text-muted hover:border-line hover:text-fg transition-all active:scale-95"
    >
      {icon}
      {label}
    </button>
  )
}
