// PURE (no fs; browser-safe): the extra formats a markdown Copy button offers in its menu (the split Copy of the doc
// toolbar, the Inflate preview and the snippet page). One row per format; the React button
// (src/ui/markdown/MarkdownCopyButton.tsx) and the SSR twin (src/components/MarkdownCopyButton.astro + src/scripts/shell.ts)
// both read this table. A converter is loaded with a dynamic `import()` on first use, so it never lands in the initial
// bundle of `shell.ts` (every page) or of an island; `preload` starts that load when the menu is about to open.

/** Markdown in, another format out. */
export type Converter = (markdown: string) => string;

export interface CopyFormat {
  /** Menu item key and test id suffix (`<base>-<id>`, e.g. `doc-copy-jira`). */
  id: string;
  /** Menu item label. */
  label: string;
  /** What the copy button's live status says after copying this format. */
  copied: string;
  /** The markdown converted (loads the converter on first use; rejects when it cannot be loaded). */
  convert: (markdown: string) => Promise<string>;
  /** Starts loading the converter, if it is not loaded yet; never rejects. */
  preload: () => void;
}

/** `convert` + `preload` over a converter that `load` imports once (a failed load is retried on the next call). */
export function lazyConverter(
  load: () => Promise<Converter>,
): Pick<CopyFormat, 'convert' | 'preload'> {
  let loading: Promise<Converter> | undefined;
  const get = (): Promise<Converter> => {
    loading ??= load().catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    return loading;
  };
  return {
    convert: async (markdown) => (await get())(markdown),
    preload: () => {
      get().catch(() => {
        // the next convert() retries and reports the failure
      });
    },
  };
}

const jira = lazyConverter(async () => (await import('./jira-markup.ts')).markdownToJira);

/** Every extra copy format, in menu order. */
export const COPY_FORMATS: readonly CopyFormat[] = [
  { id: 'jira', label: 'Copy as JIRA Markup', copied: 'Copied as JIRA Markup', ...jira },
];

/** The format with that id, if any. */
export function copyFormat(id: string | undefined): CopyFormat | undefined {
  return COPY_FORMATS.find((f) => f.id === id);
}

/** Starts loading every format's converter (the menu is about to open). */
export function preloadCopyFormats(): void {
  for (const format of COPY_FORMATS) format.preload();
}
