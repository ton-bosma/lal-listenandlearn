import { useEffect } from 'react'

/**
 * Houdt de CSS-variabele `--app-vh` gelijk aan de ZICHTBARE hoogte (visualViewport) op
 * touch-toestellen. Zo krimpt de gepinde app-shell mee als het schermtoetsenbord opkomt en blijft
 * de footer (chat-invoer, woord-toevoegen, werkwoord-invoer) erbovenop staan i.p.v. erachter.
 *
 * Alleen actief op coarse pointers (telefoon/tablet). Op desktop draait dit niet, dus `--app-vh`
 * blijft ongezet en de CSS valt terug op `100dvh` — het desktop-gedrag verandert niet.
 */
export function useAppViewportHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv || !window.matchMedia('(pointer: coarse)').matches) return

    const apply = () => {
      document.documentElement.style.setProperty('--app-vh', `${Math.round(vv.height)}px`)
    }
    apply()
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
      document.documentElement.style.removeProperty('--app-vh')
    }
  }, [])
}
