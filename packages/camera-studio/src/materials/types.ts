export type MaterialValues = {
  color: string
  metalness: number
  roughness: number
  emissive: string
  opacity: number
  mapBlobId: string
  normalMapBlobId: string
  roughnessMapBlobId: string
  metalnessMapBlobId: string
  emissiveMapBlobId: string
}

export type MaterialSlot = {
  slotId: string
  slotKey: string
  meshName: string
  materialName: string
  values: MaterialValues
}
