/*
 * Pantry — Wake Lock helper.
 *
 * The screen is kept awake while a recipe view is open. Browsers release
 * wake locks automatically when the page is hidden, so we re-request one
 * when the page becomes visible again. Unsupported browsers fail silently.
 */

let sentinel = null;
let wantsLock = false;

function supported() {
  return typeof navigator !== "undefined" && "wakeLock" in navigator;
}

async function acquire() {
  if (!wantsLock || sentinel || !supported()) return;
  if (document.visibilityState !== "visible") return;

  try {
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => {
      sentinel = null;
    });
  } catch {
    sentinel = null;
  }
}

async function release() {
  const current = sentinel;
  sentinel = null;
  if (!current) return;

  try {
    await current.release();
  } catch {
    /* The browser may already have released it. */
  }
}

/** Tell the helper whether a recipe view is currently visible. */
export function setRecipeOpen(isOpen) {
  wantsLock = Boolean(isOpen);
  if (wantsLock) acquire();
  else release();
}

/** Release the lock, e.g. when leaving the recipe. */
export async function releaseWakeLock() {
  wantsLock = false;
  await release();
}

export function isWakeLockSupported() {
  return supported();
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wantsLock) acquire();
  });
}
