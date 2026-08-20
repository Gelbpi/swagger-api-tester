import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const allowedBuiltins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

describe('esbuild bundle (build-prompt §47)', () => {
  it('leaves no unresolved bare runtime imports — only node builtins are external', async () => {
    // The metafile is the authoritative record of what esbuild actually left
    // external (as opposed to string literals in dependency source, e.g. ajv's
    // standalone codegen, which are not real imports).
    const result = await build({
      entryPoints: [resolve(root, 'src/mcp/bin.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      write: false,
      metafile: true,
      banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    });

    const external = new Set<string>();
    for (const out of Object.values(result.metafile.outputs)) {
      for (const imp of out.imports) {
        if (imp.external) external.add(imp.path);
      }
    }

    const unresolved = [...external].filter((p) => !allowedBuiltins.has(p));
    expect(unresolved).toEqual([]);
    // Sanity: everything is inlined into a single output file.
    expect(result.outputFiles).toHaveLength(1);
  }, 30_000);

  it('bundled schema validation works without node_modules present', async () => {
    // Bundle a tiny entry that exercises ajv, then eval it with require() pointed
    // at an empty dir so any leftover runtime require() of a dependency would throw.
    const entry = `import { SchemaValidator } from ${JSON.stringify(resolve(root, 'src/engine/validation/schemaValidator.js'))};
      const v = new SchemaValidator();
      const ok = v.validate({ type: 'object', required: ['id'], properties: { id: { type: 'integer' }, email: { type: 'string', format: 'email' } } }, { id: 1, email: 'a@b.com' });
      const bad = v.validate({ type: 'string', format: 'email' }, 'nope');
      globalThis.__PROBE__ = ok.valid === true && bad.valid === false;`;
    const result = await build({
      stdin: { contents: entry, resolveDir: root, loader: 'ts' },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node20',
      write: false,
    });
    const code = result.outputFiles[0]!.text;
    // Run the bundle with a require() that ONLY resolves node builtins; any
    // leftover runtime require() of a bundled dependency would throw.
    const { createRequire } = await import('node:module');
    const realRequire = createRequire(import.meta.url);
    const guardedRequire = (id: string): unknown => {
      if (!allowedBuiltins.has(id)) throw new Error(`unexpected runtime require of "${id}"`);
      return realRequire(id);
    };
    const runner = new Function('require', 'module', 'exports', code);
    runner(guardedRequire, { exports: {} }, {});
    expect((globalThis as { __PROBE__?: boolean }).__PROBE__).toBe(true);
  }, 30_000);
});
