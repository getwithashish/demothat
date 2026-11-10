/**
 * useEdContext — provides throttled read-only context chips for Ed.
 * Subscribes only to currentTime and selectedRegionId.
 * Throttled to ~10 Hz to avoid re-rendering the message list on every frame.
 */
import { useEffect, useRef, useState } from 'react'
import { useEditorStore } from '../../../store/editorStore'
import type { EdContext } from '../actions/registry'

const THROTTLE_MS = 100 // 10 Hz

export function useEdContext(): EdContext {
  const getState = useEditorStore.getState
  const [ctx, setCtx] = useState<EdContext>(() => ({
    currentTime: getState().currentTime,
    selectedRegionId: getState().selectedRegionId,
  }))

  const lastUpdateRef = useRef(0)
  const prevTimeRef = useRef(getState().currentTime)
  const prevRegionRef = useRef(getState().selectedRegionId)

  useEffect(() => {
    const unsub = useEditorStore.subscribe((state) => {
      const now = Date.now()
      if (now - lastUpdateRef.current < THROTTLE_MS) return

      const nextTime = state.currentTime
      const nextRegion = state.selectedRegionId

      if (nextRegion !== prevRegionRef.current || Math.abs(nextTime - prevTimeRef.current) >= 0.05) {
        lastUpdateRef.current = now
        prevTimeRef.current = nextTime
        prevRegionRef.current = nextRegion
        setCtx({
          currentTime: nextTime,
          selectedRegionId: nextRegion,
        })
      }
    })
    return unsub
  }, [])

  return ctx
}
