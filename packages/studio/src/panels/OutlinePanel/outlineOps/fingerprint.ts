import type {
  PropTypeConfig,
  SheetObjectPropTypeConfig,
} from '@dreamerbird/core/types/public'

/**
 * 模板结构指纹:顶层键 + 各 propType 的 type 名 + compound 子键树。
 * 只取结构,不含函数/选项/默认值(spec §2)——宁可保守禁用粘贴,
 * 不可误粘贴。键排序后序列化,与书写顺序无关。
 */
export function fingerprintOfConfig(config: SheetObjectPropTypeConfig): string {
  return JSON.stringify(_nodeOfCompoundProps(config.props))
}

function _nodeOfCompoundProps(props: Record<string, PropTypeConfig>): unknown {
  return Object.keys(props)
    .sort()
    .map((key) => [key, _nodeOf(props[key]!)])
}

function _nodeOf(config: PropTypeConfig): unknown {
  if (config.type === 'compound') {
    return {compound: _nodeOfCompoundProps(config.props)}
  }
  return config.type
}
