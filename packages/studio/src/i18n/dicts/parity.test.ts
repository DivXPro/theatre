import {studioMessages} from '.'

test.each(Object.entries(studioMessages))(
  '%s has all studio messages and preserves their interpolation variables',
  (_locale, messages) => {
    const en = studioMessages.en
    expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort())
    for (const [key, message] of Object.entries(messages)) {
      expect(message.trim()).not.toBe('')
      expect((message.match(/\{\w+\}/g) ?? []).sort()).toEqual(
        (en[key].match(/\{\w+\}/g) ?? []).sort(),
      )
    }
  },
)
