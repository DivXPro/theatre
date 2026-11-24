import cameraStyles from './cameraStyles.generated'

/**
 * Optional CSS values for the embedded Camera Studio UI. Omitted tokens use
 * the built-in dark theme. These values don't affect the scene renderer.
 */
export interface CameraStudioTheme {
  surface?: string
  raisedSurface?: string
  recessedSurface?: string
  inputBackground?: string
  border?: string
  text?: string
  secondaryText?: string
  mutedText?: string
  accent?: string
  hoverBackground?: string
  selectedBackground?: string
  selectedBorder?: string
  fontFamily?: string
  fontSize?: string
  radius?: string
}

const themeProperties: Record<keyof CameraStudioTheme, string> = {
  surface: '--cs-theme-surface',
  raisedSurface: '--cs-theme-raised-surface',
  recessedSurface: '--cs-theme-recessed-surface',
  inputBackground: '--cs-theme-input-background',
  border: '--cs-theme-border',
  text: '--cs-theme-text',
  secondaryText: '--cs-theme-secondary-text',
  mutedText: '--cs-theme-muted-text',
  accent: '--cs-theme-accent',
  hoverBackground: '--cs-theme-hover-background',
  selectedBackground: '--cs-theme-selected-background',
  selectedBorder: '--cs-theme-selected-border',
  fontFamily: '--cs-theme-font-family',
  fontSize: '--cs-theme-font-size',
  radius: '--cs-theme-radius',
}

const stylesAttribute = 'data-camera-studio-styles'

export function installCameraStyles(target: HTMLElement | ShadowRoot): void {
  const selector = `style[${stylesAttribute}]`
  const existing = target.querySelector(selector)
  if (existing) {
    if (existing.textContent !== cameraStyles)
      existing.textContent = cameraStyles
    return
  }
  const style = target.ownerDocument.createElement('style')
  style.setAttribute(stylesAttribute, '')
  style.textContent = cameraStyles
  target.appendChild(style)
}

export function applyCameraTheme(theme: CameraStudioTheme | undefined): void {
  if (typeof document === 'undefined' || !document.head) return
  installCameraStyles(document.head)

  // Shared, prefixed variables inherit into the Studio shadow host and into
  // overlays mounted elsewhere in the document. Only Camera Studio uses them.
  let style = document.head.querySelector<HTMLStyleElement>(
    'style[data-camera-studio-theme]',
  )
  if (!style) {
    if (!theme) return
    style = document.createElement('style')
    style.setAttribute('data-camera-studio-theme', '')
    style.textContent = ':root {}'
    document.head.appendChild(style)
  }
  const rule = style.sheet?.cssRules[0] as CSSStyleRule | undefined
  if (!rule) return
  for (const token of Object.keys(
    themeProperties,
  ) as (keyof CameraStudioTheme)[]) {
    const property = themeProperties[token]
    const value = theme?.[token]
    if (value) rule.style.setProperty(property, value)
    else rule.style.removeProperty(property)
  }
}
