# Camera 场景多相机 + 多路径（P2）设计

日期：2026-09-10
状态：待评审
前置：相机注册表 P1（`cameraRegistry.ts`）、路径注册表 P1（`pathRegistry.ts`，registry-driven path lifecycle）已合并。两个注册表本身就是列表结构，命名生成器（`nextCameraEntry` / `nextPathEntry`）已为多数准备好（Shot Camera 2…、Pos Path 2…）；P1 在 App 层用 `cameras.length > 0` / `paths.length === 0` 卡死成单例。P2 = 解除单例限制并补齐配套语义。

## 目标

- 工具条「添加相机」「添加路径」不再置灰，可反复添加。
- 多台相机共存：每台有机身/视锥/Target/面板/大纲行；取景能力（画中画、镜头视角、导出）归一台「活动相机」。
- 多条路径共存：每条独立编辑/删除；相机可绑定任意一条路径，路径模式下沿绑定路径走。
- 全部沿用现有交互语义（对齐 Blender 的约束/编辑模式模型），不引入新面板。

## 已确认的决策

1. **相机选路径**：路径是独立场景对象，相机面板选择绑定哪条；删除路径时绑它的相机回退手动。
2. **单活动相机**：画中画/镜头视角/导出只针对活动相机；右键任意相机「查看此镜头」= 设为活动并进入镜头视角。非活动相机只画机身与视锥线框。
3. **共享进度**：行进进度 `progress` 仍在路径对象上，多相机绑同一条路径时读同一份进度（同一路径点）。不做"每台相机各自进度"。

## 数据模型

### 相机对象新增 `pathKey` 属性

```ts
const shotCameraAdditionalProps = {
  trackTarget: t.boolean(true, ...),      // 不变
  targetHidden: t.boolean(false, ...),    // 不变
  moveMode: t.stringLiteral('manual', {manual: '手动', path: '路径'}, ...),
  pathKey: t.string('', {label: '绑定路径'}),  // 新增:空 = 未绑定
}
```

- `moveMode` 选项标签从 `pathObjectName(POS_PATH_KEY)` 改为通用的「路径」——配置是模块级常量（theatre 要求 deep-equal），**不能**把动态路径清单塞进 stringLiteral 选项，绑定哪个路径由 `pathKey` 表达。
- `pathKey` 是自由字符串属性（面板上是个文本框，能用但丑）；主交互入口是面板动作区的动态按钮（见下），文本框只当兜底。
- **旧状态兼容**：`moveMode === 'path'` 且 `pathKey` 为空时，读侧回退视为绑定 `'Pos Path'`（老场景的路径数据就是这个 key）。不做写迁移。统一走一个 helper：`resolveBoundPathKey(camObj): string | null`。

### 路径对象不变

进度 `progress`、控制点清单、面板动作都维持现状，只是 key 从单例 `POS_PATH_KEY` 变成注册表里的任意 `pathKey`。

## 活动相机

- App 新增 `activeCameraKey: string | null` 状态：默认取清单第一台；活动相机被删时顺位给新的第一台；清单为空时为 `null`。
- 消费方全部改读活动相机：
  - `ShotCamera` 渲染：`cameras.map` 渲染全部（现状已是 map），`makeDefault={shotView && isActive}`，画中画只在活动相机上渲染（`pip={!shotView && isActive}`）。
  - 画中画边框 overlay、`targetMissing` 提示条、导出：跟随活动相机。
  - 导出中活动相机被删 → 中止录制（现有 effect 改成盯 `activeCameraKey` 是否还在清单里）。非活动相机被删不影响导出。
- 右键相机菜单带上 `cameraKey`：`cameraMenu` 状态从 `{x, y}` 扩成 `{cameraKey, x, y}`；「查看此镜头」= 设活动 + 进镜头视角；「删除相机」删那台。

## 每实例 refs

现状 App 只有一对 `shotCameraObjRef / shotTargetObjRef`，`cameras.map` 里多台会互相覆盖。改为按 cameraKey 的 ref 表：

- App 持有 `shotObjRefsRef = useRef(new Map<string, {camera?: ISheetObject; target?: ISheetObject}>())`。
- `ShotCamera` 挂载时往自己 slot 写，卸载时清（沿用现有"卸载即清空"语义，只是写入 Map slot 而不是单一 ref）。
- 读侧（播种、平移路径到相机、targetMissing 订阅、删除相机、调试挂钩）一律先取活动相机的 slot。
- `window.__cameraShot` 调试挂钩改为暴露 `shotRefs`（整个 Map）+ `activeKey()`，保持自动化可读。

## 路径绑定的交互

theatre 属性配置是静态的，路径清单是动态的——绑定选择器不能做成属性下拉，放在两个动态入口处：

1. **相机面板动作区**（`buildCameraPanelActions` 扩展，动态生成）：
   - 未绑定：每条有控制点的路径一个按钮「绑定到 Pos Path 2」。
   - 已绑定：「解绑路径」+ 切换到其他路径的按钮。
2. **路径右键菜单**新增「绑定到活动相机」（无活动相机或已绑给活动相机时不出）。

绑定/解绑 = 一次 scrub 同时写 `pathKey` 和 `moveMode`（绑定时顺手把 moveMode 切到 path，解绑切回 manual），避免"绑了但没生效"的中间态。

## 绑定失效回退

`ShotCamera` 内响应式看护：绑定的 `pathKey` 对应的注册表行或路径对象不存在时（本地删除或对端同步删除都会走到），一次 scrub 写 `moveMode='manual'` + `pathKey=''`，机位定格当前位置（对齐 Blender 约束目标被删）。空路径（没控制点）不算失效，沿用现有"空路径回退手动、不锁拖拽"语义。

## App.tsx 路径相关逻辑的泛化

以下都从写死 `POS_PATH_KEY` 改为按注册表/编辑态参数化：

- `pathProgressOf(pathKey)`：按 key 读对应路径对象的进度（`CameraPath` 每条传自己的）。
- `pinPathPointAtPlayhead` / `progressKeyframes`：从只对 `POS_PATH_KEY` 开放改为对 `editingPath` 指向的任意路径开放（`PathPointEditor` 的 `onPinAtPlayhead` 不再有条件）。
- Tab 进入编辑：选中对象是注册表里任意一条路径的 meta 即进入（现状只认 Pos Path）。
- 「路径平移到相机」：路径面板动作本来就按 key 注册（`setPathPanelActions(sheet, pathKey, …)`），泛化为对每条已注册路径都注册；平移目标改为活动相机机位。
- 添加路径播种弧：从活动相机机位+瞄准点取种子（无相机时维持现状回退导演视角）。
- 启动孤儿清扫：保留对 legacy `'Pos Path'` 的检查（老结构残留）；新 key 只经 `addPath` 产生，对象先于注册表行出现是正常播种窗口，不扫。

## 结构改动清单

| 文件 | 改动 |
|---|---|
| `App.tsx` | activeCameraKey 状态；refs 改 Map；解除两个添加按钮置灰；相机菜单带 cameraKey；路径进度/钉帧/Tab/平移泛化；删除相机按 entry |
| `ShotCamera.tsx` | 新增 `pathKey` 属性；`POS_PATH_KEY` 全部改读 `resolveBoundPathKey`；绑定失效看护；pip/makeDefault 按 isActive；refs 写 Map slot；面板动作区加绑定按钮 |
| `CameraPath.tsx` | `POS_PATH_KEY` 常量保留仅供 legacy 回退引用；新增绑定到活动相机的菜单支持 |
| `menuModel.ts` | `buildCameraMenuItems` 参数化（是否活动相机）；`buildCameraPanelActions` 加路径绑定按钮；`buildPathMenuItems` 加「绑定到活动相机」 |
| `cameraRegistry.ts` | 无改动（`nextCameraEntry` 已就绪） |
| `pathRegistry.ts` | 无改动（`nextPathEntry` 已就绪） |
| `TopToolbar.tsx` | 添加按钮恒可用（或保留 disabled 形态恒 false） |

## 测试

- `menuModel.test.ts`：相机菜单按活动态出项；面板动作按绑定态/路径清单出按钮；路径菜单含绑定项。
- `cameraRegistry.test.ts` / `pathRegistry.test.ts`：现有用例不受影响，补多台/多条命名递增用例（如已覆盖则不动）。
- e2e（playground `yarn test:e2e` 体系）：添加两台相机各自取景；右键切换活动相机；两台相机绑不同路径各走各的；删路径后绑定相机回退手动；删活动相机后画中画/导出收敛到下一台。

## 非目标

- 每台相机各自进度（已明确不做，共享进度）。
- 旋转路径 / 朝向路径（Track To 已覆盖朝向）。
- 相机/路径重命名 UI。
- studio 面板侧的多实例分组展示优化。
