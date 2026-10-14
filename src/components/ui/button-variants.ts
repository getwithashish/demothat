import { cva } from 'class-variance-authority'

/**
 * Button (DESIGN_SPEC §6).
 *
 * primary  = accent fill, on-accent text, 600, no border
 * secondary = ctl fill + 1px line, centred (also used for full-width inspector buttons)
 * danger   = icon in the danger colour on ctl (timeline delete)
 * ghost    = no fill until hover
 */
export const buttonVariants = cva(
  [
    'inline-flex items-center justify-center whitespace-nowrap font-normal transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:pointer-events-none disabled:opacity-45',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-accent font-semibold text-on-accent hover:bg-accent/90',
        default: 'bg-accent font-semibold text-on-accent hover:bg-accent/90',
        secondary: 'border border-line bg-ctl text-fg hover:bg-ctl-hover active:bg-ctl-hover',
        outline: 'border border-line bg-ctl text-fg hover:bg-ctl-hover active:bg-ctl-hover',
        danger: 'border border-line bg-ctl text-danger hover:bg-ctl-hover active:bg-ctl-hover',
        destructive: 'bg-danger font-semibold text-on-accent hover:bg-danger/90',
        ghost: 'bg-transparent text-muted hover:bg-ctl hover:text-fg',
        'ghost-icon': 'bg-transparent text-muted hover:bg-ctl hover:text-fg',
        link: 'text-accent underline-offset-4 hover:underline',
        toolbar: 'border border-line bg-ctl text-fg hover:bg-ctl-hover active:bg-ctl-hover',
      },
      size: {
        default: 'h-8 gap-2 rounded-ctl px-3.5',
        sm: 'h-7 gap-1.5 rounded-ctl px-2.5',
        lg: 'h-9 gap-2 rounded-ctl px-4',
        icon: 'h-8 w-8 rounded-ctl',
        'icon-lg': 'h-9 w-9 rounded-ctl',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)
