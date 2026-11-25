const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const model = fs.readFileSync(path.join(root, 'src/scene.glb'))
fs.writeFileSync(path.join(root, 'dist/scene.glb'), model)

// A JavaScript URL module can be optimized by consumer bundlers that have no
// GLB loader. CameraScene imports it only when the demo model is enabled.
const url = `data:model/gltf-binary;base64,${model.toString('base64')}`
fs.writeFileSync(
  path.join(root, 'dist/demoModelUrl.js'),
  `export default ${JSON.stringify(url)}\n`,
)
