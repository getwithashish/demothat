// Cursor panel: rendered cursor appearance (visibility, theme, size, click
// effects, shadow). Flat Sections on the shared primitives.
// Platform-unsupported states (theme + size on Linux) are kept, with their helper text.
import { useEffect, useMemo, useState } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '../../ui/button'
import { ColorField } from '../../ui/color-field'
import { HelperText } from '../../ui/helper-text'
import { Section, SectionLabel } from '../../ui/section'
import { SegmentedControl } from '../../ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { Slider } from '../../ui/slider'
import { ToggleRow } from '../../ui/toggle-row'
import { rgbaToHexAlpha, hexToRgb } from '../../../lib/utils'
import { DEFAULTS } from '../../../lib/constants'
import { EASING_MAP } from '../../../lib/easing'
import { PanelHeader } from '../PanelHeader'

const POST_PROCESSING_SCALES = [
  { value: 3, label: '3x' },
  { value: 2, label: '2x' },
  { value: 1.5, label: '1.5x' },
  { value: 1, label: '1x' },
]

const easingOptions = Object.keys(EASING_MAP)

function ResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} aria-label={`Reset ${label}`}>
      Reset
    </Button>
  )
}

export function CursorSettings() {
  const {
    platform,
    setPostProcessingCursorScale,
    cursorThemeName,
    setCursorThemeName,
    cursorStyles,
    updateCursorStyle,
  } = useEditorStore(
    useShallow((state) => ({
      platform: state.platform,
      setPostProcessingCursorScale: state.setPostProcessingCursorScale,
      cursorThemeName: state.cursorThemeName,
      setCursorThemeName: state.setCursorThemeName,
      cursorStyles: state.cursorStyles,
      updateCursorStyle: state.updateCursorStyle,
    })),
  )
  const { reloadCursorTheme } = useEditorStore.getState()
  const [cursorScale, setCursorScale] = useState<number>(DEFAULTS.CURSOR.SCALE.defaultValue)
  const [availableThemes, setAvailableThemes] = useState<string[]>([DEFAULTS.CURSOR.THEME.defaultValue])

  const isCustomizationSupported = useMemo(() => platform === 'win32' || platform === 'darwin', [platform])

  useEffect(() => {
    if (isCustomizationSupported) {
      window.electronAPI.getCursorThemes().then((themes) => {
        if (themes && themes.length > 0) {
          setAvailableThemes(themes)
        }
      })

      window.electronAPI.getSetting<number>('recorder.cursorScale').then((savedScale) => {
        if (savedScale && POST_PROCESSING_SCALES.some((s) => s.value === savedScale)) {
          setCursorScale(savedScale)
        }
      })
    }
  }, [isCustomizationSupported])

  const handleCursorScaleChange = (value: number) => {
    setCursorScale(value)
    setPostProcessingCursorScale(value)
  }

  const handleThemeChange = (themeName: string) => {
    setCursorThemeName(themeName)
    reloadCursorTheme(themeName)
  }

  const { hex: shadowHex, alpha: shadowAlpha } = useMemo(
    () => rgbaToHexAlpha(cursorStyles.shadowColor),
    [cursorStyles.shadowColor],
  )
  const { hex: rippleHex, alpha: rippleAlpha } = useMemo(
    () => rgbaToHexAlpha(cursorStyles.clickRippleColor),
    [cursorStyles.clickRippleColor],
  )

  const handleShadowColorChange = (newHex: string) => {
    const rgb = hexToRgb(newHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${shadowAlpha})`
      updateCursorStyle({ shadowColor: newRgbaColor })
    }
  }

  const handleShadowOpacityChange = (newAlpha: number) => {
    const rgb = hexToRgb(shadowHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${newAlpha})`
      updateCursorStyle({ shadowColor: newRgbaColor })
    }
  }

  const handleRippleColorChange = (newHex: string) => {
    const rgb = hexToRgb(newHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${rippleAlpha})`
      updateCursorStyle({ clickRippleColor: newRgbaColor })
    }
  }

  const handleRippleOpacityChange = (newAlpha: number) => {
    const rgb = hexToRgb(rippleHex)
    if (rgb) {
      const newRgbaColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${newAlpha})`
      updateCursorStyle({ clickRippleColor: newRgbaColor })
    }
  }

  const handleResetTheme = () => {
    if (isCustomizationSupported) handleThemeChange(DEFAULTS.CURSOR.THEME.defaultValue)
  }

  const handleResetSize = () => {
    if (isCustomizationSupported) handleCursorScaleChange(DEFAULTS.CURSOR.SCALE.defaultValue)
  }

  const handleResetShadow = () => {
    updateCursorStyle({
      shadowBlur: DEFAULTS.CURSOR.SHADOW.BLUR.defaultValue,
      shadowOffsetX: DEFAULTS.CURSOR.SHADOW.OFFSET_X.defaultValue,
      shadowOffsetY: DEFAULTS.CURSOR.SHADOW.OFFSET_Y.defaultValue,
      shadowColor: DEFAULTS.CURSOR.SHADOW.DEFAULT_COLOR_RGBA,
    })
  }

  const handleResetClickEffects = () => {
    updateCursorStyle({
      clickRippleEffect: DEFAULTS.CURSOR.CLICK_RIPPLE.ENABLED.defaultValue,
      clickRippleColor: DEFAULTS.CURSOR.CLICK_RIPPLE.COLOR.defaultValue,
      clickRippleSize: DEFAULTS.CURSOR.CLICK_RIPPLE.SIZE.defaultValue,
      clickRippleDuration: DEFAULTS.CURSOR.CLICK_RIPPLE.DURATION.defaultValue,
      clickScaleEffect: DEFAULTS.CURSOR.CLICK_SCALE.ENABLED.defaultValue,
      clickScaleAmount: DEFAULTS.CURSOR.CLICK_SCALE.AMOUNT.defaultValue,
      clickScaleDuration: DEFAULTS.CURSOR.CLICK_SCALE.DURATION.defaultValue,
      clickScaleEasing: DEFAULTS.CURSOR.CLICK_SCALE.EASING.defaultValue,
    })
  }

  const rippleOff = !cursorStyles.clickRippleEffect
  const scaleOff = !cursorStyles.clickScaleEffect
  const cursorOff = !cursorStyles.showCursor

  return (
    <div className="flex h-full flex-col">
      <PanelHeader title="Cursor" subtitle="Rendered cursor appearance" />

      <div className="min-h-0 flex-1 overflow-y-auto stable-scrollbar">
        <Section first>
          <ToggleRow
            label="Show cursor"
            checked={cursorStyles.showCursor}
            onCheckedChange={(v) => updateCursorStyle({ showCursor: v })}
          />
        </Section>

        <Section
          label="Theme"
          labelRight={
            isCustomizationSupported ? <ResetButton onClick={handleResetTheme} label="cursor theme" /> : undefined
          }
        >
          <Select
            value={isCustomizationSupported ? cursorThemeName : DEFAULTS.CURSOR.THEME.defaultValue}
            onValueChange={handleThemeChange}
            disabled={!isCustomizationSupported}
          >
            <SelectTrigger aria-label="Cursor theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableThemes.map((theme) => (
                <SelectItem key={theme} value={theme} className="capitalize">
                  {theme}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isCustomizationSupported && <HelperText>Cursor themes are available on Windows and macOS.</HelperText>}
        </Section>

        <Section
          label="Size"
          labelRight={
            isCustomizationSupported ? <ResetButton onClick={handleResetSize} label="cursor size" /> : undefined
          }
        >
          <SegmentedControl
            aria-label="Cursor size"
            options={POST_PROCESSING_SCALES.map((scale) => ({
              value: String(scale.value),
              label: scale.label,
              disabled: !isCustomizationSupported,
            }))}
            value={String(cursorScale)}
            onChange={(value) => handleCursorScaleChange(Number(value))}
          />
          {!isCustomizationSupported && (
            <HelperText>Virtual cursor sizing is available on Windows and macOS.</HelperText>
          )}
        </Section>

        <Section
          label="Click ripple"
          labelRight={<ResetButton onClick={handleResetClickEffects} label="click effects" />}
        >
          <div className="space-y-3.5">
            <ToggleRow
              label="Visible"
              description="Expanding circle on click"
              checked={cursorStyles.clickRippleEffect}
              onCheckedChange={(v) => updateCursorStyle({ clickRippleEffect: v })}
            />
            <Slider
              label="Radius"
              disabled={rippleOff}
              min={DEFAULTS.CURSOR.CLICK_RIPPLE.SIZE.min}
              max={DEFAULTS.CURSOR.CLICK_RIPPLE.SIZE.max}
              step={DEFAULTS.CURSOR.CLICK_RIPPLE.SIZE.step}
              value={cursorStyles.clickRippleSize}
              onChange={(v) => updateCursorStyle({ clickRippleSize: v })}
              formatValue={(v) => `${v} px`}
            />
            <Slider
              label="Duration"
              disabled={rippleOff}
              min={DEFAULTS.CURSOR.CLICK_RIPPLE.DURATION.min}
              max={DEFAULTS.CURSOR.CLICK_RIPPLE.DURATION.max}
              step={DEFAULTS.CURSOR.CLICK_RIPPLE.DURATION.step}
              value={cursorStyles.clickRippleDuration}
              onChange={(v) => updateCursorStyle({ clickRippleDuration: v })}
              formatValue={(v) => `${v.toFixed(2)} s`}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="pt-0.5">
                <ColorField label="Color" value={rippleHex} onChange={handleRippleColorChange} disabled={rippleOff} />
              </div>
              <Slider
                label="Opacity"
                disabled={rippleOff}
                min={0}
                max={1}
                step={0.01}
                value={rippleAlpha}
                onChange={handleRippleOpacityChange}
                formatValue={(v) => `${Math.round(v * 100)}%`}
              />
            </div>
          </div>
        </Section>

        <Section
          label="Click scale"
          labelRight={<ResetButton onClick={handleResetClickEffects} label="click effects" />}
        >
          <div className="space-y-3.5">
            <ToggleRow
              label="Visible"
              description="Subtle scale on click"
              checked={cursorStyles.clickScaleEffect}
              onCheckedChange={(v) => updateCursorStyle({ clickScaleEffect: v })}
            />
            <Slider
              label="Scale"
              disabled={scaleOff}
              min={DEFAULTS.CURSOR.CLICK_SCALE.AMOUNT.min}
              max={DEFAULTS.CURSOR.CLICK_SCALE.AMOUNT.max}
              step={DEFAULTS.CURSOR.CLICK_SCALE.AMOUNT.step}
              value={cursorStyles.clickScaleAmount}
              onChange={(v) => updateCursorStyle({ clickScaleAmount: v })}
              formatValue={(v) => `${v.toFixed(2)}\u00d7`}
            />
            <Slider
              label="Duration"
              disabled={scaleOff}
              min={DEFAULTS.CURSOR.CLICK_SCALE.DURATION.min}
              max={DEFAULTS.CURSOR.CLICK_SCALE.DURATION.max}
              step={DEFAULTS.CURSOR.CLICK_SCALE.DURATION.step}
              value={cursorStyles.clickScaleDuration}
              onChange={(v) => updateCursorStyle({ clickScaleDuration: v })}
              formatValue={(v) => `${v.toFixed(2)} s`}
            />
            <div className="space-y-2">
              <SectionLabel>Easing</SectionLabel>
              <Select
                disabled={scaleOff}
                value={cursorStyles.clickScaleEasing}
                onValueChange={(v) => updateCursorStyle({ clickScaleEasing: v })}
              >
                <SelectTrigger aria-label="Click scale easing">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {easingOptions.map((easing) => (
                    <SelectItem key={easing} value={easing}>
                      {easing}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </Section>

        <Section label="Shadow" labelRight={<ResetButton onClick={handleResetShadow} label="cursor shadow" />}>
          <div className="space-y-3.5">
            <Slider
              label="Blur"
              disabled={cursorOff}
              min={DEFAULTS.CURSOR.SHADOW.BLUR.min}
              max={DEFAULTS.CURSOR.SHADOW.BLUR.max}
              step={DEFAULTS.CURSOR.SHADOW.BLUR.step}
              value={cursorStyles.shadowBlur}
              onChange={(v) => updateCursorStyle({ shadowBlur: v })}
              formatValue={(v) => `${v} px`}
            />
            <Slider
              label="Offset X"
              disabled={cursorOff}
              min={DEFAULTS.CURSOR.SHADOW.OFFSET_X.min}
              max={DEFAULTS.CURSOR.SHADOW.OFFSET_X.max}
              step={DEFAULTS.CURSOR.SHADOW.OFFSET_X.step}
              value={cursorStyles.shadowOffsetX}
              onChange={(v) => updateCursorStyle({ shadowOffsetX: v })}
              formatValue={(v) => `${v} px`}
            />
            <Slider
              label="Offset Y"
              disabled={cursorOff}
              min={DEFAULTS.CURSOR.SHADOW.OFFSET_Y.min}
              max={DEFAULTS.CURSOR.SHADOW.OFFSET_Y.max}
              step={DEFAULTS.CURSOR.SHADOW.OFFSET_Y.step}
              value={cursorStyles.shadowOffsetY}
              onChange={(v) => updateCursorStyle({ shadowOffsetY: v })}
              formatValue={(v) => `${v} px`}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="pt-0.5">
                <ColorField label="Color" value={shadowHex} onChange={handleShadowColorChange} disabled={cursorOff} />
              </div>
              <Slider
                label="Opacity"
                disabled={cursorOff}
                min={DEFAULTS.CURSOR.SHADOW.OPACITY.min}
                max={DEFAULTS.CURSOR.SHADOW.OPACITY.max}
                step={DEFAULTS.CURSOR.SHADOW.OPACITY.step}
                value={shadowAlpha}
                onChange={handleShadowOpacityChange}
                formatValue={(v) => `${Math.round(v * 100)}%`}
              />
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}
