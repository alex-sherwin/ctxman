// Preview view of Inflate (INFLATE_SPEC §9.3, INFLATE_V2_SPEC §11.5): the generated markdown (read-only Monaco),
// copy / download, write-to-path and the manifest table. Without a working directory the document is the
// server render (`$render`, absolute paths). With one, it is the dry run's document with paths relative to the
// directory (`$dirPlan`) unless `paths=absolute` asks for the v1 render.
import { useStore } from '@nanostores/react';
import { useRef, useState } from 'react';
import { materialDef } from '../../lib/inflate/catalog.ts';
import type { InflateManifest, InflateResult } from '../../lib/inflate/render.ts';
import {
  $inflateUrl,
  $render,
  $working,
  $writePath,
  $writeStatus,
  setPaths,
  setWritePath,
  writeOutput,
} from '../../stores/inflate.ts';
import { $dirPlan, $effectiveDir, selectView } from '../../stores/inflate-run.ts';
import {
  Button,
  Cell,
  Chip,
  ChipGroup,
  CodeEditor,
  Column,
  Row,
  Table,
  TableBody,
  TableHeader,
  TextField,
} from '../kit/index.ts';
import { formatBytes } from './format.ts';

const TYPE_LABELS: Record<string, string> = {
  markdown: 'Markdown',
  'context-intro': 'Context intro',
  'section-intro': 'Section intro',
};

/** The document being previewed and how it got here (the v1 render or the directory dry run). */
interface Shown {
  status: 'idle' | 'loading' | 'ready' | 'error';
  result: InflateResult | null;
  message?: string;
}

function RenderStatus({ shown }: { shown: Shown }) {
  let kind: 'loading' | 'ready' | 'error' = 'loading';
  let text = 'Rendering…';
  if (shown.status === 'error') {
    kind = 'error';
    text = `Render failed: ${shown.message ?? 'unknown error'}`;
  } else if (shown.status === 'ready' && shown.result !== null) {
    kind = 'ready';
    const { bytes, counts } = shown.result.manifest;
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
  const rows = manifest.segments.map((s, i) => ({ ...s, id: s.key, n: i + 1 }));
  // A render for a working directory also says what is placed where.
  const withMaterial = manifest.output !== undefined;
  return (
    <section className="cx-manifest" aria-labelledby="inflate-manifest-h">
      <h3 id="inflate-manifest-h" className="cx-label">
        Manifest
      </h3>
      <Table density="compact" aria-label="Manifest" data-testid="inflate-manifest">
        <TableHeader>
          <Column align="end">#</Column>
          <Column isRowHeader>Item</Column>
          <Column>Mode</Column>
          {withMaterial ? <Column>Material</Column> : null}
          <Column align="end">Size</Column>
          <Column>Status</Column>
        </TableHeader>
        <TableBody items={rows}>
          {(s) => (
            <Row
              data-testid="inflate-manifest-row"
              data-key={s.key}
              data-status={s.status}
              textValue={s.title}
            >
              <Cell align="end" className="cx-mono cx-subtle">
                {s.n}
              </Cell>
              <Cell>
                <span className="cx-manifest__title">{s.title}</span>{' '}
                <code className="cx-manifest__key cx-subtle">{s.key}</code>
              </Cell>
              <Cell className="cx-manifest__nowrap">
                {s.modeLabel ?? TYPE_LABELS[s.type] ?? s.type}
              </Cell>
              {withMaterial ? (
                <Cell>
                  <span className="cx-manifest__nowrap">
                    {s.material === undefined || s.kind === undefined
                      ? '—'
                      : (materialDef(s.kind, s.material)?.label ?? s.material)}
                  </span>
                  {s.dest !== undefined && (
                    <code className="cx-manifest__key cx-manifest__dest cx-subtle">{s.dest}</code>
                  )}
                </Cell>
              ) : null}
              <Cell align="end" className="cx-mono cx-manifest__nowrap">
                {s.bytes > 0 ? formatBytes(s.bytes) : '—'}
              </Cell>
              <Cell>{s.status}</Cell>
            </Row>
          )}
        </TableBody>
      </Table>
    </section>
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

/** Relative / Absolute toggle of the document shown (only with a working directory). */
function PathsToggle({ paths }: { paths: 'relative' | 'absolute' }) {
  return (
    <ChipGroup
      label="Paths"
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[paths]}
      onSelectionChange={(keys) => {
        const next = [...keys][0];
        if (next === 'relative' || next === 'absolute') setPaths(next);
      }}
      data-testid="inflate-preview-paths"
    >
      <Chip id="relative" data-testid="inflate-preview-paths-relative">
        Relative to directory
      </Chip>
      <Chip id="absolute" data-testid="inflate-preview-paths-absolute">
        Absolute
      </Chip>
    </ChipGroup>
  );
}

/** Side column of the relative document: where a run writes it, and anything that would stop the run. */
function RunHint() {
  const dirPlan = useStore($dirPlan);
  const result = dirPlan.result;
  return (
    <div className="cx-preview__write" data-testid="inflate-preview-hint">
      <p className="cx-preview__writestatus">
        A run writes this file to{' '}
        <code>
          {result?.dir ?? '<dir>'}/{result?.contextFile ?? 'LLM_CONTEXT.md'}
        </code>
        .
      </p>
      {(result?.blocking ?? []).map((b) => (
        <p
          key={`${b.code}:${b.message}`}
          className="cx-preview__writestatus"
          data-kind="error"
          data-testid="inflate-preview-blocking"
        >
          {b.message}
        </p>
      ))}
      <div className="cx-row">
        <Button size="sm" onPress={() => selectView('run')} data-testid="inflate-preview-run">
          Open Run view
        </Button>
      </div>
    </div>
  );
}

export function PreviewPane({ outDir }: { outDir: string }) {
  const working = useStore($working);
  const render = useStore($render);
  const dirPlan = useStore($dirPlan);
  const dir = useStore($effectiveDir);
  const { paths } = useStore($inflateUrl);
  if (working === null) return null;
  const relative = dir !== null && paths === 'relative';
  const shown: Shown = relative
    ? { status: dirPlan.status, result: dirPlan.result?.document ?? null, message: dirPlan.message }
    : render;
  const result = shown.result;
  const warnings = relative ? (dirPlan.result?.warnings ?? []) : (result?.manifest.warnings ?? []);
  return (
    <section
      className="cx-preview"
      aria-labelledby="inflate-preview-h"
      data-testid="inflate-preview"
      data-wide={relative ? 'true' : undefined}
    >
      <div className="cx-preview__main">
        <header className="cx-forge__pane-header">
          <h2 id="inflate-preview-h" className="cx-forge__pane-title">
            Preview
          </h2>
          <RenderStatus shown={shown} />
          {dir !== null && <PathsToggle paths={paths} />}
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
        {relative ? <RunHint /> : <WriteBox name={working.name} outDir={outDir} />}
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
