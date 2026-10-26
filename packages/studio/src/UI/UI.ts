import type {Studio} from '@dreamerbird/studio/Studio'
import type {StudioPanelVisibility} from '@dreamerbird/core/types/public'
import {val} from '@dreamerbird/dataverse'

const NonSSRBitsClass =
  typeof window !== 'undefined'
    ? import('./UINonSSRBits').then((M) => M.default)
    : null

export default class UI {
  private _rendered = false
  private _nonSSRBits = NonSSRBitsClass
    ? NonSSRBitsClass.then((NonSSRBitsClass) => new NonSSRBitsClass())
    : Promise.reject()
  readonly ready: Promise<void> = this._nonSSRBits.then(
    () => undefined,
    () => undefined,
  )

  constructor(readonly studio: Studio) {}

  render() {
    if (this._rendered) {
      return
    }
    this._rendered = true

    this._nonSSRBits
      .then((b) => {
        b.render()
      })
      .catch((err) => {
        console.error(err)
        throw err
      })
  }

  hide() {
    this.studio.transaction(({stateEditors}) => {
      stateEditors.studio.ahistoric.setVisibilityState('everythingIsHidden')
    })
  }

  restore() {
    this.render()
    this.studio.transaction(({stateEditors}) => {
      stateEditors.studio.ahistoric.setVisibilityState('everythingIsVisible')
    })
  }

  get isHidden() {
    return (
      val(this.studio.atomP.ahistoric.visibilityState) === 'everythingIsHidden'
    )
  }

  /**
   * 显隐全局工具条的 LeftStrip(logo + 工作区按钮):写 ephemeral 槽,
   * LeftStrip 组件订阅;ephemeral 不持久化/不同步,随会话生效。
   */
  setLeftStripHidden(hidden: boolean) {
    this.studio.ephemeralAtom.setByPointer((p) => p.leftStripHidden, hidden)
  }

  setPanelVisibility(visibility: StudioPanelVisibility) {
    const current = val(this.studio.ephemeralAtom.pointer.hiddenPanels)
    this.studio.ephemeralAtom.setByPointer((p) => p.hiddenPanels, {
      outline:
        visibility.outline === undefined
          ? current?.outline
          : visibility.outline === false,
      details:
        visibility.details === undefined
          ? current?.details
          : visibility.details === false,
    })
  }

  renderToolset(toolsetId: string, htmlNode: HTMLElement) {
    let shouldUnmount = false

    let unmount: null | (() => void) = null

    this._nonSSRBits
      .then((nonSSRBits) => {
        if (shouldUnmount) return // unmount requested before the toolset is mounted, so, abort
        unmount = nonSSRBits.renderToolset(toolsetId, htmlNode)
      })
      .catch((err) => {
        console.error(err)
      })

    return () => {
      if (unmount) {
        unmount()
        return
      }
      if (shouldUnmount) return
      shouldUnmount = true
    }
  }
}
