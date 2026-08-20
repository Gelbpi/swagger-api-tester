import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEndpoint } from '../../src/engine/execution/testEndpoint.js';
import { testAll } from '../../src/engine/execution/testAll.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureDir = join(repoRoot, 'test/fixtures/springboot');
const jarPath = join(fixtureDir, 'target/springboot-fixture.jar');

// Runs only when the fixture jar is built; skips otherwise so `npm test` still
// passes without a JDK/Maven toolchain.
const hasJar = existsSync(jarPath);

function waitForPort(child: ChildProcessWithoutNullStreams): Promise<number> {
  return new Promise((resolvePort, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('spring boot did not start in time')), 60_000);
    const onData = (d: Buffer): void => {
      buf += d.toString();
      // Match ONLY the actual bind line, never "Tomcat initialized with port 0".
      const m = /Tomcat started on port[^\d]*(\d+)/i.exec(buf);
      if (m && Number(m[1]) > 0) {
        clearTimeout(timer);
        resolvePort(Number(m[1]));
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => reject(new Error(`spring boot exited early (${code})`)));
  });
}

describe.skipIf(!hasJar)('engine against REAL Spring Boot + springdoc — MILESTONE 1', () => {
  let child: ChildProcessWithoutNullStreams;
  let port: number;

  beforeAll(async () => {
    // Start on the port declared in application.properties (8080) so ZERO-CONFIG
    // auto-detection (which reads that same file) points at the right place.
    child = spawn('java', ['-jar', jarPath], { cwd: repoRoot });
    port = await waitForPort(child);
  }, 70_000);

  afterAll(() => {
    child?.kill('SIGTERM');
  });

  it('discovers everything from the project with NO .api-tester/config.json (zero-config)', async () => {
    expect(port).toBe(8080); // matches application.properties -> auto-detected baseUrl
    // We point straight at the Spring Boot project dir; there is no config file.
    const byId = await testEndpoint({ method: 'GET', path: '/api/users/{id}', project: fixtureDir });
    expect(byId.compact.outcome).toBe('PASS');
    expect(byId.compact.actualStatus).toBe(200);
  });

  it('test_all (zero-config) runs read-only by default and skips the writes', async () => {
    const { summary } = await testAll({ project: fixtureDir });
    expect(summary.totals.total).toBe(4); // list, byId, post, delete
    expect(summary.totals.passed).toBeGreaterThanOrEqual(2);
    expect(summary.totals.skipped).toBeGreaterThanOrEqual(2);
  });
});
