// Fixture for run-script.test.ts: echoes its argv/env as JSON on stdout, writes ANSI-colored text to
// both streams, optionally floods stdout (`--flood`) and exits with the code given by `--exit=<n>`.
const args = process.argv.slice(2);
const exitArg = args.find((a) => a.startsWith('--exit='));

if (args.includes('--flood')) {
  process.stdout.write('x'.repeat(2 * 1024 * 1024));
} else {
  process.stdout.write(
    `${JSON.stringify({
      args,
      cwd: process.cwd(),
      dataDir: process.env.CTXMAN_DATA_DIR,
      noColor: process.env.NO_COLOR,
      forceColor: process.env.FORCE_COLOR,
    })}\n`,
  );
  process.stdout.write('\u001b[32mgreen\u001b[0m out\n');
  process.stderr.write('\u001b[31mred\u001b[0m err\n');
}
process.exitCode = exitArg === undefined ? 0 : Number(exitArg.slice('--exit='.length));
