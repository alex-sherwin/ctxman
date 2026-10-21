// The per-agent history parsers (PURE: text in, ParsedSession out) and their shared helpers.
import { describe, expect, it } from 'vitest';
import {
  claudePromptText,
  claudeUserInput,
  isTypedCommand,
  parseClaudeSession,
} from '../../src/lib/agent-history/claude.ts';
import {
  codexIdFromFileName,
  isInjectedContext,
  parseCodexSession,
  parseCodexSessionIndex,
} from '../../src/lib/agent-history/codex.ts';
import {
  parseCopilotSession,
  parseCopilotWorkspace,
} from '../../src/lib/agent-history/copilot-cli.ts';
import {
  clip,
  eachJsonLine,
  isListable,
  isoTime,
  jsonLines,
  ownString,
  toolSummary,
  transcriptBuilder,
} from '../../src/lib/agent-history/parse-util.ts';
import {
  lastVscodeActivity,
  parseVscodeSession,
  replayVscodeLog,
  scanVscodeHead,
  stripJsonKeys,
  uriToDisplay,
  vscodeJsonState,
  vscodeLogLine,
  vscodeWorkspaceFolder,
} from '../../src/lib/agent-history/vscode.ts';

const lines = (items: readonly unknown[]): string =>
  items.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join('\n');

describe('parse helpers', () => {
  it('jsonLines skips blank, broken and non-JSON lines', () => {
    expect(jsonLines('{"a":1}\n\nnot json\n{"b":\n[1]\n')).toEqual([{ a: 1 }, [1]]);
  });

  it('eachJsonLine yields the JSON lines one at a time, the last line without a newline too', () => {
    const it = eachJsonLine('{"a":1}\n\n{"b":2}');
    expect(it.next().value).toEqual({ a: 1 });
    expect([...it]).toEqual([{ b: 2 }]);
    expect([...eachJsonLine('')]).toEqual([]);
  });

  it('ownString copies a string (equal value)', () => {
    const long = `${'x'.repeat(40)}y`;
    expect(ownString(long.slice(5, 30))).toBe('x'.repeat(25));
    expect(ownString('')).toBe('');
  });

  it('isListable: a prompt and not a subagent', () => {
    expect(isListable({ messages: [], prompts: 1 })).toBe(true);
    expect(isListable({ messages: [], prompts: 0 })).toBe(false);
    expect(isListable({ messages: [], prompts: 2, subagent: true })).toBe(false);
  });

  it('isoTime accepts ISO strings and epoch ms, refuses the rest', () => {
    expect(isoTime('2026-10-21T16:13:00Z')).toBe('2026-10-21T16:13:00.000Z');
    expect(isoTime(Date.UTC(2026, 9, 21))).toBe('2026-10-21T00:00:00.000Z');
    expect(isoTime('later')).toBeUndefined();
    expect(isoTime('')).toBeUndefined();
    expect(isoTime(null)).toBeUndefined();
  });

  it('clip never splits a surrogate pair', () => {
    expect(clip('ab😀cd', 4)).toBe('ab😀…');
    expect(clip('short', 10)).toBe('short');
  });

  it('toolSummary picks the telling input field per tool, else compact JSON, one line of at most 160', () => {
    expect(toolSummary('Bash', { command: 'git   status\n--short' })).toBe('git status --short');
    expect(toolSummary('Read', { file_path: 'src/a.ts' })).toBe('src/a.ts');
    expect(toolSummary('NotebookEdit', { notebook_path: 'n.ipynb' })).toBe('n.ipynb');
    expect(toolSummary('Grep', { pattern: 'foo', path: 'src' })).toBe('foo in src');
    expect(toolSummary('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
    expect(toolSummary('WebFetch', { url: 'https://x.dev' })).toBe('https://x.dev');
    expect(toolSummary('WebSearch', { query: 'zstd node' })).toBe('zstd node');
    expect(toolSummary('Task', { description: 'Review', prompt: 'long' })).toBe('Review');
    expect(toolSummary('shell', { command: ['bash', '-lc', 'ls'] })).toBe('bash -lc ls');
    expect(toolSummary('exec_command', { cmd: 'pnpm test' })).toBe('pnpm test');
    expect(toolSummary('view', { path: 'README.md' })).toBe('README.md');
    expect(toolSummary('mystery', { a: 1, b: [2] })).toBe('{"a":1,"b":[2]}');
    expect(toolSummary('exec', 'const x = 1;\nawait y()')).toBe('const x = 1; await y()');
    const long = toolSummary('Bash', { command: 'x'.repeat(500) });
    expect(long).toHaveLength(160);
    expect(long.endsWith('…')).toBe(true);
  });

  it('the transcript builder keeps commands in the flow without counting them', () => {
    const b = transcriptBuilder();
    b.command('/model', '2026-10-21T00:00:00.000Z');
    b.prompt('ask');
    b.assistant([{ kind: 'text', text: 'a' }]);
    b.command('! pwd');
    b.assistant([{ kind: 'text', text: 'b' }]);
    expect(b.prompts).toBe(1);
    expect(b.firstPrompt).toBe('ask');
    expect(b.messages.map((m) => m.role)).toEqual([
      'command',
      'user',
      'assistant',
      'command',
      'assistant',
    ]);
    expect(b.messages[0]).toEqual({
      role: 'command',
      timestamp: '2026-10-21T00:00:00.000Z',
      blocks: [{ kind: 'text', text: '/model' }],
    });
  });

  it('a summary builder (keep false) counts prompts and keeps the first, nothing else', () => {
    const b = transcriptBuilder(false);
    b.command('/model');
    b.prompt('one');
    b.assistant([{ kind: 'text', text: 'a' }]);
    b.prompt('two');
    expect(b.prompts).toBe(2);
    expect(b.firstPrompt).toBe('one');
    expect(b.messages).toEqual([]);
  });

  it('the transcript builder merges consecutive assistant blocks into one turn', () => {
    const b = transcriptBuilder();
    b.assistant([{ kind: 'text', text: 'before' }]);
    b.prompt('one', '2026-10-21T00:00:00.000Z');
    b.assistant([{ kind: 'text', text: 'a' }], '2026-10-21T00:00:01.000Z');
    b.assistant([{ kind: 'tool', name: 'Bash', summary: 'ls' }]);
    b.assistant([]);
    b.prompt('two');
    expect(b.prompts).toBe(2);
    expect(b.firstPrompt).toBe('one');
    expect(b.messages.map((m) => [m.role, m.blocks.length])).toEqual([
      ['assistant', 1],
      ['user', 1],
      ['assistant', 2],
      ['user', 1],
    ]);
  });
});

describe('Claude Code', () => {
  it('reads slash commands, shell escapes and drops wrappers', () => {
    expect(
      claudePromptText(
        '<command-name>/review</command-name><command-message>review</command-message><command-args>  pr 12 </command-args>',
      ),
    ).toBe('/review pr 12');
    expect(
      claudePromptText('<command-name>clear</command-name><command-args></command-args>'),
    ).toBe('/clear');
    expect(claudePromptText('<bash-input>ls -la</bash-input>')).toBe('! ls -la');
    expect(claudePromptText('<local-command-stdout>done</local-command-stdout>')).toBeNull();
    expect(claudePromptText('<bash-stdout>x</bash-stdout><bash-stderr></bash-stderr>')).toBeNull();
    expect(
      claudePromptText('<system-reminder>be nice</system-reminder>\nReal ask\nCaveat: generated'),
    ).toBe('Real ask');
    expect(claudePromptText('[Request interrupted by user for tool use]')).toBeNull();
  });

  it('slash commands and shell escapes are commands, not prompts (wrapped or typed as one line)', () => {
    expect(
      claudeUserInput('<command-name>/model</command-name><command-args></command-args>'),
    ).toEqual({ kind: 'command', text: '/model' });
    expect(claudeUserInput('<bash-input>pwd</bash-input>')).toEqual({
      kind: 'command',
      text: '! pwd',
    });
    expect(claudeUserInput('/add-dir ~/repos/x')).toEqual({
      kind: 'command',
      text: '/add-dir ~/repos/x',
    });
    expect(claudeUserInput('! git status')).toEqual({ kind: 'command', text: '! git status' });
    expect(claudeUserInput('/plugin:review now')).toEqual({
      kind: 'command',
      text: '/plugin:review now',
    });
    // a path, several lines, plain text: prompts
    expect(claudeUserInput('/Users/me/app/x.ts is broken')?.kind).toBe('prompt');
    expect(claudeUserInput('/etc/hosts')?.kind).toBe('prompt');
    expect(claudeUserInput('/review\nplease look at the auth module')?.kind).toBe('prompt');
    expect(claudeUserInput('Run /model for me')?.kind).toBe('prompt');
    expect(claudeUserInput('<bash-stdout>out</bash-stdout><bash-stderr></bash-stderr>')).toBeNull();
    expect(isTypedCommand('/model')).toBe(true);
    expect(isTypedCommand('/model.ts')).toBe(false);
    expect(isTypedCommand('!')).toBe(false);
  });

  const user = (content: unknown, extra: Record<string, unknown> = {}) => ({
    type: 'user',
    timestamp: '2026-10-21T10:00:00Z',
    cwd: '/repo',
    gitBranch: 'main',
    message: { role: 'user', content },
    ...extra,
  });
  const assistant = (content: unknown, extra: Record<string, unknown> = {}) => ({
    type: 'assistant',
    timestamp: '2026-10-21T10:01:00Z',
    message: { role: 'assistant', model: 'claude-opus-5-5', content },
    ...extra,
  });

  it('keeps prompts and merged assistant turns, skips tool results, meta, sidechains and notifications', () => {
    const session = parseClaudeSession(
      lines([
        { type: 'mode', mode: 'default' },
        user('First ask'),
        assistant([{ type: 'thinking', thinking: 'hmm' }]),
        assistant([{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }]),
        user([{ type: 'tool_result', tool_use_id: 'x', content: 'out' }]),
        assistant([
          { type: 'text', text: 'Done.' },
          { type: 'redacted_thinking', data: 'x' },
        ]),
        user('meta', { isMeta: true }),
        user('side', { isSidechain: true }),
        assistant([{ type: 'text', text: 'side answer' }], { isSidechain: true }),
        user('<task-notification>x</task-notification>', { origin: { kind: 'task-notification' } }),
        user('peer says hi', { origin: { kind: 'peer' } }),
        user(
          [
            { type: 'text', text: 'Second ask' },
            { type: 'image', source: {} },
          ],
          {
            origin: { kind: 'human' },
          },
        ),
        '{"broken": ',
        assistant([{ type: 'text', text: 'ok' }], {
          message: { model: '<synthetic>', content: 'x' },
        }),
      ]),
    );
    expect(session.prompts).toBe(2);
    expect(session.firstPrompt).toBe('First ask');
    expect(session.cwd).toBe('/repo');
    expect(session.gitBranch).toBe('main');
    expect(session.model).toBe('claude-opus-5-5');
    expect(session.startedAt).toBe('2026-10-21T10:00:00.000Z');
    expect(session.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(session.messages[1]?.blocks).toEqual([
      { kind: 'thinking', text: 'hmm' },
      { kind: 'tool', name: 'Bash', summary: 'ls' },
      { kind: 'text', text: 'Done.' },
    ]);
    expect(session.messages[2]?.blocks).toEqual([
      { kind: 'text', text: 'Second ask\n\n_(image)_' },
    ]);
  });

  it('commands are neither prompts nor the first prompt; a session of commands only has no prompt', () => {
    const session = parseClaudeSession(
      lines([
        user('<command-name>/model</command-name><command-args>opus</command-args>'),
        user('<local-command-stdout>Set model to opus</local-command-stdout>'),
        user('/add-dir ~/x'),
        user('<bash-input>pwd</bash-input>'),
        user('<bash-stdout>/repo</bash-stdout><bash-stderr></bash-stderr>'),
        user('The real ask'),
        assistant([{ type: 'text', text: 'Done.' }]),
        user('! git status'),
        assistant([{ type: 'text', text: 'Clean.' }]),
      ]),
    );
    expect(session.prompts).toBe(1);
    expect(session.firstPrompt).toBe('The real ask');
    expect(session.title).toBeUndefined();
    expect(
      session.messages.map((m) => [m.role, m.blocks[0]?.kind === 'text' ? m.blocks[0].text : '']),
    ).toEqual([
      ['command', '/model opus'],
      ['command', '/add-dir ~/x'],
      ['command', '! pwd'],
      ['user', 'The real ask'],
      ['assistant', 'Done.'],
      ['command', '! git status'],
      ['assistant', 'Clean.'],
    ]);
    const commandsOnly = parseClaudeSession(
      lines([user('/model'), user('<bash-input>ls</bash-input>')]),
    );
    expect(commandsOnly.prompts).toBe(0);
    expect(isListable(commandsOnly)).toBe(false);
    // the summary parse keeps no transcript
    const summary = parseClaudeSession(
      lines([user('Ask'), assistant([{ type: 'text', text: 'A' }])]),
      {
        transcript: false,
      },
    );
    expect(summary).toMatchObject({ prompts: 1, firstPrompt: 'Ask', messages: [] });
  });

  it('titles: last custom-title, else last ai-title, else a summary line, else none', () => {
    const base = [user('ask')];
    expect(
      parseClaudeSession(
        lines([
          { type: 'ai-title', aiTitle: 'first' },
          ...base,
          { type: 'ai-title', aiTitle: 'second' },
        ]),
      ).title,
    ).toBe('second');
    expect(
      parseClaudeSession(
        lines([
          { type: 'custom-title', customTitle: 'mine' },
          { type: 'ai-title', aiTitle: 'ai' },
          ...base,
        ]),
      ).title,
    ).toBe('mine');
    expect(parseClaudeSession(lines([{ type: 'summary', summary: 'Sum' }, ...base])).title).toBe(
      'Sum',
    );
    expect(parseClaudeSession(lines(base)).title).toBeUndefined();
  });
});

describe('Codex', () => {
  it('takes the trailing uuid of a rollout file name', () => {
    expect(
      codexIdFromFileName(
        'rollout-2026-10-21T16-13-00-01a002dc-c6b7-74f0-a499-0509fca66eca.jsonl.zst',
      ),
    ).toBe('01a002dc-c6b7-74f0-a499-0509fca66eca');
    expect(codexIdFromFileName('rollout-x.jsonl')).toBeNull();
  });

  it('the session index keeps the latest name per id', () => {
    const names = parseCodexSessionIndex(
      lines([
        { id: 'a', thread_name: 'old', updated_at: '2026-10-20T00:00:00Z' },
        { id: 'a', thread_name: 'new', updated_at: '2026-10-21T00:00:00Z' },
        { id: 'a', thread_name: 'older', updated_at: '2026-10-19T00:00:00Z' },
        { id: 'b', thread_name: 'b  name' },
        { id: 'c' },
      ]),
    );
    expect([...names]).toEqual([
      ['a', 'new'],
      ['b', 'b name'],
    ]);
  });

  it('recognizes injected context', () => {
    expect(isInjectedContext('<environment_context>\n<cwd>/x</cwd>\n</environment_context>')).toBe(
      true,
    );
    expect(isInjectedContext('# AGENTS.md instructions for /x\n\nbe brief')).toBe(true);
    expect(isInjectedContext('<permissions instructions>x')).toBe(true);
    expect(isInjectedContext('<skill name="x">body</skill>')).toBe(true);
    expect(isInjectedContext('Use <b>bold</b> here')).toBe(false);
    expect(isInjectedContext('<b>start</b> and more')).toBe(false);
  });

  const meta = (extra: Record<string, unknown> = {}) => ({
    timestamp: '2026-10-21T09:00:00Z',
    type: 'session_meta',
    payload: {
      id: 'id-1',
      timestamp: '2026-10-21T09:00:00Z',
      cwd: '/w',
      git: { branch: 'dev' },
      ...extra,
    },
  });
  const item = (payload: Record<string, unknown>) => ({
    timestamp: '2026-10-21T09:01:00Z',
    type: 'response_item',
    payload,
  });
  const userItem = (text: string) =>
    item({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });

  it('prefers the exact event prompts and never counts a prompt twice', () => {
    const session = parseCodexSession(
      lines([
        meta(),
        { type: 'turn_context', payload: { model: 'gpt-5.5' } },
        userItem('<environment_context>x</environment_context>'),
        userItem('Ask one'),
        { type: 'event_msg', payload: { type: 'user_message', message: 'Ask one' } },
        item({
          type: 'reasoning',
          summary: [{ type: 'summary_text', text: 'think' }],
          encrypted_content: 'z',
        }),
        item({ type: 'function_call', name: 'shell', arguments: '{"command":["ls","-a"]}' }),
        item({ type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch' }),
        item({ type: 'local_shell_call', action: { command: ['git', 'diff'] } }),
        item({
          type: 'agent_message',
          content: [{ type: 'output_text', text: 'plain agent text' }],
        }),
        item({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Answer' }],
        }),
        userItem('Ask two'),
        {
          type: 'event_msg',
          payload: {
            type: 'item_completed',
            item: { type: 'UserMessage', content: [{ type: 'text', text: 'Ask two' }] },
          },
        },
      ]),
      new Map([['id-1', 'Thread name']]),
    );
    expect(session.prompts).toBe(2);
    expect(session.title).toBe('Thread name');
    expect(session.id).toBe('id-1');
    expect(session.model).toBe('gpt-5.5');
    expect(session.cwd).toBe('/w');
    expect(session.gitBranch).toBe('dev');
    expect(session.subagent).toBeUndefined();
    expect(session.messages[1]?.blocks).toEqual([
      { kind: 'thinking', text: 'think' },
      { kind: 'tool', name: 'shell', summary: 'ls -a' },
      { kind: 'tool', name: 'apply_patch', summary: '*** Begin Patch' },
      { kind: 'tool', name: 'shell', summary: 'git diff' },
      { kind: 'text', text: 'plain agent text' },
      { kind: 'text', text: 'Answer' },
    ]);
  });

  it('falls back to the response_item prompts when the file has no prompt events', () => {
    const session = parseCodexSession(
      lines([meta(), userItem('Only copy'), userItem('# AGENTS.md instructions for /w')]),
    );
    expect(session.prompts).toBe(1);
    expect(session.firstPrompt).toBe('Only copy');
    expect(session.title).toBeUndefined();
  });

  it('marks subagent threads', () => {
    expect(parseCodexSession(lines([meta({ parent_thread_id: 'p' })])).subagent).toBe(true);
    expect(
      parseCodexSession(lines([meta({ source: { subagent: { other: 'x' } } })])).subagent,
    ).toBe(true);
    expect(parseCodexSession(lines([meta({ thread_source: 'guardian_review' })])).subagent).toBe(
      true,
    );
    expect(
      parseCodexSession(lines([meta({ thread_source: 'user', parent_thread_id: null })])).subagent,
    ).toBeUndefined();
  });

  it('reads the older layout without the payload wrapper', () => {
    const session = parseCodexSession(
      lines([
        { id: 'legacy-id', timestamp: '2026-01-01T00:00:00Z', instructions: '' },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Legacy ask' }] },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Legacy answer' }],
        },
      ]),
    );
    expect(session.id).toBe('legacy-id');
    expect(session.prompts).toBe(1);
    expect(session.messages.at(-1)?.blocks).toEqual([{ kind: 'text', text: 'Legacy answer' }]);
  });
});

describe('GitHub Copilot CLI', () => {
  it('parses workspace.yaml defensively', () => {
    expect(
      parseCopilotWorkspace('cwd: /w\nbranch: b\nsummary: Sum\ncreated_at: 2026-10-21T00:00:00Z\n'),
    ).toEqual({ cwd: '/w', branch: 'b', summary: 'Sum', createdAt: '2026-10-21T00:00:00.000Z' });
    expect(parseCopilotWorkspace(': : [')).toEqual({});
    expect(parseCopilotWorkspace(undefined)).toEqual({});
  });

  it('reads prompts, replies, reasoning and tool calls; leaves subagent events out', () => {
    const ev = (type: string, data: Record<string, unknown>) => ({
      type,
      data,
      timestamp: '2026-10-21T08:00:00Z',
    });
    const session = parseCopilotSession(
      lines([
        ev('session.start', {
          startTime: '2026-10-21T07:59:00Z',
          context: { cwd: '/ctx', branch: 'b1' },
        }),
        ev('session.model_change', { newModel: 'm1' }),
        ev('user.message', { content: '  Do it  ' }),
        ev('assistant.reasoning', { content: 'why' }),
        ev('assistant.message', {
          content: 'Working.',
          toolRequests: [{ toolCallId: 'a', name: 'bash', arguments: { command: 'make' } }],
        }),
        ev('tool.execution_start', {
          toolCallId: 'a',
          toolName: 'bash',
          arguments: { command: 'make' },
        }),
        ev('tool.execution_start', {
          toolCallId: 'b',
          toolName: 'view',
          arguments: { path: 'x.md' },
        }),
        ev('tool.execution_start', {
          toolCallId: 'c',
          toolName: 'view',
          arguments: { path: 'y' },
          parentToolCallId: 'p',
        }),
        ev('assistant.message', { content: 'sub', parentToolCallId: 'p' }),
      ]),
      { summary: 'From workspace', cwd: '/ws' },
    );
    expect(session.title).toBe('From workspace');
    expect(session.cwd).toBe('/ws');
    expect(session.gitBranch).toBe('b1');
    expect(session.model).toBe('m1');
    expect(session.startedAt).toBe('2026-10-21T07:59:00.000Z');
    expect(session.firstPrompt).toBe('Do it');
    expect(session.messages[1]?.blocks).toEqual([
      { kind: 'thinking', text: 'why' },
      { kind: 'text', text: 'Working.' },
      { kind: 'tool', name: 'bash', summary: 'make' },
      { kind: 'tool', name: 'view', summary: 'x.md' },
    ]);
  });
});

describe('VS Code chat', () => {
  it('replays a mutation log: set, append (with truncation), delete; bad ops are skipped', () => {
    const state = replayVscodeLog(
      lines([
        { kind: 1, k: ['before'], v: 1 },
        { kind: 0, v: { sessionId: 's', requests: [], keep: { a: 1, b: 2 } } },
        { kind: 2, k: ['requests'], v: [{ message: { text: 'q1' }, response: [] }] },
        { kind: 2, k: ['requests', 0, 'response'], v: [{ value: 'a' }, { value: 'b' }] },
        { kind: 2, k: ['requests', 0, 'response'], i: 1, v: [{ value: 'c' }] },
        { kind: 1, k: ['customTitle'], v: 'T' },
        { kind: 1, k: ['deep', 'path', 0], v: 'x' },
        { kind: 3, k: ['keep', 'a'] },
        { kind: 2, k: ['fresh'], v: [1] },
        { kind: 1, k: 'not-a-path', v: 1 },
        { kind: 9, k: ['x'] },
        '{torn',
      ]),
    );
    expect(state).toEqual({
      sessionId: 's',
      requests: [{ message: { text: 'q1' }, response: [{ value: 'a' }, { value: 'c' }] }],
      keep: { b: 2 },
      customTitle: 'T',
      deep: { path: ['x'] },
      fresh: [1],
    });
    expect(replayVscodeLog('{"kind":1,"k":["a"],"v":1}')).toBeNull();
  });

  it('a replay leaves out the request keys nothing reads (attachments, result metadata, the input box)', () => {
    const state = replayVscodeLog(
      lines([
        {
          kind: 0,
          v: {
            sessionId: 's',
            requests: [
              { message: { text: 'q' }, variableData: { variables: [1] }, result: { t: 1 } },
            ],
            inputState: { attachments: [] },
          },
        },
        { kind: 1, k: ['requests', 0, 'result'], v: { timings: {} } },
        { kind: 1, k: ['requests', 0, 'variableData', 'variables'], v: [2] },
        {
          kind: 2,
          k: ['requests'],
          v: [{ message: { text: 'r' }, followups: [], response: [{ value: 'x' }] }],
        },
        { kind: 1, k: ['requests', 1, 'response', 0, 'value'], v: 'y' },
      ]),
    );
    expect(state).toEqual({
      sessionId: 's',
      requests: [
        { message: { text: 'q' } },
        { message: { text: 'r' }, response: [{ value: 'y' }] },
      ],
      inputState: { attachments: [] },
    });
  });

  it('stripJsonKeys drops members at any depth without parsing; strings never match', () => {
    const enc = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
    const keys = new Set(['variableData', 'result']);
    const cases: [unknown, unknown][] = [
      [
        { a: 1, variableData: { x: [1, '"}]', { y: 'variableData' }] }, b: 2 },
        { a: 1, b: 2 },
      ],
      [{ variableData: 1 }, {}],
      [
        { a: 'say "variableData": 1', result: null, c: [{ result: 'x' }, { d: true }] },
        { a: 'say "variableData": 1', c: [{}, { d: true }] },
      ],
      [
        { m: { text: 'hi \\"q' }, variableData: { v: 's\\' }, result: { t: 1 } },
        { m: { text: 'hi \\"q' } },
      ],
      [{ result: [1, 2], variableData: 'é ü 😀', z: 'ü' }, { z: 'ü' }],
    ];
    for (const [input, expected] of cases) {
      expect(JSON.parse(dec(stripJsonKeys(enc(input), keys)))).toEqual(expected);
    }
    expect(
      dec(stripJsonKeys(new TextEncoder().encode('{"a": 1 , "result" : {"x": 2} }'), keys)),
    ).toBe('{"a": 1  }');
    const torn = new TextEncoder().encode('{"a":"torn');
    expect(stripJsonKeys(torn, keys)).toBe(torn);
  });

  it('vscodeLogLine skips big operations on unread keys and strips big lines; small lines pass as they are', () => {
    const enc = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    const big = 'x'.repeat(70 * 1024);
    expect(vscodeLogLine(enc({ kind: 1, k: ['requests', 0, 'result'], v: { big } }))).toBeNull();
    expect(vscodeLogLine(enc({ kind: 1, k: ['inputState', 'attachments'], v: [big] }))).toBeNull();
    const append = vscodeLogLine(
      enc({ kind: 2, k: ['requests'], v: [{ message: { text: 'q' }, variableData: { big } }] }),
    );
    expect(JSON.parse(append ?? '')).toEqual({
      kind: 2,
      k: ['requests'],
      v: [{ message: { text: 'q' } }],
    });
    const small = { kind: 1, k: ['requests', 0, 'result'], v: 1 };
    expect(vscodeLogLine(enc(small))).toBe(JSON.stringify(small));
    // a whole .json state, stripped the same way
    expect(
      vscodeJsonState(
        enc({ sessionId: 's', requests: [{ message: { text: 'q' }, result: { big } }] }),
      ),
    ).toEqual({ sessionId: 's', requests: [{ message: { text: 'q' } }] });
    expect(vscodeJsonState(new TextEncoder().encode('{"sessionId":"s"}\n{torn'))).toEqual({
      sessionId: 's',
    });
    expect(vscodeJsonState(new TextEncoder().encode('nope'))).toBeNull();
  });

  it('the last activity: the later of lastMessageDate and the last request; a tail by pattern', () => {
    const session = parseVscodeSession({
      lastMessageDate: Date.UTC(2026, 9, 21, 7, 0),
      requests: [{ message: { text: 'q' }, timestamp: Date.UTC(2026, 9, 21, 8, 0), response: [] }],
    });
    expect(session.endedAt).toBe('2026-10-21T08:00:00.000Z');
    expect(
      lastVscodeActivity(
        `"timestamp":${Date.UTC(2026, 9, 1)},"x":1}\n{"kind":1,"k":["lastMessageDate"],"v":${Date.UTC(2026, 9, 2)}}`,
      ),
    ).toBe('2026-10-02T00:00:00.000Z');
    expect(
      lastVscodeActivity(
        `{"timestamp":${Date.UTC(2026, 9, 1)},"lastMessageDate": ${Date.UTC(2026, 9, 3)}}`,
      ),
    ).toBe('2026-10-03T00:00:00.000Z');
    expect(lastVscodeActivity('nothing here')).toBeUndefined();
  });

  it('turns workspace URIs into display paths', () => {
    expect(vscodeWorkspaceFolder('{"folder":"file:///Users/me/my%20app"}')).toBe(
      '/Users/me/my app',
    );
    expect(vscodeWorkspaceFolder('{"workspace":"file:///c%3A/work/x.code-workspace"}')).toBe(
      'c:/work/x.code-workspace',
    );
    expect(vscodeWorkspaceFolder('{"folder":"vscode-remote://ssh-remote%2Bbox/home/me"}')).toBe(
      'vscode-remote://ssh-remote+box/home/me',
    );
    expect(vscodeWorkspaceFolder('nope')).toBeUndefined();
    expect(uriToDisplay('file://server/share/x')).toBe('/share/x');
  });

  it('parses requests: markdown chunks joined, references, thinking by id, tool summaries', () => {
    const session = parseVscodeSession(
      {
        sessionId: 's',
        creationDate: Date.UTC(2026, 9, 21, 7),
        customTitle: 'Custom',
        requests: [
          {
            message: { text: 'Ask' },
            timestamp: Date.UTC(2026, 9, 21, 7, 1),
            modelId: 'copilot/x',
            response: [
              { value: 'See ' },
              { kind: 'inlineReference', inlineReference: { path: '/w/a.ts' } },
              { value: ' now.' },
              { kind: 'thinking', value: 'one ', id: 't1' },
              { kind: 'thinking', value: 'thought', id: 't1' },
              { kind: 'thinking', value: 'second', id: 't2' },
              { kind: 'thinking', value: [] },
              {
                kind: 'toolInvocationSerialized',
                toolId: 'copilot_readFile',
                invocationMessage: { value: 'Reading [](file:///w/b.ts#1-5), [label](x)' },
              },
              {
                kind: 'toolInvocationSerialized',
                toolId: 'sub',
                invocationMessage: 'x',
                fromSubAgent: true,
              },
              { kind: 'textEditGroup', edits: [] },
              { value: 'Done.' },
            ],
          },
          { message: { text: '   ' }, response: [] },
        ],
      },
      '/w',
    );
    expect(session.title).toBe('Custom');
    expect(session.prompts).toBe(1);
    expect(session.model).toBe('copilot/x');
    expect(session.cwd).toBe('/w');
    expect(session.startedAt).toBe('2026-10-21T07:00:00.000Z');
    expect(session.messages[1]?.blocks).toEqual([
      { kind: 'text', text: 'See `a.ts` now.' },
      { kind: 'thinking', text: 'one thought' },
      { kind: 'thinking', text: 'second' },
      { kind: 'tool', name: 'copilot_readFile', summary: 'Reading b.ts, label' },
      { kind: 'text', text: 'Done.' },
    ]);
  });

  it('summarizes a head that is not valid JSON by pattern', () => {
    const head = `{"version":3,"customTitle":"Big one","creationDate":${Date.UTC(2026, 9, 1)},"requests":[{"requestId":"r","message":{"parts":[{"text":"Hello \\"there\\""}],"text":"Hello \\"there\\""},"modelId":"copilot/y","response":[{"value":"tru`;
    const session = scanVscodeHead(head, '/w');
    expect(session.title).toBe('Big one');
    expect(session.firstPrompt).toBe('Hello "there"');
    expect(session.model).toBe('copilot/y');
    expect(session.startedAt).toBe('2026-10-01T00:00:00.000Z');
  });
});
