// 词条注册必须最先执行:模块按 import 顺序求值,CameraScene 依赖链里有模块
// 加载期就 translate 的调用(ShotCamera 属性标签)
import './i18n'
export {setCameraStudioLocale} from './i18n'
export {CameraScene} from './CameraScene'
export {CAMERA_STUDIO_VERSION} from './version'
export {useCameraStudio} from './useCameraStudio'
export {
  HttpPatchAdapter,
  HttpSnapshotAdapter,
  loadSceneSyncState,
  SceneCommitRejectedError,
  SceneRevisionConflictError,
} from './sceneSync'
export type {
  SceneCommit,
  ScenePatchCommit,
  ScenePatchOperation,
  SceneSyncSnapshot,
  SceneSyncAdapter,
  SceneSyncState,
} from './sceneSync'
export type {
  CameraStudioConfig,
  CameraStudioHandle,
  CameraSceneProps,
  CameraStudioExport,
  CameraStudioSaveExport,
  ViewportRenderingConfig,
  CameraStudioAgentConfig,
  // 桥接连接配置(agent.bridge);桥接客户端本身不公开(内部接线)
  CameraStudioAgentBridgeConfig,
} from './config'
export type {ViewportRenderMode} from './mangaViewport'
export type {MangaShadingPreset} from './mangaShading'
export type {CameraStudioTheme} from './styles/theme'
// flows.onFlows 回调句柄类型(指南 §2 config 表已点名)及其签名用到的类型
export type {CameraFlows, Vec3} from './hostFlows'
export type {PathPreset} from './pathPresets'
export type {
  CameraStudioError,
  CameraStudioErrorHandler,
  CameraStudioErrorSource,
} from './errors'
// 测试与高级宿主可用:绕过 hook 直接管 init/dispose 生命周期
export {
  initCameraStudio,
  disposeCameraStudio,
  resetCameraStudio,
} from './bootstrap'
export type {BootCtx} from './bootstrap'
// Agent JS API(spec §7/§9):门面、命名空间类型、DTO 与错误族。
// 内部接线口(activate/dispose/bindSceneHandlers/getActiveAgentRuntime)
// 与 objectResolver 等内部实现不公开
export type {CameraStudioApi} from './agent/api'
export {AgentApiError, AGENT_API_ERROR_CODES} from './agent/errors'
export type {AgentApiErrorCode} from './agent/errors'
export type {RegistryDescription, CommandDescription} from './agent/registry'
export type {
  SceneObjectId,
  SceneObjectKind,
  JobSnapshot,
  JobState,
  AgentErrorDto,
  CompletionPhase,
  // describe() 元数据链路引用(CommandDescription 的字段类型)
  JsonSchema,
  CommandContext,
  CommandDefinition,
} from './agent/types'
export type {
  SceneApi,
  ObjectsApi,
  SceneSnapshot,
  SceneObjectSummary,
} from './agent/commands/scene'
export type {SelectionApi} from './agent/commands/selection'
export type {ModelsApi} from './agent/commands/models'
export type {PrimitivesApi} from './agent/commands/primitives'
export type {PrimitiveKind} from './primitives'
export type {MaterialsApi} from './agent/commands/materials'
export type {MaterialSlot, MaterialValues} from './materials/types'
export type {AssetsApi} from './agent/commands/assets'
export type {PosesApi, PosesSessionApi} from './agent/commands/poses'
export type {
  AnimationsApi,
  AnimationStatusDto,
} from './agent/commands/animations'
export type {CamerasApi} from './agent/commands/cameras'
export type {AnchorsApi} from './agent/commands/anchors'
export type {
  PathsApi,
  PathsSessionApi,
  PathPresetInfo,
} from './agent/commands/paths'
export type {SequenceApi, SequenceState} from './agent/commands/sequence'
export type {KeyframesApi, KeyframeInfo} from './agent/commands/keyframes'
export type {HistoryApi} from './agent/commands/history'
export type {ViewApi, ViewState} from './agent/commands/view'
export type {AnimationStripsApi} from './agent/commands/animationStrips'
export type {
  AnimationTrack,
  AnimationTrackKind,
  AnimationStrip,
  AnimationStripTiming,
  ObjectAnimationChannel,
} from './animationStrips/model'
export type {
  CharacterPathsApi,
  CharacterPathState,
} from './agent/commands/characterPaths'
export type {PoseIkApi} from './agent/commands/poseIk'
export type {IkPoint, IkTarget} from './poseMode/fullbodyControls'
export type {
  ViewRenderingApi,
  ViewRenderingState,
} from './agent/commands/viewRendering'
export type {UiApi, UiPanelKind} from './agent/commands/ui'
export type {ProjectApi} from './agent/commands/project'
export type {ExportsApi} from './agent/commands/exports'
export type {
  ExportRenderArgs,
  ExportRenderMode,
  ExportBackground,
  ExportAspectRatio,
  StillExportArgs,
  VideoExportArgs,
  StillExportResult,
} from './videoExport/previsTypes'
export type {JobsApi} from './agent/commands/jobs'
export type {VideoExportResult} from './agent/runtime/exportRuntime'
export type {GizmoMode} from './PlacementManager'
export type {PoseBones} from './poseMode/poseOverride'
export type {GestureSide} from './gestureProps'
export type {PoseFrameMode} from './poseMode/poseFrame'
// 内置静态姿势库:引用本包的项目可直接取姿势数据并应用到自己的骨架,
// 不必先启动编辑器。轻量消费可走 `@dreamerbird/camera-studio/poses` 子路径
export {
  BUILTIN_POSE_RIG,
  BUILTIN_POSE_SOURCES,
  listBuiltinPoses,
  getBuiltinPose,
  applyPose,
  capturePose,
  captureBindPose,
} from './poses'
export type {BuiltinPoseSourceId} from './poses'
// 统一数据源公开契约(spec §5):宿主实现/组合存储用的类型族、错误族与
// 内置 IndexedDB 实现;宿主自实现源可对 contract-tests 子路径跑契约套件
export type {
  LibrarySource,
  LibrarySourceCapabilities,
  WritableLibrarySource,
  LibraryErrorCode,
} from './assetLibrary/source'
export {LibraryError, isWritableSource} from './assetLibrary/source'
export type {
  RigId,
  RigAlias,
  EntryKind,
  ModelEntry,
  PoseEntry,
  AnimationEntry,
  LibraryEntry,
} from './assetLibrary/types'
export {IndexedDBBackend} from './assetLibrary/indexedDBBackend'
export {importModelFiles} from './assetLibrary/importModelFiles'
export {registerModelPicker, unregisterModelPicker} from './pickerRegistry'
export type {ModelPickerProps} from './pickerRegistry'
