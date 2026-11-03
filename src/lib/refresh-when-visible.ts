/**
 * Runs `refresh` now if the tab is visible, otherwise as soon as it becomes visible.
 *
 * A page refresh can animate (React's ViewTransition), and the browser cancels an animation on a hidden
 * tab with "InvalidStateError: Transition was aborted because of invalid state. Document hidden". That is
 * harmless but noisy, and it happens when something finishes in the background, such as a location read
 * that completes after the customer switched to another app. Waiting for the tab to come back avoids it.
 */
export function refreshWhenVisible(refresh: () => void) {
  if (typeof document === 'undefined' || document.visibilityState === 'visible') {
    refresh();
    return;
  }
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onVisible);
    refresh();
  };
  document.addEventListener('visibilitychange', onVisible);
}
