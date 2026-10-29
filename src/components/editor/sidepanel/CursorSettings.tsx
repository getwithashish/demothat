// Cursor panel: rendered cursor appearance (visibility, theme, size, icon,
// click effects, shadow). Flat Sections on the shared primitives.
// Platform-unsupported states (theme + size on Linux) are kept, with their helper text.
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { CURSOR_ICON_STYLES, renderCursorIconThumb, type CursorIconStyle } from '../../../lib/cursor-icons'
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

  // Windows/macOS build the cursor from downloadable theme packs; Linux captures
  // the pointer from the OS, so its "theme" is the system cursor (a fixed Default)
  // and only the Size control rescales it. Both sets of controls work on Linux.
  const isThemeSupported = useMemo(() => platform === 'win32' || platform === 'darwin', [platform])

  useEffect(() => {
    if (isThemeSupported) {
      window.electronAPI.getCursorThemes().then((themes) => {
        if (themes && themes.length > 0) {
          setAvailableThemes(themes)
        }
      })
    }
    window.electronAPI.getSetting<number>('recorder.cursorScale').then((savedScale) => {
      if (savedScale && POST_PROCESSING_SCALES.some((s) => s.value === savedScale)) {
        setCursorScale(savedScale)
      }
    })
  }, [isThemeSupported])

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

  const handleResetMotion = () => {
    updateCursorStyle({
      smoothingEnabled: DEFAULTS.CURSOR.MOTION.SMOOTHING_ENABLED.defaultValue,
      smoothing: DEFAULTS.CURSOR.MOTION.SMOOTHING.defaultValue,
      motionBlurEnabled: DEFAULTS.CURSOR.MOTION.BLUR_ENABLED.defaultValue,
      motionBlurShutterAngle: DEFAULTS.CURSOR.MOTION.BLUR_SHUTTER.defaultValue,
      motionBlurSamples: DEFAULTS.CURSOR.MOTION.BLUR_SAMPLES.defaultValue,
      motionBlurStrength: DEFAULTS.CURSOR.MOTION.BLUR_STRENGTH.defaultValue,
    })
  }

  const handleResetTheme = () => {
    if (isThemeSupported) handleThemeChange(DEFAULTS.CURSOR.THEME.defaultValue)
  }

  const handleResetSize = () => {
    // Works on every platform (Linux rescales the captured cursor).
    handleCursorScaleChange(DEFAULTS.CURSOR.SCALE.defaultValue)
  }

  const handleResetIcon = () => {
    updateCursorStyle({ cursorIcon: DEFAULTS.CURSOR.ICON.defaultValue as CursorIconStyle })
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
  const smoothingOff = !cursorStyles.smoothingEnabled || cursorOff
  const blurOff = !cursorStyles.motionBlurEnabled || cursorOff

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
          labelRight={isThemeSupported ? <ResetButton onClick={handleResetTheme} label="cursor theme" /> : undefined}
        >
          <Select
            value={isThemeSupported ? cursorThemeName : DEFAULTS.CURSOR.THEME.defaultValue}
            onValueChange={handleThemeChange}
            disabled={!isThemeSupported}
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
          {!isThemeSupported && (
            <HelperText>
              Linux uses the system cursor captured by the recorder. Theme packs are Windows-only.
            </HelperText>
          )}
        </Section>

        <Section label="Size" labelRight={<ResetButton onClick={handleResetSize} label="cursor size" />}>
          <SegmentedControl
            aria-label="Cursor size"
            options={POST_PROCESSING_SCALES.map((scale) => ({ value: String(scale.value), label: scale.label }))}
            value={String(cursorScale)}
            onChange={(value) => handleCursorScaleChange(Number(value))}
          />
          {platform !== null && platform !== 'win32' && platform !== 'darwin' && (
            <HelperText>Resizes the cursor captured by the recorder on this platform.</HelperText>
          )}
        </Section>

        <Section label="Icon" labelRight={<ResetButton onClick={handleResetIcon} label="cursor icon" />}>
          <div className="grid grid-cols-2 gap-2">
            {CURSOR_ICON_STYLES.map((style) => (
              <button
                type="button"
                key={style.value}
                aria-pressed={cursorStyles.cursorIcon === style.value}
                onClick={() => updateCursorStyle({ cursorIcon: style.value })}
                className={`flex items-center gap-2 rounded-pv border px-2.5 py-1.5 text-left text-sm transition-colors ${
                  cursorStyles.cursorIcon === style.value
                    ? 'border-accent bg-ctl text-fg'
                    : 'border-line text-muted hover:border-line-focus'
                }`}
              >
                <CursorIconGlyph style={style.value} />
                <span>{style.label}</span>
              </button>
            ))}
          </div>
          <HelperText>
            Replaces the recorded pointer with a fixed icon, in the preview and in the export. “Recorded” uses the OS
            cursor as captured — select it to restore the original.
          </HelperText>
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

        <Section label="Motion" labelRight={<ResetButton onClick={handleResetMotion} label="cursor motion" />}>
          <div className="space-y-3.5">
            <ToggleRow
              label="Path smoothing"
              description="Turns erratic movement into a smooth glide"
              checked={cursorStyles.smoothingEnabled}
              onCheckedChange={(v) => updateCursorStyle({ smoothingEnabled: v })}
            />
            <Slider
              label="Smoothing"
              disabled={smoothingOff}
              min={DEFAULTS.CURSOR.MOTION.SMOOTHING.min}
              max={DEFAULTS.CURSOR.MOTION.SMOOTHING.max}
              step={DEFAULTS.CURSOR.MOTION.SMOOTHING.step}
              value={cursorStyles.smoothing}
              onChange={(v) => updateCursorStyle({ smoothing: v })}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />
            <ToggleRow
              label="Motion blur"
              description="Shutter-angle smear along the cursor's path"
              checked={cursorStyles.motionBlurEnabled}
              onCheckedChange={(v) => updateCursorStyle({ motionBlurEnabled: v })}
            />
            <Slider
              label="Shutter angle"
              disabled={blurOff}
              min={DEFAULTS.CURSOR.MOTION.BLUR_SHUTTER.min}
              max={DEFAULTS.CURSOR.MOTION.BLUR_SHUTTER.max}
              step={DEFAULTS.CURSOR.MOTION.BLUR_SHUTTER.step}
              value={cursorStyles.motionBlurShutterAngle}
              onChange={(v) => updateCursorStyle({ motionBlurShutterAngle: v })}
              formatValue={(v) => `${v}\u00b0`}
            />
            <Slider
              label="Blur strength"
              disabled={blurOff}
              min={DEFAULTS.CURSOR.MOTION.BLUR_STRENGTH.min}
              max={DEFAULTS.CURSOR.MOTION.BLUR_STRENGTH.max}
              step={DEFAULTS.CURSOR.MOTION.BLUR_STRENGTH.step}
              value={cursorStyles.motionBlurStrength}
              onChange={(v) => updateCursorStyle({ motionBlurStrength: v })}
              formatValue={(v) => `${v.toFixed(2)}\u00d7`}
            />
            <Slider
              label="Samples"
              disabled={blurOff}
              min={DEFAULTS.CURSOR.MOTION.BLUR_SAMPLES.min}
              max={DEFAULTS.CURSOR.MOTION.BLUR_SAMPLES.max}
              step={DEFAULTS.CURSOR.MOTION.BLUR_SAMPLES.step}
              value={cursorStyles.motionBlurSamples}
              onChange={(v) => updateCursorStyle({ motionBlurSamples: v })}
            />
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

/** A tiny canvas thumbnail of one cursor icon, drawn at 24px for the picker grid. */
function CursorIconGlyph({ style }: { style: CursorIconStyle }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    renderCursorIconThumb(canvas, style)
  }, [style])
  return <canvas ref={ref} width={24} height={24} className="h-6 w-6 shrink-0" aria-hidden="true" />
}
