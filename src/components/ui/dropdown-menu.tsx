import * as React from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { Check, ChevronRight } from 'tabler-icons-react'
import { cn } from '../../lib/utils'
import { ICON_SIZE, ICON_STROKE } from './icons'

/**
 * Dropdown menu (DESIGN_SPEC §6): panel bg, 1px line, 6px radius, popover
 * shadow, 240px wide, 12px→text-ui rows, hairline dividers.
 *
 * z-[300] keeps it above `.modal-backdrop` (z-250), like the Select primitive.
 */

const DropdownMenu = DropdownMenuPrimitive.Root
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger
const DropdownMenuGroup = DropdownMenuPrimitive.Group
const DropdownMenuSub = DropdownMenuPrimitive.Sub
const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      'flex cursor-default select-none items-center justify-between gap-4 rounded-ctl px-2 py-1.5 text-ui text-fg outline-none',
      'data-[highlighted]:bg-ctl data-[state=open]:bg-ctl',
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight size={ICON_SIZE} strokeWidth={ICON_STROKE} className="h-4 w-4 shrink-0 text-muted" />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      'animate-menu-in z-[300] min-w-[240px] overflow-hidden rounded-ctl border border-line bg-panel p-1',
      'text-fg shadow-[var(--sa-popover-shadow)]',
      className,
    )}
    {...props}
  />
))
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'animate-menu-in z-[300] min-w-[240px] overflow-hidden rounded-ctl border border-line bg-panel p-1',
        'text-fg shadow-[var(--sa-popover-shadow)]',
        className,
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { trailing?: React.ReactNode }
>(({ className, children, trailing, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      'flex cursor-default select-none items-center justify-between gap-4 rounded-ctl px-2 py-1.5 text-ui text-fg outline-none',
      'data-[highlighted]:bg-ctl data-[disabled]:pointer-events-none data-[disabled]:text-muted',
      className,
    )}
    {...props}
  >
    <span className="flex min-w-0 items-center gap-2 truncate">{children}</span>
    {trailing ? <span className="shrink-0 text-xs text-muted">{trailing}</span> : null}
  </DropdownMenuPrimitive.Item>
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    checked={checked}
    className={cn(
      'relative flex cursor-default select-none items-center rounded-ctl py-1.5 pr-2 pl-7 text-ui text-fg outline-none',
      'data-[highlighted]:bg-ctl',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check size={ICON_SIZE} strokeWidth={ICON_STROKE} className="h-3.5 w-3.5 text-accent" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn('-mx-1 my-1 h-px bg-line', className)} {...props} />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

/** Non-interactive footer line (save status wording lives here). */
const DropdownMenuFooter = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <p className={cn('px-2 py-1.5 text-xs text-muted', className)}>{children}</p>
)

/** Muted shortcut hint on the right of an item. */
const DropdownMenuShortcut = ({ children }: { children: React.ReactNode }) => (
  <span className="shrink-0 text-xs text-muted">{children}</span>
)

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuGroup,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuFooter,
  DropdownMenuShortcut,
}
