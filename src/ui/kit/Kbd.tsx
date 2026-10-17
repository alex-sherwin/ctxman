import type { ReactNode } from 'react';
import { Keyboard } from 'react-aria-components';

export function Kbd({ children }: { children: ReactNode }) {
  return <Keyboard className="ck-kbd">{children}</Keyboard>;
}
