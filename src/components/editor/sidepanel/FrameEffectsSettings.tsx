// Frame / Shadow / Border sections for the Layout panel.
// Flat Sections on the shared primitives: no Collapsible, no card-in-card.
import { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import { Button } from '../../ui/button'
import { ColorField } from '../../ui/color-field'
import { Section } from '../../ui/section'
import { Slider } from '../../ui/slider'
import { ToggleRow } from '../../ui/toggle-row'
import { rgbaToHexAlpha, hexToRgb } from '../../../lib/utils'
import { DEFAULTS } from '../../../lib/constants'

function ResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} aria-label={`Reset ${label}`}>
      Reset
    </Button>
  )
}

export function FrameEffectsSettings() {
  const { frameStyles, updateFrameStyle } = useEditorStore()

  const handleStyleChange = (name: string, value: string | number) => {
    updateFrameStyle({
      [name]: typeof value === 'string' ? Number.parseFloat(value) || 0 : value,
    })
  }

  const { hex: shadowHex, alpha: shadowAlpha } = useMemo(
    () => rgbaToHexAlpha(frameStyles.shadowColor),
    [frameStyles.shadowColor],
  )

  const { hex: borderHex } = useMemo(() => rgbaToHexAlpha(frameStyles.borderColor), [frameStyles.borderColor])

  const handleShadowColorChange = (newHex: string) => {
    const rgb = hexToRgb(newHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${shadowAlpha})`
      updateFrameStyle({ shadowColor: newRgbaColor })
    }
  }

  const handleShadowOpacityChange = (newAlpha: number) => {
    const rgb = hexToRgb(shadowHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${newAlpha})`
      updateFrameStyle({ shadowColor: newRgbaColor })
    }
  }

  const handleBorderColorChange = (newHex: string) => {
    const rgb = hexToRgb(newHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)`
      updateFrameStyle({ borderColor: newRgbaColor })
    }
  }

  // --- Reset Handlers (kept from the previous Collapse headers) ---
  const handleResetPadding = () => {
    updateFrameStyle({ padding: DEFAULTS.FRAME.PADDING.defaultValue })
  }

  const handleResetShadow = () => {
    updateFrameStyle({
      shadowBlur: DEFAULTS.FRAME.SHADOW.BLUR.defaultValue,
      shadowOffsetX: DEFAULTS.FRAME.SHADOW.OFFSET_X.defaultValue,
      shadowOffsetY: DEFAULTS.FRAME.SHADOW.OFFSET_Y.defaultValue,
      shadowColor: DEFAULTS.FRAME.SHADOW.DEFAULT_COLOR_RGBA,
    })
  }

  const handleResetBorder = () => {
    updateFrameStyle({
      borderRadius: DEFAULTS.FRAME.RADIUS.defaultValue,
      borderWidth: DEFAULTS.FRAME.BORDER.WIDTH.defaultValue,
      borderColor: DEFAULTS.FRAME.BORDER.DEFAULT_COLOR_RGBA,
    })
  }

  // The store has no border on/off flag, so the toggle is derived from the width and
  // remembers the last non-zero value locally (presentation only, no store change).
  const borderOn = frameStyles.borderWidth > 0
  const [lastBorderWidth, setLastBorderWidth] = useState(
    frameStyles.borderWidth || DEFAULTS.FRAME.BORDER.WIDTH.defaultValue,
  )
  useEffect(() => {
    if (frameStyles.borderWidth > 0) setLastBorderWidth(frameStyles.borderWidth)
  }, [frameStyles.borderWidth])
  const handleBorderToggle = (on: boolean) => {
    updateFrameStyle({ borderWidth: on ? lastBorderWidth || DEFAULTS.FRAME.BORDER.WIDTH.defaultValue : 0 })
  }

  return (
    <>
      <Section label="Frame" labelRight={<ResetButton onClick={handleResetPadding} label="frame padding" />}>
        <Slider
          label="Padding"
          min={DEFAULTS.FRAME.PADDING.min}
          max={DEFAULTS.FRAME.PADDING.max}
          step={DEFAULTS.FRAME.PADDING.step}
          value={frameStyles.padding}
          onChange={(value) => handleStyleChange('padding', value)}
          formatValue={(value) => `${value}%`}
        />
      </Section>

      <Section label="Shadow" labelRight={<ResetButton onClick={handleResetShadow} label="shadow" />}>
        <div className="space-y-3.5">
          <Slider
            label="Blur"
            min={DEFAULTS.FRAME.SHADOW.BLUR.min}
            max={DEFAULTS.FRAME.SHADOW.BLUR.max}
            step={DEFAULTS.FRAME.SHADOW.BLUR.step}
            value={frameStyles.shadowBlur}
            onChange={(value) => handleStyleChange('shadowBlur', value)}
            formatValue={(value) => `${value} px`}
          />
          <Slider
            label="Offset X"
            min={DEFAULTS.FRAME.SHADOW.OFFSET_X.min}
            max={DEFAULTS.FRAME.SHADOW.OFFSET_X.max}
            step={DEFAULTS.FRAME.SHADOW.OFFSET_X.step}
            value={frameStyles.shadowOffsetX}
            onChange={(value) => handleStyleChange('shadowOffsetX', value)}
            formatValue={(value) => `${value} px`}
          />
          <Slider
            label="Offset Y"
            min={DEFAULTS.FRAME.SHADOW.OFFSET_Y.min}
            max={DEFAULTS.FRAME.SHADOW.OFFSET_Y.max}
            step={DEFAULTS.FRAME.SHADOW.OFFSET_Y.step}
            value={frameStyles.shadowOffsetY}
            onChange={(value) => handleStyleChange('shadowOffsetY', value)}
            formatValue={(value) => `${value} px`}
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="pt-0.5">
              <ColorField label="Color" value={shadowHex} onChange={handleShadowColorChange} />
            </div>
            <Slider
              label="Opacity"
              min={DEFAULTS.FRAME.SHADOW.OPACITY.min}
              max={DEFAULTS.FRAME.SHADOW.OPACITY.max}
              step={DEFAULTS.FRAME.SHADOW.OPACITY.step}
              value={shadowAlpha}
              onChange={handleShadowOpacityChange}
              formatValue={(value) => `${Math.round(value * 100)}%`}
            />
          </div>
        </div>
      </Section>

      <Section label="Border" labelRight={<ResetButton onClick={handleResetBorder} label="border" />}>
        <ToggleRow label="Border" checked={borderOn} onCheckedChange={handleBorderToggle} />
        {borderOn && (
          <div className="mt-3.5 space-y-3.5">
            <Slider
              label="Radius"
              min={DEFAULTS.FRAME.RADIUS.min}
              max={DEFAULTS.FRAME.RADIUS.max}
              step={DEFAULTS.FRAME.RADIUS.step}
              value={frameStyles.borderRadius}
              onChange={(value) => handleStyleChange('borderRadius', value)}
              formatValue={(value) => `${value} px`}
            />
            <Slider
              label="Thickness"
              min={DEFAULTS.FRAME.BORDER.WIDTH.min}
              max={DEFAULTS.FRAME.BORDER.WIDTH.max}
              step={DEFAULTS.FRAME.BORDER.WIDTH.step}
              value={frameStyles.borderWidth}
              onChange={(value) => handleStyleChange('borderWidth', value)}
              formatValue={(value) => `${value} px`}
            />
            <ColorField label="Color" value={borderHex} onChange={handleBorderColorChange} />
          </div>
        )}
      </Section>
    </>
  )
}
