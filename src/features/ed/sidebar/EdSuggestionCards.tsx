/**
 * Ed Suggestion Cards — empty state grid of action cards.
 * On appear: staggered fade+slide-in. On click: sends action immediately.
 * Shift+click fills the composer instead of sending.
 */
import { motion } from 'motion/react'
import { ED_ACTIONS, resolvePrompt, type EdAction, type EdContext } from '../actions/registry'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { cn } from '../../../lib/utils'

const FEATURED_IDS = ['tidy-silences', 'zoom-on-click', 'studio-style', 'transcribe']
const FEATURED = ED_ACTIONS.filter((a) => FEATURED_IDS.includes(a.id))

interface EdSuggestionCardsProps {
  ctx: EdContext
  onSend: (prompt: string) => void
  onFill: (prompt: string) => void
  disabled?: boolean
}

export function EdSuggestionCards({ ctx, onSend, onFill, disabled }: EdSuggestionCardsProps) {
  const reduced = useReducedMotion()

  return (
    <div className="grid grid-cols-2 gap-2 px-3.5 py-3">
      {FEATURED.map((action, i) => (
        <SuggestionCard
          key={action.id}
          action={action}
          ctx={ctx}
          index={i}
          reduced={reduced}
          disabled={disabled}
          onSend={onSend}
          onFill={onFill}
        />
      ))}
    </div>
  )
}

interface SuggestionCardProps {
  action: EdAction
  ctx: EdContext
  index: number
  reduced: boolean
  disabled?: boolean
  onSend: (prompt: string) => void
  onFill: (prompt: string) => void
}

function SuggestionCard({ action, ctx, index, reduced, disabled, onSend, onFill }: SuggestionCardProps) {
  const Icon = action.icon
  const prompt = resolvePrompt(action, ctx)

  const handleClick = (e: React.MouseEvent) => {
    if (!prompt) return
    if (e.shiftKey) {
      onFill(prompt)
    } else {
      onSend(prompt)
    }
  }

  return (
    <motion.button
      type="button"
      disabled={disabled || !prompt}
      onClick={handleClick}
      className={cn(
        'group relative flex flex-col gap-1.5 rounded-xl border border-line/60 bg-ctl/30 p-3 text-left',
        'transition-all duration-150',
        'hover:border-accent/40 hover:bg-ctl/60 hover:shadow-sm',
        'active:scale-[0.98] active:bg-ctl/70',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-40',
      )}
      initial={reduced ? {} : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0 } : { delay: index * 0.06, duration: 0.25, ease: 'easeOut' }}
      title={`Shift+click to fill composer · Click to send: ${action.title}`}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-md border border-line/50 bg-ctl/70 text-accent">
          <Icon size={13} />
        </div>
      </div>

      <div>
        <p className="text-[12px] font-semibold text-fg leading-tight">{action.title}</p>
        <p className="mt-0.5 text-[11px] text-muted leading-snug line-clamp-2">{action.description}</p>
      </div>
    </motion.button>
  )
}
