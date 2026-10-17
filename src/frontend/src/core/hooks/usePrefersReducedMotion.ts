import { useEffect, useState } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function getQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(REDUCED_MOTION_QUERY)
    : null
}

/**
 * Live `prefers-reduced-motion: reduce` (NFR-001). False where `matchMedia`
 * is missing (jsdom). Never throws: older engines expose only the deprecated
 * `addListener` / `removeListener`.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => getQuery()?.matches ?? false)
  useEffect(() => {
    const query = getQuery()
    if (query === null) return
    const onChange = () => setReduce(query.matches)
    onChange()
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange)
      return () => query.removeEventListener('change', onChange)
    }
    if (typeof query.addListener === 'function') {
      query.addListener(onChange)
      return () => query.removeListener(onChange)
    }
  }, [])
  return reduce
}
