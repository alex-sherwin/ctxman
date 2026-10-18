// SERVER (no astro:*): builds the McpServer of /mcp for ONE request (plans/CORE_REFACTOR_PLAN.md §8): name `ctxman`,
// version from package.json, capabilities tools + resources, the instructions below, every tool of tools.ts
// (arktype Types as Standard Schema input: the SDK validates arguments and answers `isError` on bad input) and the
// two resource templates of resources.ts. The server is stateless: http.ts creates a fresh one per HTTP request.
import { McpServer, ResourceNotFoundError, ResourceTemplate } from '@modelcontextprotocol/server';
import type { Variables } from '@modelcontextprotocol/server';
import pkg from '../../../package.json' with { type: 'json' };
import {
  RESOURCE_DOC_TEMPLATE,
  RESOURCE_ENTRY_TEMPLATE,
  ResourceMissingError,
  listEntryResources,
  readDocResource,
  readEntryResource,
} from './resources.ts';
import { TOOLS } from './tools.ts';
import type { ToolContext } from './tools.ts';

export const SERVER_NAME = 'ctxman';

export const INSTRUCTIONS = `ctxman keeps knowledge, work items, skills and references as files and links them with typed relations.
Datasets: kb, rca, idea, task, bug, feature, project (okf bundles), skill, reference, context (evergreen link sets) and recipe (saved Context Inflate compositions).
1. Start with search (all datasets, ranked, with snippets) or list-entries (filter by state, tag, project); list-datasets shows what exists.
2. get-entry gives frontmatter, body, relations and files; read-bundle-file reads one file (index.md is an okf entry, plus concepts/x.md, log.md; SKILL.md for skills); get-context resolves a context's links and notes.
3. render-recipe returns the full Context Inflate brief for a recipe or an ad hoc set of contexts/items; check-data runs the compliance checks.
4. Write tools change files immediately and without confirmation: create-entry, patch-entry (state, title, description, tags, relations), append-context-links, append-log (a dated line in a bundle's log.md). Record notable changes with append-log.
5. Entries are also resources: ctxman://{dataset}/{slug} and ctxman://{dataset}/{slug}/doc/{path}. Other entries are referenced in prose as ctxman:<dataset>/<slug>.`;

const first = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

/** A fresh server for one request; `ctx` is the per-request tool context (data dir, clock, server origin). */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: pkg.version },
    {
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
      instructions: INSTRUCTIONS,
    },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: tool.readOnly
          ? { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
          : {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: false,
            },
      },
      (args) => tool.handler(args, ctx),
    );
  }

  const asProtocolError = (uri: URL, error: unknown): never => {
    if (error instanceof ResourceMissingError)
      throw new ResourceNotFoundError(uri.href, error.message);
    throw error;
  };

  server.registerResource(
    'entry',
    new ResourceTemplate(RESOURCE_ENTRY_TEMPLATE, {
      list: async () => ({ resources: await listEntryResources(ctx) }),
    }),
    {
      title: 'Entry',
      description:
        'An entry file as on disk: index.md / SKILL.md, or the yaml of a reference, context or recipe.',
    },
    async (uri: URL, vars: Variables) => {
      try {
        const found = await readEntryResource(ctx, first(vars.dataset), first(vars.slug));
        return { contents: [{ uri: uri.href, mimeType: found.mimeType, text: found.text }] };
      } catch (error) {
        return asProtocolError(uri, error);
      }
    },
  );

  server.registerResource(
    'bundle-file',
    new ResourceTemplate(RESOURCE_DOC_TEMPLATE, { list: undefined }),
    {
      title: 'Bundle file',
      description:
        'One text file of an okf bundle or skill directory, e.g. concepts/search.md or log.md.',
    },
    async (uri: URL, vars: Variables) => {
      try {
        const found = await readDocResource(
          ctx,
          first(vars.dataset),
          first(vars.slug),
          first(vars.path),
        );
        return { contents: [{ uri: uri.href, mimeType: found.mimeType, text: found.text }] };
      } catch (error) {
        return asProtocolError(uri, error);
      }
    },
  );

  return server;
}
