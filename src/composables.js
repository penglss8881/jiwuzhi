import { ref, watch, onMounted, onUnmounted, onActivated, onDeactivated, toValue } from 'vue'
import { apiFetch } from './api.js'
import { notify } from './store.js'
export function useResource(url, initial = [], ttl = 20000) {
  const data = ref(initial), loading = ref(true), error = ref('')
  let sequence = 0, controller, active = true, loadedAt = 0, dirty = false
  async function load(force = false) {
    const id = ++sequence
    controller?.abort(); controller = new AbortController()
    if (!toValue(url)) { data.value = initial; loading.value = false; error.value = ''; return }
    loading.value = true; error.value = ''
    try {
      const result = await apiFetch(toValue(url), { ttl, force, signal: controller.signal })
      if (id === sequence) { data.value = result; loadedAt = Date.now(); dirty = false }
    } catch (e) { if (id === sequence && e.name !== 'AbortError') error.value = e.message }
    finally { if (id === sequence) loading.value = false }
  }
  watch(() => toValue(url), () => load(), { immediate: true })
  const invalidate = () => { dirty = true }
  onMounted(() => window.addEventListener('data-updated', invalidate))
  onActivated(() => { if (!active && (dirty || Date.now() - loadedAt > ttl)) load(true); active = true })
  onDeactivated(() => { active = false; if (loading.value) dirty = true; controller?.abort(); sequence++; loading.value = false })
  onUnmounted(() => { controller?.abort(); sequence++; window.removeEventListener('data-updated', invalidate) })
  return { data, loading, error, load }
}
export function useAction() {
  const busy = ref(false), error = ref('')
  async function run(task, message = '操作成功') {
    if (busy.value) return false
    busy.value = true; error.value = ''
    try { await task(); if (message) notify(message); return true }
    catch (e) { error.value = e.message; notify(e.message, 'error'); return false }
    finally { busy.value = false }
  }
  return { busy, error, run }
}
export function useVisiblePoll(task, interval = 15000) {
  let timer, stopped = true, running = false
  async function tick() {
    if (stopped || running || document.hidden) return
    running = true
    try { await task() } catch { /* Retry on next visible tick. */ }
    finally { running = false }
  }
  const visibility = () => { if (!document.hidden) tick() }
  onMounted(() => { stopped = false; tick(); timer = setInterval(tick, interval); document.addEventListener('visibilitychange', visibility) })
  onUnmounted(() => { stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', visibility) })
  return tick
}
