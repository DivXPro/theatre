import type {EditableFactoryConfig} from './editableFactoryConfigUtils'
import {
  createColorPropConfig,
  createNumberPropConfig,
  createVector,
  createVectorPropConfig,
  extendObjectProps,
} from './editableFactoryConfigUtils'
import type {
  DirectionalLight,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  PointLight,
  SpotLight,
} from 'three'
import {
  BoxHelper,
  CameraHelper,
  Color,
  DirectionalLightHelper,
  PointLightHelper,
  SpotLightHelper,
} from 'three'
import {translate} from '@dreamerbird/studio/i18n'
import './i18n'

/**
 * 属性面板显示名,函数形式:studio 每次渲染现调,语言切换热改。
 * 本文件的配置都是模块级常量(只建一次),箭头引用天然稳定。
 */
const propLabel =
  (key: string): (() => string) =>
  () =>
    translate(key)

const baseObjectConfig = {
  props: {
    position: createVectorPropConfig('position', createVector(), {
      label: propLabel('r3f.props.position'),
    }),
    rotation: createVectorPropConfig('rotation', createVector(), {
      label: propLabel('r3f.props.rotation'),
    }),
    scale: createVectorPropConfig('scale', createVector([1, 1, 1]), {
      label: propLabel('r3f.props.scale'),
    }),
  },
  useTransformControls: true,
  icon: 'cube' as const,
  createHelper: (object: Object3D) => new BoxHelper(object, selectionColor),
}

const baseLightConfig = {
  ...extendObjectProps(baseObjectConfig, {
    intensity: createNumberPropConfig('intensity', 1, {
      label: propLabel('r3f.props.intensity'),
    }),
    distance: createNumberPropConfig('distance', 0, {
      label: propLabel('r3f.props.distance'),
    }),
    decay: createNumberPropConfig('decay', 0, {
      label: propLabel('r3f.props.decay'),
    }),
    color: createColorPropConfig('color', new Color('white'), {
      label: propLabel('r3f.props.color'),
    }),
  }),
  dimensionless: true,
}

const baseCameraConfig = {
  ...extendObjectProps(baseObjectConfig, {
    near: createNumberPropConfig('near', 0.1, {
      nudgeMultiplier: 0.1,
      label: propLabel('r3f.props.near'),
    }),
    far: createNumberPropConfig('far', 2000, {
      nudgeMultiplier: 0.1,
      label: propLabel('r3f.props.far'),
    }),
  }),
  updateObject: (camera: PerspectiveCamera | OrthographicCamera) => {
    camera.updateProjectionMatrix()
  },
  icon: 'camera' as const,
  dimensionless: true,
  createHelper: (camera: PerspectiveCamera) => new CameraHelper(camera),
}

const selectionColor = '#40AAA4'

const defaultEditableFactoryConfig = {
  group: {
    ...baseObjectConfig,
    icon: 'collection' as const,
    createHelper: (object: Object3D) => new BoxHelper(object, selectionColor),
  },
  mesh: {
    ...baseObjectConfig,
    icon: 'cube' as const,
    createHelper: (object: Object3D) => new BoxHelper(object, selectionColor),
  },
  spotLight: {
    ...extendObjectProps(baseLightConfig, {
      angle: createNumberPropConfig('angle', 0, {
        nudgeMultiplier: 0.001,
        label: propLabel('r3f.props.angle'),
      }),
      penumbra: createNumberPropConfig('penumbra', 0, {
        nudgeMultiplier: 0.001,
        label: propLabel('r3f.props.penumbra'),
      }),
    }),
    icon: 'spotLight' as const,
    createHelper: (light: SpotLight) =>
      new SpotLightHelper(light, selectionColor),
  },
  directionalLight: {
    ...extendObjectProps(baseObjectConfig, {
      intensity: createNumberPropConfig('intensity', 1, {
        label: propLabel('r3f.props.intensity'),
      }),
      color: createColorPropConfig('color', new Color('white'), {
        label: propLabel('r3f.props.color'),
      }),
    }),
    icon: 'sun' as const,
    dimensionless: true,
    createHelper: (light: DirectionalLight) =>
      new DirectionalLightHelper(light, 1, selectionColor),
  },
  pointLight: {
    ...baseLightConfig,
    icon: 'lightBulb' as const,
    createHelper: (light: PointLight) =>
      new PointLightHelper(light, 1, selectionColor),
  },
  ambientLight: {
    props: {
      intensity: createNumberPropConfig('intensity', 1, {
        label: propLabel('r3f.props.intensity'),
      }),
      color: createColorPropConfig('color', new Color('white'), {
        label: propLabel('r3f.props.color'),
      }),
    },
    useTransformControls: false,
    icon: 'lightBulb' as const,
  },
  hemisphereLight: {
    props: {
      intensity: createNumberPropConfig('intensity', 1, {
        label: propLabel('r3f.props.intensity'),
      }),
      color: createColorPropConfig('color', new Color('white'), {
        label: propLabel('r3f.props.color'),
      }),
      groundColor: createColorPropConfig('groundColor', new Color('white'), {
        label: propLabel('r3f.props.groundColor'),
      }),
    },
    useTransformControls: false,
    icon: 'lightBulb' as const,
  },
  perspectiveCamera: extendObjectProps(baseCameraConfig, {
    fov: createNumberPropConfig('fov', 50, {
      nudgeMultiplier: 0.1,
      label: propLabel('r3f.props.fov'),
    }),
    zoom: createNumberPropConfig('zoom', 1, {
      label: propLabel('r3f.props.zoom'),
    }),
  }),
  orthographicCamera: baseCameraConfig,
  points: baseObjectConfig,
  // fiber v9 removed the `<line>` JSX element (SVG name conflict);
  // use lineSegments/lineLoop or a drei Line wrapped with editable().
  lineLoop: baseObjectConfig,
  lineSegments: baseObjectConfig,
  fog: {
    props: {
      color: createColorPropConfig('color', new Color('white'), {
        label: propLabel('r3f.props.fogColor'),
      }),
      near: createNumberPropConfig('near', 1, {
        nudgeMultiplier: 0.1,
        label: propLabel('r3f.props.fogNear'),
      }),
      far: createNumberPropConfig('far', 1000, {
        nudgeMultiplier: 0.1,
        label: propLabel('r3f.props.fogFar'),
      }),
    },
    useTransformControls: false,
    icon: 'cloud' as const,
  },
}

// Assert that the config is indeed of EditableFactoryConfig without actually
// forcing it to that type so that we can pass the real type to the editable factory
defaultEditableFactoryConfig as EditableFactoryConfig

export default defaultEditableFactoryConfig
