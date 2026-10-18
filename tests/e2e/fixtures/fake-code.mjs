#!/usr/bin/env node
// Stand-in for the VS Code `code` command (api-ide.spec.ts). prepare-data.ts copies it to
// .tmp/e2e-ide/fake-code and the dev server runs it through CTXMAN_IDE_COMMAND: it records its argv as one
// JSON line in the file named by CTXMAN_IDE_RECORD and opens nothing.
import { appendFileSync } from 'node:fs';

appendFileSync(process.env.CTXMAN_IDE_RECORD, `${JSON.stringify(process.argv.slice(2))}\n`);
