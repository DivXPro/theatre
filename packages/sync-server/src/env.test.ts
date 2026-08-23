import * as envSchema from './envSchema'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import * as yaml from 'yaml'

describe(`@toy-box/sync-server env`, () => {
  describe(`AUTH_DISABLED self-host env`, () => {
    const base = {NODE_ENV: 'development', PORT: '3001', HOST: 'localhost'}

    test(`AUTH_DISABLED=true validates without DATABASE_URL/APP_URL/DEV_DB_*`, () => {
      const res = envSchema.devSchema.safeParse({
        ...base,
        AUTH_DISABLED: 'true',
      })
      expect(res.success).toBe(true)
    })

    test(`AUTH_DISABLED unset in development requires DATABASE_URL, APP_URL and DEV_DB_*`, () => {
      expect(envSchema.devSchema.safeParse(base).success).toBe(false)
      // DATABASE_URL + APP_URL alone is no longer enough in dev: DEV_DB_*
      // compose the dev DATABASE_URL, so they're enforced too (mirrors the
      // app's envSchema where they are mandatory).
      expect(
        envSchema.devSchema.safeParse({
          ...base,
          DATABASE_URL: 'postgresql://postgres:test@localhost:43943/postgres',
          APP_URL: 'http://app',
        }).success,
      ).toBe(false)
      expect(
        envSchema.devSchema.safeParse({
          ...base,
          DATABASE_URL: 'postgresql://postgres:test@localhost:43943/postgres',
          APP_URL: 'http://app',
          DEV_DB_PORT: '43943',
          DEV_DB_PASSWORD: 'test',
        }).success,
      ).toBe(true)
    })
  })

  describe(`.env files`, () => {
    test(`.env.example should be valid`, () => {
      const pathToEnvExample = path.join(__dirname, '../.env.example')
      const envAsString = fs.readFileSync(pathToEnvExample, {encoding: 'utf8'})
      // this should use an INI parser
      const envAsObject = dotenv.parse(envAsString)
      envSchema.devSchema.parse(envAsObject)
    })

    test(`.env should be valid (if it exists)`, () => {
      const pathToEnvExample = path.join(__dirname, '../.env')
      if (!fs.existsSync(pathToEnvExample)) {
        return
      }
      const envAsString = fs.readFileSync(pathToEnvExample, {encoding: 'utf8'})
      // this should use an INI parser
      const envAsObject = dotenv.parse(envAsString)
      envSchema.devSchema.parse(envAsObject)
    })
  })
  describe(`render.yaml`, () => {
    test(`should include all the env variables required by the production schema`, () => {
      const pathToRenderYaml = path.join(__dirname, '../../../render.yaml')
      const yamlContent = yaml.parse(
        fs.readFileSync(pathToRenderYaml, {encoding: 'utf8'}),
      )

      const service = yamlContent.services.find(
        (service: any) => service.name === 'syncServer',
      )

      if (!service) {
        throw new Error(`syncServer service not found`)
      }

      const envVars: Array<{key: string}> = service.envVars
      const envVarKeys = envVars.map((envVar) => envVar.key)
      // PORT is automatically added by render
      envVarKeys.push('PORT')

      const requiredKeys = Object.keys(envSchema.productionSchemaShape.shape)

      envVarKeys.sort()
      requiredKeys.sort()

      // make sure envVarKeys and requiredKeys have all the same values, and no more
      expect(envVarKeys).toEqual(requiredKeys)
    })
  })
})
