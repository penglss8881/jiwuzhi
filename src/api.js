// Cache only explicitly requested reads; mutations invalidate cached reads.
const cache = new Map(), pending = new Map()
let generation = 0
export function getToken() {
  try { return JSON.parse(localStorage.getItem('library_current_user') || 'null')?.token || '' } catch { return '' }
}
export function clearCache() { generation++; cache.clear(); pending.clear() }
export function apiUrl(url) {
  return /^\/(items|rent-requests|conversations|users|posts|favorites|refunds|friends)(\/|\?|$)/.test(url) ? `/api/v1${url}` : url
}
export async function apiFetch(url, options = {}) {
  const { ttl = 0, force = false, timeout = 15000, ...init } = options
  const method = (init.method || 'GET').toUpperCase(), token = getToken()
  const key = `${token}:${apiUrl(url)}`, cacheable = method === 'GET' && ttl > 0
  const share = cacheable && !init.signal
  if (cacheable && !force && cache.get(key)?.expires > Date.now()) return structuredClone(cache.get(key).data)
  if (share && pending.has(key)) return structuredClone(await pending.get(key))
  const requestGeneration = generation
  const run = async () => {
    const controller = new AbortController(), abort = () => controller.abort()
    if (init.signal?.aborted) controller.abort()
    init.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, timeout)
    try {
      const headers = new Headers(init.headers)
      if (token) headers.set('Authorization', `Bearer ${token}`)
      if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
      const response = await fetch(apiUrl(url), { ...init, headers, signal: controller.signal })
      const text = await response.text()
      let data = {}
      try { data = text ? JSON.parse(text) : {} } catch { throw new Error('服务暂时不可用，请确认后端已启动后重试') }
      if (!response.ok) {
        if (response.status === 401 && token && getToken() === token) window.dispatchEvent(new Event('auth-expired'))
        throw new Error(data.message || `请求失败 (${response.status})`)
      }
      if (method !== 'GET') { clearCache(); window.dispatchEvent(new Event('data-updated')) }
      else if (cacheable && requestGeneration === generation) {
        if (cache.size >= 60) cache.delete(cache.keys().next().value)
        cache.set(key, { data, expires: Date.now() + ttl })
      }
      return data
    } catch (e) {
      if (e.name === 'AbortError' && !init.signal?.aborted) throw new Error('请求超时，请稍后重试')
      if (e instanceof TypeError) throw new Error('无法连接服务，请检查网络或后端服务')
      throw e
    } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort) }
  }
  const promise = run()
  if (share) pending.set(key, promise)
  try { return structuredClone(await promise) } finally { if (pending.get(key) === promise) pending.delete(key) }
}
export const send = (url, body, method = 'POST') => apiFetch(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
export async function upload(file, attachment = false) {
  if (!file) return null
  const max = attachment ? 20 : 5
  if (file.size > max * 1024 * 1024) throw new Error(`文件不能超过 ${max}MB`)
  if (!attachment && !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG、GIF 或 WebP 图片')
  const body = new FormData()
  body.append(attachment ? 'file' : 'cover', file)
  return apiFetch(attachment ? '/uploads/chat' : '/uploads', { method: 'POST', body, timeout: 60000 })
}
