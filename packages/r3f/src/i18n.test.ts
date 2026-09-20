/**
 * r3f 界面词条的配对测试:中英文 key 集合必须完全一致、值非空。
 * 词典类型已用 Record<keyof typeof en, string> 强制补齐,
 * 这里再守住"多余 key/空值"两类漏网。
 */
import {r3fPropsEn, r3fPropsZhCN, r3fEditorEn, r3fEditorZhCN} from './i18nDicts'

describe('r3f 属性/编辑器词条 en ↔ zh-CN 配对', () => {
  const pairs: Array<[string, Record<string, string>, Record<string, string>]> =
    [
      ['props', r3fPropsEn, r3fPropsZhCN],
      ['editor', r3fEditorEn, r3fEditorZhCN],
    ]

  it.each(pairs)('%s:两语言 key 集合一致', (_name, en, zhCN) => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort())
  })

  it.each(pairs)('%s:所有值非空', (_name, en, zhCN) => {
    for (const dict of [en, zhCN]) {
      for (const [key, value] of Object.entries(dict)) {
        expect(value.trim().length).toBeGreaterThan(0)
      }
    }
  })
})
