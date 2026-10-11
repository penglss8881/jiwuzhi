import { ref, reactive } from 'vue'
import { clearCache } from './api.js'
function readUser() {
  try { return JSON.parse(localStorage.getItem('library_current_user') || 'null') }
  catch { localStorage.removeItem('library_current_user'); return null }
}
export const user = ref(readUser())
export const toast = reactive({ text: '', type: 'success' })
let timer
export function notify(text, type = 'success') {
  clearTimeout(timer); Object.assign(toast, { text, type })
  timer = setTimeout(() => { toast.text = '' }, 4000)
}
export function setUser(value) {
  clearCache(); user.value = value
  if (value) localStorage.setItem('library_current_user', JSON.stringify(value))
  else localStorage.removeItem('library_current_user')
}
window.addEventListener('storage', e => { if (e.key === 'library_current_user') { clearCache(); user.value = readUser() } })
