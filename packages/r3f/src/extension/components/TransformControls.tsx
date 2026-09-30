import type {Event, Object3D} from 'three'
import type {EventDispatcher} from 'three'
import React, {forwardRef, useLayoutEffect, useEffect, useMemo} from 'react'
import type {ThreeElement, Vector3} from '@react-three/fiber'
import {useThree} from '@react-three/fiber'
import {TransformControls as TransformControlsImpl} from 'three-stdlib'
import type {Overwrite} from '../../types'

/** The events three-stdlib's TransformControls dispatches (untyped upstream). */
type TransformControlsEventMap = {
  change: {}
  'dragging-changed': {value: boolean}
  objectChange: {}
}

export type TransformControlsDraggingChangedEvent = Event & {value: boolean}

type TransformControlsWithEvents = TransformControlsImpl &
  EventDispatcher<TransformControlsEventMap>

type R3fTransformControls = Overwrite<
  // the component constructs the impl itself, so `args` is meaningless here
  Omit<ThreeElement<typeof TransformControlsImpl>, 'args'>,
  {target?: Vector3}
>

export interface TransformControlsProps extends R3fTransformControls {
  object: Object3D
  orbitControlsRef?: React.MutableRefObject<{enabled: boolean} | null>
  onObjectChange?: (event: Event) => void
  onDraggingChange?: (event: TransformControlsDraggingChangedEvent) => void

  // not a complete list of props that transform controls can take
  mode: TransformControlsImpl['mode']
  space: TransformControlsImpl['space']
}

const TransformControls = forwardRef(
  (
    {
      children,
      object,
      orbitControlsRef,
      onObjectChange,
      onDraggingChange,
      ...props
    }: TransformControlsProps,
    ref,
  ) => {
    const {camera, gl, invalidate} = useThree()
    const controls = useMemo(
      () =>
        new TransformControlsImpl(
          camera,
          gl.domElement,
        ) as TransformControlsWithEvents,
      [camera, gl.domElement],
    )

    useLayoutEffect(() => {
      controls.attach(object)

      return () => void controls.detach()
    }, [object, controls])

    useEffect(() => {
      controls?.addEventListener?.('change', () => invalidate())
      return () => controls?.removeEventListener?.('change', () => invalidate())
    }, [controls, invalidate])

    useEffect(() => {
      const callback = (event: TransformControlsDraggingChangedEvent) => {
        if (orbitControlsRef && orbitControlsRef.current) {
          orbitControlsRef.current.enabled = !event.value
        }
      }

      if (controls) {
        controls.addEventListener!('dragging-changed', callback)
      }

      return () => {
        controls.removeEventListener!('dragging-changed', callback)
      }
    }, [controls, orbitControlsRef])

    useEffect(() => {
      if (onObjectChange) {
        controls.addEventListener('objectChange', onObjectChange)
      }

      return () => {
        if (onObjectChange) {
          controls.removeEventListener('objectChange', onObjectChange)
        }
      }
    }, [onObjectChange, controls])

    useEffect(() => {
      if (onDraggingChange) {
        controls.addEventListener('dragging-changed', onDraggingChange)
      }

      return () => {
        if (onDraggingChange) {
          controls.removeEventListener('dragging-changed', onDraggingChange)
        }
      }
    }, [controls, onDraggingChange])

    return <primitive dispose={null} object={controls} ref={ref} {...props} />
  },
)

export default TransformControls
