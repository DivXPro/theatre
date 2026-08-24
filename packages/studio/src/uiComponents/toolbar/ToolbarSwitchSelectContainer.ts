import styled from 'styled-components'
import type {ElementType} from 'react'
import {Group} from 'reakit'

const Container = styled(Group as ElementType)`
  display: flex;
  height: fit-content;
  backdrop-filter: blur(14px);
  border-radius: 2px;
`

export default Container
