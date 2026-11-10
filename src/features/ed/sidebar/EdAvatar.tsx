/**
 * Ed Avatar — renders the official Ed mascot icon with subtle motion effects.
 * Size defaults to 28px.
 */
import { motion } from 'motion/react'
import { cn } from '../../../lib/utils'
import { useReducedMotion } from '../hooks/useReducedMotion'

interface EdAvatarProps {
  size?: number
  streaming?: boolean
  className?: string
}

export function EdAvatar({ size = 28, streaming = false, className }: EdAvatarProps) {
  const reduced = useReducedMotion()

  return (
    <motion.div
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-[9px] overflow-hidden border border-line/60 bg-ctl/60 p-0.5',
        className,
      )}
      style={{ width: size, height: size }}
      animate={
        !reduced && streaming
          ? {
              scale: [1, 1.05, 1],
              opacity: [0.9, 1, 0.9],
            }
          : {
              scale: 1,
              opacity: 1,
            }
      }
      transition={streaming ? { repeat: Infinity, duration: 1.6, ease: 'easeInOut' } : { duration: 0.3 }}
      aria-hidden="true"
    >
      <img src="./demothat-mascot-ed-neutral.svg" alt="Ed" className="h-full w-full object-contain" draggable={false} />
    </motion.div>
  )
}
