export const categories = ['图书', '文具', '数码', '生活用品', '体育', '其他']
// Uploaded files are served from the site root, including on nested profile routes.
export function avatarUrl(value) {
  const url = typeof value === 'string' ? value.trim() : ''
  if (!url) return ''
  if (/^(https?:\/\/|blob:|data:image\/)/i.test(url) || url.startsWith('/')) return url
  return `/${url.replace(/^(\.\/)+/, '')}`
}
export const money = v => Number(v || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const chinaDate = value => {
  if (!value) return null
  if (value instanceof Date) return value
  const text = String(value).trim()
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(text)
    ? `${text.replace(' ', 'T')}+08:00`
    : text
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}
const dateParts = value => {
  const date = chinaDate(value)
  if (!date) return null
  return Object.fromEntries(new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
}
export const dateText = value => {
  const parts = dateParts(value)
  return parts ? `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}` : '—'
}
export const dateTimestamp = value => chinaDate(value)?.getTime() || 0
export const messageTime = value => {
  const date = chinaDate(value)
  const parts = dateParts(value)
  if (!date || !parts) return '—'
  const today = dateParts(new Date())
  const targetDay = `${parts.year}-${parts.month}-${parts.day}`
  const todayDay = `${today.year}-${today.month}-${today.day}`
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const y = dateParts(yesterday)
  const yesterdayDay = `${y.year}-${y.month}-${y.day}`
  if (targetDay === todayDay) return `今天 ${parts.hour}:${parts.minute}`
  if (targetDay === yesterdayDay) return `昨天 ${parts.hour}:${parts.minute}`
  return `${parts.year === today.year ? `${parts.month}-${parts.day}` : targetDay} ${parts.hour}:${parts.minute}`
}
export function goBack(router, fallback = '/') {
  if (window.history.state?.back) router.back()
  else router.replace(fallback)
}
export const itemStatus = v => ({ on_sale: '在售', rented: '已售出', off: '已下架' }[v] || v)
export function orderStage(o) {
  if (o.requestType !== 'buyout') return '历史订单（只读）'
  if (o.refundedAt || o.refundStatus === 'approved') return '已退款（模拟）'
  if (o.status === 'canceled') return '已取消'
  if (o.status === 'declined') return '已婉拒'
  if (o.refundStatus === 'applied') return '退款处理中'
  if (o.receivedAt) return '交易已完成'
  if (o.shippedAt) return '待签收'
  if (o.status === 'agreed') return '待发货'
  return o.paidAt ? '待卖家确认' : '待支付'
}
// Existing backend bills rentals by price × expected days.
export const orderAmount = o => o.requestType === 'buyout' ? Number(o.buyoutPrice || 0) : Math.round(Number(o.price || 0) * Number(o.expectDays || 0) * 100) / 100
