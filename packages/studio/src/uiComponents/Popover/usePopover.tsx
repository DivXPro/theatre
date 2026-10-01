import {usePointerCapturing} from '@dreamerbird/studio/UIRoot/PointerCapturing'
import useRefAndState from '@dreamerbird/studio/utils/useRefAndState'
import React, {useCallback, useContext, useEffect, useRef} from 'react'
import {createPortal} from 'react-dom'
import {PortalContext} from 'reakit'
import type {AbsolutePlacementBoxConstraints} from './PopoverPositioner'
import PopoverPositioner from './PopoverPositioner'
import {contextMenuShownContext} from '@dreamerbird/studio/panels/DetailPanel/DetailPanel'

export type OpenFn = (
  e:
    | React.MouseEvent
    | MouseEvent
    | {clientX: number; clientY: number}
    | undefined,
  target: HTMLElement | SVGElement | Element,
) => void
type CloseFn = (reason: string) => void
type State =
  | {isOpen: false}
  | {
      isOpen: true
      clickPoint: {
        clientX: number
        clientY: number
      }
      target: HTMLElement | SVGElement | Element
      opts: Opts
      onPointerOutside?: {
        threshold: number
        callback: (e: MouseEvent) => void
      }
      onClickOutside: () => void
    }

/**
 * 嵌套弹框锁:子弹框打开时 takeFocus,父弹框的「点外部关/挪远关」检查到
 * 子锁持有即跳过——颜色选择器等二级弹框赖此存活。usePopover 的子弹框自动
 * 入锁;不经 usePopover 的自制弹层(如姿势选择停靠框,直接 portal 到
 * document.body)须手动 useContext 本锁,打开期间 takeFocus、关闭释放。
 * 不在任何弹框内时拿到默认值(takeFocus 为空操作),零影响。
 */
export const PopoverAutoCloseLock = React.createContext({
  // defaults have no effects, since there would not be a
  // parent popover to worry about auto-closing.
  takeFocus() {
    return {
      releaseFocus() {},
    }
  },
})

type Opts = {
  debugName: string
  closeWhenPointerIsDistant?: boolean
  pointerDistanceThreshold?: number
  closeOnClickOutside?: boolean
  constraints?: AbsolutePlacementBoxConstraints
  verticalGap?: number
}

export interface IPopover {
  /**
   * The React node of the popover. Insert into your JSX using \{node\}. Its state
   * will be managed automatically.
   */
  node: React.ReactNode
  open: OpenFn
  close: CloseFn
  toggle: OpenFn
  isOpen: boolean
}

/**
 * @deprecated Use useChordial() instead.
 */
export default function usePopover(
  opts: Opts | (() => Opts),
  render: () => React.ReactElement,
): IPopover {
  const _debug = (...args: any) => {}

  // want to make sure that we don't close a popover when dragging something (like a curve editor handle)
  // I think this could be improved to handle closing after done dragging, better.
  const {isPointerBeingCaptured} = usePointerCapturing(`usePopover`)

  const [stateRef, state] = useRefAndState<State>({
    isOpen: false,
  })

  const optsRef = useRef(opts)

  const close = useCallback<CloseFn>((reason: string): void => {
    _debug(`closing due to "${reason}"`)
    stateRef.current = {isOpen: false}
  }, [])

  const open = useCallback<OpenFn>((e, target) => {
    const opts =
      typeof optsRef.current === 'function'
        ? optsRef.current()
        : optsRef.current

    function onClickOutside(): void {
      if (lock.childHasFocusRef.current) return
      if (opts.closeOnClickOutside !== false) {
        close('clicked outside popover')
      }
    }

    stateRef.current = {
      isOpen: true,
      clickPoint: {clientX: e?.clientX ?? 0, clientY: e?.clientY ?? 0},
      target,
      opts,
      onClickOutside: onClickOutside,
      onPointerOutside:
        opts.closeWhenPointerIsDistant === false
          ? undefined
          : {
              threshold: opts.pointerDistanceThreshold ?? 100,
              callback: () => {
                if (lock.childHasFocusRef.current) return
                // this is a bit weird, because when you stop capturing, then the popover can close on you...
                // TODO: Better fixes?
                if (isPointerBeingCaptured()) return
                close('pointer outside')
              },
            },
    }
  }, [])

  const toggle = useCallback<OpenFn>((...args) => {
    if (stateRef.current.isOpen) {
      close('toggled')
    } else {
      open(...args)
    }
  }, [])

  /**
   * See doc comment on {@link useAutoCloseLockState}.
   * Used to ensure that moving far away from a parent popover doesn't
   * close a child popover.
   */
  const lock = useAutoCloseLockState({
    _debug,
    state,
  })

  // TODO: this lock is now exported from the detail panel, do refactor it when you get the chance
  const [, addContextMenu] = useContext(contextMenuShownContext)

  useEffect(() => {
    let removeContextMenu: () => void | undefined
    if (state.isOpen) {
      removeContextMenu = addContextMenu()
    }

    return () => removeContextMenu?.()
  }, [state.isOpen])

  const portalLayer = useContext(PortalContext)

  const node = state.isOpen ? (
    createPortal(
      <PopoverAutoCloseLock.Provider value={lock.childPopoverLock}>
        <PopoverPositioner
          children={render}
          target={state.target}
          onClickOutside={state.onClickOutside}
          onPointerOutside={state.onPointerOutside}
          constraints={state.opts.constraints}
          verticalGap={state.opts.verticalGap}
        />
      </PopoverAutoCloseLock.Provider>,
      portalLayer!,
    )
  ) : (
    <></>
  )

  return {node, open, close, toggle, isOpen: state.isOpen}
}

/**
 * Keep track of the current lock state, and provide
 * a lock that can be passed down to popover children.
 *
 * Used to ensure that moving far away from a parent popover doesn't
 * close a child popover.
 * When child popovers are opened, we want to suspend all auto-closing
 * behaviors for parenting popovers.
 */
function useAutoCloseLockState(options: {
  state: {isOpen: boolean}
  _debug: (message: string, args?: object) => void
}) {
  const parentLock = useContext(PopoverAutoCloseLock)

  useEffect(() => {
    if (options.state.isOpen) {
      // when this "popover" is open, then take focus from parent
      const focused = parentLock.takeFocus()
      options._debug('take focus')
      return () => {
        // when closed / unmounted, release focus
        options._debug('release focus')
        focused.releaseFocus()
      }
    }
  }, [options.state.isOpen])

  // child of us
  const childHasFocusRef = useRef(false)
  return {
    childHasFocusRef: childHasFocusRef,
    childPopoverLock: {
      takeFocus() {
        childHasFocusRef.current = true
        return {
          releaseFocus() {
            childHasFocusRef.current = false
          },
        }
      },
    },
  }
}
