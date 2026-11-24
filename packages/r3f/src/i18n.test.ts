/**
 * r3f 界面词条的配对测试:各语言 key 集合必须完全一致、值非空。
 * 词典类型已用 Record<keyof typeof en, string> 强制补齐,
 * 这里再守住"多余 key/空值"两类漏网。
 */
import {r3fMessages} from './i18nDicts'

test.each(Object.entries(r3fMessages))(
  '%s has all r3f property and editor labels',
  (_locale, messages) => {
    expect(Object.keys(messages).sort()).toEqual(
      Object.keys(r3fMessages.en).sort(),
    )
    for (const value of Object.values(messages)) {
      expect(value.trim()).not.toBe('')
    }
  },
)
