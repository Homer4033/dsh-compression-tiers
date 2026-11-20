import { cpSync, renameSync, rmSync } from 'node:fs'

/**
 * Atomic-ish replacement of an installed tree.
 *
 * Windows refuses `rename()` on a directory while any file inside it is still
 * open — an antivirus halfway through scanning a freshly written 110 MB
 * `ffmpeg.exe`, or the child process that just answered `-version`, is enough —
 * and it reports that as `EPERM`. The lock is short-lived, so the first answer
 * is to retry with a backoff. If the lock outlives the retries, renaming is
 * hopeless but *reading* is not, so the tree is copied into the free path
 * instead: the install still finishes, it just costs a copy.
 *
 * Renaming onto an existing non-empty directory also fails (`EPERM` /
 * `ENOTEMPTY` on Windows, `ENOTEMPTY` on POSIX), so callers keep the contract
 * that `to` must be free; the copy fallback clears it first anyway.
 */

/** Locks that clear on their own: retry before giving up on the rename. */
const LOCKED = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'EEXIST'])

/** Errors that will never survive a retry but are fine for a copy. */
const CROSS_DEVICE = new Set(['EXDEV'])

/** Whether a filesystem error is a transient lock rather than a real refusal. */
export function isLockedError(error) {
  return Boolean(error) && LOCKED.has(String(error.code || ''))
}

/** Whether the destination lives on another volume, so only a copy can work. */
export function isCrossDeviceError(error) {
  return Boolean(error) && CROSS_DEVICE.has(String(error.code || ''))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Rename with a bounded exponential backoff for lock errors. Errors that a
 * retry cannot fix (`ENOENT`, `ENOSPC`, `EXDEV`, …) are rethrown at once.
 *
 * @returns the attempt number that succeeded.
 */
export async function renameWithRetry(from, to, { attempts = 7, delayMs = 200, rename = renameSync } = {}) {
  let lastError = null
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rename(from, to)
      return attempt
    } catch (error) {
      lastError = error
      if (!isLockedError(error) || attempt === attempts) throw error
      await sleep(delayMs * 2 ** (attempt - 1))
    }
  }
  throw lastError
}

/**
 * Put `from` at the free path `to`, renaming it there or — when the tree stays
 * locked / lives on another volume — copying it there. The source is left in
 * place on both paths; callers prune their own staging directories.
 *
 * @returns `{ how: 'rename' | 'copy', attempts }`.
 */
export async function moveIntoPlace(from, to, { attempts, delayMs, rename = renameSync, copy = cpSync, remove = rmSync } = {}) {
  try {
    const how = await renameWithRetry(from, to, { attempts, delayMs, rename })
    return { how: 'rename', attempts: how }
  } catch (error) {
    if (!isLockedError(error) && !isCrossDeviceError(error)) throw error
    remove(to, { recursive: true, force: true })
    copy(from, to, { recursive: true })
    return { how: 'copy', attempts }
  }
}
