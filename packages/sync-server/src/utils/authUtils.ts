import * as jose from 'jose'
import {TRPCError} from '@trpc/server'
import {appHost} from '../appClient'
import {isAuthDisabled} from '../authConfig'
import type {studioAuthTokens} from '@dreamerbird/app/types'
import type {$IntentionalAny} from '@dreamerbird/utils/types'

let jwtPublicKeyPromise: Promise<CryptoKey> | undefined
// Lazy: the fetch only fires when a token actually needs verifying. The
// self-hosted minimal loop (AUTH_DISABLED=true) never calls this, so the
// module can be imported without an app / without APP_URL.
function getJwtPublicKey() {
  if (!jwtPublicKeyPromise) {
    jwtPublicKeyPromise = fetch(appHost + `/api/jwt-public-key`)
      .then((response) => response.json())
      .then((json) => json.publicKey)
      .then((publicKeyString) => jose.importSPKI(publicKeyString, 'RS256'))
  }
  return jwtPublicKeyPromise
}

export type Session = {
  _accessToken: string
} & studioAuthTokens.AccessTokenPayload

export async function verifyAccessTokenOrThrow(opts: {
  input: {studioAuth?: {accessToken: string}}
}): Promise<Session> {
  if (isAuthDisabled()) {
    return {_accessToken: opts.input.studioAuth?.accessToken ?? ''} as Session
  }

  const accessToken = opts.input.studioAuth?.accessToken
  if (!accessToken) {
    // Auth is on but no token was sent — reject (this only happens through a
    // misconfigured direct-ws client; the app-backed client always injects one).
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      cause: 'InvalidSession',
      message: 'Access token could not be verified',
    })
  }
  console.log('verifying ', accessToken)

  const publicKey = await getJwtPublicKey()
  try {
    const res = await jose.jwtVerify(accessToken, publicKey, {
      maxTokenAge: '1h',
    })

    const {payload}: {payload: studioAuthTokens.AccessTokenPayload} =
      res as $IntentionalAny

    console.log('authorized')
    return {_accessToken: accessToken, ...payload}
  } catch (e) {
    console.log('unauthorized')
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      cause: 'InvalidSession',
      message: 'Access token could not be verified',
    })
  }
}
