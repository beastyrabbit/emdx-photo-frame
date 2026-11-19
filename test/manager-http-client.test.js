import { test } from 'node:test';
import assert from 'node:assert/strict';

test('S15 mutations and uploads refresh a stale CSRF token once, without retrying other failures', async (t) => {
  const { httpApi, uploadPictures } = await import('../web/src/api/http.ts');
  let current = 'first';
  let bootstrap = 0;
  let attempts = 0;
  let writes = 0;
  let reject = null;
  const uploaded = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url === '/api/v1/bootstrap') {
      bootstrap++;
      return Response.json({ csrf: current });
    }
    attempts++;
    if (reject) return Response.json({ error: 'Refused', ...reject }, { status: 403 });
    if (init.headers['X-CSRF-Token'] !== current)
      return Response.json({ code: 'csrf', error: 'Sitzung erneuern' }, { status: 403 });
    writes++;
    if (url === '/api/v1/uploads') uploaded.push(init.body.get('files').name);
    return Response.json(url === '/api/v1/uploads' ? { results: [] } : null);
  });
  await httpApi.updateSettings({ autoAccept: false });
  current = 'after-restart';
  await httpApi.updateSettings({ autoAccept: true });
  assert.equal(bootstrap, 2);
  assert.equal(attempts, 3);
  assert.equal(writes, 2);
  current = 'after-second-restart';
  await uploadPictures([new File(['image'], 'picture.png')]);
  assert.equal(bootstrap, 3);
  assert.equal(attempts, 5);
  assert.deepEqual(uploaded, ['picture.png']);
  reject = {};
  await assert.rejects(() => httpApi.updateSettings({ autoAccept: false }), /Refused/);
  assert.equal(attempts, 6);
  assert.equal(bootstrap, 3);
  reject = { code: 'csrf' };
  await assert.rejects(() => httpApi.updateSettings({ autoAccept: false }), /Refused/);
  assert.equal(attempts, 8);
  assert.equal(bootstrap, 4);
});
