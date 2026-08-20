import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testEndpoint } from '../../src/engine/execution/testEndpoint.js';
import { testAll } from '../../src/engine/execution/testAll.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const jarPath = join(repoRoot, 'test/fixtures/springboot/target/springboot-fixture.jar');

// Runs only when the fixture jar is built; skips otherwise so `npm test` still
// passes without a JDK/Maven toolchain.
const hasJar = existsSync(jarPath);

/** Resolve the actual bound port from the Spring Boot startup log. */
function waitForPort(child: ChildProcessWithoutNullStreams): Promise<number> {
  return new Promise((resolvePort, reject) => {
    let buf = '';
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error('Spring Boot did not report a port within 60s'))),
      60_000,
    );
    const onData = (d: Buffer): void => {
      buf += d.toString();
      // Match ONLY the actual bind line, never "Tomcat initialized with port 0".
      const m = /Tomcat started on port[^\d]*(\d+)/i.exec(buf);
      if (m && Number(m[1]) > 0) finish(() => resolvePort(Number(m[1])));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) =>
      finish(() => reject(new Error(`Spring Boot exited before binding a port (code ${code ?? 'null'})`))),
    );
  });
}

describe.skipIf(!hasJar)('engine against REAL Spring Boot + springdoc — MILESTONE 1', () => {
  let child: ChildProcessWithoutNullStreams | undefined;
  let projectDir: string;
  let root: string;

  beforeAll(async () => {
    // Random port (0) => fully isolated, never collides with a leftover process.
    child = spawn('java', ['-jar', jarPath, '--server.port=0'], { cwd: repoRoot });
    const port = await waitForPort(child);

    // Build a throwaway "Spring Boot project" whose application.properties carries
    // the ACTUAL bound port, so zero-config auto-detection resolves to it.
    root = mkdtempSync(join(tmpdir(), 'apitester-spring-'));
    projectDir = join(root, 'proj');
    mkdirSync(join(projectDir, 'src', 'main', 'resources'), { recursive: true });
    writeFileSync(
      join(projectDir, 'pom.xml'),
      '<project><dependencies><dependency><groupId>org.springframework.boot</groupId></dependency></dependencies></project>',
    );
    writeFileSync(
      join(projectDir, 'src', 'main', 'resources', 'application.properties'),
      `server.port=${port}\n`,
    );
  }, 70_000);

  afterAll(() => {
    try {
      child?.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('discovers everything from the project with NO .api-tester/config.json (zero-config)', async () => {
    const dataDir = join(root, 'data-endpoint');
    const byId = await testEndpoint({ method: 'GET', path: '/api/users/{id}', project: projectDir, dataDir });
    expect(byId.compact.outcome).toBe('PASS');
    expect(byId.compact.actualStatus).toBe(200);
  });

  it('test_all (zero-config) runs read-only by default and skips the writes', async () => {
    const dataDir = join(root, 'data-all');
    const { summary } = await testAll({ project: projectDir, dataDir });
    expect(summary.totals.total).toBe(4); // list, byId, post, delete
    expect(summary.totals.passed).toBeGreaterThanOrEqual(2);
    expect(summary.totals.skipped).toBeGreaterThanOrEqual(2);
  });
});
