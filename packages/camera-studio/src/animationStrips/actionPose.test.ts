import type {Group, Vector3, Quaternion} from 'three'
import type {ActionEditorSession} from '../actionEditor/session'

const enterDraftPoseSession = jest.fn()
const getPoseSession = jest.fn()
jest.doMock('../poseMode/poseSession', () => ({
  enterDraftPoseSession,
  getPoseSession,
}))
const {beginActionDraftPose} =
  require('./actionPose') as typeof import('./actionPose')

type Bone = {
  position?: Vector3
  quaternion?: Quaternion
  scale?: Vector3
}

function transform(
  position: [number, number, number],
  quaternion: [number, number, number, number] = [0, 0, 0, 1],
) {
  return {
    position: {
      x: position[0],
      y: position[1],
      z: position[2],
    },
    quaternion: {
      x: quaternion[0],
      y: quaternion[1],
      z: quaternion[2],
      w: quaternion[3],
    },
    scale: {x: 1, y: 1, z: 1},
  }
}

describe('beginActionDraftPose', () => {
  beforeEach(() => {
    enterDraftPoseSession.mockReset()
    getPoseSession.mockReset()
    getPoseSession.mockReturnValue(null)
  })

  test('以动作编辑器当前局部帧姿势作为摆姿基线', () => {
    const before = {
      Hips: transform([0, 1, 0]),
      Arm: transform([0, 2, 0]),
    }
    const action = {
      getSnapshot: () => ({values: {bones: before}}),
      recordBonePose: jest.fn(),
    } as unknown as ActionEditorSession
    const baseline = new Map<string, Bone>([
      [
        'Hips',
        {
          position: {x: 0, y: 1, z: 0} as Vector3,
          quaternion: {x: 0, y: 0, z: 0, w: 1} as Quaternion,
          scale: {x: 1, y: 1, z: 1} as Vector3,
        },
      ],
      [
        'Arm',
        {
          position: {x: 0, y: 2, z: 0} as Vector3,
          quaternion: {x: 0, y: 0, z: 0, w: 1} as Quaternion,
          scale: {x: 1, y: 1, z: 1} as Vector3,
        },
      ],
    ])
    const sampler = {
      applyPose: jest.fn(),
      capturePose: jest.fn(() => baseline),
    }
    const invalidate = jest.fn()

    expect(
      beginActionDraftPose('model:Y_Bot', action, sampler, invalidate),
    ).toBe(true)
    expect(enterDraftPoseSession).toHaveBeenCalledWith(
      'model:Y_Bot',
      expect.objectContaining({
        applyPreview: expect.any(Function),
        onCapture: expect.any(Function),
      }),
    )

    const options = enterDraftPoseSession.mock.calls[0][1]
    options.applyPreview({} as Group)
    expect([...sampler.applyPose.mock.calls[0][0].keys()]).toEqual([
      'Hips',
      'Arm',
    ])

    options.onCapture({
      Hips: {
        rotation: [0, 0, 0, 1],
        position: [0.5, 1, 0],
      },
      Arm: {
        rotation: [0, 0, 0, 1],
        position: [0, 2, 0],
      },
    })

    expect(action.recordBonePose).toHaveBeenCalledWith({
      Hips: expect.objectContaining({
        position: {x: 0.5, y: 1, z: 0},
      }),
    })
    expect(
      (action.recordBonePose as jest.Mock).mock.calls[0][0],
    ).not.toHaveProperty('Arm')
    expect(invalidate).toHaveBeenCalled()
  })

  test('已有姿势会话时不再重复进入', () => {
    getPoseSession.mockReturnValue({key: 'model:Other', target: 'scene'})
    const action = {
      getSnapshot: () => ({values: {bones: {}}}),
      recordBonePose: jest.fn(),
    } as unknown as ActionEditorSession
    const sampler = {applyPose: jest.fn(), capturePose: jest.fn()}

    expect(
      beginActionDraftPose('model:Y_Bot', action, sampler, jest.fn()),
    ).toBe(true)
    expect(enterDraftPoseSession).not.toHaveBeenCalled()
  })
})
