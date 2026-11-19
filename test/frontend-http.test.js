import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

test('release #5: expired SSO on reads, bootstrap and mutations gives the reload message', async (t) => {
  const source = stripTypeScriptTypes(fs.readFileSync(new URL('../web/src/api/http.ts', import.meta.url), 'utf8'));
  let instance = 0;
  const fresh = () => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${instance++}`);
  const expired = /Anmeldung abgelaufen – Seite neu laden/;
  for (const response of [
    new Response('<html>SSO</html>', { headers: { 'Content-Type': 'text/html' } }),
    { type: 'opaqueredirect', ok: false },
    { type: 'basic', redirected: true, ok: true },
  ]) {
    t.mock.method(globalThis, 'fetch', async () => response);
    const { httpApi } = await fresh();
    await assert.rejects(httpApi.getOverview(), expired);
    await assert.rejects(httpApi.updateSettings({}), expired);
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, 'fetch', async (url) => url === '/api/v1/bootstrap'
    ? Response.json({ csrf: 'fixture-token' })
    : new Response('<html>SSO</html>', { status: 403, headers: { 'Content-Type': 'text/html' } }));
  const { httpApi } = await fresh();
  await assert.rejects(httpApi.updateSettings({}), expired);
  t.mock.restoreAll();
  let bootstrap = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === '/api/v1/bootstrap') return Response.json({ csrf: `fixture-${++bootstrap}` });
    return init.headers['X-CSRF-Token'] === 'fixture-1'
      ? Response.json({ code: 'csrf' }, { status: 403 }) : Response.json({ saved: true });
  });
  const api = (await fresh()).httpApi;
  assert.deepEqual(await api.updateSettings({}), { saved: true });
  assert.equal(bootstrap, 2);
});
