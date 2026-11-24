const icons = {
  theatre: '<path d="M4 5h16M12 5v15m-4 0h8M4 9V5m16 4V5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5ZM3 7l9 5 9-5m-9 5v10"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  scan: '<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/><circle cx="12" cy="12" r="2"/>',
  video:
    '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-3v10l-6-3"/>',
  person:
    '<circle cx="12" cy="5" r="2"/><path d="M5 10h14m-7 0v5m0 0-4 6m4-6 4 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.4"/>',
  'eye-off':
    '<path d="m3 3 18 18M10 6.2c.7-.1 1.3-.2 2-.2 6.4 0 10 6 10 6a16 16 0 0 1-3 3.3M6 7.8A17 17 0 0 0 2 12s3.6 6 10 6c1.5 0 2.8-.3 4-.9"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  diamond: '<path d="M12 4l8 8-8 8-8-8Z"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',
  cursor: '<path d="m5 3 15 9-7 1.5L10 20 5 3Z"/>',
  move: '<path d="M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3m14-6 3 3-3 3"/>',
  rotate: '<path d="M4 11a8 8 0 1 1 2.3 6M4 11V5m0 6h6"/>',
  scale: '<path d="M14 4h6v6m0-6-7 7M10 20H4v-6m0 6 7-7"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16M12 4v16"/>',
  sliders:
    '<path d="M4 6h5m4 0h7M4 12h10m4 0h2M4 18h2m4 0h10"/><circle cx="11" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
  timeline: '<path d="M4 6h16M4 12h16M4 18h16M7 4v4m7 2v4m-4 2v4"/>',
  play: '<path d="M7 4.5 20 12 7 19.5Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M8 5v14m8-14v14" stroke-width="3"/>',
  'skip-back': '<path d="M5 5v14m13-13-9 6 9 6Z"/>',
  'skip-forward': '<path d="M19 5v14M6 6l9 6-9 6Z"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v2"/>',
  'lock-open':
    '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2.6M12 14v2"/>',
  aperture:
    '<circle cx="12" cy="12" r="9"/><path d="m8 4 7 12m3-11-7 12m10-4H7m8 7L8 8M6 19l7-12M3 11h14"/>',
  frame: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
}

function icon(name) {
  return `<svg aria-hidden="true" class="icon" viewBox="0 0 24 24">${icons[name]}</svg>`
}

const $ = (selector, root = document) => root.querySelector(selector)
const all = (selector, root = document) => [...root.querySelectorAll(selector)]
all('[data-icon]').forEach((element) => {
  element.innerHTML = icon(element.dataset.icon)
})

const groups = [
  {name: '镜头', objects: ['camera', 'alternate']},
  {name: '场景', objects: ['platform', 'rail', 'actor']},
  {name: '灯光', objects: ['key', 'practical']},
]

const objects = {
  camera: {
    name: '主摄像机',
    kind: '相机',
    icon: 'video',
    position: [4.2, 2.8, 6.5],
    rotation: [-12, 32, 0],
    focal: 35,
    focus: 5.2,
    aperture: 2.8,
  },
  alternate: {
    name: '备用摄像机',
    kind: '相机',
    icon: 'video',
    position: [2.3, 1.45, -3.5],
    rotation: [0, -45, 0],
    focal: 50,
    focus: 3.1,
    aperture: 4,
  },
  platform: {
    name: '站台主体',
    kind: '模型',
    icon: 'box',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: '#9a9d9f',
  },
  rail: {
    name: '铁轨',
    kind: '模型',
    icon: 'layers',
    position: [0, -0.2, 2.3],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: '#7c8487',
  },
  actor: {
    name: '站台人物',
    kind: '角色',
    icon: 'person',
    position: [1.1, 0, -0.6],
    rotation: [0, 18, 0],
    scale: [1, 1, 1],
    color: '#c9cbca',
  },
  key: {
    name: '主光',
    kind: '灯光',
    icon: 'sun',
    position: [-2.4, 3.8, -1.1],
    rotation: [-32, 24, 0],
    power: 650,
    temperature: 5500,
    color: '#e6eeee',
  },
  practical: {
    name: '顶棚灯',
    kind: '灯光',
    icon: 'sun',
    position: [0, 2.6, 0],
    rotation: [-90, 0, 0],
    power: 140,
    temperature: 3200,
    color: '#e7be87',
  },
}

const tracks = [
  {
    id: 'camera',
    clips: [
      [0, 41, '推入', true],
      [42, 39, '镜头停留', true],
    ],
  },
  {
    id: 'actor',
    clips: [
      [13, 40, '等待'],
      [56, 30, '回望', true],
    ],
  },
  {id: 'key', clips: [[0, 88, '光照']]},
]

const keyframes = {
  camera: {
    'position.0': new Map([
      [0, 6.25],
      [60, 4.2],
      [156, 2.8],
    ]),
    'rotation.1': new Map([
      [0, 28],
      [156, 38],
    ]),
  },
}
const viewport = $('.viewport')
const inspector = $('#inspector-content')
const propertySelectControl = $('#keyframe-property')
const propertyLane = $('#property-keyframes')
const previousKeyframe = $('#previous-keyframe')
const nextKeyframe = $('#next-keyframe')
const tree = $('#scene-tree')
const search = $('#object-search input')
let selected = 'camera'
let activeProperty = 'position.0'

function iconButton(symbol, label, attrs = '') {
  return `<button class="icon-button" aria-label="${label}" ${attrs}>${icon(
    symbol,
  )}</button>`
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  )
}

tree.innerHTML = groups
  .map(
    ({name, objects: ids}) => `
  <details class="tree-group" open>
    <summary>${icon('chevron-right')}<span>${name}</span></summary>
    ${ids
      .map((id) => {
        const object = objects[id]
        return `<div class="tree-item" data-row="${id}">
        <button class="tree-choice" data-object="${id}" aria-pressed="false">
          <span>${icon(object.icon)}</span><span class="tree-name">${
            object.name
          }</span>
        </button>
        ${iconButton(
          'eye',
          `显示「${object.name}」`,
          `data-visibility="${id}" aria-pressed="true"`,
        )}
      </div>`
      })
      .join('')}
  </details>
`,
  )
  .join('')

function field(label, value, key, {suffix = '', axis = ''} = {}) {
  return `<div class="field" data-channel="${key}"><label class="field-value">
    <span class="${
      axis ? `component-axis axis-label-${axis.toLowerCase()}` : ''
    }">${axis || label}</span>
    <input type="number" step="any" data-field="${key}" value="${value}" aria-label="${label}">
    ${suffix ? `<small>${suffix}</small>` : ''}
  </label><button class="icon-button keyframe-button" data-keyframe="${key}" aria-label="${label}关键帧" aria-pressed="false">${icon(
    'diamond',
  )}</button></div>`
}

function vector(label, key, values, suffix = '', precision = 2) {
  return `<div class="property-group"><span class="group-label">${label}</span>
    <div class="field-grid">${['X', 'Y', 'Z']
      .map((axis, i) =>
        field(`${label} ${axis}`, values[i].toFixed(precision), `${key}.${i}`, {
          axis,
          suffix,
        }),
      )
      .join('')}</div>
  </div>`
}

function propertySelect(label, key, choices, value = choices[0]) {
  return `<label class="property-row"><span>${label}</span><span class="select-wrap property-select">
    <select aria-label="${label}" data-field="${key}">
      ${choices
        .map(
          (choice) =>
            `<option${choice === value ? ' selected' : ''}>${choice}</option>`,
        )
        .join('')}
    </select><span>${icon('chevron-down')}</span>
  </span></label>`
}

function switchRow(label, key, checked) {
  return `<div class="property-row"><span>${label}</span><button class="switch" role="switch" aria-label="${label}" aria-checked="${checked}" data-switch="${key}"></button></div>`
}

function colorRow(value) {
  return `<label class="property-row"><span>颜色</span><input class="swatch" type="color" value="${value}" data-field="color" aria-label="颜色"></label>`
}

function card(label, symbol, content) {
  return `<details class="property-card" open>
    <summary><span>${icon(
      symbol,
    )}</span><span>${label}</span><span class="section-chevron">${icon(
      'chevron-down',
    )}</span></summary>
    <div class="card-body">${content}</div>
  </details>`
}

function renderInspector() {
  const object = objects[selected]
  $('#inspector-context').textContent = object?.kind ?? '场景'
  syncSafeFrame()
  if (!object) {
    inspector.innerHTML = card(
      '场景',
      'frame',
      '<p class="inspector-empty">从场景树选择对象以查看属性。</p>',
    )
    return
  }

  const identity = `<div class="identity"><span>${icon(object.icon)}</span>
    <input data-field="name" aria-label="对象名称" value="${escapeHtml(
      object.name,
    )}">
    ${iconButton(
      object.locked ? 'lock' : 'lock-open',
      '锁定对象',
      `data-lock aria-pressed="${Boolean(object.locked)}"`,
    )}
  </div>`
  const transform = card(
    '对象变换',
    'move',
    [
      identity,
      vector('位置', 'position', object.position),
      vector('旋转', 'rotation', object.rotation, '°', 0),
      object.scale ? vector('缩放', 'scale', object.scale) : '',
    ].join(''),
  )

  if (object.kind === '相机') {
    const lens = card(
      '镜头',
      'aperture',
      [
        propertySelect(
          '投影',
          'projection',
          ['透视', '正交'],
          object.projection,
        ),
        `<div class="field-grid two">
        ${field('焦距', object.focal, 'focal', {suffix: 'mm'})}
        ${field('光圈', object.aperture.toFixed(1), 'aperture', {suffix: 'f'})}
      </div>`,
        field('对焦距离', object.focus.toFixed(2), 'focus', {suffix: 'm'}),
        '<hr class="property-separator">',
        switchRow('景深', 'depth', object.depth ?? true),
      ].join(''),
    )
    const framing = card(
      '取景',
      'frame',
      [
        propertySelect(
          '宽高比',
          'ratio',
          ['16:9', '2.39:1', '4:3', '1:1'],
          object.ratio,
        ),
        switchRow('安全框', 'safe', object.safe ?? false),
      ].join(''),
    )
    inspector.innerHTML = transform + lens + framing
  } else if (object.kind === '灯光') {
    inspector.innerHTML =
      transform +
      card(
        '灯光',
        'sun',
        [
          `<div class="field-grid two">${field('功率', object.power, 'power', {
            suffix: 'W',
          })}${field('色温', object.temperature, 'temperature', {
            suffix: 'K',
          })}</div>`,
          colorRow(object.color),
          switchRow('投射阴影', 'shadows', object.shadows ?? true),
        ].join(''),
      )
  } else {
    inspector.innerHTML =
      transform +
      card(
        '外观',
        'layers',
        [
          colorRow(object.color),
          switchRow('可见', 'visible', !object.hidden),
          switchRow('投射阴影', 'shadows', object.shadows ?? true),
        ].join(''),
      )
  }
}

function syncSafeFrame() {
  viewport.dataset.safe = String(
    Boolean(objects[selected]?.safe && objects[selected]?.kind === '相机'),
  )
}

function setSelection(id) {
  if (selected !== id) activeProperty = 'position.0'
  selected = id
  all('button[data-object]:not(.track-clip)').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.object === id))
  })
  all('[data-row]', tree).forEach((row) => {
    row.dataset.selected = String(row.dataset.row === id)
  })
  renderInspector()
  const fields = all('.field input', inspector)
  propertySelectControl.replaceChildren(
    ...fields.map(
      (input) =>
        new Option(input.getAttribute('aria-label'), input.dataset.field),
    ),
  )
  if (!fields.length) propertySelectControl.add(new Option('属性关键帧', ''))
  propertySelectControl.disabled = !fields.length
  selectProperty(activeProperty)
  syncPropertyValues()
}

function selectProperty(key) {
  activeProperty = key
  propertySelectControl.value = selected ? key : ''
  for (const field of all('[data-channel]', inspector)) {
    field.toggleAttribute('data-active', field.dataset.channel === key)
  }
  renderKeyframeLane()
}

function channelKeys(key) {
  return keyframes[selected]?.[key]
}

function adjacentKeyframes() {
  const times = [...(channelKeys(activeProperty)?.keys() ?? [])]
  const previous = Math.max(-1, ...times.filter((time) => time < frame))
  const next = Math.min(Infinity, ...times.filter((time) => time > frame))
  return {previous, next}
}

function syncKeyframeIndicators() {
  for (const button of all('[data-keyframe]', inspector)) {
    const keys = channelKeys(button.dataset.keyframe)
    const onFrame = keys?.has(frame) ?? false
    button.setAttribute('aria-pressed', String(onFrame))
    button.toggleAttribute('data-animated', Boolean(keys?.size))
    button.title = onFrame ? '移除当前关键帧' : '在当前帧添加关键帧'
  }
  for (const marker of all('[data-keyframe-time]', propertyLane)) {
    marker.setAttribute(
      'aria-current',
      Number(marker.dataset.keyframeTime) === frame ? 'true' : 'false',
    )
  }
  const {previous, next} = adjacentKeyframes()
  previousKeyframe.disabled = previous < 0
  nextKeyframe.disabled = !Number.isFinite(next)
}

function renderKeyframeLane() {
  const keys = channelKeys(activeProperty)
  const label = propertySelectControl.selectedOptions[0]?.textContent ?? ''
  propertyLane.replaceChildren()
  if (keys?.size) {
    for (const time of [...keys.keys()].sort((a, b) => a - b)) {
      const marker = document.createElement('button')
      marker.className = 'keyframe-marker'
      marker.dataset.keyframeTime = time
      marker.style.setProperty('--key-position', `${(100 * time) / endFrame}%`)
      marker.title = `${label} · ${formatTimecode(time)}`
      marker.setAttribute(
        'aria-label',
        `${label}关键帧 ${formatTimecode(time)}`,
      )
      marker.innerHTML = icon('diamond')
      propertyLane.append(marker)
    }
  } else {
    const hint = document.createElement('span')
    hint.className = 'keyframe-hint'
    hint.textContent = selected
      ? '点击属性旁的菱形添加关键帧'
      : '选择对象以查看属性关键帧'
    propertyLane.append(hint)
  }
  syncKeyframeIndicators()
}

function syncPropertyValues() {
  for (const input of all('.field input', inspector)) {
    const keys = channelKeys(input.dataset.field)
    if (!keys?.size || document.activeElement === input) continue
    const times = [...keys.keys()].sort((a, b) => a - b)
    const nextIndex = times.findIndex((time) => time >= frame)
    const left =
      times[Math.max(0, nextIndex === -1 ? times.length - 1 : nextIndex - 1)]
    const right = times[nextIndex] ?? left
    const fraction = left === right ? 0 : (frame - left) / (right - left)
    const value = keys.get(left) + (keys.get(right) - keys.get(left)) * fraction
    input.value = value.toFixed(
      input.dataset.field.startsWith('rotation.') ? 0 : 2,
    )
  }
}

function toggleKeyframe(button) {
  const key = button.dataset.keyframe
  const input = $('.field-value input', button.closest('[data-channel]'))
  const value = input.valueAsNumber
  if (!selected || !Number.isFinite(value)) return

  stop()
  const channels = (keyframes[selected] ??= {})
  const keys = (channels[key] ??= new Map())
  const removed = keys.delete(frame)
  if (!removed) keys.set(frame, value)
  selectProperty(key)
  syncPropertyValues()
  $('#keyframe-status').textContent = `${input.getAttribute('aria-label')} ${
    removed ? '已移除' : '已添加'
  }关键帧，${formatTimecode(frame)}`
}

function setVisibility(id, visible) {
  objects[id].hidden = !visible
  const row = $(`[data-row="${id}"]`, tree)
  const button = $('[data-visibility]', row)
  row.dataset.hidden = String(!visible)
  button.setAttribute('aria-pressed', String(visible))
  button.innerHTML = icon(visible ? 'eye' : 'eye-off')
  if (id === selected)
    $('[data-switch="visible"]', inspector)?.setAttribute(
      'aria-checked',
      String(visible),
    )
}

function filterTree() {
  const query = search.value.trim().toLocaleLowerCase()
  let matches = 0
  for (const group of all('.tree-group', tree)) {
    const rows = all('[data-row]', group)
    rows.forEach((row) => {
      row.hidden = !objects[row.dataset.row].name
        .toLocaleLowerCase()
        .includes(query)
      if (!row.hidden) matches += 1
    })
    group.hidden = rows.every((row) => row.hidden)
    if (query && !group.hidden) group.open = true
  }
  $('.empty-tree').hidden = matches > 0
  $('#object-count').textContent = `${matches} 个对象`
}

$('#search-toggle').addEventListener('click', (event) => {
  const inputRow = $('#object-search')
  inputRow.hidden = !inputRow.hidden
  event.currentTarget.setAttribute('aria-expanded', String(!inputRow.hidden))
  if (!inputRow.hidden) search.focus()
  else {
    search.value = ''
    filterTree()
  }
})
search.addEventListener('input', filterTree)
$('#clear-selection').addEventListener('click', () => setSelection(null))

tree.addEventListener('click', (event) => {
  const button = event.target.closest('[data-visibility]')
  if (button) {
    const id = button.dataset.visibility
    setVisibility(id, objects[id].hidden === true)
  }
})

inspector.addEventListener('change', (event) => {
  const input = event.target
  if (!input.dataset.field || !selected) return
  const object = objects[selected]
  const [key, index] = input.dataset.field.split('.')
  if (key === 'name') {
    object.name = input.value.trim() || object.name
    input.value = object.name
    const row = $(`[data-row="${selected}"]`)
    $('.tree-name', row).textContent = object.name
    $('[data-visibility]', row).setAttribute(
      'aria-label',
      `显示「${object.name}」`,
    )
    const track = $(`.track-label[data-object="${selected}"]`)
    if (track) track.lastChild.textContent = object.name
    filterTree()
  } else if (input.type === 'number') {
    const storedValue = index === undefined ? object[key] : object[key][index]
    const value = Number.isFinite(input.valueAsNumber)
      ? input.valueAsNumber
      : storedValue
    if (index === undefined) object[key] = value
    else object[key][index] = value
    const keys = channelKeys(input.dataset.field)
    if (keys?.has(frame)) keys.set(frame, value)
    input.value = value
  } else {
    object[key] = input.value
  }
})

inspector.addEventListener('focusin', (event) => {
  const key = event.target.closest('.field input')?.dataset.field
  if (key && key !== activeProperty) selectProperty(key)
})

inspector.addEventListener('click', (event) => {
  const button = event.target.closest('button')
  if (!button || !selected) return
  if (button.dataset.keyframe) {
    toggleKeyframe(button)
    return
  }
  const object = objects[selected]
  if (button.hasAttribute('data-lock')) {
    object.locked = !object.locked
    button.setAttribute('aria-pressed', String(object.locked))
    button.innerHTML = icon(object.locked ? 'lock' : 'lock-open')
  }
  const key = button.dataset.switch
  if (key) {
    const checked = button.getAttribute('aria-checked') === 'false'
    button.setAttribute('aria-checked', String(checked))
    if (key === 'visible') setVisibility(selected, checked)
    else object[key] = checked
    syncSafeFrame()
  }
})

const viewSelect = $('#view-select')
function setView(view) {
  viewport.dataset.view = view
  viewSelect.value = view
  $('#view-caption').textContent = view === 'camera' ? '主摄像机' : '透视'
}

viewSelect.addEventListener('change', () => setView(viewSelect.value))
$('#fit-view').addEventListener('click', () => setView('director'))

const viewportGrid = document.createElement('div')
viewportGrid.className = 'viewport-grid'
viewportGrid.setAttribute('aria-hidden', 'true')
$('.scene-image').after(viewportGrid)
$('#grid-toggle').addEventListener('click', (event) => {
  viewportGrid.hidden = !viewportGrid.hidden
  event.currentTarget.setAttribute('aria-pressed', String(!viewportGrid.hidden))
})

$('#preview-toggle').addEventListener('click', (event) => {
  const preview = $('#camera-preview')
  preview.hidden = !preview.hidden
  event.currentTarget.setAttribute('aria-pressed', String(!preview.hidden))
})

all('[data-tool]').forEach((button) =>
  button.addEventListener('click', () => {
    all('[data-tool]').forEach((tool) =>
      tool.setAttribute('aria-pressed', String(tool === button)),
    )
  }),
)

$('#export-button').addEventListener('click', () =>
  $('#export-dialog').showModal(),
)

$('#track-content').innerHTML = tracks
  .map(
    ({id, clips}) => `
  <div class="track">${clips
    .map(
      ([start, duration, title, keyed]) => `
    <button class="track-clip" data-object="${id}" data-frame="${Math.round(
      start * 1.92,
    )}"
      style="--clip-start:${start};--clip-duration:${duration}"${
        keyed ? ' data-keyed' : ''
      }>${title}</button>
  `,
    )
    .join('')}</div>`,
  )
  .join('')
all('.ticks span').forEach((tick, i) => tick.style.setProperty('--index', i))

const framesPerSecond = 24
const endFrame = 192
const scrubber = $('#scrubber')
const playButton = $('#play')
let frame = Number(scrubber.value)
let playback = 0

function formatTimecode(frameNumber) {
  const seconds = String(Math.floor(frameNumber / framesPerSecond)).padStart(
    2,
    '0',
  )
  const frames = String(frameNumber % framesPerSecond).padStart(2, '0')
  return `00:${seconds}:${frames}`
}

function seek(value) {
  frame = Math.max(0, Math.min(endFrame, value))
  scrubber.value = frame
  $('.timeline-grid').style.setProperty('--timeline-ratio', frame / endFrame)
  $('#timecode').value = formatTimecode(frame)
  syncKeyframeIndicators()
  syncPropertyValues()
}

function stop() {
  cancelAnimationFrame(playback)
  playback = 0
  playButton.innerHTML = icon('play')
  playButton.setAttribute('aria-label', '播放')
}

function togglePlayback() {
  if (playback) {
    stop()
    return
  }
  if (frame === endFrame) seek(0)
  const startFrame = frame
  const start = performance.now()
  function update(now) {
    seek(startFrame + Math.floor(((now - start) * framesPerSecond) / 1000))
    if (frame === endFrame) stop()
    else playback = requestAnimationFrame(update)
  }
  playButton.innerHTML = icon('pause')
  playButton.setAttribute('aria-label', '暂停')
  playback = requestAnimationFrame(update)
}

scrubber.addEventListener('input', () => {
  stop()
  seek(Number(scrubber.value))
})
$('#play').addEventListener('click', togglePlayback)
$('#rewind').addEventListener('click', () => {
  stop()
  seek(0)
})
$('#forward').addEventListener('click', () => {
  stop()
  seek(endFrame)
})

propertySelectControl.addEventListener('change', () =>
  selectProperty(propertySelectControl.value),
)
previousKeyframe.addEventListener('click', () => {
  stop()
  seek(adjacentKeyframes().previous)
})
nextKeyframe.addEventListener('click', () => {
  stop()
  seek(adjacentKeyframes().next)
})
propertyLane.addEventListener('click', (event) => {
  const marker = event.target.closest('[data-keyframe-time]')
  if (!marker) return
  stop()
  seek(Number(marker.dataset.keyframeTime))
})

$('.workspace').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-object]')
  if (!button) return
  setSelection(button.dataset.object)
  if (button.dataset.frame !== undefined) {
    stop()
    seek(Number(button.dataset.frame))
  }
})

setSelection(selected)
setView(viewSelect.value)
seek(frame)
