// Shared ticking clock (UI_SPEC §0.6). Components read time from here, never `Date.now()` in render.
// The interval only runs while at least one component is subscribed (nanostores onMount).
import { atom, onMount } from 'nanostores';

export const $now = atom<number>(0);

onMount($now, () => {
  $now.set(Date.now());
  const timer = setInterval(() => $now.set(Date.now()), 1000);
  return () => clearInterval(timer);
});
