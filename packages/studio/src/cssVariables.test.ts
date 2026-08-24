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

  it('panel background family migrated', () => {
    expectMigrated(
      [
        'notify.tsx',
        'panels/OutlinePanel/BaseItem.tsx',
        'panels/SequenceEditorPanel/SequenceEditorPanel.tsx',
        'panels/DetailPanel/DetailPanel.tsx',
        'panels/DetailPanel/DeterminePropEditorForDetail/DetailCompoundPropEditor.tsx',
        'uiComponents/toolbar/ToolbarIconButton.tsx',
        'uiComponents/toolbar/ToolbarButton.tsx',
      ],
      [/#282b2f/i, /rgba\(\s*40,\s*43,\s*47/],
      ['var(--theatre-panel-bg'],
    )
  })

  it('text color family migrated', () => {
    expectMigrated(
      [
        'panels/SequenceEditorPanel/DopeSheet/Left/AnyCompositeRow.tsx',
        'panels/SequenceEditorPanel/DopeSheet/Left/PrimitivePropRow.tsx',
        'uiComponents/ExternalLink.tsx',
        'propEditors/simpleEditors/ImagePropEditor.tsx',
        'propEditors/simpleEditors/FilePropEditor.tsx',
        'notify.tsx',
        'panels/SequenceEditorPanel/RightOverlay/HorizontalScrollbar.tsx',
        'uiComponents/ConnectionStatusBadge.tsx',
        'uiComponents/icons/CubeRendered.tsx',
        'uiComponents/colorPicker/components/common/Pointer.tsx',
        'uiComponents/colorPicker/components/common/Alpha.tsx',
        'uiComponents/colorPicker/components/common/Saturation.tsx',
        'panels/SequenceEditorPanel/DopeSheet/Right/BasicKeyframedTrack/KeyframeEditor/CurveEditorPopover/CurveEditorPopover.tsx',
        'panels/SequenceEditorPanel/DopeSheet/Right/BasicKeyframedTrack/KeyframeEditor/CurveEditorPopover/SVGCurveSegment.tsx',
      ],
      [/#fff\b/i, /#ccc\b/i, /#888\b/i, /#888888/i, /color:\s*white\b/],
      [],
    )
  })

  it('text color residuals migrated', () => {
    expectMigrated(
      [
        'panels/BasePanel/ExtensionPaneWrapper.tsx',
        'panels/SequenceEditorPanel/GraphEditorToggle.tsx',
        'panels/SequenceEditorPanel/DopeSheet/Right/LengthIndicator/LengthIndicator.tsx',
        'panels/SequenceEditorPanel/DopeSheet/Right/BasicKeyframedTrack/KeyframeEditor/CurveEditorPopover/EasingOption.tsx',
        'panels/DetailPanel/DeterminePropEditorForDetail/SingleRowPropEditor.tsx',
        'panels/DetailPanel/DeterminePropEditorForDetail/DetailCompoundPropEditor.tsx',
        'uiComponents/Popover/TooltipWithIcon.tsx',
        'uiComponents/simpleContextMenu/ContextMenu/BaseMenu.tsx',
        'uiComponents/form/BasicSwitch.tsx',
        'uiComponents/Popover/BasicTooltip.tsx',
        'uiComponents/Popover/BasicPopover.tsx',
        'propEditors/simpleEditors/RgbaPropEditor.tsx',
        'uiComponents/chordial/TooltipOverlay.tsx',
        'toolbars/GlobalToolbar/GlobalToolbar.tsx',
        'toolbars/GlobalToolbar/MoreMenu/MoreMenu.tsx',
      ],
      [
        /color:\s*white\b/i,
        /color:\s*#fff\b/i,
        /color:\s*#ccc\b/i,
        /color:\s*#888\b/i,
      ],
      [],
    )
  })

  it('accent and shadow migrated', () => {
    expectMigrated(
      [
        'panels/SequenceEditorPanel/RightOverlay/FocusRangeZone/FocusRangeThumb.tsx',
        'toolbars/GlobalToolbar/GlobalToolbar.tsx',
      ],
      [/#40aaa4/i],
      ['var(--theatre-accent)'],
    )
    expectMigrated(
      [
        'notify.tsx',
        'panels/DetailPanel/DetailPanel.tsx',
        'toolbars/GlobalToolbar/MoreMenu/MoreMenu.tsx',
      ],
      [/rgba\(\s*0,\s*0,\s*0,\s*0\.25\s*\)/],
      ['var(--theatre-shadow-color)'],
    )
  })

  it('css.tsx host text styles migrated', () => {
    const css = read('css.tsx')
    expect(css).not.toMatch(/color:\s*white\b/)
    expect(css).not.toMatch(/\.text-color-pale\s*\{[^}]*#ccc/i)
  })

  it('host font uses font tokens', () => {
    const css = read('css.tsx')
    expect(css).toContain('var(--theatre-font-size)')
    expect(css).toContain('var(--theatre-font-family)')
    expect(css).not.toMatch(/font:\s*\n?\s*11px/)
  })
})
