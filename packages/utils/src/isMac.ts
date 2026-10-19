// navigator.platform 在 Node 的内置 navigator(≥21)里是空串、在测试环境
// 手工装的 navigator 壳上可能整个没有——拿不到就当非 Mac。
export const isMac =
  typeof navigator !== 'undefined' &&
  (navigator.platform ?? '').toUpperCase().indexOf('MAC') >= 0
