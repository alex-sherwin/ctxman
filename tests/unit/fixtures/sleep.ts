// Fixture for run-script.test.ts: prints a line, then stays alive far longer than any test timeout so
// the runner's timeout -> kill path (exit code 124) is exercised. Run directly by Node (type stripping).
process.stdout.write('sleeping\n');
setTimeout(() => undefined, 60_000);
