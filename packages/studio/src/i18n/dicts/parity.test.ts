import {en} from './en'
import {zhCN} from './zh-CN'

test('studio 内置词典 en/zh-CN key 集合一致', () => {
  expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort())
})
