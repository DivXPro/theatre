export function deriveSaazNames(persistenceKey: string): {
  frontDbName: string
  backDbName: string
  dbName: string
} {
  return {
    frontDbName: `theatrejs-saaz-front/${persistenceKey}`,
    backDbName: `theatrejs-saaz-back/${persistenceKey}`,
    dbName: persistenceKey,
  }
}
