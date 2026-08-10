import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import './tooltip.css'

const SHOW_DELAY_MS = 600
const HIDE_TRANSITION_MS = 150

/** Renders a fixed-position tooltip so parent containers cannot clip it. Delays appearance to avoid flicker during quick pointer movement and fades in/out with a CSS transition. */
export function Tooltip({
  children,
  label,
  hint,
}: {
  children: ReactNode
  label: string
  hint?: string
}) {
  const [mounted, setMounted] = useState(false)
  const [entered, setEntered] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const hostRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<Element | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const pointerDismissed = useRef(false)
  const dismissalListener = useRef<((event: PointerEvent) => void) | null>(null)
  const showTimer = useRef<number | null>(null)
  const hideTimer = useRef<number | null>(null)

  const clearTimers = useCallback(() => {
    if (showTimer.current !== null) {
      clearTimeout(showTimer.current)
      showTimer.current = null
    }
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }, [])

  useLayoutEffect(() => {
    if (!mounted) return
    const updatePosition = (): void => {
      const trigger = triggerRef.current
      const tooltip = tooltipRef.current
      if (!trigger || !tooltip || !trigger.isConnected) return
      const triggerRect = trigger.getBoundingClientRect()
      const tooltipRect = tooltip.getBoundingClientRect()
      const left = Math.min(
        Math.max(8, triggerRect.left + (triggerRect.width - tooltipRect.width) / 2),
        window.innerWidth - tooltipRect.width - 8,
      )
      let top = triggerRect.top - tooltipRect.height - 8
      if (top < 8) top = triggerRect.bottom + 8
      if (top + tooltipRect.height > window.innerHeight - 8)
        top = Math.max(
          8,
          window.innerHeight - tooltipRect.height - 8,
        )
      setPosition({ top, left })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [mounted])

  useEffect(() => {
    if (!mounted) return
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [mounted])

  // Hide the tooltip if React replaced or removed the trigger element.
  useLayoutEffect(() => {
    if (mounted && !triggerRef.current?.isConnected) hide()
  })

  // Clean up pending timers when the component unmounts.
  useEffect(() => {
    return () => {
      clearTimers()
      if (dismissalListener.current)
        window.removeEventListener('pointermove', dismissalListener.current)
    }
  }, [clearTimers])

  function show(eventTarget: EventTarget | null): void {
    if (pointerDismissed.current || !(eventTarget instanceof Element)) return
    clearTimers()
    triggerRef.current = eventTarget
    showTimer.current = window.setTimeout(() => {
      if (!triggerRef.current?.isConnected) return
      setPosition(null)
      setMounted(true)
    }, SHOW_DELAY_MS)
  }

  function hide(): void {
    clearTimers()
    setEntered(false)
    hideTimer.current = window.setTimeout(() => {
      setMounted(false)
      triggerRef.current = null
    }, HIDE_TRANSITION_MS)
  }

  // Keep a clicked tooltip dismissed until the pointer physically moves beyond its trigger.
  function dismissPointer(): void {
    pointerDismissed.current = true
    if (!dismissalListener.current) {
      const releaseDismissal = (event: PointerEvent): void => {
        if (!(event.target instanceof Node) || hostRef.current?.contains(event.target)) return
        pointerDismissed.current = false
        window.removeEventListener('pointermove', releaseDismissal)
        dismissalListener.current = null
      }
      dismissalListener.current = releaseDismissal
      window.addEventListener('pointermove', releaseDismissal)
    }
    hide()
  }

  return (
    <>
      <span
        className='tooltip-host'
        onBlur={hide}
        onClick={hide}
        onPointerDown={dismissPointer}
        onPointerEnter={(event) => show(event.target)}
        onPointerLeave={hide}
        ref={hostRef}
      >
        {children}
      </span>
      {mounted && (
        <div
          className='tooltip-content'
          data-entered={entered || undefined}
          ref={tooltipRef}
          role='tooltip'
          style={{
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            visibility: position ? 'visible' : 'hidden',
          }}
        >
          <span className='tooltip-label'>{label}</span>
          {hint && <span className='tooltip-hint'>{hint}</span>}
        </div>
      )}
    </>
  )
}
