import * as React from 'react'
import * as SwitchPrimitives from '@radix-ui/react-switch'
import { cn } from '../../lib/utils'

export interface SwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> {
  /**
   * Kept for source compatibility with existing call sites. The revamp uses a single
   * switch appearance (DESIGN_SPEC §6), so every variant renders identically.
   */
  variant?: 'default' | 'primary' | 'destructive'
  /** Kept for source compatibility; the visual state follows `checked`. */
  isChecked?: boolean
}

/**
 * Radix Switch (DESIGN_SPEC §6): 34x20, off = ctl track with a muted knob,
 * on = accent track with an on-accent knob.
 */
const Switch = React.forwardRef<React.ElementRef<typeof SwitchPrimitives.Root>, SwitchProps>(
  ({ className, checked, ...props }, ref) => (
    <SwitchPrimitives.Root
      className={cn(
        'peer inline-flex h-5 w-[34px] shrink-0 cursor-pointer items-center rounded-full p-[3px] transition-colors',
        'bg-ctl data-[state=checked]:bg-accent',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      checked={checked}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          'pointer-events-none block h-3.5 w-3.5 rounded-full transition-transform',
          'translate-x-0 bg-muted data-[state=checked]:translate-x-3.5 data-[state=checked]:bg-on-accent',
        )}
      />
    </SwitchPrimitives.Root>
  ),
)
Switch.displayName = 'Switch'

export { Switch }
