'use client';

import { useState } from 'react';

/**
 * Counts how often `value` has changed since the component appeared, and which way it moved.
 * Use the count as a React key to replay a CSS animation on every change, and only add the
 * animation class once the count is above zero, so nothing animates when the page first loads.
 *
 * `armed` is for values that fill in after the first paint, like the cart read from storage:
 * pass its ready flag, and only changes made after it was already ready count (a person
 * tapping Add), not the jump from empty to the saved cart.
 */
export function useChangePulse(value: number, armed = true) {
  const [seen, setSeen] = useState({ value, armed });
  const [pulse, setPulse] = useState({ count: 0, up: true });

  // Adjusting state while rendering (not in an effect) keeps the animation on the same frame as the change.
  if (seen.value !== value || seen.armed !== armed) {
    setSeen({ value, armed });
    if (seen.armed && seen.value !== value) {
      setPulse((current) => ({ count: current.count + 1, up: value > seen.value }));
    }
  }

  return pulse;
}
