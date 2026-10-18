// PURE: list reordering shared by the Forge (links) and Inflate (segments). No fs, no astro:*; browser-safe.

export type DropPosition = 'before' | 'after';

/**
 * Move `moving` (kept in their current relative order within `keys`) before or after `target`.
 * Returns a new array and never mutates its inputs. Keys in `moving` that are not in `keys` are ignored; an
 * unknown `target`, a `target` that is itself moving, or nothing to move returns an unchanged copy.
 */
export function reorderKeys(
  keys: readonly string[],
  moving: readonly string[],
  target: string,
  position: DropPosition,
): string[] {
  const moveSet = new Set(moving);
  const moved = keys.filter((k) => moveSet.has(k));
  if (moved.length === 0 || !keys.includes(target) || moveSet.has(target)) return [...keys];
  const rest = keys.filter((k) => !moveSet.has(k));
  const at = rest.indexOf(target) + (position === 'after' ? 1 : 0);
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
}
