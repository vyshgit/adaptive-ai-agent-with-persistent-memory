import { useLayoutEffect, useRef } from 'react'
import type { UIEvent } from 'react'

// Follow new output only while the reader is at the end. Hidden/unmounted work
// panels and responsive layout changes must not lose deliberate scrollback.
export function useOutputScroll<T extends HTMLElement>(content: unknown, resetKey: unknown, layoutKey: string) {
  const ref = useRef<T>(null), following = useRef(true), position = useRef(0), previousReset = useRef(resetKey)
  const size = useRef({ width: 0, height: 0 })
  function align() {
    const node = ref.current
    if (!node?.clientHeight) return
    node.scrollTop = following.current ? node.scrollHeight : position.current
    position.current = node.scrollTop
    size.current = { width: node.clientWidth, height: node.clientHeight }
  }
  useLayoutEffect(() => {
    if (!Object.is(previousReset.current, resetKey)) {
      previousReset.current = resetKey; following.current = true; position.current = 0
    }
    align()
  }, [content, resetKey, layoutKey])
  useLayoutEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(align)
    observer.observe(node)
    return () => observer.disconnect()
  }, [layoutKey, resetKey])
  function onScroll(event: UIEvent<T>) {
    const node = event.currentTarget
    if (!node.clientHeight) return
    // Resize-induced clamping is not the reader choosing to leave the tail.
    // The observer restores the prior follow/scrollback choice at the new size.
    if (node.clientWidth !== size.current.width || node.clientHeight !== size.current.height) return
    position.current = node.scrollTop
    following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
  }
  function follow() { following.current = true; align() }
  return { ref, onScroll, follow }
}
