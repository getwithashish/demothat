/**
 * Ed Credits Pill — shows credit balance with animated count transition.
 * Uses a monospace font; on change, the number fades + slides in.
 */
import { useRef, useState, useEffect } from 'react'
import { Bolt } from 'tabler-icons-react'
import { AnimatePresence, motion } from 'motion/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip'
import { useReducedMotion } from '../hooks/useReducedMotion'

interface EdCreditsPillProps {
  balance: number | undefined
}

export function EdCreditsPill({ balance }: EdCreditsPillProps) {
  const reduced = useReducedMotion()
  const prevBalanceRef = useRef(balance)
  const [displayBalance, setDisplayBalance] = useState(balance)

  useEffect(() => {
    if (balance !== prevBalanceRef.current) {
      prevBalanceRef.current = balance
      setDisplayBalance(balance)
    }
  }, [balance])

  if (typeof balance !== 'number') return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1 rounded-full border border-line bg-ctl/70 px-2 py-0.5 cursor-default">
          <Bolt size={12} className="text-accent shrink-0" />
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={displayBalance}
              className="font-mono text-[11px] font-medium text-fg tabular-nums"
              initial={reduced ? {} : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? {} : { opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              {(displayBalance ?? 0).toLocaleString()}
            </motion.span>
          </AnimatePresence>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[200px] text-center">
        AI credits remaining. Credits are used for each edit Ed performs.
      </TooltipContent>
    </Tooltip>
  )
}
