// MarkdownTargets island (ROUND2_UI_SPEC §F.2): turns the server-rendered pencil buttons
// (`<button data-md-edit="<target id>" disabled>`) of a context or recipe detail page into popup markdown
// editors. It renders nothing itself except the open modal: on mount it enables the SSR buttons and listens
// for clicks on the document (delegated, so it works for every button on the page, rows included).
// Mounted by src/pages/[dataset]/[slug]/index.astro with client:only="react" (no fallback; the SSR buttons are
// simply disabled until it mounts).
import { useEffect, useState } from 'react';
import { MarkdownModal } from './MarkdownModal.tsx';
import { targetById } from './targets.ts';
import type { MdTarget } from './targets.ts';

export interface MarkdownTargetsProps {
  targets: MdTarget[];
}

export default function MarkdownTargets({ targets }: MarkdownTargetsProps) {
  const [open, setOpen] = useState<MdTarget | null>(null);

  useEffect(() => {
    for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-md-edit]')) {
      button.disabled = false;
    }
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest<HTMLElement>('[data-md-edit]');
      const target = targetById(targets, button?.dataset.mdEdit);
      if (target === undefined) return;
      event.preventDefault();
      setOpen(target);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [targets]);

  return open === null ? null : (
    <MarkdownModal key={open.id} target={open} onClose={() => setOpen(null)} />
  );
}
