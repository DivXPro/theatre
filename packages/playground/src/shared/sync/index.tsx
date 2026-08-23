import theatre, {getProject, getStudioSync} from '@toy-box/core'

const params = new URLSearchParams(window.location.search)
const serverUrl = params.get('serverUrl') ?? 'ws://localhost:3000'

void theatre.init({studio: true, serverUrl})

const project = getProject('Syncing project')
const sheet = project.sheet('sheet')
const obj = sheet.object('obj', {x: 0, a: ''})

// Deterministic test hooks: the e2e reads #sync-value and clicks #sync-plus
// instead of poking at studio UI internals. The mutation goes through the
// studio scrub → saaz, which in direct-ws mode sends it to the sync-server.
let currentX = 0
const valueEl = document.querySelector('#sync-value')!
obj.onValuesChange((values) => {
  currentX = (values as any).x
  valueEl.textContent = String(currentX)
})
document.querySelector('#sync-plus')!.addEventListener('click', () => {
  const scrub = getStudioSync()!.scrub()
  scrub.capture(({set}) => {
    set(obj.props.x, currentX + 1)
  })
  scrub.commit()
})
