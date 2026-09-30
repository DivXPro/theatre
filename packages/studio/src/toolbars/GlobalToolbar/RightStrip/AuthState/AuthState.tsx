import {useVal} from '@dreamerbird/react'
import type Auth from '@dreamerbird/studio/Auth'
import getStudio from '@dreamerbird/studio/getStudio'
import ToolbarButton from '@dreamerbird/studio/uiComponents/toolbar/ToolbarButton'
import React from 'react'
import Unauthorized from './Unauthorized'
import Avatar from './Avatar'

const AuthState: React.FC<{}> = (props) => {
  // In offline mode (no `serverUrl`) the studio has no Auth instance at all,
  // so there is no auth UI to show. No hooks run before this early return.
  const auth = getStudio().auth
  if (!auth) return null
  return <AuthedAuthState auth={auth} />
}

const AuthedAuthState: React.FC<{auth: Auth}> = ({auth}) => {
  const authState = useVal(auth.derivedState)

  if (authState === 'loading') {
    return <></>
  }

  if (!authState.loggedIn) {
    return <Unauthorized authState={authState} />
  } else {
    return (
      <>
        <ToolbarButton $primary={true} onClick={() => {}}>
          Share
        </ToolbarButton>
        <Avatar authState={authState} />
      </>
    )
  }
}

export default AuthState
