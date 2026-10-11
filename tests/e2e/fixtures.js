export const account = { userId: 1, name: '林间', nickname: '林间', accountNo: 'reader-test', token: 'test-session', isAdmin: false }
export const items = Array.from({ length: 17 }, (_, i) => ({ itemId: i + 1, ownerId: 2, ownerName: ['鹿鸣', '小满', '陈一', '山间来信'][i % 4], title: ['在文字里，找到生活的另一种可能', '人间草木 · 汪曾祺散文集', '一台记录日常的复古相机', '给生活留一点空白', '被讨厌的勇气', '周末一起去露营'][i % 6], category: i % 3 === 2 ? '数码' : '图书', price: 36 + i, priceUnit: '元/件', description: '保存完好，希望它能遇见下一位喜欢它的人。可以当面交接，欢迎私信交流。', status: 'on_sale', views: 32 + i * 7, favoriteCount: 3 + i, commentCount: 2, favorited: i === 1, buyoutEnabled: true, buyoutPrice: 36 + i, coverImageUrl: '' }))
export const posts = [
  { postId: 1, authorId: 2, title: '读完《人间草木》，才发现生活原来这么可爱', content: '最近重新翻开汪曾祺的散文，字里行间都是对生活细小的热爱。花草、食物、街头巷尾，原来平凡日子里也藏着这么多值得记录的瞬间。你最近在读什么书？', views: 328, commentCount: 16, images: [], createdAt: '2026-10-08 10:24:00', author: { name: '鹿鸣', avatarUrl: '' } },
  { postId: 2, authorId: 3, title: '把闲置书架整理了一遍，给好书找个新主人', content: '书架空间有限，但阅读的热情没有。整理了几本读完的好书，希望把它们分享给下一位读者。也欢迎大家分享自己的阅读清单。', views: 186, commentCount: 8, images: [], createdAt: '2026-10-08 09:15:00', author: { name: '小满', avatarUrl: '' } },
  { postId: 3, authorId: 4, title: '周末计划：带上一本书，去公园坐一下午', content: '趁着秋天的阳光刚好，约上朋友去公园阅读。不赶时间，慢慢翻页，把自己还给生活。', views: 96, commentCount: 5, images: [], createdAt: '2026-10-07 15:30:00', author: { name: '山间来信', avatarUrl: '' } },
]
export async function mockApp(page, { admin = false, loggedIn = true, orderRole = 'buyer', orderState = {} } = {}) {
  const user = { ...account, isAdmin: admin }
  const requests = [], inventory = [], messages = [], comments = []
  const order = { requestId: 10, itemId: 1, itemTitle: items[0].title, price: 1, priceUnit: '元/件', expectDays: null, requestType: 'buyout', buyoutPrice: 36, status: 'pending', role: orderRole, phone: '13800000000', address: '校园图书馆', note: '', createdAt: '2026-10-08 11:00:00', requester: { userId: 1, name: '林间' }, owner: { userId: 2, name: '鹿鸣' }, ...orderState }
  if (loggedIn) await page.addInitScript(value => localStorage.setItem('library_current_user', JSON.stringify(value)), user)
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/v1', ''), method = request.method()
    const body = request.postDataJSON?.() || {}
    requests.push({ path, query: Object.fromEntries(url.searchParams), method, body })
    const ok = data => route.fulfill({ json: data })
    if (path === '/users/login') return body.password === 'wrong' ? route.fulfill({ status: 401, json: { message: '账号或密码错误' } }) : ok(user)
    if (path === '/users/register' || path === '/users/forgot-reset') return ok({ message: '成功' })
    if (path === '/users/forgot-question') return ok({ securityQuestion: '您的出生城市是？' })
    if (path === '/users/search') return ok(['鹿鸣', 'test2'].includes(url.searchParams.get('q')) ? [{ userId: 2, name: '鹿鸣', signature: '分享生活与好物', avatarUrl: '' }] : [])
    if (/^\/users\/\d+\/profile$/.test(path)) return ok({ userId: Number(path.split('/')[2]), name: Number(path.split('/')[2]) === 2 ? '鹿鸣' : '小满', signature: '分享生活与好物', avatarUrl: '' })
    if (path === '/users/me') return ok({ ...user, signature: '喜欢阅读，也喜欢分享。', phone: '13800000000', address: '校园图书馆', avatarUrl: '', realName: '林间', idCard: '123456********1234', idCardBound: true, createdAt: '2026-01-01' })
    if (path === '/users/me/profile' || path === '/users/me/password') return ok({ message: '已保存' })
    if (path === '/users') return ok([{ ...user, role: 'reader_admin', status: 'active' }, { userId: 2, name: '鹿鸣', accountNo: 'test2', role: 'user', status: 'active' }])
    if (path === '/posts' && method === 'GET') return ok(posts.filter(p => (!url.searchParams.get('authorId') || p.authorId === Number(url.searchParams.get('authorId'))) && (!url.searchParams.get('keyword') || p.title.includes(url.searchParams.get('keyword')))))
    if (path === '/posts' && method === 'POST') return ok({ postId: 8 })
    if (/^\/posts\/\d+$/.test(path)) return method === 'DELETE' ? ok({}) : ok(posts.find(p => p.postId === Number(path.split('/')[2])) || posts[0])
    if (path.endsWith('/comments')) {
      if (method === 'POST') {
        const target = comments.find(c => c.commentId === body.parentCommentId)
        comments.push({
          commentId: comments.length + 1,
          parentCommentId: target ? (target.parentCommentId || target.commentId) : null,
          content: body.content,
          author: { userId: user.userId, name: user.name },
          replyTo: target ? { userId: target.author.userId, name: target.author.name } : null,
          createdAt: '2026-10-08 12:00:00',
        })
      }
      return ok(comments)
    }
    if (path === '/items' && method === 'GET') return ok(items.filter(i => (!url.searchParams.get('ownerId') || i.ownerId === Number(url.searchParams.get('ownerId'))) && (!url.searchParams.get('category') || i.category === url.searchParams.get('category')) && (!url.searchParams.get('keyword') || i.title.includes(url.searchParams.get('keyword')))))
    if (path === '/favorites') return ok(items.slice(0, 3))
    if (path.endsWith('/favorite')) return ok({ favorited: false, favoriteCount: 2 })
    if (path === '/items/mine') return ok(inventory)
    if (path === '/items' && method === 'POST') { inventory.push({ ...body, itemId: 100, status: 'on_sale' }); return ok({ itemId: 100 }) }
    if (path.endsWith('/rent-requests')) { Object.assign(order, body, { requestType: body.type }); return ok({ requestId: 10, needPay: true }) }
    if (/^\/items\/\d+$/.test(path)) return ok(items.find(i => i.itemId === Number(path.split('/')[2])) || items[0])
    if (path.endsWith('/unread-count') || path.endsWith('/pending-count')) return ok({ total: 0 })
    if (path.endsWith('/mark-seen')) return ok({ ok: true })
    if (path === '/rent-requests/incoming' || path === '/rent-requests/outgoing') return ok([{ ...order, requesterName: order.requester.name, ownerName: order.owner.name, requester: undefined, owner: undefined }])
    if (path === '/rent-requests/10' && method === 'GET') return ok(order)
    if (path.startsWith('/rent-requests/10')) {
      if (method === 'PUT') order.status = body.status
      const fields = { '/pay': 'paidAt', '/ship': 'shippedAt', '/receive': 'receivedAt', '/return': 'returnRequestedAt', '/return/confirm': 'returnedAt' }
      const suffix = path.replace('/rent-requests/10', '')
      if (fields[suffix]) order[fields[suffix]] = '2026-10-08 12:00:00'
      if (suffix === '/pay') order.payMethod = body.payMethod
      if (suffix === '/refund') { order.refundStatus = 'applied'; order.refundReason = body.reason; order.refundEvidenceText = body.evidenceText }
      if (suffix === '/refund/approve') { order.refundStatus = 'approved'; order.refundedAt = '2026-10-08 12:00:00' }
      if (suffix === '/refund/reject') order.refundStatus = 'rejected'
      return ok({ message: '操作成功' })
    }
    if (path === '/conversations') return method === 'POST' ? ok({ conversationId: 1 }) : ok([{ conversationId: 1, itemId: 1, otherUser: { userId: 2, name: '鹿鸣' }, lastMessage: messages.at(-1)?.content || '你好，这本书还在吗？', unread: 0 }])
    if (path === '/conversations/1/messages') { if (method === 'POST') messages.push({ ...body, messageId: messages.length + 1, senderId: 1, createdAt: new Date().toISOString(), msgType: body.msgType || 'text' }); return ok(messages) }
    if (path.endsWith('/recall')) { messages[0].recalled = true; return ok({}) }
    if (path === '/books') return ok([{ bookCode: 'BK001', title: '人间草木', author: '汪曾祺', isbn: '9780000000000', status: 'available' }])
    if (path === '/borrow-records') return ok([{ recordId: 1, userId: 1, bookCode: 'BK001', bookTitle: '人间草木', borrowerName: '林间', status: 'borrowing', borrowDate: '2026-10-08' }])
    if (path === '/logs') return ok([{ id: 1, action: '登录', operator: '林间', detail: '登录成功', createdAt: '2026-10-08' }])
    if (path === '/refunds/disputes') return ok([{ ...order, refundStatus: 'applied', refundReason: '物品不符', refundEvidenceText: '封面破损' }])
    return ok({ message: '操作成功' })
  })
  return { requests, order, inventory, messages, comments }
}
