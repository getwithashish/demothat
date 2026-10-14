// Dev-only UI gallery: renders every shared primitive in every state, in both themes.
// Opened with `?ui-gallery` (see App.tsx). Excluded from production builds.
import { useState, type ReactNode } from 'react'
import { Camera, Plus, Scissors, Trash, Wand } from 'tabler-icons-react'
import { Button } from '../components/ui/button'
import { ColorField } from '../components/ui/color-field'
import { HelperText } from '../components/ui/helper-text'
import { PositionGrid, type PositionGridValue } from '../components/ui/position-grid'
import { Section, SectionLabel } from '../components/ui/section'
import { SegmentedControl } from '../components/ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Slider } from '../components/ui/slider'
import { SwatchGrid } from '../components/ui/swatch-grid'
import { Switch } from '../components/ui/switch'
import { ToggleRow } from '../components/ui/toggle-row'
import { ToolbarButton } from '../components/ui/toolbar-button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/tooltip'
import { ICON_SIZE, ICON_STROKE } from '../components/ui/icons'
import { useTheme, type Theme } from '../hooks/useTheme'

// Opened outside Electron (plain browser) the settings IPC is absent; the theme
// toggle would throw. Stub the two methods it needs so the gallery still works.
if (import.meta.env.DEV && typeof window !== 'undefined' && !window.electronAPI) {
  const settingsStub = {
    getSetting: () => Promise.resolve(undefined),
    setSetting: () => undefined,
    getPlatform: () => Promise.resolve('linux'),
    updateTitleBarOverlay: () => undefined,
  }
  Object.defineProperty(window, 'electronAPI', {
    value: settingsStub,
    configurable: true,
    writable: true,
  })
}

const SWATCHES = [
  { id: 'c9733a', label: 'Rust', color: '#c9733a' },
  { id: '7a5c8f', label: 'Plum', color: '#7a5c8f' },
  { id: '2f4a63', label: 'Slate', color: '#2f4a63' },
  { id: '6b7f5e', label: 'Moss', color: '#6b7f5e' },
  { id: 'b8a48a', label: 'Sand', color: '#b8a48a' },
  { id: '3d3d45', label: 'Graphite', color: '#3d3d45' },
  { id: 'a8505a', label: 'Crimson', color: '#a8505a' },
  { id: '4f7f86', label: 'Teal', color: '#4f7f86' },
  { id: 'd9b36c', label: 'Gold', color: '#d9b36c' },
  { id: '5a5f9e', label: 'Indigo', color: '#5a5f9e' },
  { id: '8a8f96', label: 'Steel', color: '#8a8f96' },
  { id: '1f2a38', label: 'Ink', color: '#1f2a38' },
]

function Demo({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="border-t border-line px-[18px] py-[14px] first:border-t-0">
      <div className="mb-3 flex items-baseline gap-3">
        <h3 className="text-title font-semibold text-fg">{title}</h3>
        {note && <span className="text-sm text-muted">{note}</span>}
      </div>
      {children}
    </div>
  )
}

/** Six labelled cells: the real control plus the CSS-forced versions of each state. */
function StateGrid({ cells }: { cells: { label: string; node: ReactNode }[] }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
      {cells.map((cell) => (
        <div key={cell.label} className="min-w-0">
          <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">{cell.label}</div>
          <div className="flex items-center gap-2">{cell.node}</div>
        </div>
      ))}
    </div>
  )
}

export default function UiGallery() {
  const { theme, setTheme } = useTheme()
  const [segment, setSegment] = useState('wallpaper')
  const [slide, setSlide] = useState(35)
  const [toggle, setToggle] = useState(true)
  const [aspect, setAspect] = useState('16:9')
  const [swatch, setSwatch] = useState('7a5c8f')
  const [color, setColor] = useState('#2f5fd0')
  const [position, setPosition] = useState<PositionGridValue>('bottom-right')

  return (
    <div className="min-h-screen bg-app text-fg">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-panel px-[18px] py-3">
        <div>
          <h1 className="text-title font-semibold">ScreenArc UI gallery</h1>
          <p className="text-sm text-muted">
            Dev-only. Every primitive, every state, both themes. Open with <code>?ui-gallery</code>.
          </p>
        </div>
        <div className="w-56">
          <SegmentedControl
            aria-label="Theme"
            value={theme}
            onChange={(value) => setTheme(value as Theme)}
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] pb-24">
        <p className="px-[18px] py-4 text-sm text-muted">
          The last five columns of each row are CSS-forced (no pointer), so a static screenshot shows hover,
          focus-visible, active and disabled exactly as the stylesheet defines them.
        </p>

        <Demo title="Section / SectionLabel / HelperText" note="spec §6">
          <div className="rounded-ctl border border-line">
            <Section first label="Background" labelRight={<span className="font-mono text-sm text-muted">5%</span>}>
              <HelperText>Hairline dividers only. No card-in-card, no icon tiles, no chevrons.</HelperText>
            </Section>
            <Section label="Frame">
              <SectionLabel>nested label</SectionLabel>
              <HelperText className="mt-0">First section drops its top hairline via the `first` prop.</HelperText>
            </Section>
          </div>
        </Demo>

        <Demo title="Button" note="primary / secondary / danger / ghost-icon">
          <StateGrid
            cells={[
              { label: 'primary', node: <Button>Export</Button> },
              {
                label: 'primary hover',
                node: <Button className="bg-accent/90">Export</Button>,
              },
              { label: 'primary disabled', node: <Button disabled>Export</Button> },
              { label: 'secondary', node: <Button variant="secondary">Import video files</Button> },
              {
                label: 'secondary hover',
                node: (
                  <Button variant="secondary" className="bg-ctl-hover">
                    Import video files
                  </Button>
                ),
              },
              { label: 'secondary disabled', node: <Button variant="secondary" disabled>Import</Button> },
              {
                label: 'ghost-icon',
                node: (
                  <Button variant="ghost-icon" size="icon" aria-label="Settings">
                    <Wand size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                  </Button>
                ),
              },
              {
                label: 'danger (icon)',
                node: (
                  <Button variant="danger" size="icon" aria-label="Delete">
                    <Trash size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                  </Button>
                ),
              },
              {
                label: 'focus-visible',
                node: (
                  <Button variant="secondary" className="outline-solid outline-2 outline-offset-2 outline-accent">
                    Focused
                  </Button>
                ),
              },
              { label: 'destructive', node: <Button variant="destructive">Delete clip</Button> },
              { label: 'ghost', node: <Button variant="ghost">Cancel</Button> },
              { label: 'sm size', node: <Button variant="secondary" size="sm">Small</Button> },
            ]}
          />
        </Demo>

        <Demo title="SegmentedControl" note="ctl bg, 2px padding, 7px radius; active = panel + 1px line ring">
          <div className="grid gap-5 lg:grid-cols-3">
            <div>
              <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">default</div>
              <SegmentedControl
                aria-label="Background type"
                value={segment}
                onChange={setSegment}
                options={[
                  { value: 'wallpaper', label: 'Wallpaper' },
                  { value: 'color', label: 'Color' },
                  { value: 'gradient', label: 'Gradient' },
                  { value: 'image', label: 'Image' },
                ]}
              />
            </div>
            <div>
              <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">with disabled option</div>
              <SegmentedControl
                aria-label="Speed"
                value="mellow"
                onChange={() => undefined}
                options={[
                  { value: 'slow', label: 'Slow' },
                  { value: 'mellow', label: 'Mellow' },
                  { value: 'quick', label: 'Quick' },
                  { value: 'rapid', label: 'Rapid', disabled: true },
                ]}
              />
            </div>
            <div>
              <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">sm</div>
              <SegmentedControl
                aria-label="Cursor size"
                size="sm"
                value="1x"
                onChange={() => undefined}
                options={[
                  { value: '1x', label: '1x' },
                  { value: '1.5x', label: '1.5x' },
                  { value: '2x', label: '2x' },
                  { value: '3x', label: '3x' },
                ]}
              />
            </div>
          </div>
        </Demo>

        <Demo title="Slider" note="label left, mono value right, 4px ctl track, accent fill, 14px thumb">
          <div className="grid gap-6 lg:grid-cols-3">
            <div>
              <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">interactive</div>
              <Slider label="Padding" min={0} max={20} value={slide} onChange={setSlide} formatValue={(v) => `${v}%`} />
            </div>
            <div>
              <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">at minimum</div>
              <Slider label="Blur" min={0} max={80} value={0} onChange={() => undefined} formatValue={(v) => `${v} px`} />
            </div>
            <div>
              <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">disabled</div>
              <Slider label="Opacity" min={0} max={1} step={0.01} value={0.8} disabled onChange={() => undefined} formatValue={(v) => `${Math.round(v * 100)}%`} />
            </div>
          </div>
        </Demo>

        <Demo title="Switch / ToggleRow" note="34x20; off = ctl + muted knob, on = accent + on-accent knob">
          <StateGrid
            cells={[
              { label: 'switch on', node: <Switch checked onCheckedChange={() => undefined} aria-label="On" /> },
              { label: 'switch off', node: <Switch checked={false} onCheckedChange={() => undefined} aria-label="Off" /> },
              {
                label: 'switch disabled',
                node: <Switch checked disabled onCheckedChange={() => undefined} aria-label="Disabled" />,
              },
            ]}
          />
          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <ToggleRow
              label="Visible"
              description="Hides the overlay in the export"
              checked={toggle}
              onCheckedChange={setToggle}
            />
            <ToggleRow
              label="Disabled row"
              description="45% opacity, no hover"
              checked
              disabled
              onCheckedChange={() => undefined}
            />
          </div>
        </Demo>

        <Demo title="Select" note="ctl fill, 1px line, 6px radius, 8px 10px padding; popover = panel + line">
          <div className="grid gap-6 lg:grid-cols-3">
            <div>
              <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">default (closed)</div>
              <Select value={aspect} onValueChange={setAspect}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 Landscape</SelectItem>
                  <SelectItem value="9:16">9:16 Portrait</SelectItem>
                  <SelectItem value="1:1">1:1 Square</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">with label + helper</div>
              <Select value={aspect} onValueChange={setAspect}>
                <SelectTrigger label="Aspect" helperText="Controls the export frame">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 Landscape</SelectItem>
                  <SelectItem value="9:16">9:16 Portrait</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">disabled</div>
              <Select value={aspect} onValueChange={setAspect} disabled>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="16:9">16:9 Landscape</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </Demo>

        <Demo title="SwatchGrid" note="6 columns, 8px gap, 6px radius, rgba(128,128,128,.3) border">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">selected</div>
              <SwatchGrid aria-label="Wallpaper" items={SWATCHES} selectedId={swatch} onSelect={setSwatch} />
            </div>
            <div>
              <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">none selected</div>
              <SwatchGrid aria-label="Colour" items={SWATCHES.slice(0, 6)} selectedId={null} onSelect={() => undefined} />
            </div>
          </div>
        </Demo>

        <Demo title="ColorField" note="22px square swatch + mono hex">
          <div className="grid gap-6 lg:grid-cols-3">
            <ColorField label="Shadow colour" value={color} onChange={setColor} />
            <ColorField value={color} onChange={setColor} />
            <ColorField label="Disabled" value="#7c3aed" disabled onChange={() => undefined} />
          </div>
        </Demo>

        <Demo title="PositionGrid" note="3x3 in a ctl box, 84px tall, 7px radius, 10px dots">
          <div className="grid gap-6 lg:grid-cols-3">
            <div>
              <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">interactive</div>
              <PositionGrid value={position} onChange={setPosition} />
            </div>
            <div>
              <div className="mb-2 text-label uppercase tracking-[0.06em] text-muted">disabled</div>
              <PositionGrid value="top-left" disabled onChange={() => undefined} />
            </div>
          </div>
        </Demo>

        <Demo title="ToolbarButton" note="ctl fill, 1px line, 6px radius, 5px 12px, 18px icon (AGENTS)">
          <StateGrid
            cells={[
              { label: 'default', node: <ToolbarButton icon={<Scissors size={ICON_SIZE} strokeWidth={ICON_STROKE} />}>Trim</ToolbarButton> },
              {
                label: 'hover (forced)',
                node: (
                  <ToolbarButton className="bg-ctl-hover" icon={<Scissors size={ICON_SIZE} strokeWidth={ICON_STROKE} />}>
                    Trim
                  </ToolbarButton>
                ),
              },
              {
                label: 'focus-visible',
                node: (
                  <ToolbarButton className="outline-solid outline-2 outline-offset-2 outline-accent" icon={<Camera size={ICON_SIZE} strokeWidth={ICON_STROKE} />}>
                    Camera
                  </ToolbarButton>
                ),
              },
              { label: 'active', node: <ToolbarButton active icon={<Plus size={ICON_SIZE} strokeWidth={ICON_STROKE} />}>Layout</ToolbarButton> },
              { label: 'icon-only', node: <ToolbarButton iconOnly icon={<Scissors size={ICON_SIZE} strokeWidth={ICON_STROKE} />} aria-label="Trim" /> },
              { label: 'disabled', node: <ToolbarButton disabled icon={<Scissors size={ICON_SIZE} strokeWidth={ICON_STROKE} />}>Trim</ToolbarButton> },
            ]}
          />
        </Demo>

        <Demo title="Tooltip" note="panel bg, 1px line, 6px radius, 12px text, 4px 8px padding">
          <TooltipProvider delayDuration={0}>
            <Tooltip open>
              <TooltipTrigger asChild>
                <Button variant="secondary">Hover target</Button>
              </TooltipTrigger>
              <TooltipContent>Zoom to the cursor</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Demo>

        <Demo title="Accent discipline" note="the single accent marks active/selected/primary only">
          <div className="flex flex-wrap items-center gap-4">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Switch checked onCheckedChange={() => undefined} aria-label="On" />
            <SegmentedControl
              aria-label="demo"
              className="w-48"
              value="a"
              onChange={() => undefined}
              options={[
                { value: 'a', label: 'Selected' },
                { value: 'b', label: 'Idle' },
              ]}
            />
            <span className="font-mono text-sm text-muted">00:04.12</span>
            <span className="text-danger">Danger text</span>
          </div>
        </Demo>
      </main>
    </div>
  )
}
