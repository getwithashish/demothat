import * as React from 'react'
import { cn } from '../../lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
  suffix?: string
  prefix?: string
}

/**
 * Text input (DESIGN_SPEC §6): same surface and sizing as the Select trigger —
 * ctl fill, 1px line, 6px radius, 13px text, accent focus ring.
 */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, helperText, suffix, prefix, ...props }, ref) => {
    const inputId = React.useId()

    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-sm text-muted">
            {label}
          </label>
        )}

        <div className="relative">
          {prefix && (
            <div className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ui text-muted">
              {prefix}
            </div>
          )}

          <input
            id={inputId}
            type={type}
            className={cn(
              'flex w-full rounded-ctl border border-line bg-ctl px-2.5 py-2 text-ui text-fg',
              'placeholder:text-muted',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              'hover:bg-ctl-hover',
              'disabled:cursor-not-allowed disabled:opacity-45',
              prefix && 'pl-7',
              suffix && 'pr-7',
              error && 'border-danger',
              className,
            )}
            ref={ref}
            {...props}
          />

          {suffix && (
            <div className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ui text-muted">
              {suffix}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        {helperText && !error && <p className="text-sm text-muted">{helperText}</p>}
      </div>
    )
  },
)

Input.displayName = 'Input'

export { Input }
