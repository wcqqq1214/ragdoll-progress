import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs real DOM/layout tests in an isolated Chrome profile; no npm dependencies.
const chromePath = process.env.CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = new URL('../', import.meta.url);
const source = await readFile(new URL('src/content.js', root), 'utf8');
const styles = await readFile(new URL('src/content.css', root), 'utf8');
const tests = await readFile(new URL('tests/content.browser.js', root), 'utf8');
const temporary = await mkdtemp(join(tmpdir(), 'ragdoll-tests-'));
try {
  const html = join(temporary, 'tests.html');
  await writeFile(html, `<!doctype html><meta charset="utf-8"><style>${styles}</style><body>
    <pre id="results">RUNNING</pre><script>
    const extensionSource = ${JSON.stringify(source).replaceAll('<', '\\u003c')};
    ${tests}
    </script></body>`);
  const { stdout } = await promisify(execFile)(chromePath, [
    '--headless', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', `--user-data-dir=${join(temporary, 'profile')}`,
    '--virtual-time-budget=3000', '--dump-dom', `file://${html}`
  ], { timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  const result = stdout.match(/<pre id="results">([\s\S]*?)<\/pre>/)?.[1];
  if (!result || result === 'RUNNING') throw new Error('Browser tests did not finish');
  console.log(result);
  if (result.includes('FAIL')) process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
