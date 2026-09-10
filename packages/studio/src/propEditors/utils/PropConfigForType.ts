import type {PropTypeConfig} from '@dreamerbird/core/types/public'

export type PropConfigForType<K extends PropTypeConfig['type']> = Extract<
  PropTypeConfig,
  {type: K}
>
