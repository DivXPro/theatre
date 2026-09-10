import {defer} from '@dreamerbird/utils/defer'
import type {InitOpts} from './types/public'

/**
 * Tracks whether (and how) `theatre.init()` was called.
 *
 * Kept in its own module (rather than index.ts) so that modules deep in core
 * (like Project) can read it without a circular import through the package
 * entry point.
 */
export const initState = {
  called: false,
  optsDeferred: defer<InitOpts | undefined>(),
}
