import type Project from '@toy-box/core/projects/Project'
import {getAllPossibleAssetIDs} from './assets'

function projectWithState(state: unknown): Project {
  return {
    pointers: {
      historic: {
        sheetsById: state,
      },
    },
  } as unknown as Project
}

describe('getAllPossibleAssetIDs', () => {
  test('collects assets referenced directly by a static override', () => {
    const project = projectWithState({
      Scene: {
        staticOverrides: {
          byObject: {
            'Placed / model': {
              source: {type: 'file', id: 'model.fbx'},
            },
          },
        },
      },
    })
    expect(getAllPossibleAssetIDs(project)).toEqual(['model.fbx'])
  })

  test('collects assets nested inside compound static overrides', () => {
    const project = projectWithState({
      Scene: {
        staticOverrides: {
          byObject: {
            Mesh: {
              material: {maps: {albedo: {type: 'file', id: 'albedo.png'}}},
            },
          },
        },
      },
    })
    expect(getAllPossibleAssetIDs(project)).toEqual(['albedo.png'])
  })

  test('ignores plain values and collects keyframe asset values', () => {
    const project = projectWithState({
      Scene: {
        staticOverrides: {
          byObject: {
            Camera: {position: {x: 1, y: 2}, label: 'front'},
          },
        },
        sequence: {
          tracksByObject: {
            Mesh: {
              trackData: {
                source: {
                  keyframes: {
                    byId: {
                      kf1: {value: {type: 'file', id: 'anim.fbx'}, position: 0},
                    },
                    allIds: {source: ['kf1']},
                  },
                },
              },
            },
          },
        },
      },
    })
    expect(getAllPossibleAssetIDs(project)).toEqual(['anim.fbx'])
  })

  test('filters by asset type when given', () => {
    const project = projectWithState({
      Scene: {
        staticOverrides: {
          byObject: {
            'Placed / model': {source: {type: 'file', id: 'model.fbx'}},
          },
        },
      },
    })
    expect(getAllPossibleAssetIDs(project, 'image')).toEqual([])
    expect(getAllPossibleAssetIDs(project, 'file')).toEqual(['model.fbx'])
  })
})
