import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoDetectProject } from '../../src/engine/project/autoDetect.js';

let root: string;
function project(name: string, files: Record<string, string>): string {
  const dir = join(root, name);
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'apitester-autodetect-'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const SPRING_POM = '<project><dependencies><dependency><groupId>org.springframework.boot</groupId></dependency></dependencies></project>';

describe('autoDetectProject (zero-config Spring Boot)', () => {
  it('reads port + context-path + springdoc path from application.properties', () => {
    const dir = project('props', {
      'pom.xml': SPRING_POM,
      'src/main/resources/application.properties':
        'server.port=9090\nserver.servlet.context-path=/api\nspringdoc.api-docs.path=/docs\n',
    });
    const d = autoDetectProject(dir);
    expect(d.framework).toBe('spring-boot');
    expect(d.baseUrl).toBe('http://localhost:9090/api');
    expect(d.openApiUrl).toBe('http://localhost:9090/api/docs');
  });

  it('uses defaults (8080, /v3/api-docs) when only a spring pom exists', () => {
    const dir = project('defaults', { 'pom.xml': SPRING_POM });
    const d = autoDetectProject(dir);
    expect(d.baseUrl).toBe('http://localhost:8080');
    expect(d.openApiUrl).toBe('http://localhost:8080/v3/api-docs');
  });

  it('reads nested keys from application.yml', () => {
    const dir = project('yaml', {
      'build.gradle': "implementation 'org.springframework.boot:spring-boot-starter-web'",
      'src/main/resources/application.yml': 'server:\n  port: 7000\n  servlet:\n    context-path: /v1\n',
    });
    const d = autoDetectProject(dir);
    expect(d.baseUrl).toBe('http://localhost:7000/v1');
  });

  it('ignores env-placeholder / random ports and falls back to 8080', () => {
    const dir = project('placeholder', {
      'pom.xml': SPRING_POM,
      'src/main/resources/application.properties': 'server.port=${PORT:8080}\n',
    });
    expect(autoDetectProject(dir).baseUrl).toBe('http://localhost:8080');
  });

  it('detects Quarkus (quarkus.http.port, /q/openapi)', () => {
    const dir = project('quarkus', {
      'pom.xml': '<project><dependency><groupId>io.quarkus</groupId></dependency></project>',
      'src/main/resources/application.properties': 'quarkus.http.port=8081\n',
    });
    const d = autoDetectProject(dir);
    expect(d.framework).toBe('quarkus');
    expect(d.baseUrl).toBe('http://localhost:8081');
    expect(d.openApiUrl).toBe('http://localhost:8081/q/openapi');
  });

  it('detects Micronaut (micronaut.server.port)', () => {
    const dir = project('micronaut', {
      'build.gradle': "implementation('io.micronaut:micronaut-http-server-netty')",
      'src/main/resources/application.yml': 'micronaut:\n  server:\n    port: 8082\n',
    });
    const d = autoDetectProject(dir);
    expect(d.framework).toBe('micronaut');
    expect(d.baseUrl).toBe('http://localhost:8082');
  });

  it('falls back to a PORT from a .env file', () => {
    const dir = project('dotenv', {
      'pom.xml': SPRING_POM,
      '.env': 'PORT=5000\n',
    });
    expect(autoDetectProject(dir).baseUrl).toBe('http://localhost:5000');
  });

  it('returns unknown for a non-Spring project', () => {
    const dir = project('node', { 'package.json': '{}' });
    const d = autoDetectProject(dir);
    expect(d.framework).toBe('unknown');
    expect(d.baseUrl).toBeUndefined();
  });
});
