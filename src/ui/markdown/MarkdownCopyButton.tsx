// The split Copy of a markdown text (the doc toolbar of DocEditor, the Inflate preview): Copy copies the markdown, the
// arrow's menu copies it in another format (`COPY_FORMATS` in src/lib/copy-formats.ts: "Copy as JIRA Markup"). The
// converters load on demand, started when the arrow is hovered or focused or its menu opens. Monaco-free: kit parts by
// file. SSR twin: src/components/MarkdownCopyButton.astro (the snippet page).
import { COPY_FORMATS, preloadCopyFormats } from '../../lib/copy-formats.ts';
import { CopySplitButton, type CopySplitButtonProps } from '../kit/CopySplitButton.tsx';

export interface MarkdownCopyButtonProps extends Omit<
  CopySplitButtonProps,
  'options' | 'onPrepare' | 'moreLabel'
> {
  /** The markdown; a function is read at press time (and again when a menu format is chosen). */
  text: string | (() => string);
}

export function MarkdownCopyButton({
  text,
  'aria-label': ariaLabel = 'Copy markdown',
  ...rest
}: MarkdownCopyButtonProps) {
  const read = () => (typeof text === 'function' ? text() : text);
  const options = COPY_FORMATS.map((format) => ({
    id: format.id,
    label: format.label,
    copied: format.copied,
    text: () => format.convert(read()),
  }));
  return (
    <CopySplitButton
      {...rest}
      text={text}
      aria-label={ariaLabel}
      options={options}
      onPrepare={preloadCopyFormats}
    />
  );
}
