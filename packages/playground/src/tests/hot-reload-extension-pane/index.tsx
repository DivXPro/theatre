import type {IExtension} from '@toy-box/core'
import theatre from '@toy-box/core'
import '@toy-box/studio'
import '@toy-box/core'
import {extensionButton} from '../../shared/utils/useExtensionButton'

const ext1: IExtension = {
  id: '@toy-box/hello-world-extension',
  toolbars: {},
  panes: [],
}

void theatre.init({studio: true, usePersistentStorage: false})

let currentStep = -1

extensionButton(
  'Forward',
  () => {
    if (currentStep < steps.length - 1) {
      currentStep++
      steps[currentStep]()
    }
  },
  '>',
)

const steps = [
  function step0() {
    const studio = theatre.getStudioSync()!
    studio.extend(
      {
        ...ext1,
        panes: [
          {
            class: 'pane1',
            mount: ({paneId, node}) => {
              const el = document.createElement('div')
              el.innerHTML = 'pane1-config1'
              node.appendChild(el)
              return function unmount() {
                node.removeChild(el)
                console.log('unmount pane1-config1')
              }
            },
          },
        ],
      },

      {reconfigure: true},
    )
    studio.createPane('pane1')
  },
  function step1() {
    const studio = theatre.getStudioSync()!
    studio.extend(
      {
        ...ext1,
        panes: [
          {
            class: 'pane1',
            mount: ({paneId, node}) => {
              const el = document.createElement('div')
              el.innerHTML = 'pane1-config2'
              node.appendChild(el)
              return function unmount() {
                node.removeChild(el)
                console.log('unmount pane1-config2')
              }
            },
          },
        ],
      },

      {reconfigure: true},
    )
  },
  function step2() {
    const studio = theatre.getStudioSync()!
    studio.extend(
      {
        ...ext1,
        panes: [],
      },

      {reconfigure: true},
    )
  },
  function step3() {
    steps[1]()
  },
]
