// Preview view of Inflate (INFLATE_SPEC §9.3): the generated markdown (read-only Monaco), copy / download,
// write-to-path and the manifest table. The document comes from the server render (`$render`).
import { useStore } from '@nanostores/react';
import { useRef, useState } from 'react';
import type { InflateManifest } from '../../lib/inflate/render.ts';
import {
  $render,
  $working,
  $writePath,
  $writeStatus,
  setWritePath,
  writeOutput,
} from '../../stores/inflate.ts';
import { Button, CodeEditor, TextField } from '../kit/index.ts';
import { formatBytes } from './format.ts';

const TYPE_LABELS: Record<string, string> = {
  markdown: 'Markdown',
  'context-intro': 'Context intro',
  'section-intro': 'Section intro',
};

function RenderStatus() {
  const render = useStore($render);
  let kind: 'loading' | 'ready' | 'error' = 'loading';
  let text = 'Rendering…';
  if (render.status === 'error') {
    kind = 'error';
    text = `Render failed: ${render.message ?? 'unknown error'}`;
  } else if (render.status === 'ready' && render.result !== null) {
    kind = 'ready';
    const { bytes, counts } = render.result.manifest;
    text = `${formatBytes(bytes)} · ${counts.included} items`;
  }
  return (
    <span
      className="cx-forge__status cx-preview__status"
      role="status"
      data-kind={kind}
      data-testid="inflate-render-status"
    >
      {text}
    </span>
  );
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.md`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function PreviewActions({ name, markdown }: { name: string; markdown: string | null }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  async function onCopy() {
    if (markdown === null) return;
    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      return; // clipboard blocked (permissions / insecure context): nothing to confirm
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <Button
        size="sm"
        onPress={() => void onCopy()}
        isDisabled={markdown === null}
        data-testid="inflate-copy"
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
      <Button
        size="sm"
        onPress={() => {
          if (markdown !== null) download(name, markdown);
        }}
        isDisabled={markdown === null}
        data-testid="inflate-download"
      >
        Download .md
      </Button>
    </>
  );
}

function ManifestTable({ manifest }: { manifest: InflateManifest }) {
  return (
    <table className="cx-manifest" data-testid="inflate-manifest">
      <caption className="cx-label">Manifest</caption>
      <thead>
        <tr>
          <th scope="col">#</th>
          <th scope="col">Item</th>
          <th scope="col">Mode</th>
          <th scope="col">Size</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {manifest.segments.map((s, i) => (
          <tr
            key={s.key}
            data-testid="inflate-manifest-row"
            data-key={s.key}
            data-status={s.status}
          >
            <td className="cx-mono cx-subtle">{i + 1}</td>
            <td>
              <span className="cx-manifest__title">{s.title}</span>{' '}
              <code className="cx-subtle">{s.key}</code>
            </td>
            <td>{s.modeLabel ?? TYPE_LABELS[s.type] ?? s.type}</td>
            <td className="cx-mono">{s.bytes > 0 ? formatBytes(s.bytes) : '—'}</td>
            <td>{s.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function WriteBox({ name, outDir }: { name: string; outDir: string }) {
  const typed = useStore($writePath);
  const status = useStore($writeStatus);
  const path = typed ?? `${outDir}${name}.md`;
  let text = '';
  let kind: 'ok' | 'error' | 'busy' | 'idle' = 'idle';
  if (status.kind === 'writing') {
    kind = 'busy';
    text = 'Writing…';
  } else if (status.kind === 'written') {
    kind = 'ok';
    text = `Wrote ${status.path ?? path} (${formatBytes(status.bytes ?? 0)})`;
  } else if (status.kind === 'error') {
    kind = 'error';
    text = status.message ?? 'Write failed';
  }
  return (
    <div className="cx-preview__write">
      <TextField
        label="Write to path"
        size="sm"
        mono
        value={path}
        onChange={setWritePath}
        description="Absolute path ending in .md. Missing folders are created; an existing file is replaced."
        inputTestId="inflate-write-path"
      />
      <div className="cx-row">
        <Button
          variant="primary"
          size="sm"
          onPress={() => void writeOutput(path)}
          isPending={status.kind === 'writing'}
          data-testid="inflate-write"
        >
          Write file
        </Button>
      </div>
      <p
        className="cx-preview__writestatus"
        role="status"
        data-kind={kind}
        data-testid="inflate-write-status"
      >
        {text}
      </p>
    </div>
  );
}

export function PreviewPane({ outDir }: { outDir: string }) {
  const working = useStore($working);
  const render = useStore($render);
  if (working === null) return null;
  const result = render.result;
  const warnings = result?.manifest.warnings ?? [];
  return (
    <section
      className="cx-preview"
      aria-labelledby="inflate-preview-h"
      data-testid="inflate-preview"
    >
      <div className="cx-preview__main">
        <header className="cx-forge__pane-header">
          <h2 id="inflate-preview-h" className="cx-forge__pane-title">
            Preview
          </h2>
          <RenderStatus />
          <span className="cx-inflate__spacer" />
          <PreviewActions name={working.name} markdown={result?.markdown ?? null} />
        </header>
        <div className="cx-preview__editor">
          <CodeEditor
            language="markdown"
            readOnly
            value={result?.markdown ?? ''}
            height={{ mode: 'fill' }}
            testId="inflate-preview-editor"
            ariaLabel="Generated markdown"
          />
        </div>
      </div>
      <aside className="cx-preview__side" aria-label="Output">
        <WriteBox name={working.name} outDir={outDir} />
        {warnings.length > 0 && (
          <ul className="cx-preview__warnings" data-testid="inflate-manifest-warnings">
            {warnings.map((w) => (
              <li key={`${w.code}:${w.key ?? ''}:${w.message}`}>{w.message}</li>
            ))}
          </ul>
        )}
        {result !== null && <ManifestTable manifest={result.manifest} />}
      </aside>
    </section>
  );
}
