import { useRef } from "react"

/**
 * Runs a menu item's action once the menu has closed and let go of focus, so
 * an inline input it opens keeps the focus.
 */
export function useAfterClose() {
  const pending = useRef<(() => void) | null>(null)
  return {
    later: (action: () => void) => () => {
      pending.current = action
    },
    /** For the menu content's onCloseAutoFocus. */
    onCloseAutoFocus: (e: Event) => {
      const action = pending.current
      if (!action) return
      e.preventDefault()
      pending.current = null
      action()
    },
  }
}
