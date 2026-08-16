/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-visual-studio`.
 * @module @deepseek-ai/dsh-visual-studio/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-visual-studio'

/** Cordis companion plugin name. */
export const name = 'visual-studio-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the RPC channel and slot registration are effects
 * owned and observed by their respective registries; the file-service
 * containment rule is exercised directly through its unit tests.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
