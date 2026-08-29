/**
 * Minimal Result union used at trust boundaries.
 *
 * We deliberately do not depend on a Result library. The two variants are:
 *  - { ok: true; value: T }
 *  - { ok: false; error: E }
 *
 * Helper {@link unwrap} is provided for the obvious case but every site is
 * expected to handle the error branch explicitly; no exception-style escape.
 */
export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(r: Result<T, E>): r is Ok<T> {
  return r.ok === true;
}

export function isErr<T, E>(r: Result<T, E>): r is Err<E> {
  return r.ok === false;
}

/**
 * Returns the success value or throws.
 *
 * Reserved for tests and well-justified production sites where a missing
 * success is genuinely unrecoverable. Domain code MUST NOT use this.
 */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok === true) {
    return r.value;
  }
  throw new Error(`unwrap on Err: ${JSON.stringify(r.error)}`);
}

export function map<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  return r.ok === true ? ok(fn(r.value)) : r;
}

/**
 * Bind: chain a Result-producing computation on the success branch.
 * If the receiver is Err, the original error is returned unchanged.
 */
export function andThen<T, U, E>(
  r: Result<T, E>,
  fn: (v: T) => Result<U, E>,
): Result<U, E> {
  return r.ok === true ? fn(r.value) : r;
}
