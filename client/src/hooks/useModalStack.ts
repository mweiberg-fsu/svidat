import { useEffect, useState, useSyncExternalStore } from 'react'

// Stacking order for the sidebar widget modals, which can all be open at
// once: each newly opened one goes on top, and clicking one raises it.
// z-indexes are derived from the open order (BASE_Z, BASE_Z + 1, ...) rather
// than an ever-growing counter, so they stay below confirm dialogs no matter
// how often windows are raised.
const BASE_Z = 100

const order: number[] = []
let nextId = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// How many stacked modals are open right now (used to cascade new ones).
export function openModalCount(): number {
  return order.length
}

export function useModalStack(): { zIndex: number; bringToFront: () => void } {
  const [id] = useState(() => nextId++)

  useEffect(() => {
    order.push(id)
    emit()
    return () => {
      order.splice(order.indexOf(id), 1)
      emit()
    }
  }, [id])

  // Before the mount effect runs, an unregistered modal sorts to the top.
  const position = useSyncExternalStore(subscribe, () => {
    const i = order.indexOf(id)
    return i === -1 ? order.length : i
  })

  const bringToFront = () => {
    const i = order.indexOf(id)
    if (i === -1 || i === order.length - 1) return
    order.splice(i, 1)
    order.push(id)
    emit()
  }

  return { zIndex: BASE_Z + position, bringToFront }
}
