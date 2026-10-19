# Camera Studio Agent 命令参考

> 由 schema-to-markdown.mjs 生成,请勿手改。API version: `1`。

本文件由运行时 schema(`GET /v1/schema`)生成:同一 schema 重复生成字节一致(无时间戳)。重新生成:

```bash
node .claude/skills/camera-studio-agent/scripts/scene-api.mjs schema \
  | node .claude/skills/camera-studio-agent/scripts/schema-to-markdown.mjs \
  > .claude/skills/camera-studio-agent/references/commands.md
```

---
## `anchors.clearParent`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,anchor:<key>"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `anchors.create`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `mounted`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"position":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"z":{"type":"number"}},"required":["x","y","z"],"additionalProperties":false,"description":"创建位置(世界坐标);缺省 = 导演视角前方 5 单位"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,anchor:<key>"},"revision":{"type":"number"}},"required":["objectId","revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`, `INTERNAL_ERROR`

## `anchors.setParent`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,anchor:<key>"},"parent":{"type":"string","description":"父级目标:anchor:<key> | model:<key> | camera:<key> | bone:<placementKey>#<part>"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId","parent"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `animations.apply`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID(模型),如 model:Y Bot"},"assetId":{"type":"string","description":"动画资产条目 id"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId","assetId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `ASSET_NOT_FOUND`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `animations.clear`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID(模型),如 model:Y Bot"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `animations.getStatus`

- Kind: `query`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID(模型),如 model:Y Bot"}},"required":["objectId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"assetId":{"type":"string"},"loaded":{"type":"boolean"},"error":{"type":"object","properties":{"code":{"type":"string"},"message":{"type":"string"},"retryable":{"type":"boolean"}},"required":["code","message","retryable"]}},"required":["loaded"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`

## `assets.delete`

- Kind: `mutation`
- State: `asset`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"assetId":{"type":"string","description":"资产条目 id"}},"required":["assetId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"deleted":{"enum":[true]}},"required":["deleted"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `ASSET_NOT_FOUND`, `INVALID_STATE`, `STORAGE_ERROR`, `NETWORK_ERROR`, `INTERNAL_ERROR`

## `assets.get`

- Kind: `query`
- State: `asset`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"assetId":{"type":"string","description":"资产条目 id"}},"required":["assetId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","description":"资产库条目(模型/姿势/动画共用外壳,各 kind 另有专属字段)","properties":{"id":{"type":"string"},"kind":{"enum":["model","pose","animation"]},"name":{"type":"string"},"rig":{"type":"string"},"createdAt":{"type":"number"}},"required":["id","kind","name"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `ASSET_NOT_FOUND`

## `assets.importModel`

- Kind: `job`
- State: `asset`
- Undoable: `none`
- Completion: `loaded`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"file":{"type":"object","description":"HTTP:经 POST /v1/files 上传后的引用;JS:直接传 hydrated File","properties":{"fileId":{"type":"string","description":"桥接上传返回的文件 id"},"fileName":{"type":"string"},"mimeType":{"type":"string"}},"required":["fileId"],"additionalProperties":false}},"required":["file"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"jobId":{"type":"string"}},"required":["jobId"]}
```

### Job result

```json
{"type":"object","properties":{"id":{"type":"string"},"kind":{"enum":["model"]},"name":{"type":"string"},"rig":{"type":"string"},"blobId":{"type":"string"},"contentHash":{"type":"string"},"thumbnailId":{"type":"string"},"boneCount":{"type":"number"},"vertexCount":{"type":"number"},"createdAt":{"type":"number"}},"required":["id","kind","name","rig","blobId","contentHash","boneCount","vertexCount","createdAt"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_STATE`, `STORAGE_ERROR`, `NETWORK_ERROR`, `PARTIAL_FAILURE`, `INTERNAL_ERROR`

## `assets.list`

- Kind: `query`
- State: `asset`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"kind":{"enum":["model","pose","animation"],"description":"按条目类型过滤;缺省返回全部"}},"additionalProperties":false}
```

### Output

```json
{"type":"array","items":{"type":"object","description":"资产库条目(模型/姿势/动画共用外壳,各 kind 另有专属字段)","properties":{"id":{"type":"string"},"kind":{"enum":["model","pose","animation"]},"name":{"type":"string"},"rig":{"type":"string"},"createdAt":{"type":"number"}},"required":["id","kind","name"]}}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`

## `assets.rename`

- Kind: `mutation`
- State: `asset`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"assetId":{"type":"string","description":"资产条目 id"},"name":{"type":"string","description":"新名称(非空)"}},"required":["assetId","name"],"additionalProperties":false}
```

### Output

```json
{"type":"object","description":"资产库条目(模型/姿势/动画共用外壳,各 kind 另有专属字段)","properties":{"id":{"type":"string"},"kind":{"enum":["model","pose","animation"]},"name":{"type":"string"},"rig":{"type":"string"},"createdAt":{"type":"number"}},"required":["id","kind","name"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `ASSET_NOT_FOUND`, `INVALID_STATE`, `STORAGE_ERROR`, `NETWORK_ERROR`, `INTERNAL_ERROR`

## `cameras.bindPath`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,camera:<key>"},"pathId":{"type":"string","description":"带类型路径 ID,path:<key>"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId","pathId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `cameras.create`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `mounted`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"fromCurrentView":{"type":"boolean","description":"true = 以当前导演视角的机位/朝向为种子"},"transform":{"type":"object","properties":{"position":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"z":{"type":"number"}},"required":["x","y","z"],"additionalProperties":false,"description":"机位(世界坐标)"},"rotation":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"z":{"type":"number"}},"required":["x","y","z"],"additionalProperties":false,"description":"朝向(XYZ 欧拉角,弧度)"}},"required":["position","rotation"],"additionalProperties":false,"description":"显式初始机位/朝向;与 fromCurrentView 互斥"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,camera:<key>"},"revision":{"type":"number"}},"required":["objectId","revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`, `INTERNAL_ERROR`

## `cameras.setActive`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,camera:<key>"}},"required":["objectId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `SCENE_UNAVAILABLE`

## `cameras.setAimTarget`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,camera:<key>"},"target":{"type":"string","description":"瞄准目标:''(解除)| anchor:<key> | bone:<placementKey>#<part>"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId","target"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `cameras.unbindPath`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,camera:<key>"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `exports.startVideo`

- Kind: `job`
- State: `session`
- Undoable: `none`
- Completion: `loaded`
- Cancelable: yes
- Expected revision: no

### Input

```json
{"type":"object","properties":{"cameraId":{"type":"string","description":"相机对象 ID(camera:<key>);缺省 = 当前活动相机"}},"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"jobId":{"type":"string"}},"required":["jobId"]}
```

### Job result

```json
{"type":"object","description":"HTTP:导出文件描述(经 GET /v1/files/:id 下载);JS 结果为 VideoExportResult(blob/fileName/mimeType/size)","properties":{"fileId":{"type":"string","description":"桥接临时文件 id"},"fileName":{"type":"string"},"mimeType":{"type":"string"},"size":{"type":"number","description":"字节数"}},"required":["fileId","fileName","mimeType","size"]}
```

### Errors

`API_DISPOSED`, `SCENE_UNAVAILABLE`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `CAPABILITY_UNAVAILABLE`, `JOB_CANCELLED`, `INTERNAL_ERROR`

## `history.redo`

- Kind: `mutation`
- State: `project`
- Undoable: `none`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `history.undo`

- Kind: `mutation`
- State: `project`
- Undoable: `none`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `jobs.cancel`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"jobId":{"type":"string","description":"任务 id(任务命令的返回值)"}},"required":["jobId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"jobId":{"type":"string"},"kind":{"type":"string"},"state":{"enum":["pending","running","succeeded","failed","cancelled"]},"progress":{"type":"number","description":"0..1"},"phase":{"enum":["accepted","committed","mounted","loaded"]},"result":{"description":"成功时的任务输出(形状见各命令 jobResultSchema)"},"error":{"type":"object","description":"失败时的结构化错误{code,message,retryable,details?}"},"cancelable":{"type":"boolean"}},"required":["jobId","kind","state","progress","phase","cancelable"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `JOB_NOT_FOUND`, `JOB_NOT_CANCELABLE`, `INVALID_STATE`

## `jobs.get`

- Kind: `query`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"jobId":{"type":"string","description":"任务 id(任务命令的返回值)"}},"required":["jobId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"jobId":{"type":"string"},"kind":{"type":"string"},"state":{"enum":["pending","running","succeeded","failed","cancelled"]},"progress":{"type":"number","description":"0..1"},"phase":{"enum":["accepted","committed","mounted","loaded"]},"result":{"description":"成功时的任务输出(形状见各命令 jobResultSchema)"},"error":{"type":"object","description":"失败时的结构化错误{code,message,retryable,details?}"},"cancelable":{"type":"boolean"}},"required":["jobId","kind","state","progress","phase","cancelable"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `JOB_NOT_FOUND`

## `keyframes.delete`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,如 model:Y Bot"},"propPath":{"type":"array","items":{"type":"string"},"description":"简单叶子的属性路径分段,如 [\"position\",\"x\"]"},"at":{"type":"number","description":"要删除的关键帧位置(秒)"},"snap":{"type":"boolean","description":"先按序列网格吸附位置再写入,默认 false"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId","propPath","at"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `KEYFRAME_NOT_FOUND`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `keyframes.list`

- Kind: `query`
- State: `project`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,如 model:Y Bot"},"propPath":{"type":"array","items":{"type":"string"},"description":"简单叶子的属性路径分段,如 [\"position\",\"x\"]"}},"required":["objectId","propPath"],"additionalProperties":false}
```

### Output

```json
{"type":"array","items":{"type":"object","properties":{"position":{"type":"number"},"value":{"description":"关键帧值(简单叶子的标量)"}},"required":["position","value"]}}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`

## `keyframes.move`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,如 model:Y Bot"},"propPath":{"type":"array","items":{"type":"string"},"description":"简单叶子的属性路径分段,如 [\"position\",\"x\"]"},"from":{"type":"number","description":"源关键帧位置(秒)"},"to":{"type":"number","description":"目标位置(秒)"},"snap":{"type":"boolean","description":"先按序列网格吸附位置再写入,默认 false"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId","propPath","from","to"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `KEYFRAME_NOT_FOUND`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `keyframes.set`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,如 model:Y Bot"},"propPath":{"type":"array","items":{"type":"string"},"description":"简单叶子的属性路径分段,如 [\"position\",\"x\"]"},"at":{"type":"number","description":"关键帧位置(秒)"},"value":{"description":"关键帧值,形状与叶子当前值一致"},"snap":{"type":"boolean","description":"先按序列网格吸附位置再写入,默认 false"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId","propPath","at","value"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `models.create`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `mounted`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"assetId":{"type":"string","description":"模型资产条目 id"},"position":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"z":{"type":"number"}},"required":["x","y","z"],"additionalProperties":false,"description":"创建位置(世界坐标)"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["assetId","position"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,model:<key>"},"revision":{"type":"number"}},"required":["objectId","revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `ASSET_NOT_FOUND`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`, `RESOURCE_LOAD_FAILED`, `INTERNAL_ERROR`

## `objects.delete`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID(model:/camera:/anchor:/path:<key>);类型决定完整清理行为(spec 9.2)"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"deleted":{"type":"string","description":"已删除的带类型场景对象 ID"},"revision":{"type":"number"}},"required":["deleted","revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `objects.get`

- Kind: `query`
- State: `project`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,如 model:Y Bot"}},"required":["objectId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"id":{"type":"string","description":"带类型场景对象 ID,如 model:Y Bot"},"kind":{"type":"string","enum":["model","camera","anchor","path"]},"key":{"type":"string"},"props":{"type":"object","description":"当前求值属性的深拷贝;未挂载为 null"},"mounted":{"type":"boolean"}},"required":["id","kind","key","props","mounted"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`

## `objects.list`

- Kind: `query`
- State: `project`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","description":"带类型场景对象 ID,如 model:Y Bot"},"kind":{"type":"string","enum":["model","camera","anchor","path"]},"key":{"type":"string"},"props":{"type":"object","description":"当前求值属性的深拷贝;未挂载为 null"},"mounted":{"type":"boolean"}},"required":["id","kind","key","props","mounted"]}}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`

## `objects.update`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,如 model:Y Bot"},"props":{"type":"object","description":"顶层静态属性 patch;compound 属性必须提供完整值"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId","props"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `paths.addPoint`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"pathId":{"type":"string","description":"带类型路径 ID,path:<key>"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["pathId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"pointKey":{"type":"string"},"revision":{"type":"number"}},"required":["pointKey","revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `paths.createPreset`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"preset":{"type":"string","description":"预设 id(paths.listPresets 返回)"},"at":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"z":{"type":"number"}},"required":["x","y","z"],"additionalProperties":false,"description":"显式落点(世界坐标);缺省自动避让"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["preset"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"pathId":{"type":"string","description":"带类型路径 ID,path:<key>"},"pointKeys":{"type":"array","items":{"type":"string"},"description":"播下的控制点 key(P1..Pn)"},"revision":{"type":"number"}},"required":["pathId","pointKeys","revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `paths.deletePoint`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"pathId":{"type":"string","description":"带类型路径 ID,path:<key>"},"pointKey":{"type":"string","description":"控制点 key,如 P2"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["pathId","pointKey"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"},"pathDeleted":{"type":"boolean","description":"删掉的是最后一点 → 整条路径已删除(含相机回退)"}},"required":["revision","pathDeleted"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `PATH_POINT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `paths.listPresets`

- Kind: `query`
- State: `project`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"en":{"type":"string"},"closed":{"type":"boolean"},"durSeconds":{"type":"number"}},"required":["id","name","en","closed","durSeconds"]}}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`

## `paths.sample`

- Kind: `query`
- State: `project`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"pathId":{"type":"string","description":"带类型路径 ID,path:<key>"},"u":{"type":"number","description":"全程进度(0~1,超出按边界夹取)"}},"required":["pathId","u"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"position":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"z":{"type":"number"}},"required":["x","y","z"],"additionalProperties":false,"description":"世界坐标采样点"}},"required":["position"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`

## `paths.session.exitEditing`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `SCENE_UNAVAILABLE`

## `paths.session.selectPoint`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"pathId":{"type":"string","description":"带类型路径 ID,path:<key>"},"pointKey":{"type":"string","description":"控制点 key,如 P2"}},"required":["pathId","pointKey"],"additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `PATH_POINT_NOT_FOUND`, `INVALID_STATE`, `SCENE_UNAVAILABLE`

## `paths.session.startEditing`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"pathId":{"type":"string","description":"带类型路径 ID,path:<key>"}},"required":["pathId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `SCENE_UNAVAILABLE`

## `paths.setPointTiming`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"pathId":{"type":"string","description":"带类型路径 ID,path:<key>"},"pointKey":{"type":"string","description":"控制点 key(限内部点)"},"u":{"type":"number","description":"全程进度锚点(0~1,夹到相邻锚点之间);null = 恢复自动(弧长等比);首尾点固定 0/1 不可调"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["pathId","pointKey","u"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `PATH_POINT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `paths.updatePoint`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"pathId":{"type":"string","description":"带类型路径 ID,path:<key>"},"pointKey":{"type":"string","description":"控制点 key,如 P2"},"position":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"z":{"type":"number"}},"required":["x","y","z"],"additionalProperties":false,"description":"新位置(相对路径原点的局部坐标)"},"handles":{"type":"object","properties":{"side":{"type":"string","enum":["left","right"]},"offset":{"type":"object","properties":{"x":{"type":"number"},"y":{"type":"number"},"z":{"type":"number"}},"required":["x","y","z"],"additionalProperties":false,"description":"被拖侧手柄相对控制点的新偏移"}},"required":["side","offset"],"additionalProperties":false,"description":"拖手柄(对齐规则,同 UI):被拖侧取新偏移,另一侧共线镜像"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["pathId","pointKey"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `PATH_POINT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `poses.apply`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID(模型),如 model:Y Bot"},"assetId":{"type":"string","description":"库姿势条目 id"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId","assetId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `ASSET_NOT_FOUND`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `poses.applyCustom`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID(模型),如 model:Y Bot"},"bones":{"type":"object","description":"骨骼快照:骨骼名 → {rotation?: [x,y,z,w] 四元数, position?: [x,y,z]}","additionalProperties":{"type":"object","properties":{"rotation":{"type":"array","items":{"type":"number"}},"position":{"type":"array","items":{"type":"number"}}},"additionalProperties":false}},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId","bones"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `poses.clear`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID(模型),如 model:Y Bot"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"cleared":{"type":"boolean","description":"是否确有轨道或静态值被清除(空姿势为 false)"},"revision":{"type":"number"}},"required":["cleared","revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `poses.saveCurrent`

- Kind: `mutation`
- State: `asset`
- Undoable: `none`
- Completion: `committed`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID(模型),如 model:Y Bot"},"name":{"type":"string","description":"姿势名称;缺省为 姿势-N(库姿势数 + 1)"}},"required":["objectId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"id":{"type":"string"},"kind":{"enum":["pose"]},"name":{"type":"string"},"rig":{"type":"string"},"bones":{"type":"object","description":"骨骼快照:骨骼名 → {rotation?: [x,y,z,w] 四元数, position?: [x,y,z]}","additionalProperties":{"type":"object","properties":{"rotation":{"type":"array","items":{"type":"number"}},"position":{"type":"array","items":{"type":"number"}}},"additionalProperties":false}},"createdAt":{"type":"number"}},"required":["id","kind","name","rig","bones","createdAt"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `SCENE_UNAVAILABLE`, `STORAGE_ERROR`, `NETWORK_ERROR`, `INTERNAL_ERROR`

## `poses.session.cancel`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"会话所在模型的带类型 ID"},"frame":{"type":"object","description":"会话帧信息(帧上=编辑该帧 / 帧间=新建帧);仅 start 返回"}},"required":["objectId"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_STATE`

## `poses.session.commit`

- Kind: `mutation`
- State: `session`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"会话所在模型的带类型 ID"},"frame":{"type":"object","description":"会话帧信息(帧上=编辑该帧 / 帧间=新建帧);仅 start 返回"}},"required":["objectId"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_STATE`

## `poses.session.start`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Completion: `mounted`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID(模型),如 model:Y Bot"}},"required":["objectId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"会话所在模型的带类型 ID"},"frame":{"type":"object","description":"会话帧信息(帧上=编辑该帧 / 帧间=新建帧);仅 start 返回"}},"required":["objectId"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `SCENE_UNAVAILABLE`

## `poses.setGesture`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID(模型),如 model:Y Bot"},"side":{"enum":["left","right"],"description":"手势侧别"},"assetId":{"type":"string","description":"库手势条目 id;null 清除本侧手势"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["objectId","side","assetId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `ASSET_NOT_FOUND`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `project.exportState`

- Kind: `query`
- State: `project`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"projectId":{"type":"string"},"content":{"type":"object","description":"Theatre 项目存档(深拷贝)"}},"required":["projectId","content"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `API_NOT_READY`

## `scene.getSnapshot`

- Kind: `query`
- State: `project`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"},"objects":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string","description":"带类型场景对象 ID,如 model:Y Bot"},"kind":{"type":"string","enum":["model","camera","anchor","path"]},"key":{"type":"string"},"props":{"type":"object","description":"当前求值属性的深拷贝;未挂载为 null"},"mounted":{"type":"boolean"}},"required":["id","kind","key","props","mounted"]}}},"required":["revision","objects"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`

## `selection.clear`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `SCENE_UNAVAILABLE`

## `selection.get`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"objectIds":{"type":"array","items":{"type":"string"}}},"required":["objectIds"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `SCENE_UNAVAILABLE`

## `selection.selectObject`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"objectId":{"type":"string","description":"带类型场景对象 ID,如 model:Y Bot"}},"required":["objectId"],"additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `INVALID_ID_KIND`, `OBJECT_NOT_FOUND`, `INVALID_STATE`, `SCENE_UNAVAILABLE`

## `sequence.getState`

- Kind: `query`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"playing":{"type":"boolean"},"position":{"type":"number"},"length":{"type":"number"}},"required":["playing","position","length"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`

## `sequence.pause`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"playing":{"type":"boolean"},"position":{"type":"number"},"length":{"type":"number"}},"required":["playing","position","length"]}
```

### Errors

`API_DISPOSED`

## `sequence.play`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"playing":{"type":"boolean"},"position":{"type":"number"},"length":{"type":"number"}},"required":["playing","position","length"]}
```

### Errors

`API_DISPOSED`

## `sequence.seek`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"position":{"type":"number","description":"目标位置(秒)"},"snap":{"type":"boolean","description":"先按序列网格吸附再写入,默认 false"}},"required":["position"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"playing":{"type":"boolean"},"position":{"type":"number"},"length":{"type":"number"}},"required":["playing","position","length"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`

## `sequence.setLength`

- Kind: `mutation`
- State: `project`
- Undoable: `single-step`
- Completion: `committed`
- Expected revision: yes

### Input

```json
{"type":"object","properties":{"length":{"type":"number","description":"新的序列时长(秒),必须大于 0"},"expectedRevision":{"type":"number","description":"乐观并发:读取场景时的 revision"}},"required":["length"],"additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"revision":{"type":"number"}},"required":["revision"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `REVISION_CONFLICT`, `SCENE_UNAVAILABLE`

## `ui.closePanel`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"panel":{"type":"string","enum":["model","pose","animation","path"],"description":"资产框体:model|pose|animation|path"}},"required":["panel"],"additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `SCENE_UNAVAILABLE`

## `ui.hide`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `SCENE_UNAVAILABLE`

## `ui.openPanel`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"panel":{"type":"string","enum":["model","pose","animation","path"],"description":"资产框体:model|pose|animation|path"}},"required":["panel"],"additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `SCENE_UNAVAILABLE`

## `ui.restore`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `SCENE_UNAVAILABLE`

## `ui.setGizmoMode`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"mode":{"type":"string","enum":["select","translate","rotate","scale"],"description":"gizmo 模式:select|translate|rotate|scale"}},"required":["mode"],"additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `SCENE_UNAVAILABLE`

## `ui.setLeftStripHidden`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"hidden":{"type":"boolean","description":"true = 隐藏 studio 左侧条"}},"required":["hidden"],"additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `SCENE_UNAVAILABLE`

## `view.dolly`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"delta":{"type":"number","description":"沿视线的距离增量(正值 = 靠近瞄准点,负值 = 拉远)"}},"required":["delta"],"additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `API_NOT_READY`

## `view.getState`

- Kind: `query`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","properties":{"activeCameraKey":{"type":"string","description":"活动相机 key;无活动相机为 null"},"shotView":{"type":"boolean"},"pipVisible":{"type":"boolean"},"editingPath":{"type":"string","description":"正在编辑的路径 key;未编辑为 null"},"gizmoMode":{"type":"string","enum":["select","translate","rotate","scale"]},"studioHidden":{"type":"boolean"}},"required":["activeCameraKey","shotView","pipVisible","editingPath","gizmoMode","studioHidden"]}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `SCENE_UNAVAILABLE`

## `view.orbit`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"deltaTheta":{"type":"number","description":"方位角增量(弧度,正值绕瞄准点逆时针,俯视)"},"deltaPhi":{"type":"number","description":"极角增量(弧度,正值向水平方向下压)"}},"required":["deltaTheta","deltaPhi"],"additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `API_NOT_READY`

## `view.pan`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"deltaX":{"type":"number","description":"沿相机右方向平移(世界单位)"},"deltaY":{"type":"number","description":"沿相机上方向平移(世界单位)"}},"required":["deltaX","deltaY"],"additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `API_NOT_READY`

## `view.reset`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `API_NOT_READY`

## `view.setPipVisible`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"visible":{"type":"boolean","description":"画中画是否可见"}},"required":["visible"],"additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `SCENE_UNAVAILABLE`

## `view.setShotView`

- Kind: `mutation`
- State: `session`
- Undoable: `none`
- Expected revision: no

### Input

```json
{"type":"object","properties":{"on":{"type":"boolean","description":"true = 进入镜头视角,false = 回到导演视角"}},"required":["on"],"additionalProperties":false}
```

### Output

```json
{"type":"object","additionalProperties":false}
```

### Errors

`API_DISPOSED`, `INVALID_ARGUMENT`, `SCENE_UNAVAILABLE`
