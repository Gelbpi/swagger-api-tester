/**
 * Teardown: compensating DELETEs after a mutation run (review item #11).
 *
 * ONLY deletes resources the tester itself created (ids captured from POST
 * responses), and ONLY via the API's own documented DELETE endpoint. It never
 * touches a database directly and never deletes anything it didn't create.
 * Runs in reverse creation order, sequentially. Honors the target guard and the
 * configured auth. A 404 is treated as success (already gone / idempotent).
 */
import type { Endpoint } from '../types/endpoint.js';
import type { CreatedResource, TeardownResult } from '../types/run.js';
import type { HttpFetchImpl } from '../types/http.js';
import type { EngineContext } from './context.js';
import { buildRequest } from '../generation/requestBuilder.js';
import { applyAuthMaterial, AuthError } from '../auth/authManager.js';
import { assertTargetAllowed } from '../http/targetGuard.js';
import { sendRequest, HttpClientError } from '../http/httpClient.js';
import { EngineError } from '../types/errors.js';

function segments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

function isParamSeg(seg: string): boolean {
  return /^\{.+\}$/.test(seg) || /^:.+/.test(seg);
}

function paramName(seg: string): string {
  return seg.replace(/^[:{]/, '').replace(/\}$/, '');
}

/** A DELETE endpoint that removes an item of the given collection (path + /{id}). */
function findItemDelete(registry: EngineContext['registry'], collectionPath: string): Endpoint | undefined {
  const cs = segments(collectionPath);
  return registry.list().find((e) => {
    if (e.method !== 'DELETE') return false;
    const ds = segments(e.path);
    return ds.length === cs.length + 1 && cs.every((s, i) => s === ds[i]) && isParamSeg(ds[ds.length - 1]!);
  });
}

export interface TeardownOptions {
  authProfile?: string;
  httpFetchImpl?: HttpFetchImpl;
}

export async function runTeardown(
  ctx: EngineContext,
  created: CreatedResource[],
  opts: TeardownOptions = {},
): Promise<TeardownResult[]> {
  const results: TeardownResult[] = [];
  const profileName = opts.authProfile ?? ctx.settings.defaultAuthProfile;

  // Reverse creation order (LIFO): delete children before parents.
  for (const resource of [...created].reverse()) {
    const deleteEp = findItemDelete(ctx.registry, resource.collectionPath);
    if (!deleteEp) {
      results.push({
        method: 'DELETE',
        path: `${resource.collectionPath}/{id}`,
        status: null,
        ok: false,
        note: 'no matching DELETE endpoint — cannot clean up',
      });
      continue;
    }
    const param = paramName(segments(deleteEp.path)[segments(deleteEp.path).length - 1]!);

    const build = buildRequest({
      endpoint: deleteEp,
      baseUrl: ctx.baseUrl,
      explicit: { pathParams: { [param]: resource.id } },
      validator: ctx.validator,
    });
    if (!build.ok) {
      results.push({ method: 'DELETE', path: deleteEp.path, status: null, ok: false, note: build.explanation });
      continue;
    }
    const request = build.request;

    try {
      const material = await ctx.authManager.resolve(profileName);
      applyAuthMaterial(material, request.headers, request.query);
      const qs = new URLSearchParams(request.query).toString();
      request.url = `${ctx.baseUrl.replace(/\/$/, '')}${request.path}${qs ? `?${qs}` : ''}`;

      assertTargetAllowed(request.url, {
        ...(ctx.settings.allowRemoteTargets !== undefined ? { allowRemoteTargets: ctx.settings.allowRemoteTargets } : {}),
        env: ctx.env,
      });

      const res = await sendRequest(
        {
          method: 'DELETE',
          url: request.url,
          headers: request.headers,
          timeoutMs: ctx.settings.timeoutMs ?? 10_000,
        },
        opts.httpFetchImpl ? { fetchImpl: opts.httpFetchImpl } : {},
      );
      const ok = res.status === 200 || res.status === 202 || res.status === 204 || res.status === 404;
      results.push({
        method: 'DELETE',
        path: request.path,
        status: res.status,
        ok,
        ...(res.status === 404 ? { note: 'already gone (404) — treated as clean' } : {}),
      });
    } catch (err) {
      const note =
        err instanceof AuthError || err instanceof EngineError || err instanceof HttpClientError
          ? err.message
          : String(err);
      results.push({ method: 'DELETE', path: request.path, status: null, ok: false, note });
    }
  }
  return results;
}
