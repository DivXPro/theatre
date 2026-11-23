import {seedAssetsManifest} from './seedAssetsManifest'
import type {ModelEntry} from './types'

export const modelGroupOrder = [
  'characters',
  'buildings',
  'buildingBlocks',
  'sceneBlocks',
  'props',
  'vehicles',
  'nature',
  'imported',
] as const

type ModelGroup = (typeof modelGroupOrder)[number]

const catalogNames = new Map(
  seedAssetsManifest.models.map((model) => [model.contentHash, model.name]),
)

const legacyBotNames = new Map([
  ['d1b47880a8a72b81', 'y bot'],
  ['95cbcdd2192dbe68', 'y bot'],
])

const retiredCharacterHashes = new Set([
  'd5d9862207306764',
  '9085df26b9dc2601',
  '8e507be93fc542d6',
  '54b363dfe815b224',
  '65cbbd27f7ba6850',
])

const retiredCharacterNames = new Set([
  'erika archer',
  'maria j j ong',
  'remy',
  'sporty granny',
  'the boss',
  'poser_male_01a_1.8m',
  'poserextension_male_r_arm_a',
  'poserextension_male_l_arm_a',
  'poserextension_male_r_lag_a',
  'poserextension_male_l_lag_a',
  'dummy_male_01a_1.8m',
  'dummy_r_hand_m01a_1.8m',
  'dummy_l_hand_m01a_1.8m',
])

function normalizedModelName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^mangaka posers? (?:dummies )?- /, '')
    .replace(/^mixamo (?:- )?/, '')
    .replace(/\.(fbx|glb|gltf)$/, '')
    .replace(/ \(\d+\)$/, '')
}

function botName(entry: ModelEntry): string | undefined {
  const name = normalizedModelName(
    catalogNames.get(entry.contentHash) ??
      legacyBotNames.get(entry.contentHash) ??
      entry.name,
  )
  return name === 'x bot' || name === 'y bot' ? name : undefined
}

export function modelPickerEntries(
  entries: readonly ModelEntry[],
): ModelEntry[] {
  const preferredBots = new Map<string, ModelEntry>()
  for (const entry of entries) {
    const name = botName(entry)
    if (!name) continue
    const previous = preferredBots.get(name)
    if (
      !previous ||
      entry.blobId.startsWith('catalog:models/') ||
      (catalogNames.has(entry.contentHash) &&
        !catalogNames.has(previous.contentHash))
    ) {
      preferredBots.set(name, entry)
    }
  }

  return entries.filter((entry) => {
    if (
      retiredCharacterHashes.has(entry.contentHash) ||
      retiredCharacterNames.has(normalizedModelName(entry.name))
    ) {
      return false
    }
    const name = botName(entry)
    return name === undefined || preferredBots.get(name) === entry
  })
}

export function modelGroupOf(entry: ModelEntry): ModelGroup {
  if (botName(entry)) return 'characters'

  const name = catalogNames.get(entry.contentHash)
  if (!name) return 'imported'
  if (
    name.startsWith('ModKit Building - ') ||
    name.startsWith('MangaKa Building blocks - ') ||
    name.startsWith('MangaKa Props - M_R_Window_')
  ) {
    return 'buildingBlocks'
  }
  if (name.startsWith('LowPoly Modular - ')) return 'sceneBlocks'
  if (
    /^MangaKa Props - (F_S_ScifiBuilding|M_R_City_Building|PF_MedieHouses)_/.test(
      name,
    )
  ) {
    return 'buildings'
  }
  if (/^MangaKa Props - M_R_(Bicycles|Bikes)_/.test(name)) return 'vehicles'
  if (/^MangaKa Props - N_[CR]_Veg_/.test(name)) return 'nature'
  return 'props'
}
