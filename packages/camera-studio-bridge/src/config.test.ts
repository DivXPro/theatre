import {resolveBridgeConfig, resolveBridgeConfigFromEnv} from './config'

test('uses local secure defaults', () => {
  const config = resolveBridgeConfig({token: 'secret'})
  expect(config).toMatchObject({
    host: '127.0.0.1',
    port: 43110,
    corsOrigins: [],
    maxUploadBytes: 200 * 1024 * 1024,
  })
})

test('applies secondary defaults and freezes the result', () => {
  const config = resolveBridgeConfig({token: 'secret'})
  expect(config.maxCommandBytes).toBe(1024 * 1024)
  expect(config.fileTtlMs).toBe(60 * 60 * 1000)
  expect(Object.isFrozen(config)).toBe(true)
  expect(Object.isFrozen(config.corsOrigins)).toBe(true)
})

test('refuses to start without any authentication', () => {
  expect(() => resolveBridgeConfig({})).toThrow(/Token|authenticate/)
})

test('does not relax auth when host becomes public', () => {
  expect(() => resolveBridgeConfig({host: '0.0.0.0'})).toThrow()
  expect(resolveBridgeConfig({host: '0.0.0.0', token: 'secret'}).host).toBe(
    '0.0.0.0',
  )
})

test('an empty token does not count as authentication', () => {
  expect(() => resolveBridgeConfig({token: ''})).toThrow(/Token|authenticate/)
})

test('authenticate callback alone is sufficient and covers both transports', () => {
  const authenticate = () => true
  const config = resolveBridgeConfig({authenticate})
  expect(config.authMode).toBe('custom')
  expect(config.authenticate).toBe(authenticate)
})

test('token and authenticate combine with AND semantics', () => {
  const authenticate = () => true
  const config = resolveBridgeConfig({token: 'secret', authenticate})
  expect(config.authMode).toBe('token+custom')
  expect(config.token).toBe('secret')
  expect(config.authenticate).toBe(authenticate)
})

test('rejects invalid ports', () => {
  for (const port of [0, -1, 65536, 1.5, NaN]) {
    expect(() => resolveBridgeConfig({token: 'secret', port})).toThrow(/port/i)
  }
})

test('rejects non-positive upload and command limits', () => {
  expect(() =>
    resolveBridgeConfig({token: 'secret', maxUploadBytes: -1}),
  ).toThrow(/maxUploadBytes/)
  expect(() =>
    resolveBridgeConfig({token: 'secret', maxUploadBytes: 0}),
  ).toThrow(/maxUploadBytes/)
  expect(() =>
    resolveBridgeConfig({token: 'secret', maxCommandBytes: -1}),
  ).toThrow(/maxCommandBytes/)
  expect(() => resolveBridgeConfig({token: 'secret', fileTtlMs: 0})).toThrow(
    /fileTtlMs/,
  )
})

test('rejects empty or duplicate CORS origins', () => {
  expect(() =>
    resolveBridgeConfig({token: 'secret', corsOrigins: ['']}),
  ).toThrow(/cors/i)
  expect(() =>
    resolveBridgeConfig({
      token: 'secret',
      corsOrigins: ['https://a.example', 'https://a.example'],
    }),
  ).toThrow(/cors/i)
  expect(() =>
    resolveBridgeConfig({token: 'secret', corsOrigins: ['  ']}),
  ).toThrow(/cors/i)
})

test('reads configuration from environment variables', () => {
  const config = resolveBridgeConfigFromEnv({
    CAMERA_STUDIO_BRIDGE_HOST: '0.0.0.0',
    CAMERA_STUDIO_BRIDGE_PORT: '44000',
    CAMERA_STUDIO_BRIDGE_TOKEN: 'secret',
    CAMERA_STUDIO_BRIDGE_CORS_ORIGINS: 'https://a.example, https://b.example',
    CAMERA_STUDIO_BRIDGE_MAX_UPLOAD_BYTES: String(1024),
  })
  expect(config).toMatchObject({
    host: '0.0.0.0',
    port: 44000,
    token: 'secret',
    corsOrigins: ['https://a.example', 'https://b.example'],
    maxUploadBytes: 1024,
  })
})

test('environment without a token is refused', () => {
  expect(() => resolveBridgeConfigFromEnv({})).toThrow(/Token|authenticate/)
})

test('rejects invalid environment values', () => {
  const base = {CAMERA_STUDIO_BRIDGE_TOKEN: 'secret'}
  expect(() =>
    resolveBridgeConfigFromEnv({...base, CAMERA_STUDIO_BRIDGE_PORT: 'abc'}),
  ).toThrow(/port/i)
  expect(() =>
    resolveBridgeConfigFromEnv({...base, CAMERA_STUDIO_BRIDGE_PORT: '70000'}),
  ).toThrow(/port/i)
  expect(() =>
    resolveBridgeConfigFromEnv({
      ...base,
      CAMERA_STUDIO_BRIDGE_MAX_UPLOAD_BYTES: '-5',
    }),
  ).toThrow(/maxUploadBytes/)
  expect(() =>
    resolveBridgeConfigFromEnv({
      ...base,
      CAMERA_STUDIO_BRIDGE_CORS_ORIGINS: 'https://a.example,,https://b.example',
    }),
  ).toThrow(/cors/i)
  expect(() =>
    resolveBridgeConfigFromEnv({
      ...base,
      CAMERA_STUDIO_BRIDGE_CORS_ORIGINS: 'https://a.example,https://a.example',
    }),
  ).toThrow(/cors/i)
})
