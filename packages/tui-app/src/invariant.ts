/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-tui-app`.
 * @module @deepseek-ai/dsh-tui-app/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tui-app'

/** Cordis companion plugin name. */
export const name = 'tui-app-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bundle is a static patch-list carrier plus the
 * startup provider, which owns no durable package-local event stream; the
 * front-door plugin it mounts carries the interactive invariants.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
