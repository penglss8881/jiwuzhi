// ============================================================
// 物品租借平台路由（C2C：上架 / 求租 / 私信）
// 挂载方式：app.use('/api/v1', platformRouter)
// ============================================================
import { Router } from 'express'
import { query } from './database.js'
import { verifyToken, encryptField, decryptField } from './security.js'

export const platformRouter = Router()

// Keep historical records readable; the marketplace no longer processes legacy orders.
platformRouter.use('/rent-requests/:requestId', requireAuth, async (req, res, next) => {
  if (req.method === 'GET' || !/^\d+$/.test(req.params.requestId)) return next()
  try {
    const { rows } = await query('SELECT request_type FROM rent_requests WHERE request_id = ?', [Number(req.params.requestId)])
    if (rows[0] && rows[0].request_type !== 'buyout') return res.status(410).json({ message: '该历史订单仅供查看，请联系管理员处理遗留事项' })
    next()
  } catch { res.status(500).json({ message: '订单校验失败，请重试' }) }
})

// ============================================================
// 【物品租借平台路由 platform-routes.js】挂载于 /api/v1，职责：
//   物品：GET/POST /items、GET /items/mine、GET/PUT/DELETE /items/:id、PUT /items/:id/status
//   求租：POST /items/:id/rent-requests、GET /rent-requests/incoming|outgoing、PUT /rent-requests/:id
//   资料：GET /users/me、PUT /users/me/profile
//   私信：GET/POST /conversations、GET/POST /conversations/:id/messages
//
// 核心业务规则（状态机收敛在服务端，前端只提交意图）：
//   - 物品状态：on_sale(出租中) → rented(同意求租后自动置为已租出) / off(手动下架)
//   - 申请状态：pending → agreed(物主同意) / declined(婉拒) / canceled(申请人取消)
//   - 同意申请联动三件事：更新申请状态 → 物品置 rented → 自动建私聊会话并发开场消息
//   - 越权防护：物主才能编辑/删除/处理自己的物品；申请人只能取消自己的 pending 申请
//   - 防重复：同一人同一物品只能有一条 pending 申请(409)
// ============================================================
const nowText = () => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
}).format(new Date())

// ---------- 鉴权（同 server.js 一致） ----------
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '请先登录' })
  }
  try {
    const payload = verifyToken(authHeader.slice(7))
    const { rows } = await query('SELECT * FROM users WHERE user_id = ? AND status = ?', [payload.userId, 'active'])
    if (rows.length === 0) {
      return res.status(401).json({ message: '账号不存在或已禁用' })
    }
    req.user = {
      userId: rows[0].user_id,
      accountNo: rows[0].account_no,
      name: rows[0].name,
      role: rows[0].role,
      isAdmin: rows[0].role === 'reader_admin' || rows[0].role === 'book_admin',
    }
    next()
  } catch (err) {
    return res.status(401).json({ message: '令牌无效或已过期，请重新登录' })
  }
}

const addLog = async (action, detail, operator) => {
  try {
    await query('INSERT INTO logs (action, detail, operator) VALUES (?, ?, ?)', [action, detail, operator || null])
  } catch (err) {
    console.error('日志记录失败:', err.message)
  }
}

const CATEGORIES = ['图书', '文具', '数码', '生活用品', '体育', '其他']

// ---------- 工具 ----------
export function toItemRow(row) {
  return {
    itemId: row.item_id,
    ownerId: row.owner_id,
    title: row.title,
    category: row.category,
    description: row.description || '',
    price: row.buyout_enabled ? Number(row.buyout_price) : null,
    priceUnit: '元/件',
    coverImageUrl: row.cover_image_url || '',
    status: row.status,
    views: row.views || 0,
    createdAt: row.created_at,
    ownerName: row.owner_nickname || row.owner_name || null,
    ownerAvatar: row.owner_avatar || null,
    ownerSignature: row.owner_signature || null,
    favoriteCount: Number(row.favorite_count || 0),
    commentCount: Number(row.comment_count || 0),
    favorited: Boolean(row.favorited),
    buyoutEnabled: Boolean(row.buyout_enabled),
    buyoutPrice: row.buyout_price != null ? Number(row.buyout_price) : null,
  }
}

function validateItemBody(body) {
  const title = body.title ? String(body.title).trim() : ''
  const category = body.category ? String(body.category).trim() : ''
  const price = Number(body.price)
  if (!title) return { error: '物品名称不能为空' }
  if (title.length > 60) return { error: '物品名称最多60个字' }
  if (!CATEGORIES.includes(category)) return { error: '请选择正确的分类' }
  if (!Number.isFinite(price) || price <= 0 || price > 999999) return { error: '请输入大于零的商品售价' }
  const priceUnit = '元/件'
  const description = body.description ? String(body.description).trim() : ''
  const coverImageUrl = body.coverImageUrl ? String(body.coverImageUrl).trim() : ''
  // 购买：勾选后必须填写合法的购买价（一口价）
  const buyoutEnabled = true
  const buyoutPrice = price
  return { title, category, price, priceUnit, description, coverImageUrl, buyoutEnabled, buyoutPrice }
}

async function findOrCreateConversation(userIdA, userIdB, itemId) {
  const a = Math.min(userIdA, userIdB)
  const b = Math.max(userIdA, userIdB)
  let { rows } = await query(
    'SELECT conversation_id FROM conversations WHERE user_a_id = ? AND user_b_id = ?',
    [a, b]
  )
  if (rows.length > 0) {
    // 会话已存在：清除双方的删除标记（重新唤起会话，类似微信）
    await query('UPDATE conversations SET deleted_by_a = 0, deleted_by_b = 0 WHERE conversation_id = ?', [rows[0].conversation_id])
    return rows[0].conversation_id
  }
  const result = await query(
    'INSERT INTO conversations (user_a_id, user_b_id, item_id) VALUES (?, ?, ?)',
    [a, b, itemId || null]
  )
  return Number(result.rows.insertId)
}

async function canAccessConversation(userId, conversationId) {
  const { rows } = await query(
    'SELECT * FROM conversations WHERE conversation_id = ? AND (user_a_id = ? OR user_b_id = ?)',
    [conversationId, userId, userId]
  )
  return rows.length > 0 ? rows[0] : null
}

// 订单流程通知：给交易双方推送一条会话消息（自动创建/唤起会话，类似微信）
async function pushFlowMessage(senderId, receiverId, itemId, content) {
  const conversationId = await findOrCreateConversation(senderId, receiverId, itemId)
  await query(
    'INSERT INTO messages (conversation_id, sender_id, content) VALUES (?, ?, ?)',
    [conversationId, senderId, content]
  )
  await query(
    'UPDATE conversations SET last_message = ?, last_time = ? WHERE conversation_id = ?',
    [content, nowText(), conversationId]
  )
  return conversationId
}

// 可选登录：广场/详情接口允许游客访问，登录后可返回“是否已收藏”
async function optionalUserId(req) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  try {
    const payload = verifyToken(authHeader.slice(7))
    return payload.userId
  } catch {
    return null
  }
}
// ============================================================
// 物品（items）
// ============================================================

// 物品广场列表（公开）
platformRouter.get('/items', async (req, res) => {
  const { keyword, category, sort } = req.query
  const viewerId = (await optionalUserId(req)) || null
  const sql = [
    `SELECT i.*, u.name AS owner_name, u.nickname AS owner_nickname, u.avatar_url AS owner_avatar, u.signature AS owner_signature,`,
    `  (SELECT COUNT(*) FROM item_favorites f WHERE f.item_id = i.item_id) AS favorite_count,`,
    `  (SELECT COUNT(*) FROM item_favorites f WHERE f.item_id = i.item_id AND f.user_id = ?) AS favorited,`,
    `  (SELECT COUNT(*) FROM item_comments c WHERE c.item_id = i.item_id) AS comment_count`,
    `FROM items i JOIN users u ON u.user_id = i.owner_id`,
    `WHERE i.status = 'on_sale' AND i.buyout_enabled = 1 AND i.buyout_price > 0 AND u.status = 'active'`,
  ]
  const params = [viewerId]
  if (req.query.ownerId !== undefined) {
    const ownerId = Number(req.query.ownerId)
    if (!Number.isSafeInteger(ownerId) || ownerId <= 0) return res.status(400).json({ message: '用户编号不正确' })
    sql.push('AND i.owner_id = ?')
    params.push(ownerId)
  }
  if (category && CATEGORIES.includes(category)) {
    sql.push('AND i.category = ?')
    params.push(category)
  }
  if (keyword && String(keyword).trim()) {
    sql.push('AND (i.title LIKE ? OR i.description LIKE ?)')
    const kw = `%${String(keyword).trim()}%`
    params.push(kw, kw)
  }
  if (req.query.buyout === '1') {
    sql.push('AND i.buyout_enabled = 1')
  }
  if (sort === 'price_asc') sql.push('ORDER BY i.buyout_price ASC')
  else if (sort === 'price_desc') sql.push('ORDER BY i.buyout_price DESC')
  // 综合热度：浏览量 + 收藏数×5 + 留言数×2（推荐好物页使用）
  else if (sort === 'hot') sql.push('ORDER BY (i.views + (SELECT COUNT(*) FROM item_favorites f WHERE f.item_id = i.item_id) * 5 + (SELECT COUNT(*) FROM item_comments c WHERE c.item_id = i.item_id) * 2) DESC, i.created_at DESC')
  else sql.push('ORDER BY i.created_at DESC')
  sql.push('LIMIT 300')
  try {
    const { rows } = await query(sql.join(' '), params)
    res.json(rows.map(toItemRow))
  } catch (err) {
    console.error('获取物品列表失败:', err.message)
    res.status(500).json({ message: '获取物品列表失败', error: err.message })
  }
})

// 我的物品（登录）
platformRouter.get('/items/mine', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT *, (SELECT COUNT(*) FROM item_favorites f WHERE f.item_id = items.item_id) AS favorite_count, (SELECT COUNT(*) FROM item_comments c WHERE c.item_id = items.item_id) AS comment_count FROM items WHERE owner_id = ? ORDER BY created_at DESC',
      [req.user.userId]
    )
    res.json(rows.map(toItemRow))
  } catch (err) {
    console.error('获取我的物品失败:', err.message)
    res.status(500).json({ message: '获取我的物品失败', error: err.message })
  }
})

// 上架物品（登录）
platformRouter.post('/items', requireAuth, async (req, res) => {
  const check = validateItemBody(req.body)
  if (check.error) return res.status(400).json({ message: check.error })
  try {
    const result = await query(
      `INSERT INTO items (owner_id, title, category, description, price, price_unit, cover_image_url, buyout_enabled, buyout_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.userId, check.title, check.category, check.description, check.price, check.priceUnit, check.coverImageUrl || null, check.buyoutEnabled ? 1 : 0, check.buyoutEnabled ? check.buyoutPrice : null]
    )
    const itemId = Number(result.rows.insertId)
    await addLog('物品上架', `${req.user.name} 上架《${check.title}》`, req.user.name)
    res.status(201).json({ message: '上架成功', itemId })
  } catch (err) {
    console.error('上架物品失败:', err.message)
    res.status(500).json({ message: '上架失败', error: err.message })
  }
})

// 物品详情（公开，浏览量+1）
platformRouter.get('/items/:itemId', async (req, res) => {
  try {
    const itemId = Number(req.params.itemId)
    await query('UPDATE items SET views = views + 1 WHERE item_id = ?', [itemId])
    const viewerId = (await optionalUserId(req)) || null
    const { rows } = await query(
      `SELECT i.*, u.name AS owner_name, u.nickname AS owner_nickname, u.avatar_url AS owner_avatar, u.signature AS owner_signature,
       (SELECT COUNT(*) FROM item_favorites f WHERE f.item_id = i.item_id) AS favorite_count,
       (SELECT COUNT(*) FROM item_favorites f WHERE f.item_id = i.item_id AND f.user_id = ?) AS favorited,
       (SELECT COUNT(*) FROM item_comments c WHERE c.item_id = i.item_id) AS comment_count
       FROM items i JOIN users u ON u.user_id = i.owner_id
       WHERE i.item_id = ?`,
      [viewerId, itemId]
    )
    if (rows.length === 0) return res.status(404).json({ message: '物品不存在或已下架' })
    res.json(toItemRow(rows[0]))
  } catch (err) {
    console.error('获取物品详情失败:', err.message)
    res.status(500).json({ message: '获取物品详情失败', error: err.message })
  }
})

// 修改物品（本人或管理员）
platformRouter.put('/items/:itemId', requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId)
  try {
    const { rows } = await query('SELECT * FROM items WHERE item_id = ?', [itemId])
    if (rows.length === 0) return res.status(404).json({ message: '物品不存在' })
    const item = rows[0]
    const isOwner = item.owner_id === req.user.userId
    if (!isOwner && !req.user.isAdmin) return res.status(403).json({ message: '只能操作自己的物品' })

    const title = req.body.title !== undefined ? String(req.body.title).trim() : item.title
    const category = req.body.category !== undefined ? String(req.body.category).trim() : item.category
    const price = req.body.price !== undefined ? Number(req.body.price) : Number(item.buyout_price)
    const priceUnit = '元/件'
    const description = req.body.description !== undefined ? String(req.body.description).trim() : item.description
    const coverImageUrl = req.body.coverImageUrl !== undefined ? String(req.body.coverImageUrl).trim() : item.cover_image_url
    const check = validateItemBody({ title, category, price, description, coverImageUrl })
    if (check.error) return res.status(400).json({ message: check.error })

    // 购买字段：勾选必须带合法购买价
    const buyoutEnabled = true
    const buyoutPrice = price

    // Historical orders still read the original columns. Do not rewrite their amounts.
    const { rows: history } = await query(
      `SELECT request_type FROM rent_requests WHERE item_id = ? GROUP BY request_type`, [itemId]
    )
    if (history.some(order => order.request_type === 'buyout') && price !== Number(item.buyout_price)) {
      return res.status(409).json({ message: '该商品已有订单，不能修改原售价；如需调整价格，请发布新商品' })
    }
    const storedPrice = history.some(order => order.request_type === 'rent') ? Number(item.price) : price

    await query(
      `UPDATE items SET title = ?, category = ?, description = ?, price = ?, price_unit = ?, cover_image_url = ?, buyout_enabled = ?, buyout_price = ? WHERE item_id = ?`,
      [title, category, description, storedPrice, priceUnit, coverImageUrl || null, buyoutEnabled ? 1 : 0, buyoutEnabled ? buyoutPrice : null, itemId]
    )
    res.json({ message: '保存成功' })
  } catch (err) {
    console.error('修改物品失败:', err.message)
    res.status(500).json({ message: '修改物品失败', error: err.message })
  }
})

// 上架/下架/标记已租出（本人或管理员）
platformRouter.put('/items/:itemId/status', requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId)
  const { status } = req.body
  if (!['on_sale', 'off', 'rented'].includes(status)) {
    return res.status(400).json({ message: '状态不合法' })
  }
  try {
    const { rows } = await query('SELECT * FROM items WHERE item_id = ?', [itemId])
    if (rows.length === 0) return res.status(404).json({ message: '物品不存在' })
    const item = rows[0]
    if (item.owner_id !== req.user.userId && !req.user.isAdmin) {
      return res.status(403).json({ message: '只能操作自己的物品' })
    }
    await query('UPDATE items SET status = ? WHERE item_id = ?', [status, itemId])
    res.json({ message: '操作成功', status })
  } catch (err) {
    console.error('修改物品状态失败:', err.message)
    res.status(500).json({ message: '操作失败', error: err.message })
  }
})

// 删除物品（本人或管理员）
platformRouter.delete('/items/:itemId', requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId)
  try {
    const { rows } = await query('SELECT * FROM items WHERE item_id = ?', [itemId])
    if (rows.length === 0) return res.status(404).json({ message: '物品不存在' })
    const item = rows[0]
    if (item.owner_id !== req.user.userId && !req.user.isAdmin) {
      return res.status(403).json({ message: '只能操作自己的物品' })
    }
    await query('DELETE FROM items WHERE item_id = ?', [itemId])
    res.json({ message: '删除成功' })
  } catch (err) {
    console.error('删除物品失败:', err.message)
    res.status(500).json({ message: '删除失败', error: err.message })
  }
})

// ============================================================
// 求租申请（rent_requests）
// ============================================================

// 发起租借/购买申请（type=rent 租借 / type=buyout 购买；购买创建后需到支付弹窗完成模拟支付）
platformRouter.post('/items/:itemId/rent-requests', requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId)
  const { phone, address, note, type } = req.body
  if (type !== undefined && type !== 'buyout') return res.status(400).json({ message: '平台仅支持购买交易' })
  const requestType = 'buyout'
  if (!phone || !String(phone).trim()) return res.status(400).json({ message: '请填写联系电话' })
  if (!address || !String(address).trim()) return res.status(400).json({ message: '请填写收货地址/取件地址' })
  try {
    const { rows } = await query('SELECT * FROM items WHERE item_id = ?', [itemId])
    if (rows.length === 0) return res.status(404).json({ message: '物品不存在' })
    const item = rows[0]
    if (item.owner_id === req.user.userId) {
      return res.status(400).json({ message: '不能购买自己的商品' })
    }
    if (item.status !== 'on_sale') return res.status(400).json({ message: '该物品当前不可交易' })
    if (requestType === 'buyout' && !item.buyout_enabled) {
      return res.status(400).json({ message: '请等待卖家确认商品售价后再购买' })
    }
    // 同一人同一物品不能重复提交待处理申请
    const { rows: pendingRows } = await query(
      'SELECT request_id FROM rent_requests WHERE item_id = ? AND requester_id = ? AND status = ?',
      [itemId, req.user.userId, 'pending']
    )
    if (pendingRows.length > 0) {
      return res.status(409).json({
        message: '你已有该商品的待处理订单，请勿重复下单',
      })
    }
    const days = null
    const feeAmount = Math.round(Number(item.buyout_price || 0) * 100) / 100
    if (!Number.isFinite(feeAmount) || feeAmount <= 0) return res.status(400).json({ message: '商品售价未确认，暂不可购买' })
    const feeText = `¥${feeAmount.toFixed(2)}`
    const feeName = '货款'
    const idResult = await query(
      `INSERT INTO rent_requests (item_id, request_type, requester_id, phone, address, expect_days, note, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [itemId, requestType, req.user.userId, String(phone).trim(), String(address).trim(), days,
        note ? String(note).trim().slice(0, 500) : null]
    )
    const requestId = Number(idResult.rows.insertId)
    await addLog('创建商品订单', `${req.user.name} 购买《${item.title}》${feeText}，待支付`, req.user.name)
    res.status(201).json({
      message: `订单已创建，${feeName} ${feeText} 待支付，请在支付界面完成付款`,
      requestId,
      needPay: true,
      feeAmount,
    })
  } catch (err) {
    console.error('提交申请失败:', err.message)
    res.status(500).json({ message: '提交失败', error: err.message })
  }
})

// 申请费用支付（模拟）：租借租金 / 购买货款，仅申请人可对未付款的待处理申请发起支付
platformRouter.post('/rent-requests/:requestId/pay', requireAuth, async (req, res) => {
  const requestId = Number(req.params.requestId)
  const payMethod = req.body.payMethod === 'alipay' || req.body.payMethod === 'wechat' ? req.body.payMethod : null
  if (!payMethod) return res.status(400).json({ message: '请选择微信或支付宝支付' })
  try {
    const { rows } = await query(
      `SELECT r.*, i.title AS item_title, i.owner_id, i.price, i.buyout_price
       FROM rent_requests r JOIN items i ON i.item_id = r.item_id
       WHERE r.request_id = ?`,
      [requestId]
    )
    if (rows.length === 0) return res.status(404).json({ message: '申请不存在' })
    const row = rows[0]
    if (Number(row.requester_id) !== Number(req.user.userId)) return res.status(403).json({ message: '只有申请人可以支付' })
    const isBuyout = row.request_type === 'buyout'
    if (!['buyout', 'rent'].includes(row.request_type)) return res.status(400).json({ message: '该申请无需支付' })
    if (row.status !== 'pending') return res.status(400).json({ message: '该申请已处理，无法支付' })
    if (row.paid_at) return res.status(400).json({ message: '该订单已支付，请勿重复支付' })

    const now = nowText()
    const feeAmount = isBuyout
      ? Math.round(Number(row.buyout_price || 0) * 100) / 100
      : Math.round(Number(row.price || 0) * Number(row.expect_days || 0) * 100) / 100
    if (feeAmount <= 0) return res.status(400).json({ message: '费用金额异常，无法支付，请联系管理员' })
    const amountText = `¥${feeAmount.toFixed(2)}`
    const feeName = isBuyout ? '货款' : '租金'
    const orderName = isBuyout ? '购买订单' : '租借申请'
    await query('UPDATE rent_requests SET pay_method = ?, paid_at = ? WHERE request_id = ?', [payMethod, now, requestId])
    // 支付成功后通知卖家（自动建立/唤起会话）
    await pushFlowMessage(req.user.userId, row.owner_id, row.item_id,
      `我已完成《${row.item_title}》${orderName}的支付，${feeName} ${amountText}（${payMethod === 'wechat' ? '微信' : '支付宝'}·模拟），请尽快确认接单`)
    await addLog(isBuyout ? '购买支付' : '租借支付', `支付《${row.item_title}》${orderName} ${feeName} ${amountText}（模拟）`, req.user.name)
    res.json({ message: `支付成功（模拟），${feeName} ${amountText} 已支付，等待卖家确认接单`, paidAt: now, payMethod })
  } catch (err) {
    console.error('支付失败:', err.message)
    res.status(500).json({ message: '支付失败', error: err.message })
  }
})

// 待处理申请红点数：自上次查看"租借管理"以来，需要我处理的新申请（已付租金的租借申请 + 已付款的购买申请）
platformRouter.get('/rent-requests/pending-count', requireAuth, async (req, res) => {
  const me = req.user.userId
  try {
    const { rows } = await query(
      `SELECT COUNT(*) AS total
       FROM rent_requests r
       JOIN items i ON i.item_id = r.item_id
       JOIN users u ON u.user_id = ?
       WHERE i.owner_id = ? AND r.status = 'pending'
         AND r.paid_at IS NOT NULL
         AND r.deleted_by_owner = 0
         AND r.created_at > COALESCE(u.rentals_seen_at, '2000-01-01 00:00:00')`,
      [me, me]
    )
    res.json({ total: Number(rows[0].total || 0) })
  } catch (err) {
    console.error('获取待处理红点数失败:', err.message)
    res.status(500).json({ message: '获取待处理红点数失败', error: err.message })
  }
})

// 单侧删除交易记录（仅从自己的列表移除，不影响对方账号显示）
platformRouter.delete('/rent-requests/:requestId', requireAuth, async (req, res) => {
  const requestId = Number(req.params.requestId)
  try {
    const { rows } = await query(
      `SELECT r.*, i.owner_id FROM rent_requests r JOIN items i ON i.item_id = r.item_id WHERE r.request_id = ?`,
      [requestId]
    )
    if (rows.length === 0) return res.status(404).json({ message: '记录不存在' })
    const row = rows[0]
    const isOwner = Number(row.owner_id) === Number(req.user.userId)
    const isRequester = Number(row.requester_id) === Number(req.user.userId)
    if (!isOwner && !isRequester && !req.user.isAdmin) return res.status(403).json({ message: '无权删除该记录' })
    if (row.status === 'pending') return res.status(400).json({ message: '进行中的申请不能删除，请先处理' })
    // 删除限制：交易须已完结才允许删除历史记录
    //   购买：买家已确认收货（签收）即视为完成
    //   租借：买家已确认收货且卖家确认收到退货（归还完成）后才视为完成
    //   另：已婉拒 / 已取消 / 退款已通过（交易关闭）的记录也允许删除
    const isRentRecord = row.request_type === 'rent'
    const finished = isRentRecord ? Boolean(row.returned_at) : Boolean(row.received_at)
    const settledClosed = ['declined', 'canceled'].includes(row.status) || row.refund_status === 'approved'
    if (!finished && !settledClosed) {
      return res.status(400).json({
        message: isRentRecord
          ? '该租借尚未结束：需卖家确认收到退货（归还完成）后才能删除记录'
          : '该交易尚未完成：需买家“确认收货”后才能删除记录',
      })
    }

    if (isOwner) {
      await query('UPDATE rent_requests SET deleted_by_owner = 1 WHERE request_id = ?', [requestId])
    } else if (isRequester) {
      await query('UPDATE rent_requests SET deleted_by_requester = 1 WHERE request_id = ?', [requestId])
    } else if (req.user.isAdmin) {
      await query('UPDATE rent_requests SET deleted_by_owner = 1, deleted_by_requester = 1 WHERE request_id = ?', [requestId])
    }
    res.json({ message: '记录已删除（仅从你的列表移除）' })
  } catch (err) {
    console.error('删除记录失败:', err.message)
    res.status(500).json({ message: '操作失败', error: err.message })
  }
})

// 查看"租借管理"：记录已读时间（红点立刻消除）
// 注意：用 MySQL 的 NOW(3) 与 rent_requests.created_at（数据库默认时间，DATETIME(3)）保持同一时区与毫秒精度
platformRouter.post('/rent-requests/mark-seen', requireAuth, async (req, res) => {
  try {
    await query('UPDATE users SET rentals_seen_at = NOW(3) WHERE user_id = ?', [req.user.userId])
    res.json({ ok: true })
  } catch (err) {
    console.error('记录已读失败:', err.message)
    res.status(500).json({ message: '记录已读失败', error: err.message })
  }
})

// 我收到的求租申请（我的物品）
platformRouter.get('/rent-requests/incoming', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT r.*, i.title AS item_title, i.price, i.price_unit, i.cover_image_url, i.buyout_price,
              u.name AS requester_name, u.nickname AS requester_nickname, u.avatar_url AS requester_avatar
       FROM rent_requests r
       JOIN items i ON i.item_id = r.item_id
       JOIN users u ON u.user_id = r.requester_id
       WHERE i.owner_id = ? AND r.deleted_by_owner = 0
       ORDER BY r.created_at DESC`,
      [req.user.userId]
    )
    res.json(rows.map(row => ({
      requestId: row.request_id,
      itemId: row.item_id,
      itemTitle: row.item_title,
      price: Number(row.price),
      priceUnit: row.price_unit,
      coverImageUrl: row.cover_image_url,
      requestType: row.request_type,
      buyoutPrice: row.buyout_price != null ? Number(row.buyout_price) : null,
      requesterId: row.requester_id,
      requesterName: row.requester_nickname || row.requester_name,
      requesterAvatar: row.requester_avatar,
      refundStatus: row.refund_status || null,
      refundAppliedAt: row.refund_applied_at || null,
      refundReason: row.refund_reason || '',
      refundImage: row.refund_image || '',
      refundEvidenceText: row.refund_evidence_text || '',
      refundHandledAt: row.refund_handled_at || null,
      phone: row.phone,
      address: row.address,
      expectDays: row.expect_days,
      note: row.note || '',
      payMethod: row.pay_method || null,
      paidAt: row.paid_at || null,
      handledAt: row.handled_at || null,
      shippedAt: row.shipped_at || null,
      receivedAt: row.received_at || null,
      returnRequestedAt: row.return_requested_at || null,
      returnedAt: row.returned_at || null,
      refundedAt: row.refunded_at || null,
      status: row.status,
      createdAt: row.created_at,
    })))
  } catch (err) {
    console.error('获取收到的申请失败:', err.message)
    res.status(500).json({ message: '获取失败', error: err.message })
  }
})

// 我发出的求租申请
platformRouter.get('/rent-requests/outgoing', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT r.*, i.title AS item_title, i.price, i.price_unit, i.cover_image_url, i.buyout_price,
              u.name AS owner_name, u.nickname AS owner_nickname, u.avatar_url AS owner_avatar
       FROM rent_requests r
       JOIN items i ON i.item_id = r.item_id
       JOIN users u ON u.user_id = i.owner_id
       WHERE r.requester_id = ? AND r.deleted_by_requester = 0
       ORDER BY r.created_at DESC`,
      [req.user.userId]
    )
    res.json(rows.map(row => ({
      requestId: row.request_id,
      itemId: row.item_id,
      itemTitle: row.item_title,
      price: Number(row.price),
      priceUnit: row.price_unit,
      coverImageUrl: row.cover_image_url,
      requestType: row.request_type,
      buyoutPrice: row.buyout_price != null ? Number(row.buyout_price) : null,
      ownerId: row.owner_id,
      ownerName: row.owner_nickname || row.owner_name,
      ownerAvatar: row.owner_avatar || null,
      refundStatus: row.refund_status || null,
      refundAppliedAt: row.refund_applied_at || null,
      refundReason: row.refund_reason || '',
      refundImage: row.refund_image || '',
      refundEvidenceText: row.refund_evidence_text || '',
      refundHandledAt: row.refund_handled_at || null,
      phone: row.phone,
      address: row.address,
      expectDays: row.expect_days,
      note: row.note || '',
      payMethod: row.pay_method || null,
      paidAt: row.paid_at || null,
      handledAt: row.handled_at || null,
      shippedAt: row.shipped_at || null,
      receivedAt: row.received_at || null,
      returnRequestedAt: row.return_requested_at || null,
      returnedAt: row.returned_at || null,
      refundedAt: row.refunded_at || null,
      status: row.status,
      createdAt: row.created_at,
    })))
  } catch (err) {
    console.error('获取我发出的申请失败:', err.message)
    res.status(500).json({ message: '获取失败', error: err.message })
  }
})

// 处理租借/购买申请：同意/拒绝（物品主人），取消（申请人）
platformRouter.put('/rent-requests/:requestId', requireAuth, async (req, res) => {
  const requestId = Number(req.params.requestId)
  const { status } = req.body
  if (!['agreed', 'declined', 'canceled'].includes(status)) {
    return res.status(400).json({ message: '操作不合法' })
  }
  try {
    const { rows } = await query(
      `SELECT r.*, i.title AS item_title, i.status AS item_status, i.owner_id, i.item_id, i.price, i.buyout_price
       FROM rent_requests r JOIN items i ON i.item_id = r.item_id
       WHERE r.request_id = ?`,
      [requestId]
    )
    if (rows.length === 0) return res.status(404).json({ message: '申请不存在' })
    const reqRow = rows[0]
    const isBuyout = reqRow.request_type === 'buyout'
    const paid = Boolean(reqRow.paid_at)
    const itemTitle = reqRow.item_title || ''
    const feeAmount = isBuyout
      ? Math.round(Number(reqRow.buyout_price || 0) * 100) / 100
      : Math.round(Number(reqRow.price || 0) * Number(reqRow.expect_days || 0) * 100) / 100
    const amountText = `¥${feeAmount.toFixed(2)}`
    const feeName = isBuyout ? '货款' : '租金'
    const typeName = isBuyout ? '购买' : '租借'

    // 申请人取消（已付款时自动模拟退款）
    if (status === 'canceled') {
      if (reqRow.requester_id !== req.user.userId && !req.user.isAdmin) {
        return res.status(403).json({ message: '只能取消自己的申请' })
      }
      await query(
        'UPDATE rent_requests SET status = ?, refunded_at = COALESCE(refunded_at, ?) WHERE request_id = ?',
        ['canceled', paid ? nowText() : null, requestId]
      )
      if (paid) {
        // 自动退款完成：清空可能残留的退款申请状态
        await query(
          "UPDATE rent_requests SET refund_status = NULL, refund_handled_at = NULL WHERE request_id = ? AND refund_status IS NOT NULL",
          [requestId]
        )
        await pushFlowMessage(reqRow.requester_id, reqRow.owner_id, reqRow.item_id,
          `我取消了《${itemTitle}》的${typeName}申请，${feeName} ${amountText} 已自动原路退款（模拟支付）`)
        await addLog(`取消${typeName}申请`, `取消《${itemTitle}》的${typeName}申请并退款 ${amountText}`, req.user.name)
      }
      return res.json({ message: paid ? `已取消申请，${feeName}已自动退款（模拟）` : '已取消申请' })
    }

    // agreed / declined：仅物品主人或管理员
    if (reqRow.owner_id !== req.user.userId && !req.user.isAdmin) {
      return res.status(403).json({ message: '只有物品主人可以处理' })
    }
    if (reqRow.status !== 'pending') return res.status(400).json({ message: '该申请已处理过' })
    if (status === 'agreed' && reqRow.item_status !== 'on_sale') {
      return res.status(400).json({ message: '物品已不在可交易状态' })
    }
    // 买家未付款时卖家不能接单（租借租金 / 购买货款）
    if (status === 'agreed' && !paid) {
      return res.status(400).json({ message: '买家尚未完成付款，暂不能接单' })
    }

    const handledNow = nowText()
    if (status === 'agreed') {
      await query(
        'UPDATE rent_requests SET status = ?, handled_at = ? WHERE request_id = ?',
        ['agreed', handledNow, requestId]
      )
      // 物品锁定：不再被其他人申请
      await query('UPDATE items SET status = ? WHERE item_id = ?', ['rented', reqRow.item_id])
      const agreeMsg = isBuyout
        ? `我已同意你的购买申请，《${itemTitle}》订单已生效，我会尽快为你发货，请留意物流状态`
        : `我已同意你对《${itemTitle}》的求租申请（租金已收·模拟），请在私聊中确认取货/交付细节`
      await pushFlowMessage(req.user.userId, reqRow.requester_id, reqRow.item_id, agreeMsg)
      await addLog(`同意${typeName}`, `同意《${itemTitle}》的${typeName}申请`, req.user.name)
      res.json({ message: isBuyout ? `已同意购买，买家货款 ${amountText} 已收（模拟），请尽快发货` : `已同意，租金 ${amountText} 已收（模拟），物品标记为租出` })
    } else {
      // declined：已付款的申请自动模拟退款
      await query(
        'UPDATE rent_requests SET status = ?, handled_at = ?, refunded_at = COALESCE(refunded_at, ?) WHERE request_id = ?',
        ['declined', handledNow, paid ? handledNow : null, requestId]
      )
      if (paid) {
        // 自动退款完成：清空可能残留的退款申请状态
        await query(
          "UPDATE rent_requests SET refund_status = NULL, refund_handled_at = NULL WHERE request_id = ? AND refund_status IS NOT NULL",
          [requestId]
        )
        await pushFlowMessage(req.user.userId, reqRow.requester_id, reqRow.item_id,
          `很抱歉，你的${typeName}申请被婉拒，${feeName} ${amountText} 已自动原路退款（模拟支付）`)
      }
      await addLog(`婉拒${typeName}`, `婉拒《${itemTitle}》的${typeName}申请`, req.user.name)
      res.json({ message: paid ? `已婉拒该${typeName}申请，${feeName}将自动退款（模拟）` : '已拒绝该申请' })
    }
  } catch (err) {
    console.error('处理申请失败:', err.message)
    res.status(500).json({ message: '操作失败', error: err.message })
  }
})

// 订单/申请详情（仅交易双方或管理员可见）
platformRouter.get('/rent-requests/:requestId', requireAuth, async (req, res) => {
  const requestId = Number(req.params.requestId)
  try {
    const { rows } = await query(
      `SELECT r.*,
              i.title AS item_title, i.price, i.price_unit, i.cover_image_url, i.buyout_price, i.owner_id,
              u1.name AS requester_name, u1.nickname AS requester_nickname, u1.avatar_url AS requester_avatar,
              u2.name AS owner_name, u2.nickname AS owner_nickname, u2.avatar_url AS owner_avatar
       FROM rent_requests r
       JOIN items i ON i.item_id = r.item_id
       JOIN users u1 ON u1.user_id = r.requester_id
       JOIN users u2 ON u2.user_id = i.owner_id
       WHERE r.request_id = ?`,
      [requestId]
    )
    if (rows.length === 0) return res.status(404).json({ message: '申请不存在' })
    const row = rows[0]
    const isOwner = Number(row.owner_id) === Number(req.user.userId)
    const isRequester = Number(row.requester_id) === Number(req.user.userId)
    if (!isOwner && !isRequester && !req.user.isAdmin) {
      return res.status(403).json({ message: '无权查看该订单' })
    }
    // 单侧删除后：本人再查看按"已删除"处理，对方不受影响
    if (!req.user.isAdmin) {
      if (isOwner && row.deleted_by_owner) return res.status(404).json({ message: '该记录已被删除' })
      if (isRequester && row.deleted_by_requester) return res.status(404).json({ message: '该记录已被删除' })
    }
    res.json({
      requestId: row.request_id,
      itemId: row.item_id,
      itemTitle: row.item_title,
      price: Number(row.price),
      priceUnit: row.price_unit,
      coverImageUrl: row.cover_image_url,
      requestType: row.request_type,
      buyoutPrice: row.buyout_price != null ? Number(row.buyout_price) : null,
      status: row.status,
      phone: row.phone,
      address: row.address,
      expectDays: row.expect_days,
      note: row.note || '',
      createdAt: row.created_at,
      payMethod: row.pay_method || null,
      paidAt: row.paid_at || null,
      handledAt: row.handled_at || null,
      shippedAt: row.shipped_at || null,
      receivedAt: row.received_at || null,
      returnRequestedAt: row.return_requested_at || null,
      returnedAt: row.returned_at || null,
      refundedAt: row.refunded_at || null,
      refundStatus: row.refund_status || null,
      refundAppliedAt: row.refund_applied_at || null,
      refundReason: row.refund_reason || '',
      refundImage: row.refund_image || '',
      refundEvidenceText: row.refund_evidence_text || '',
      refundHandledAt: row.refund_handled_at || null,
      requester: {
        userId: row.requester_id,
        name: row.requester_nickname || row.requester_name,
        avatarUrl: row.requester_avatar || '',
      },
      owner: {
        userId: row.owner_id,
        name: row.owner_nickname || row.owner_name,
        avatarUrl: row.owner_avatar || '',
      },
      role: isRequester ? 'buyer' : (isOwner ? 'seller' : 'admin'),
    })
  } catch (err) {
    console.error('获取订单详情失败:', err.message)
    res.status(500).json({ message: '获取失败', error: err.message })
  }
})

// 卖家发货（购买订单 / 租借申请，卖家已同意后）
platformRouter.post('/rent-requests/:requestId/ship', requireAuth, async (req, res) => {
  const requestId = Number(req.params.requestId)
  try {
    const { rows } = await query(
      `SELECT r.*, i.title AS item_title, i.owner_id, i.item_id
       FROM rent_requests r JOIN items i ON i.item_id = r.item_id
       WHERE r.request_id = ?`,
      [requestId]
    )
    if (rows.length === 0) return res.status(404).json({ message: '订单不存在' })
    const row = rows[0]
    const isBuyout = row.request_type === 'buyout'
    if (Number(row.owner_id) !== Number(req.user.userId) && !req.user.isAdmin) {
      return res.status(403).json({ message: '只有卖家可以发货' })
    }
    if (row.status !== 'agreed') return res.status(400).json({ message: '订单尚未确认，无法发货' })
    if (row.shipped_at || row.received_at) return res.status(400).json({ message: '订单已发货或已完成' })
    if (row.refunded_at) return res.status(400).json({ message: '订单已退款，无法发货' })
    if (isBuyout && row.refund_status === 'applied') return res.status(400).json({ message: '买家正在申请退款，请先处理退款申请' })
    const now = nowText()
    await query('UPDATE rent_requests SET shipped_at = ? WHERE request_id = ?', [now, requestId])
    await pushFlowMessage(req.user.userId, row.requester_id, row.item_id,
      `📦《${row.item_title}》已发货，请留意收货并在确认收到后点击“确认收货”`)
    await addLog(isBuyout ? '购买订单发货' : '租借发货', `《${row.item_title}》${isBuyout ? '购买订单' : '租借申请'}已发货`, req.user.name)
    res.json({ message: '已发货，等待买家签收' })
  } catch (err) {
    console.error('发货失败:', err.message)
    res.status(500).json({ message: '操作失败', error: err.message })
  }
})

// 买家确认收货（购买订单 / 租借申请，卖家已发货后）
platformRouter.post('/rent-requests/:requestId/receive', requireAuth, async (req, res) => {
  const requestId = Number(req.params.requestId)
  try {
    const { rows } = await query(
      `SELECT r.*, i.title AS item_title, i.owner_id, i.item_id
       FROM rent_requests r JOIN items i ON i.item_id = r.item_id
       WHERE r.request_id = ?`,
      [requestId]
    )
    if (rows.length === 0) return res.status(404).json({ message: '订单不存在' })
    const row = rows[0]
    const isBuyout = row.request_type === 'buyout'
    if (Number(row.requester_id) !== Number(req.user.userId) && !req.user.isAdmin) {
      return res.status(403).json({ message: '只有买家可以确认收货' })
    }
    if (row.status !== 'agreed') return res.status(400).json({ message: '订单状态不正确' })
    if (!row.shipped_at) return res.status(400).json({ message: '卖家尚未发货' })
    if (row.received_at) return res.status(400).json({ message: '订单已完成，无需重复操作' })
    if (row.refunded_at) return res.status(400).json({ message: '订单已退款，无法确认收货' })
    if (isBuyout && row.refund_status === 'applied') return res.status(400).json({ message: '你已申请退款，请等待卖家处理' })
    const now = nowText()
    await query('UPDATE rent_requests SET received_at = ? WHERE request_id = ?', [now, requestId])
    await pushFlowMessage(req.user.userId, row.owner_id, row.item_id,
      isBuyout
        ? `✅ 我已收到《${row.item_title}》并确认签收，购买交易完成，感谢！`
        : `✅ 我已收到《${row.item_title}》并确认签收，租借交易完成，感谢！`)
    await addLog(isBuyout ? '购买订单签收' : '租借签收', `《${row.item_title}》${isBuyout ? '购买订单' : '租借申请'}买家已签收`, req.user.name)
    res.json({ message: '已确认收货，交易完成！' })
  } catch (err) {
    console.error('确认收货失败:', err.message)
    res.status(500).json({ message: '操作失败', error: err.message })
  }
})

// 买家申请退货（租借：已确认收货后，租期结束将物品归还给卖家）
platformRouter.post('/rent-requests/:requestId/return', requireAuth, async (req, res) => {
  const requestId = Number(req.params.requestId)
  try {
    const { rows } = await query(
      `SELECT r.*, i.title AS item_title, i.owner_id, i.item_id
       FROM rent_requests r JOIN items i ON i.item_id = r.item_id
       WHERE r.request_id = ?`,
      [requestId]
    )
    if (rows.length === 0) return res.status(404).json({ message: '订单不存在' })
    const row = rows[0]
    if (Number(row.requester_id) !== Number(req.user.userId) && !req.user.isAdmin) {
      return res.status(403).json({ message: '只有租借人（买家）可以申请退货' })
    }
    if (row.request_type !== 'rent') return res.status(400).json({ message: '只有租借申请需要退货，购买订单请使用“申请退款”' })
    if (row.status !== 'agreed') return res.status(400).json({ message: '订单尚未成交，无法退货' })
    if (!row.received_at) return res.status(400).json({ message: '请先“确认收货”，再申请退货' })
    if (row.return_requested_at) return res.status(400).json({ message: '退货申请已提交，请等待卖家确认收货' })
    if (row.returned_at) return res.status(400).json({ message: '该物品已退货完成' })
    if (row.refunded_at || row.refund_status === 'approved') return res.status(400).json({ message: '该订单已退款关闭' })
    const now = nowText()
    await query('UPDATE rent_requests SET return_requested_at = ? WHERE request_id = ?', [now, requestId])
    await pushFlowMessage(req.user.userId, row.owner_id, row.item_id,
      `📤 我已将《${row.item_title}》归还/退货，请确认收到退货`)
    await addLog('申请退货', `${req.user.name} 申请退还《${row.item_title}》`, req.user.name)
    res.json({ message: '退货申请已提交，请等待卖家确认收货' })
  } catch (err) {
    console.error('提交退货申请失败:', err.message)
    res.status(500).json({ message: '操作失败', error: err.message })
  }
})

// 卖家确认收到退货（租借：确认后租借结束，物品重新上架可再次出租）
platformRouter.post('/rent-requests/:requestId/return/confirm', requireAuth, async (req, res) => {
  const requestId = Number(req.params.requestId)
  try {
    const { rows } = await query(
      `SELECT r.*, i.title AS item_title, i.owner_id, i.item_id, i.status AS item_status
       FROM rent_requests r JOIN items i ON i.item_id = r.item_id
       WHERE r.request_id = ?`,
      [requestId]
    )
    if (rows.length === 0) return res.status(404).json({ message: '订单不存在' })
    const row = rows[0]
    if (Number(row.owner_id) !== Number(req.user.userId) && !req.user.isAdmin) {
      return res.status(403).json({ message: '只有卖家可以确认收到退货' })
    }
    if (row.request_type !== 'rent') return res.status(400).json({ message: '只有租借申请需要确认退货' })
    if (!row.return_requested_at) return res.status(400).json({ message: '买家尚未申请退货' })
    if (row.returned_at) return res.status(400).json({ message: '已确认过退货，请勿重复操作' })
    const now = nowText()
    await query('UPDATE rent_requests SET returned_at = ? WHERE request_id = ?', [now, requestId])
    // 物品收回后重新上架，可再次出租/购买
    await query("UPDATE items SET status = 'on_sale' WHERE item_id = ? AND status = 'rented'", [row.item_id])
    await pushFlowMessage(req.user.userId, row.requester_id, row.item_id,
      `✅ 我已确认收到《${row.item_title}》的退货，租借结束，感谢使用！`)
    await addLog('确认退货', `确认收到《${row.item_title}》的退货，租借结束`, req.user.name)
    res.json({ message: '已确认收到退货，租借结束，物品已重新上架' })
  } catch (err) {
    console.error('确认退货失败:', err.message)
    res.status(500).json({ message: '操作失败', error: err.message })
  }
})

// 买家申请退款（购买订单售后：填写理由 + 上传证明；证明可以是文件、图片或文字）
platformRouter.post('/rent-requests/:requestId/refund', requireAuth, async (req, res) => {
  const requestId = Number(req.params.requestId)
  const reason = req.body.reason ? String(req.body.reason).trim().slice(0, 500) : ''
  const image = req.body.image ? String(req.body.image).trim() : ''
  const evidenceText = req.body.evidenceText ? String(req.body.evidenceText).trim().slice(0, 1000) : ''
  if (!reason) return res.status(400).json({ message: '请填写退款理由' })
  if (!image && !evidenceText) return res.status(400).json({ message: '请上传退款证明（文件/图片）或填写证明文字' })
  if (image && !image.startsWith('/uploads/')) return res.status(400).json({ message: '退款凭证地址不合法' })
  try {
    const { rows } = await query(
      `SELECT r.*, i.title AS item_title, i.owner_id, i.item_id, i.buyout_price
       FROM rent_requests r JOIN items i ON i.item_id = r.item_id
       WHERE r.request_id = ?`,
      [requestId]
    )
    if (rows.length === 0) return res.status(404).json({ message: '订单不存在' })
    const row = rows[0]
    if (Number(row.requester_id) !== Number(req.user.userId) && !req.user.isAdmin) {
      return res.status(403).json({ message: '只有买家可以申请退款' })
    }
    if (row.request_type !== 'buyout') return res.status(400).json({ message: '租借申请无需退款' })
    if (!row.paid_at) return res.status(400).json({ message: '该订单未支付，无需退款' })
    if (row.refunded_at) return res.status(400).json({ message: '该订单已退款' })
    if (row.refund_status === 'applied') return res.status(400).json({ message: '退款申请处理中，请等待卖家处理' })
    const now = nowText()
    await query(
      `UPDATE rent_requests
       SET refund_status = 'applied', refund_applied_at = ?, refund_reason = ?, refund_image = ?, refund_evidence_text = ?, refund_handled_at = NULL
       WHERE request_id = ?`,
      [now, reason, image || null, evidenceText || null, requestId]
    )
    await pushFlowMessage(req.user.userId, row.owner_id, row.item_id,
      `💸 我申请了《${row.item_title}》的退款，理由：${reason.length > 60 ? reason.slice(0, 60) + '…' : reason}，请尽快处理`)
    await addLog('申请退款', `${req.user.name} 申请《${row.item_title}》退款`, req.user.name)
    res.json({ message: '退款申请已提交，请等待卖家处理（已签收订单将按售后流程处理）' })
  } catch (err) {
    console.error('提交退款申请失败:', err.message)
    res.status(500).json({ message: '操作失败', error: err.message })
  }
})

// 卖家同意退款（货款自动原路退回，模拟）
platformRouter.post('/rent-requests/:requestId/refund/approve', requireAuth, async (req, res) => {
  const requestId = Number(req.params.requestId)
  try {
    const { rows } = await query(
      `SELECT r.*, i.title AS item_title, i.owner_id, i.item_id, i.buyout_price, i.status AS item_status
       FROM rent_requests r JOIN items i ON i.item_id = r.item_id
       WHERE r.request_id = ?`,
      [requestId]
    )
    if (rows.length === 0) return res.status(404).json({ message: '订单不存在' })
    const row = rows[0]
    if (Number(row.owner_id) !== Number(req.user.userId) && !req.user.isAdmin) {
      return res.status(403).json({ message: '只有卖家可以处理退款申请' })
    }
    if (row.request_type !== 'buyout') return res.status(400).json({ message: '该申请无需退款' })
    if (row.refund_status !== 'applied') return res.status(400).json({ message: '当前没有待处理的退款申请' })
    const now = nowText()
    const amountText = `¥${Number(row.buyout_price != null ? row.buyout_price : 0).toFixed(2)}`
    await query(
      `UPDATE rent_requests SET refund_status = 'approved', refund_handled_at = ?, refunded_at = ? WHERE request_id = ?`,
      [now, now, requestId]
    )
    // 退款成立后：物品若处于已租出/锁定状态，则重新上架可再次交易（已签收商品按“买家已退回”处理）
    if (row.item_status !== 'on_sale') {
      await query("UPDATE items SET status = 'on_sale' WHERE item_id = ? AND status = 'rented'", [row.item_id])
    }
    const isOwnerActor = Number(row.owner_id) === Number(req.user.userId)
    if (isOwnerActor) {
      await pushFlowMessage(req.user.userId, row.requester_id, row.item_id,
        `✅ 我已同意《${row.item_title}》的退款申请，货款 ${amountText} 已原路退回（模拟支付）${row.received_at ? '，请按约定将商品寄回' : ''}`)
      await addLog('同意退款', `同意《${row.item_title}》的退款申请`, req.user.name)
    } else {
      // 管理员仲裁：判决通过，通知买家与卖家
      await pushFlowMessage(req.user.userId, row.requester_id, row.item_id,
        `✅ 平台管理员已判决：同意你对《${row.item_title}》的退款申请，货款 ${amountText} 已原路退回（模拟支付）${row.received_at ? '，请按约定将商品寄回卖家' : ''}`)
      await pushFlowMessage(req.user.userId, row.owner_id, row.item_id,
        `✅ 平台管理员已判决：同意买家对《${row.item_title}》的退款申请，货款 ${amountText} 已原路退回（模拟支付）${row.received_at ? '，请与买家协商收回商品' : ''}`)
      await addLog('管理员判决退款通过', `判决《${row.item_title}》退款申请通过`, req.user.name)
    }
    res.json({
      message: isOwnerActor
        ? (row.received_at ? '已同意退款，货款已原路退回（模拟），请与买家协商商品退回' : '已同意退款，货款已原路退回（模拟）')
        : '判决通过：货款已原路退回（模拟），已通知买卖双方',
    })
  } catch (err) {
    console.error('处理退款失败:', err.message)
    res.status(500).json({ message: '操作失败', error: err.message })
  }
})

// 卖家拒绝退款申请
platformRouter.post('/rent-requests/:requestId/refund/reject', requireAuth, async (req, res) => {
  const requestId = Number(req.params.requestId)
  try {
    const { rows } = await query(
      `SELECT r.*, i.title AS item_title, i.owner_id, i.item_id
       FROM rent_requests r JOIN items i ON i.item_id = r.item_id
       WHERE r.request_id = ?`,
      [requestId]
    )
    if (rows.length === 0) return res.status(404).json({ message: '订单不存在' })
    const row = rows[0]
    if (Number(row.owner_id) !== Number(req.user.userId) && !req.user.isAdmin) {
      return res.status(403).json({ message: '只有卖家可以处理退款申请' })
    }
    if (row.request_type !== 'buyout') return res.status(400).json({ message: '该申请无需退款' })
    if (row.refund_status !== 'applied') return res.status(400).json({ message: '当前没有待处理的退款申请' })
    const now = nowText()
    await query(
      `UPDATE rent_requests SET refund_status = 'rejected', refund_handled_at = ? WHERE request_id = ?`,
      [now, requestId]
    )
    const isOwnerActor = Number(row.owner_id) === Number(req.user.userId)
    if (isOwnerActor) {
      await pushFlowMessage(req.user.userId, row.requester_id, row.item_id,
        `❌ 很抱歉，我拒绝了《${row.item_title}》的退款申请。如有疑问可以继续私聊沟通，也可重新申请退款`)
      await addLog('拒绝退款', `拒绝《${row.item_title}》的退款申请`, req.user.name)
    } else {
      // 管理员仲裁：驳回申请，通知买家与卖家
      await pushFlowMessage(req.user.userId, row.requester_id, row.item_id,
        `❌ 平台管理员已判决：驳回你对《${row.item_title}》的退款申请。如有异议可在私信中继续沟通，或补充凭证后重新申请`)
      await pushFlowMessage(req.user.userId, row.owner_id, row.item_id,
        `❌ 平台管理员已判决：驳回买家对《${row.item_title}》的退款申请，交易按原状态继续`)
      await addLog('管理员驳回退款申请', `驳回《${row.item_title}》的退款申请`, req.user.name)
    }
    res.json({ message: isOwnerActor ? '已拒绝该退款申请' : '判决完成：已驳回该退款申请并通知买卖双方' })
  } catch (err) {
    console.error('处理退款失败:', err.message)
    res.status(500).json({ message: '操作失败', error: err.message })
  }
})

// 管理员查看全部退款纠纷（购买售后退款：待判决 + 已判决记录）
platformRouter.get('/refunds/disputes', requireAuth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: '仅管理员可查看退款纠纷' })
  try {
    const { rows } = await query(
      `SELECT r.request_id, r.item_id, r.request_type, r.status AS request_status,
              r.phone, r.address, r.created_at, r.paid_at, r.received_at,
              r.refund_status, r.refund_applied_at, r.refund_reason, r.refund_image,
              r.refund_evidence_text, r.refund_handled_at, r.refunded_at,
              i.title AS item_title, i.buyout_price, i.cover_image_url, i.owner_id,
              u1.name AS requester_name, u1.nickname AS requester_nickname,
              u1.account_no AS requester_account_no,
              u2.name AS owner_name, u2.nickname AS owner_nickname,
              u2.account_no AS owner_account_no
       FROM rent_requests r
       JOIN items i ON i.item_id = r.item_id
       JOIN users u1 ON u1.user_id = r.requester_id
       JOIN users u2 ON u2.user_id = i.owner_id
       WHERE r.request_type = 'buyout' AND r.refund_status IS NOT NULL
       ORDER BY (r.refund_status = 'applied') DESC, r.refund_applied_at DESC, r.request_id DESC`,
    )
    res.json(rows.map(row => ({
      requestId: row.request_id,
      itemId: row.item_id,
      itemTitle: row.item_title,
      coverImageUrl: row.cover_image_url,
      amount: Number(row.buyout_price || 0),
      receivedAt: row.received_at || null,
      createdAt: row.created_at,
      paidAt: row.paid_at || null,
      refundStatus: row.refund_status || null,
      refundAppliedAt: row.refund_applied_at || null,
      refundReason: row.refund_reason || '',
      refundImage: row.refund_image || '',
      refundEvidenceText: row.refund_evidence_text || '',
      refundHandledAt: row.refund_handled_at || null,
      refundedAt: row.refunded_at || null,
      requester: {
        userId: row.requester_id,
        name: row.requester_nickname || row.requester_name,
        accountNo: row.requester_account_no,
      },
      owner: {
        userId: row.owner_id,
        name: row.owner_nickname || row.owner_name,
        accountNo: row.owner_account_no,
      },
    })))
  } catch (err) {
    console.error('获取退款纠纷失败:', err.message)
    res.status(500).json({ message: '获取退款纠纷失败', error: err.message })
  }
})

// ============================================================
// 个人资料
// ============================================================

// Exact lookup by account, nickname, or registered name. Return only active public profile fields.
platformRouter.get('/users/search', requireAuth, async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q) return res.status(400).json({ message: '请输入完整账号或名称' })
  if (q.length > 100) return res.status(400).json({ message: '查找内容过长' })
  try {
    const { rows } = await query(
      `SELECT user_id,
              CASE WHEN BINARY account_no = BINARY ? THEN account_no ELSE '' END AS account_no,
              name, nickname, avatar_url, signature
       FROM users
       WHERE status = 'active' AND user_id <> ?
         AND (BINARY account_no = BINARY ? OR BINARY COALESCE(nickname, '') = BINARY ? OR BINARY name = BINARY ?)
       ORDER BY user_id ASC LIMIT 20`,
      [q, req.user.userId, q, q, q]
    )
    res.json(rows.map(row => ({
      userId: row.user_id,
      accountNo: row.account_no,
      name: row.nickname || row.name,
      avatarUrl: row.avatar_url || '',
      signature: row.signature || '',
    })))
  } catch (err) {
    console.error('精确查找用户失败:', err.message)
    res.status(500).json({ message: '查找用户失败', error: err.message })
  }
})

platformRouter.get('/users/:userId/profile', requireAuth, async (req, res) => {
  const userId = Number(req.params.userId)
  if (!Number.isSafeInteger(userId) || userId <= 0) return res.status(400).json({ message: '用户编号不正确' })
  try {
    const { rows } = await query(
      `SELECT user_id, name, nickname, avatar_url, signature FROM users WHERE user_id = ? AND status = 'active'`, [userId]
    )
    if (!rows.length) return res.status(404).json({ message: '用户不存在或已停用' })
    const person = rows[0]
    res.json({ userId: person.user_id, name: person.nickname || person.name, avatarUrl: person.avatar_url || '', signature: person.signature || '' })
  } catch { res.status(500).json({ message: '获取用户主页失败' }) }
})

platformRouter.get('/users/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM users WHERE user_id = ?', [req.user.userId])
    if (rows.length === 0) return res.status(404).json({ message: '用户不存在' })
    const u = rows[0]

    // 实名信息：解密后返回姓名；身份证号只返回脱敏版本（前6后4，中间打码）
    const realName = u.real_name ? decryptField(u.real_name) : ''
    const plainIdCard = u.id_card ? decryptField(u.id_card) : ''
    const idCardMasked = plainIdCard && plainIdCard.length >= 10
      ? `${plainIdCard.slice(0, 6)}********${plainIdCard.slice(-4)}`
      : ''

    res.json({
      userId: u.user_id,
      accountNo: u.account_no,
      name: u.name,
      nickname: u.nickname || '',
      avatarUrl: u.avatar_url || '',
      signature: u.signature || '',
      phone: u.phone || '',
      address: u.address || '',
      role: u.role,
      isAdmin: u.role === 'reader_admin' || u.role === 'book_admin',
      createdAt: u.created_at,
      realName,
      idCard: idCardMasked,
      idCardBound: Boolean(plainIdCard),
    })
  } catch (err) {
    console.error('获取个人资料失败:', err.message)
    res.status(500).json({ message: '获取失败', error: err.message })
  }
})

platformRouter.put('/users/me/profile', requireAuth, async (req, res) => {
  const { nickname, avatarUrl, signature, phone, address, realName, idCard } = req.body
  const sets = []
  const params = []
  if (nickname !== undefined) {
    const v = String(nickname).trim()
    if (v.length > 30) return res.status(400).json({ message: '昵称最多30个字' })
    sets.push('nickname = ?'); params.push(v)
  }
  if (avatarUrl !== undefined) { sets.push('avatar_url = ?'); params.push(String(avatarUrl).trim()) }
  if (signature !== undefined) {
    const v = String(signature).trim()
    if (v.length > 200) return res.status(400).json({ message: '签名最多200个字' })
    sets.push('signature = ?'); params.push(v)
  }
  if (phone !== undefined) { sets.push('phone = ?'); params.push(String(phone).trim()) }
  if (address !== undefined) { sets.push('address = ?'); params.push(String(address).trim()) }

  // 实名绑定：realName 与 idCard 必须同时出现
  //   两者都为空 → 解绑（置 NULL）；两者都有值 → 校验格式后加密存储
  if (realName !== undefined || idCard !== undefined) {
    if (realName === undefined || idCard === undefined) {
      return res.status(400).json({ message: '姓名和身份证号必须一起提交' })
    }
    const rn = String(realName).trim()
    const ic = String(idCard).trim().toUpperCase()
    if (rn === '' && ic === '') {
      sets.push('real_name = NULL', 'id_card = NULL')
    } else {
      if (!rn) return res.status(400).json({ message: '请填写姓名' })
      if (!/^(\d{15}|\d{17}[\dX])$/.test(ic)) return res.status(400).json({ message: '身份证号格式不正确（15 或 18 位）' })
      sets.push('real_name = ?', 'id_card = ?')
      params.push(encryptField(rn), encryptField(ic))
    }
  }

  if (sets.length === 0) return res.status(400).json({ message: '没有需要更新的内容' })
  params.push(req.user.userId)
  await query(`UPDATE users SET ${sets.join(', ')} WHERE user_id = ?`, params)
  res.json({ message: '资料已保存' })
})

// ============================================================
// 私信（conversations / messages）
// ============================================================

// 打开或创建与某人的会话
platformRouter.post('/conversations', requireAuth, async (req, res) => {
  const otherUserId = Number(req.body.otherUserId)
  const itemId = req.body.itemId ? Number(req.body.itemId) : null
  if (!Number.isInteger(otherUserId) || otherUserId === req.user.userId) {
    return res.status(400).json({ message: '会话对象不合法' })
  }
  try {
    const { rows } = await query('SELECT user_id, name, nickname, avatar_url, signature FROM users WHERE user_id = ? AND status = ?', [otherUserId, 'active'])
    if (rows.length === 0) return res.status(404).json({ message: '对方不存在或已禁用' })
    const conversationId = await findOrCreateConversation(req.user.userId, otherUserId, itemId)
    res.status(201).json({
      conversationId,
      otherUser: {
        userId: rows[0].user_id,
        name: rows[0].nickname || rows[0].name,
        avatarUrl: rows[0].avatar_url || '',
        signature: rows[0].signature || '',
      },
    })
  } catch (err) {
    console.error('创建会话失败:', err.message)
    res.status(500).json({ message: '创建会话失败', error: err.message })
  }
})

// 我的会话列表（已删除的会话不再显示；对方发来新消息会自动恢复）
platformRouter.get('/conversations', requireAuth, async (req, res) => {
  try {
    const me = req.user.userId
    const { rows } = await query(
      `SELECT c.conversation_id, c.item_id, c.last_message, c.last_time, c.created_at,
              u.user_id AS other_user_id, u.name AS other_name, u.nickname AS other_nickname, u.avatar_url AS other_avatar,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.conversation_id AND m.sender_id <> ? AND m.is_read = 0) AS unread
       FROM conversations c
       JOIN users u ON u.user_id = IF(c.user_a_id = ?, c.user_b_id, c.user_a_id)
       WHERE (c.user_a_id = ? OR c.user_b_id = ?)
         AND NOT (c.user_a_id = ? AND c.deleted_by_a = 1)
         AND NOT (c.user_b_id = ? AND c.deleted_by_b = 1)
       ORDER BY COALESCE(c.last_time, c.created_at) DESC`,
      [me, me, me, me, me, me]
    )
    res.json(rows.map(row => ({
      conversationId: row.conversation_id,
      itemId: row.item_id,
      lastMessage: row.last_message || '',
      lastTime: row.last_time || row.created_at,
      otherUser: {
        userId: row.other_user_id,
        name: row.other_nickname || row.other_name,
        avatarUrl: row.other_avatar || '',
      },
      unread: Number(row.unread || 0),
    })))
  } catch (err) {
    console.error('获取会话列表失败:', err.message)
    res.status(500).json({ message: '获取会话失败', error: err.message })
  }
})

// 未读消息总数（用于顶部导航"私信"红点）
platformRouter.get('/conversations/unread-count', requireAuth, async (req, res) => {
  const me = req.user.userId
  try {
    const { rows } = await query(
      `SELECT COUNT(*) AS total
       FROM messages m
       JOIN conversations c ON c.conversation_id = m.conversation_id
       WHERE (c.user_a_id = ? OR c.user_b_id = ?)
         AND m.sender_id <> ? AND m.is_read = 0
         AND NOT (c.user_a_id = ? AND c.deleted_by_a = 1)
         AND NOT (c.user_b_id = ? AND c.deleted_by_b = 1)`,
      [me, me, me, me, me]
    )
    res.json({ total: Number(rows[0].total || 0) })
  } catch (err) {
    console.error('获取未读总数失败:', err.message)
    res.status(500).json({ message: '获取未读总数失败', error: err.message })
  }
})

// 某会话的消息列表（进入即标记已读）
platformRouter.get('/conversations/:conversationId/messages', requireAuth, async (req, res) => {
  const conversationId = Number(req.params.conversationId)
  try {
    const conv = await canAccessConversation(req.user.userId, conversationId)
    if (!conv) return res.status(403).json({ message: '无权查看该会话' })
    await query(
      'UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id <> ? AND is_read = 0',
      [conversationId, req.user.userId]
    )
    const { rows } = await query(
      `SELECT message_id, conversation_id, sender_id, content, is_read, created_at, msg_type, file_url, file_name, file_size, recalled
       FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 500`,
      [conversationId]
    )
    res.json(rows.map(row => {
      const recalled = Boolean(row.recalled)
      return {
        messageId: row.message_id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        // 已撤回的消息不返回内容与附件
        content: recalled ? '' : row.content,
        msgType: row.msg_type || 'text',
        fileUrl: recalled ? '' : (row.file_url || ''),
        fileName: recalled ? '' : (row.file_name || ''),
        fileSize: recalled ? 0 : (row.file_size || 0),
        recalled,
        isRead: Boolean(row.is_read),
        createdAt: row.created_at,
      }
    }))
  } catch (err) {
    console.error('获取消息失败:', err.message)
    res.status(500).json({ message: '获取消息失败', error: err.message })
  }
})

// 发送消息（支持文本 / 图片 / 文件附件；对方删除了会话时，新消息会自动恢复会话）
platformRouter.post('/conversations/:conversationId/messages', requireAuth, async (req, res) => {
  const conversationId = Number(req.params.conversationId)
  const msgType = req.body.msgType === 'image' || req.body.msgType === 'file' ? req.body.msgType : 'text'
  const content = msgType === 'text' ? String(req.body.content || '').trim() : ''
  const fileUrl = req.body.fileUrl ? String(req.body.fileUrl).trim() : ''
  const fileName = req.body.fileName ? String(req.body.fileName).trim().slice(0, 200) : ''
  const fileSize = Number(req.body.fileSize) || 0

  if (msgType === 'text') {
    if (!content) return res.status(400).json({ message: '消息不能为空' })
    if (content.length > 1000) return res.status(400).json({ message: '消息最长1000字' })
  } else {
    // 附件消息：只允许本站上传的文件地址
    if (!fileUrl.startsWith('/uploads/')) return res.status(400).json({ message: '附件地址不合法' })
    if (!fileName) return res.status(400).json({ message: '附件缺少文件名' })
  }

  try {
    const conv = await canAccessConversation(req.user.userId, conversationId)
    if (!conv) return res.status(403).json({ message: '无权在该会话发言' })
    const lastText = msgType === 'text' ? content : (msgType === 'image' ? '[图片]' : `[文件] ${fileName}`)
    await query(
      'INSERT INTO messages (conversation_id, sender_id, content, msg_type, file_url, file_name, file_size) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [conversationId, req.user.userId, content, msgType, fileUrl || null, fileName || null, fileSize || null]
    )
    // 更新会话摘要，并恢复双方的会话（清除删除标记）
    await query(
      'UPDATE conversations SET last_message = ?, last_time = ?, deleted_by_a = 0, deleted_by_b = 0 WHERE conversation_id = ?',
      [lastText, nowText(), conversationId]
    )
    const result = await query('SELECT LAST_INSERT_ID() AS id')
    res.status(201).json({
      messageId: Number(result.rows[0].id),
      senderId: req.user.userId,
      content,
      msgType,
      fileUrl: fileUrl || '',
      fileName: fileName || '',
      fileSize: fileSize || 0,
      createdAt: nowText(),
    })
  } catch (err) {
    console.error('发送消息失败:', err.message)
    res.status(500).json({ message: '发送失败', error: err.message })
  }
})

// 撤回消息（仅本人、2 分钟内、未撤回过）
platformRouter.post('/conversations/:conversationId/messages/:messageId/recall', requireAuth, async (req, res) => {
  const conversationId = Number(req.params.conversationId)
  const messageId = Number(req.params.messageId)
  try {
    const conv = await canAccessConversation(req.user.userId, conversationId)
    if (!conv) return res.status(403).json({ message: '无权操作该会话' })
    const { rows } = await query('SELECT * FROM messages WHERE message_id = ? AND conversation_id = ?', [messageId, conversationId])
    if (rows.length === 0) return res.status(404).json({ message: '消息不存在' })
    const msg = rows[0]
    if (Number(msg.sender_id) !== Number(req.user.userId)) return res.status(403).json({ message: '只能撤回自己的消息' })
    if (msg.recalled) return res.status(400).json({ message: '该消息已撤回' })
    const elapsed = Date.now() - new Date(msg.created_at).getTime()
    if (elapsed > 2 * 60 * 1000) return res.status(400).json({ message: '超过2分钟的消息无法撤回' })

    await query('UPDATE messages SET recalled = 1 WHERE message_id = ?', [messageId])
    // 如果撤回的是最新一条，同步更新会话摘要
    const { rows: lastRows } = await query('SELECT message_id FROM messages WHERE conversation_id = ? ORDER BY message_id DESC LIMIT 1', [conversationId])
    if (lastRows.length > 0 && Number(lastRows[0].message_id) === messageId) {
      await query('UPDATE conversations SET last_message = ?, last_time = ? WHERE conversation_id = ?', ['[消息已撤回]', nowText(), conversationId])
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('撤回消息失败:', err.message)
    res.status(500).json({ message: '撤回失败', error: err.message })
  }
})

// 删除会话（仅从我的列表删除，对方不受影响；对方再发消息会自动恢复）
platformRouter.delete('/conversations/:conversationId', requireAuth, async (req, res) => {
  const conversationId = Number(req.params.conversationId)
  try {
    const conv = await canAccessConversation(req.user.userId, conversationId)
    if (!conv) return res.status(403).json({ message: '无权操作该会话' })
    const isUserA = Number(conv.user_a_id) === Number(req.user.userId)
    await query(
      `UPDATE conversations SET ${isUserA ? 'deleted_by_a' : 'deleted_by_b'} = 1 WHERE conversation_id = ?`,
      [conversationId]
    )
    res.json({ ok: true })
  } catch (err) {
    console.error('删除会话失败:', err.message)
    res.status(500).json({ message: '删除失败', error: err.message })
  }
})
