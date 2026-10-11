// ============================================================
// 好友路由（挂载方式：app.use('/api/v1', friendRouter)）
// ============================================================
import { Router } from 'express'
import { query } from './database.js'
import { verifyToken } from './security.js'

export const friendRouter = Router()

// ============================================================
// 【好友模块路由 friend-routes.js】挂载于 /api/v1，职责：
//   好友列表：GET /friends
//   申请管理：GET /friends/requests、POST /friends/requests、
//             POST /friends/requests/:id/accept、DELETE /friends/requests/:id
//   关系查询：GET /friends/status/:userId、GET /friends/pending-count
//   解除好友：DELETE /friends/:userId
//
// 设计要点：
//   - 申请→同意机制：pending 只有被申请人可接受；申请人与被申请人均可删除（撤回/拒绝）
//   - 反向申请自动视为同意：B 在 A→B 申请待处理时发申请，直接成为好友
//   - 同一对用户仅一条记录（uk_pair 按方向唯一），列表查询顺序无关
//   - 对外只暴露昵称 || 姓名、头像、签名；禁用账号不出现在任何列表
// ============================================================

// ---------- 鉴权 ----------
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

// 列表查询共用的"对方用户"字段片段（配合 JOIN users u）
const OTHER_USER_SELECT = 'u.user_id AS o_id, u.name AS o_name, u.nickname AS o_nickname, u.avatar_url AS o_avatar, u.signature AS o_signature'

const toUser = row => ({
  userId: row.o_id,
  name: row.o_nickname || row.o_name || '用户',
  avatarUrl: row.o_avatar || '',
  signature: row.o_signature || '',
})

const toPlainUser = row => ({
  userId: row.user_id,
  name: row.nickname || row.name || '用户',
  avatarUrl: row.avatar_url || '',
  signature: row.signature || '',
})

const parseId = value => {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

// 查询两人之间的唯一关系记录（有方向存储，需双向匹配；极端竞态下取最新一条）
const findPair = (me, other) => query(
  'SELECT friendship_id, requester_id, addressee_id, status FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?) ORDER BY friendship_id DESC LIMIT 1',
  [me, other, other, me]
)

const USER_FIELDS = 'user_id, name, nickname, avatar_url, signature'

// ---------- 好友列表 ----------
friendRouter.get('/friends', requireAuth, async (req, res) => {
  const me = req.user.userId
  try {
    const { rows } = await query(
      `SELECT f.friendship_id, f.created_at, f.updated_at, ${OTHER_USER_SELECT}
       FROM friendships f
       JOIN users u ON u.user_id = IF(f.requester_id = ?, f.addressee_id, f.requester_id)
       WHERE (f.requester_id = ? OR f.addressee_id = ?) AND f.status = 'accepted' AND u.status = 'active'
       ORDER BY f.updated_at DESC`,
      [me, me, me]
    )
    res.json(rows.map(row => ({
      friendshipId: row.friendship_id,
      // updated_at 会在 pending→accepted 时刷新，即成为好友的时间
      since: row.updated_at || row.created_at,
      user: toUser(row),
    })))
  } catch (err) {
    console.error('获取好友列表失败:', err.message)
    res.status(500).json({ message: '获取好友列表失败', error: err.message })
  }
})

// ---------- 待处理申请数（导航角标） ----------
friendRouter.get('/friends/pending-count', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT COUNT(*) AS total FROM friendships WHERE addressee_id = ? AND status = ?',
      [req.user.userId, 'pending']
    )
    res.json({ total: Number(rows[0]?.total || 0) })
  } catch (err) {
    console.error('获取好友申请数失败:', err.message)
    res.status(500).json({ message: '获取好友申请数失败', error: err.message })
  }
})

// ---------- 申请列表（收到 + 发出） ----------
friendRouter.get('/friends/requests', requireAuth, async (req, res) => {
  const me = req.user.userId
  try {
    const incoming = await query(
      `SELECT f.friendship_id, f.created_at, ${OTHER_USER_SELECT}
       FROM friendships f
       JOIN users u ON u.user_id = f.requester_id
       WHERE f.addressee_id = ? AND f.status = 'pending' AND u.status = 'active'
       ORDER BY f.created_at DESC`,
      [me]
    )
    const outgoing = await query(
      `SELECT f.friendship_id, f.created_at, ${OTHER_USER_SELECT}
       FROM friendships f
       JOIN users u ON u.user_id = f.addressee_id
       WHERE f.requester_id = ? AND f.status = 'pending' AND u.status = 'active'
       ORDER BY f.created_at DESC`,
      [me]
    )
    const map = rows => rows.map(row => ({ requestId: row.friendship_id, createdAt: row.created_at, user: toUser(row) }))
    res.json({ incoming: map(incoming.rows), outgoing: map(outgoing.rows) })
  } catch (err) {
    console.error('获取好友申请失败:', err.message)
    res.status(500).json({ message: '获取好友申请失败', error: err.message })
  }
})

// ---------- 查询与某人的好友关系（用户主页按钮状态） ----------
friendRouter.get('/friends/status/:userId', requireAuth, async (req, res) => {
  const me = req.user.userId
  const other = parseId(req.params.userId)
  if (!other) return res.status(400).json({ message: '用户编号不正确' })
  if (other === me) return res.status(400).json({ message: '不能对自己发起好友操作' })

  try {
    const { rows } = await findPair(me, other)
    if (rows.length === 0) return res.json({ status: 'none', requestId: null })
    const row = rows[0]
    if (row.status === 'accepted') return res.json({ status: 'friends', requestId: row.friendship_id })
    res.json({
      status: row.requester_id === me ? 'pending_out' : 'pending_in',
      requestId: row.friendship_id,
    })
  } catch (err) {
    console.error('查询好友关系失败:', err.message)
    res.status(500).json({ message: '查询好友关系失败', error: err.message })
  }
})

// ---------- 发起好友申请 ----------
friendRouter.post('/friends/requests', requireAuth, async (req, res) => {
  const me = req.user.userId
  const other = parseId(req.body?.userId)
  if (!other) return res.status(400).json({ message: '用户编号不正确' })
  if (other === me) return res.status(400).json({ message: '不能添加自己为好友' })

  try {
    const { rows: targets } = await query(`SELECT ${USER_FIELDS} FROM users WHERE user_id = ? AND status = ?`, [other, 'active'])
    if (targets.length === 0) return res.status(404).json({ message: '对方不存在或已禁用' })
    const targetUser = toPlainUser(targets[0])

    const { rows: pairs } = await findPair(me, other)
    if (pairs.length > 0) {
      const pair = pairs[0]
      if (pair.status === 'accepted') return res.status(409).json({ message: '你们已经是好友' })
      if (pair.requester_id === me) return res.status(409).json({ message: '申请已发送，等待对方处理' })
      // 对方已向你发起申请：本次申请视为直接同意
      await query('UPDATE friendships SET status = ? WHERE friendship_id = ? AND status = ?', ['accepted', pair.friendship_id, 'pending'])
      return res.json({ accepted: true, friendshipId: pair.friendship_id, user: targetUser })
    }

    let insertId
    try {
      const result = await query('INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, ?)', [me, other, 'pending'])
      insertId = Number(result.rows.insertId)
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: '申请已发送，等待对方处理' })
      throw err
    }

    // 竞态兜底：双方几乎同时互发申请时会产生两条反向 pending，取最新一条转正、删除另一条
    const { rows: pendingRows } = await query(
      "SELECT friendship_id FROM friendships WHERE ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)) AND status = 'pending' ORDER BY friendship_id DESC",
      [me, other, other, me]
    )
    if (pendingRows.length > 1) {
      const [newest, ...older] = pendingRows
      await query('UPDATE friendships SET status = ? WHERE friendship_id = ?', ['accepted', newest.friendship_id])
      await query('DELETE FROM friendships WHERE friendship_id = ?', [older[0].friendship_id])
      return res.json({ accepted: true, friendshipId: newest.friendship_id, user: targetUser })
    }

    res.status(201).json({ accepted: false, requestId: insertId, user: targetUser })
  } catch (err) {
    console.error('发送好友申请失败:', err.message)
    res.status(500).json({ message: '发送好友申请失败', error: err.message })
  }
})

// ---------- 同意好友申请（仅被申请人） ----------
friendRouter.post('/friends/requests/:requestId/accept', requireAuth, async (req, res) => {
  const me = req.user.userId
  const requestId = parseId(req.params.requestId)
  if (!requestId) return res.status(400).json({ message: '申请编号不正确' })

  try {
    const { rows } = await query('SELECT requester_id, addressee_id, status FROM friendships WHERE friendship_id = ?', [requestId])
    if (rows.length === 0) return res.status(404).json({ message: '申请不存在' })
    const request = rows[0]
    if (Number(request.addressee_id) !== me) return res.status(403).json({ message: '无权处理该申请' })
    if (request.status !== 'pending') return res.status(409).json({ message: '该申请已处理' })

    const result = await query("UPDATE friendships SET status = 'accepted' WHERE friendship_id = ? AND status = 'pending'", [requestId])
    if (result.rows.affectedRows === 0) return res.status(409).json({ message: '该申请已处理' })

    const { rows: requesters } = await query(`SELECT ${USER_FIELDS} FROM users WHERE user_id = ?`, [request.requester_id])
    res.json({ accepted: true, friendshipId: requestId, user: requesters.length ? toPlainUser(requesters[0]) : null })
  } catch (err) {
    console.error('同意好友申请失败:', err.message)
    res.status(500).json({ message: '同意好友申请失败', error: err.message })
  }
})

// ---------- 撤回申请（申请人）/ 拒绝申请（被申请人） ----------
friendRouter.delete('/friends/requests/:requestId', requireAuth, async (req, res) => {
  const me = req.user.userId
  const requestId = parseId(req.params.requestId)
  if (!requestId) return res.status(400).json({ message: '申请编号不正确' })

  try {
    const { rows } = await query('SELECT requester_id, addressee_id, status FROM friendships WHERE friendship_id = ?', [requestId])
    if (rows.length === 0) return res.status(404).json({ message: '申请不存在' })
    const request = rows[0]
    if (Number(request.requester_id) !== me && Number(request.addressee_id) !== me) {
      return res.status(403).json({ message: '无权操作该申请' })
    }
    if (request.status !== 'pending') return res.status(409).json({ message: '该申请已处理' })

    await query("DELETE FROM friendships WHERE friendship_id = ? AND status = 'pending'", [requestId])
    res.json({ ok: true })
  } catch (err) {
    console.error('处理好友申请失败:', err.message)
    res.status(500).json({ message: '处理好友申请失败', error: err.message })
  }
})

// ---------- 解除好友 ----------
friendRouter.delete('/friends/:userId', requireAuth, async (req, res) => {
  const me = req.user.userId
  const other = parseId(req.params.userId)
  if (!other) return res.status(400).json({ message: '用户编号不正确' })

  try {
    const { rows } = await query(
      "SELECT friendship_id FROM friendships WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))",
      [me, other, other, me]
    )
    if (rows.length === 0) return res.status(404).json({ message: '你们还不是好友' })
    await query('DELETE FROM friendships WHERE friendship_id = ?', [rows[0].friendship_id])
    res.json({ ok: true })
  } catch (err) {
    console.error('解除好友失败:', err.message)
    res.status(500).json({ message: '解除好友失败', error: err.message })
  }
})
