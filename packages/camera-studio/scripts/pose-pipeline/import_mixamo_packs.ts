import fs from 'fs'
import os from 'os'
import path from 'path'
import {execFileSync} from 'child_process'
import {fileURLToPath} from 'url'
import {Texture, TextureLoader} from 'three'
import {FBXLoader} from 'three-stdlib'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import draco3dgltf from 'draco3dgltf'
import {exportAnimationGLB} from '../../src/assetLibrary/exportGLB'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '../..')
const ANIMATIONS_OUT = path.join(pkgRoot, 'assets/animations')
const DOWNLOADS_DIR =
  process.env.MIXAMO_PACKS_DIR ?? path.join(os.homedir(), 'Downloads')
const STRICT = process.argv.includes('--strict')

const PACKS = [
  {zip: 'Action Adventure Pack.zip', prefix: 'Mixamo Action Adventure'},
  {zip: 'Locomotion Pack.zip', prefix: 'Mixamo Locomotion'},
  {zip: 'Basic Locomotion Pack.zip', prefix: 'Mixamo Basic Locomotion'},
  {zip: 'Magic Locomotion Pack.zip', prefix: 'Mixamo Magic Locomotion'},
  {zip: 'Scary Zombie Pack.zip', prefix: 'Mixamo Scary Zombie'},
  {zip: 'Not So Scary Zombie Pack.zip', prefix: 'Mixamo Not So Scary Zombie'},
  {zip: 'Breakdance Pack.zip', prefix: 'Mixamo Breakdance'},
  {zip: 'Capoeira Pack.zip', prefix: 'Mixamo Capoeira'},
  {zip: 'Pro Magic Pack.zip', prefix: 'Mixamo Pro Magic'},
  {zip: 'Pro Melee Axe Pack.zip', prefix: 'Mixamo Pro Melee Axe'},
  {zip: 'Pro Rifle Pack.zip', prefix: 'Mixamo Pro Rifle'},
  {zip: 'Pro Longbow Pack.zip', prefix: 'Mixamo Pro Longbow'},
  {zip: 'Pro Sword and Shield Pack.zip', prefix: 'Mixamo Pro Sword And Shield'},
  {zip: 'Rifle 8-Way Locomotion Pack.zip', prefix: 'Mixamo Rifle 8-Way'},
  {zip: 'Pistol Handgun Locomotion Pack.zip', prefix: 'Mixamo Pistol Handgun'},
  {zip: 'Sword and Shield Pack.zip', prefix: 'Mixamo Sword And Shield'},
  {
    zip: 'Lite Sword and Shield Pack.zip',
    prefix: 'Mixamo Lite Sword And Shield',
  },
  {zip: 'Great Sword Pack.zip', prefix: 'Mixamo Great Sword'},
  {zip: 'Longbow Locomotion Pack.zip', prefix: 'Mixamo Longbow Locomotion'},
  {zip: 'Longbow Aiming Pack.zip', prefix: 'Mixamo Longbow Aiming'},
  {zip: 'Lite Longbow Pack.zip', prefix: 'Mixamo Lite Longbow'},
  {zip: 'Shooter Pack.zip', prefix: 'Mixamo Shooter'},
  {zip: 'Basic Shooter Pack.zip', prefix: 'Mixamo Basic Shooter'},
  {zip: 'Slim Shooter Pack.zip', prefix: 'Mixamo Slim Shooter'},
  {zip: 'Lite Rifle Pack.zip', prefix: 'Mixamo Lite Rifle'},
  {zip: 'Lite Magic Pack.zip', prefix: 'Mixamo Lite Magic'},
  {zip: 'Magic Spell Pack.zip', prefix: 'Mixamo Magic Spell'},
  {zip: 'Soccer Game Pack.zip', prefix: 'Mixamo Soccer Game'},
  {zip: 'Farming Pack.zip', prefix: 'Mixamo Farming'},
  {zip: 'Creature Pack.zip', prefix: 'Mixamo Creature'},
  {zip: 'Creature NPC Pack.zip', prefix: 'Mixamo Creature NPC'},
  {zip: 'Male Locomotion Pack.zip', prefix: 'Mixamo Male Locomotion'},
  {zip: 'Female Locomotion Pack.zip', prefix: 'Mixamo Female Locomotion'},
  {
    zip: 'Female Basic Locomotion Pack.zip',
    prefix: 'Mixamo Female Basic Locomotion',
  },
  {zip: 'Male Injured Pack.zip', prefix: 'Mixamo Male Injured'},
  {zip: 'Male Drunk Pack.zip', prefix: 'Mixamo Male Drunk'},
  {zip: 'Gestures Pack Basic.zip', prefix: 'Mixamo Gestures Basic'},
  {zip: 'Free Test Pack.zip', prefix: 'Mixamo Free Test'},
] as const

TextureLoader.prototype.load = function () {
  return new Texture()
}

function parseFbx(buffer: ArrayBuffer) {
  const globals = globalThis as unknown as {window?: {URL: typeof URL}}
  const hadWindow = globals.window !== undefined
  if (!hadWindow) globals.window = {URL}
  try {
    return new FBXLoader().parse(buffer, '')
  } catch (error) {
    // FBX 末尾的换行字节会让 three-stdlib 的结尾判断差 1 字节,读进 footer 报未知属性类型。
    const bytes = new Uint8Array(buffer)
    if (bytes.byteLength > 0 && bytes[bytes.byteLength - 1] === 0x0a) {
      return new FBXLoader().parse(buffer.slice(0, bytes.byteLength - 1), '')
    }
    throw error
  } finally {
    if (!hadWindow) delete globals.window
  }
}

function titleCase(source: string) {
  return source
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase()
      if (/^\d+h$/.test(lower)) return lower.toUpperCase()
      if (lower === 'w/') return 'W/'
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

function actionTitle(filename: string) {
  const stem = path.basename(filename, path.extname(filename))
  const match = /^(.*?)(?: \((\d+)\))?$/.exec(stem)
  if (!match) throw new Error(`无法解析动作文件名:${filename}`)
  const suffix = match[2] ? ` ${match[2]}` : ''
  return `${titleCase(match[1])}${suffix}`
}

function normalizedClipName(filename: string) {
  return filename.replace(/^mixamorig\d+(?=[A-Z])/, 'mixamorig')
}

async function convertPack(pack: (typeof PACKS)[number]) {
  const zipPath = path.join(DOWNLOADS_DIR, pack.zip)
  if (!fs.existsSync(zipPath)) {
    throw new Error(`找不到动作包:${zipPath}`)
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theatre-mixamo-pack-'))
  const failures: string[] = []
  try {
    execFileSync('unzip', ['-q', '-o', zipPath, '-d', tempDir])
    const fbxFiles = fs
      .readdirSync(tempDir)
      .filter((file) => file.toLowerCase().endsWith('.fbx'))
      .sort()

    for (const file of fbxFiles) {
      if (/^(ch36_nonpbr|x bot)\.fbx$/i.test(file)) continue
      const source = fs.readFileSync(path.join(tempDir, file))
      let root: ReturnType<typeof parseFbx>
      try {
        root = parseFbx(Uint8Array.from(source).buffer)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`${pack.prefix} - ${file}: ${message}`)
        console.warn(`解析失败,跳过 ${pack.prefix} - ${file}: ${message}`)
        continue
      }
      const clip = root.animations[0]
      if (!clip) {
        console.log(`跳过无动画源文件 ${pack.prefix} - ${file}`)
        continue
      }

      const name = `${pack.prefix} - ${actionTitle(file)}`
      const outputFile = `${name}.glb`
      const outputPath = path.join(ANIMATIONS_OUT, outputFile)
      if (fs.existsSync(outputPath)) {
        console.log(`已存在,跳过 ${outputFile}`)
        continue
      }

      clip.name = name
      root.traverse((node) => {
        node.name = normalizedClipName(node.name)
      })
      for (const track of clip.tracks) {
        track.name = normalizedClipName(track.name)
        const target = track.name.split('.')[0]
        if (!root.getObjectByName(target)) {
          throw new Error(`${file} 的轨道目标缺失:${track.name}`)
        }
      }

      const glb = await exportAnimationGLB(root, clip)
      const io = new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({
          'draco3d.decoder': await draco3dgltf.createDecoderModule(),
        })
      const doc = await io.readBinary(new Uint8Array(glb))
      const rig = doc
        .getRoot()
        .listNodes()
        .find((node) => node.getName() === 'AnimationRig')
      if (!rig) throw new Error(`${file} 导出后缺少 AnimationRig`)
      rig.setExtras({...rig.getExtras(), animationMetersPerUnit: 0.01})
      fs.writeFileSync(outputPath, await io.writeBinary(doc), {flag: 'wx'})
      console.log(`已导入 ${outputFile}`)
    }
  } finally {
    fs.rmSync(tempDir, {recursive: true, force: true})
  }
  return failures
}

async function main() {
  const failures: string[] = []
  for (const pack of PACKS) {
    failures.push(...(await convertPack(pack)))
  }
  if (failures.length) {
    const message = `有 ${failures.length} 个动作解析失败:\n${failures.join(
      '\n',
    )}`
    if (STRICT) throw new Error(message)
    console.warn(message)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
