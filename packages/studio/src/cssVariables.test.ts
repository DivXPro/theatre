import {readFileSync} from 'fs'
import {join} from 'path'

const studioSrc = __dirname
const read = (rel: string) => readFileSync(join(studioSrc, rel), 'utf8')

/** 断言一批文件:不含任何 forbidden 模式,且含有全部 required 字符串 */
export const expectMigrated = (
  files: string[],
  forbidden: RegExp[],
  required: string[],
) => {
  for (const f of files) {
    const src = read(f)
    for (const pat of forbidden) {
      expect(src).not.toMatch(pat)
    }
    for (const req of required) {
      expect(src).toContain(req)
    }
  }
}

const TOKEN_DEFINITIONS = [
  '--theatre-panel-bg:',
  '--theatre-panel-bg-95:',
  '--theatre-panel-bg-80:',
  '--theatre-panel-border:',
  '--theatre-text-primary:',
  '--theatre-text-secondary:',
  '--theatre-text-muted:',
  '--theatre-head-title:',
  '--theatre-head-punctuation:',
  '--theatre-accent:',
  '--theatre-shadow-color:',
  '--theatre-font-family:',
  '--theatre-font-size:',
]

describe('studio theming tokens', () => {
  it('defines all 13 tokens in css.tsx', () => {
    const css = read('css.tsx')
    for (const def of TOKEN_DEFINITIONS) {
      expect(css).toContain(def)
    }
  })

  it('theme object references variables', () => {
    const css = read('css.tsx')
    expect(css).toContain('var(--theatre-panel-bg)')
    expect(css).toContain('var(--theatre-head-title)')
    expect(css).toContain('var(--theatre-head-punctuation)')
    expect(css).toContain('var(--theatre-panel-border)')
  })

  it('ProvideTheme dead shell is removed', () => {
    expect(() => read('UIRoot/ProvideTheme.tsx')).toThrow()
  })
})
