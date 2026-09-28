import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { openModalCount, useModalStack } from './useModalStack'

// Offset between successive open panels, so a new one doesn't land exactly
// on top of the last.
const CASCADE_PX = 24

// Position + size state for a floating panel that's dragged by its header
// and resized from a corner handle. Opens centered in the window, cascaded
// past any panels already open. Dragging is clamped so at least 40px stays
// on screen. Several can be open at once: attach `onPanelMouseDown` to the
// panel root (as onMouseDownCapture) so clicking anywhere raises it.
export function useFloatingPanel({
  width,
  height,
  minWidth,
  minHeight,
}: {
  width: number
  height: number
  minWidth: number
  minHeight: number
}) {
  const { zIndex, bringToFront } = useModalStack()
  const [position, setPosition] = useState(() => {
    const offset = openModalCount() * CASCADE_PX
    return {
      top: Math.max(0, (window.innerHeight - height) / 2) + offset,
      left: Math.max(0, (window.innerWidth - width) / 2) + offset,
    }
  })
  const [size, setSize] = useState({ width, height })
  const draggingRef = useRef(false)
  const resizingRef = useRef(false)

  // Tracks the pointer on window until mouseup, feeding each move's delta
  // from the mousedown point to `onMove`.
  const trackPointer = (
    e: ReactMouseEvent,
    activeRef: { current: boolean },
    onMove: (deltaX: number, deltaY: number) => void
  ) => {
    // Otherwise the browser treats the drag as a text selection across the page.
    e.preventDefault()
    activeRef.current = true
    const startX = e.clientX
    const startY = e.clientY
    const handleMouseMove = (ev: MouseEvent) => {
      if (!activeRef.current) return
      onMove(ev.clientX - startX, ev.clientY - startY)
    }
    const handleMouseUp = () => {
      activeRef.current = false
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const onHeaderMouseDown = (e: ReactMouseEvent) => {
    const { top, left } = position
    trackPointer(e, draggingRef, (dx, dy) => {
      setPosition({
        top: Math.min(window.innerHeight - 40, Math.max(0, top + dy)),
        left: Math.min(window.innerWidth - 40, Math.max(0, left + dx)),
      })
    })
  }

  const onResizeMouseDown = (e: ReactMouseEvent) => {
    e.stopPropagation()
    const start = size
    trackPointer(e, resizingRef, (dx, dy) => {
      setSize({
        width: Math.max(minWidth, start.width + dx),
        height: Math.max(minHeight, start.height + dy),
      })
    })
  }

  return {
    style: { top: position.top, left: position.left, width: size.width, height: size.height, zIndex },
    onPanelMouseDown: bringToFront,
    onHeaderMouseDown,
    onResizeMouseDown,
  }
}
