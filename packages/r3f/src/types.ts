export type $FixMe = any
export type $IntentionalAny = any

/**
 * `T` with the keys of `U` replaced by `U`'s types.
 * fiber v9 no longer exports its `Overwrite` helper, so we keep
 * our own equivalent for the two controls components that used it.
 */
export type Overwrite<T, U> = Omit<T, keyof U> & U
