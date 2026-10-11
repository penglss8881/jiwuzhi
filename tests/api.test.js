import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { apiFetch, apiUrl, clearCache } from '../src/api.js'
import { dateText, dateTimestamp } from '../src/utils.js'
const savedFetch = globalThis.fetch
const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) }
globalThis.window = new EventTarget()
beforeEach(() => { clearCache(); storage.clear() })
afterEach(() => { globalThis.fetch = savedFetch })
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
test('prefixes only known API roots', () => {
  assert.equal(apiUrl('/items?category=图书'), '/api/v1/items?category=图书')
  assert.equal(apiUrl('/items-other'), '/items-other')
  assert.equal(apiUrl('/uploads'), '/uploads')
  assert.equal(apiUrl('/api/v1/books'), '/api/v1/books')
})
test('formats UTC and database timestamps consistently in China time', () => {
  assert.equal(dateText('2026-10-10T00:00:00.000Z'), '2026-10-10 08:00')
  assert.equal(dateTimestamp('2026-10-10 08:00:00'), Date.parse('2026-10-10T00:00:00.000Z'))
})
test('deduplicates concurrent reads and returns isolated cached copies', async () => {
  let calls = 0
  globalThis.fetch = async () => { calls++; await new Promise(r => setTimeout(r, 20)); return json([{ title: 'Original' }]) }
  const [a, b] = await Promise.all([apiFetch('/items', { ttl: 10000 }), apiFetch('/items', { ttl: 10000 })])
  a[0].title = 'Changed'
  assert.equal(b[0].title, 'Original')
  assert.equal((await apiFetch('/items', { ttl: 10000 }))[0].title, 'Original')
  assert.equal(calls, 1)
})
test('separates user caches and sends bearer token', async () => {
  let calls = 0
  globalThis.fetch = async (_url, init) => { calls++; return json(init.headers.get('Authorization')) }
  localStorage.setItem('library_current_user', JSON.stringify({ token: 'a' }))
  assert.equal(await apiFetch('/items', { ttl: 10000 }), 'Bearer a')
  localStorage.setItem('library_current_user', JSON.stringify({ token: 'b' }))
  assert.equal(await apiFetch('/items', { ttl: 10000 }), 'Bearer b')
  assert.equal(calls, 2)
})
test('mutations invalidate earlier list data', async () => {
  let calls = 0
  globalThis.fetch = async () => json({ count: ++calls })
  await apiFetch('/items', { ttl: 10000 })
  await apiFetch('/items', { method: 'POST', body: '{}' })
  assert.equal((await apiFetch('/items', { ttl: 10000 })).count, 3)
})
test('an old read cannot repopulate cache after a mutation', async () => {
  let finish
  globalThis.fetch = async (_url, init) => init.method === 'POST' ? json({ ok: true }) : new Promise(resolve => { finish = () => resolve(json(['old'])) })
  const old = apiFetch('/items', { ttl: 10000 })
  await apiFetch('/items', { method: 'POST' })
  finish(); await old
  globalThis.fetch = async () => json(['new'])
  assert.deepEqual(await apiFetch('/items', { ttl: 10000 }), ['new'])
})
test('handles explicit cancellation and request timeout differently', async () => {
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))))
  const controller = new AbortController()
  const promise = apiFetch('/items', { signal: controller.signal }); controller.abort()
  await assert.rejects(promise, { name: 'AbortError' })
  await assert.rejects(apiFetch('/items', { timeout: 10 }), /请求超时/)
})
test('expires the current session on 401; rejects non-JSON responses', async () => {
  let expired = false
  localStorage.setItem('library_current_user', JSON.stringify({ token: 'old' }))
  window.addEventListener('auth-expired', () => { expired = true }, { once: true })
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'expired' }), { status: 401 })
  await assert.rejects(apiFetch('/users/me'), /expired/)
  assert.equal(expired, true)
  globalThis.fetch = async () => new Response('<html>oops</html>')
  await assert.rejects(apiFetch('/items'), /服务暂时不可用/)
})
