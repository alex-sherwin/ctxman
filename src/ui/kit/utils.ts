/** Join the truthy class names with a space. */
export function cx(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(' ');
}

/** A RAC `className`: a string, or a render function of the component's render props. */
export type RacClassName<R> =
  | string
  | ((values: R & { defaultClassName: string | undefined }) => string);

/**
 * Merge the kit's base classes into a RAC `className` (string or render function).
 * Same contract as `composeRenderProps(className, (c) => cx(...base, c))`, but accepts `undefined`.
 * Passing any className also switches off RAC's default `react-aria-*` class (the kit never styles those).
 */
export function kitClass<R>(
  className: RacClassName<R> | undefined,
  ...base: Array<string | false | null | undefined>
): RacClassName<R> {
  if (typeof className === 'function') return (values) => cx(...base, className(values));
  return cx(...base, className);
}
