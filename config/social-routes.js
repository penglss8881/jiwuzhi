// ============================================================
// 论坛 + 物品评论/收藏 路由（挂载方式：app.use('/api/v1', socialRouter)）
// ============================================================
import { Router } from 'express'
import { query } from './database.js'
import { verifyToken } from './security.js'
import { toItemRow } from './platform-routes.js'

export const socialRouter = Router()

// ============================================================
// 【社交模块路由 social-routes.js】挂载于 /api/v1，职责：
//   论坛：GET/POST /posts、GET/DELETE /posts/:id、GET/POST /posts/:id/comments
//   物品留言：GET/POST /items/:id/comments
//   收藏：POST /items/:id/favorite(切换式)、GET /favorites(我的收藏)
//
// 设计要点：
//   - 收藏用 toggle 接口：已收藏则删记录、未收藏则插入，返回最新 {favorited, favoriteCount}
//   - 帖子 images 以 JSON 数组存储(上限 6 张)，浏览量 GET 详情时 +1
//   - 收藏数/留言数用 COUNT 子查询实时统计；广场列表额外返回"当前用户是否已收藏"
//   - 删除帖子/回复均有本人或管理员权限校验
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

const displayName = (row, prefix) => {
  const n = row[`${prefix}_nickname`] || row[`${prefix}_name`]
  return n || null
}

function parseImages(raw) {
  try {
    const arr = JSON.parse(raw || '[]')
    return Array.isArray(arr) ? arr.filter(s => typeof s === 'string' && s.trim()) : []
  } catch {
    return []
  }
}

function toPostRow(row) {
  return {
    postId: row.post_id,
    authorId: row.user_id,
    title: row.title,
    content: row.content || '',
    images: parseImages(row.images),
    views: row.views || 0,
    commentCount: Number(row.comment_count || 0),
    likeCount: Number(row.like_count || 0),
    liked: Boolean(row.liked),
    createdAt: row.created_at,
    author: {
      userId: row.user_id,
      name: displayName(row, 'author'),
      avatarUrl: row.author_avatar || '',
    },
  }
}

function toCommentRow(row, prefix = 'author') {
  return {
    commentId: row.comment_id,
    parentCommentId: row.parent_comment_id || null,
    authorId: row.user_id,
    content: row.content,
    createdAt: row.created_at,
    author: {
      userId: row.user_id,
      name: displayName(row, prefix),
      avatarUrl: row[`${prefix}_avatar`] || '',
    },
    replyTo: row.reply_to_user_id ? {
      userId: row.reply_to_user_id,
      name: row.reply_to_nickname || row.reply_to_name || '用户',
    } : null,
  }
}

const AUTHOR_SELECT = `
  u.name AS author_name, u.nickname AS author_nickname, u.avatar_url AS author_avatar`
const REPLY_SELECT = `
  ru.user_id AS reply_to_user_id, ru.name AS reply_to_name, ru.nickname AS reply_to_nickname`

async function optionalUserId(req) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return 0
  try {
    const payload = verifyToken(authHeader.slice(7))
    const { rows } = await query('SELECT user_id FROM users WHERE user_id = ? AND status = ?', [payload.userId, 'active'])
    return rows[0]?.user_id || 0
  } catch {
    return 0
  }
}

// ============================================================
// 论坛帖子
// ============================================================

// 帖子列表（按最新/热门）
socialRouter.get('/posts', async (req, res) => {
  const { keyword, sort } = req.query
  const viewerId = await optionalUserId(req)
  const sql = [
    `SELECT p.*, ${AUTHOR_SELECT.trim()},
            (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.post_id) AS comment_count,
            (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.post_id) AS like_count,
            EXISTS(SELECT 1 FROM post_likes mine WHERE mine.post_id = p.post_id AND mine.user_id = ?) AS liked
     FROM posts p JOIN users u ON u.user_id = p.user_id WHERE u.status = 'active'`,
  ]
  const params = [viewerId]
  if (req.query.authorId !== undefined) {
    const authorId = Number(req.query.authorId)
    if (!Number.isSafeInteger(authorId) || authorId <= 0) return res.status(400).json({ message: '用户编号不正确' })
    sql.push('AND p.user_id = ?')
    params.push(authorId)
  }
  if (keyword && String(keyword).trim()) {
    sql.push('AND (p.title LIKE ? OR p.content LIKE ?)')
    const kw = `%${String(keyword).trim()}%`
    params.push(kw, kw)
  }
  sql.push(sort === 'hot' ? 'ORDER BY p.views DESC, p.created_at DESC' : 'ORDER BY p.created_at DESC')
  sql.push('LIMIT 200')
  try {
    const { rows } = await query(sql.join(' '), params)
    res.json(rows.map(toPostRow))
  } catch (err) {
    console.error('获取帖子列表失败:', err.message)
    res.status(500).json({ message: '获取帖子失败', error: err.message })
  }
})

// 帖子详情（浏览量+1）
socialRouter.get('/posts/:postId', async (req, res) => {
  const postId = Number(req.params.postId)
  const viewerId = await optionalUserId(req)
  try {
    await query('UPDATE posts SET views = views + 1 WHERE post_id = ?', [postId])
    const { rows } = await query(
      `SELECT p.*, ${AUTHOR_SELECT.trim()},
              (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.post_id) AS comment_count,
              (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.post_id) AS like_count,
              EXISTS(SELECT 1 FROM post_likes mine WHERE mine.post_id = p.post_id AND mine.user_id = ?) AS liked
       FROM posts p JOIN users u ON u.user_id = p.user_id
       WHERE p.post_id = ?`,
      [viewerId, postId]
    )
    if (rows.length === 0) return res.status(404).json({ message: '帖子不存在或已删除' })
    res.json(toPostRow(rows[0]))
  } catch (err) {
    console.error('获取帖子详情失败:', err.message)
    res.status(500).json({ message: '获取帖子失败', error: err.message })
  }
})

// 点赞/取消点赞，让动态流具备轻量的朋友圈互动。
socialRouter.post('/posts/:postId/like', requireAuth, async (req, res) => {
  const postId = Number(req.params.postId)
  try {
    const { rows: posts } = await query('SELECT post_id FROM posts WHERE post_id = ?', [postId])
    if (!posts.length) return res.status(404).json({ message: '帖子不存在或已删除' })
    const result = await query('INSERT IGNORE INTO post_likes (post_id, user_id) VALUES (?, ?)', [postId, req.user.userId])
    const liked = Number(result.rows?.affectedRows || 0) > 0
    if (!liked) await query('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', [postId, req.user.userId])
    const { rows } = await query('SELECT COUNT(*) AS total FROM post_likes WHERE post_id = ?', [postId])
    res.json({ liked, likeCount: Number(rows[0]?.total || 0) })
  } catch (err) {
    console.error('动态点赞失败:', err.message)
    res.status(500).json({ message: '操作失败，请稍后重试', error: err.message })
  }
})

// 发帖（登录）
socialRouter.post('/posts', requireAuth, async (req, res) => {
  const title = req.body.title ? String(req.body.title).trim() : ''
  const content = req.body.content ? String(req.body.content).trim() : ''
  let images = Array.isArray(req.body.images) ? req.body.images : []
  if (!title) return res.status(400).json({ message: '请填写帖子标题' })
  if (title.length > 100) return res.status(400).json({ message: '标题最多100个字' })
  if (!content && !images.length) return res.status(400).json({ message: '写一句近况或添加一张照片吧' })
  if (content.length > 5000) return res.status(400).json({ message: '内容最多5000字' })
  images = images.slice(0, 6).map(s => String(s).trim()).filter(Boolean)
  for (const img of images) {
    if (img.length > 500) return res.status(400).json({ message: '图片地址不合法' })
  }
  try {
    await query(
      'INSERT INTO posts (user_id, title, content, images) VALUES (?, ?, ?, ?)',
      [req.user.userId, title, content, JSON.stringify(images)]
    )
    const result = await query('SELECT LAST_INSERT_ID() AS id')
    res.status(201).json({ message: '发布成功', postId: Number(result.rows[0].id) })
  } catch (err) {
    console.error('发布帖子失败:', err.message)
    res.status(500).json({ message: '发布失败', error: err.message })
  }
})

// 删除帖子（本人或管理员）
socialRouter.delete('/posts/:postId', requireAuth, async (req, res) => {
  const postId = Number(req.params.postId)
  try {
    const { rows } = await query('SELECT * FROM posts WHERE post_id = ?', [postId])
    if (rows.length === 0) return res.status(404).json({ message: '帖子不存在' })
    if (rows[0].user_id !== req.user.userId && !req.user.isAdmin) {
      return res.status(403).json({ message: '只能删除自己发布的帖子' })
    }
    await query('DELETE FROM posts WHERE post_id = ?', [postId])
    res.json({ message: '删除成功' })
  } catch (err) {
    console.error('删除帖子失败:', err.message)
    res.status(500).json({ message: '删除失败', error: err.message })
  }
})

// 帖子回复列表
socialRouter.get('/posts/:postId/comments', async (req, res) => {
  const postId = Number(req.params.postId)
  try {
    const { rows } = await query(
      `SELECT c.*, ${AUTHOR_SELECT.trim()}, ${REPLY_SELECT.trim()}
       FROM post_comments c JOIN users u ON u.user_id = c.user_id
       LEFT JOIN users ru ON ru.user_id = c.reply_to_user_id
       WHERE c.post_id = ? ORDER BY c.created_at ASC`,
      [postId]
    )
    res.json(rows.map(r => toCommentRow(r)))
  } catch (err) {
    console.error('获取帖子回复失败:', err.message)
    res.status(500).json({ message: '获取回复失败', error: err.message })
  }
})

// 回复帖子（登录）
socialRouter.post('/posts/:postId/comments', requireAuth, async (req, res) => {
  const postId = Number(req.params.postId)
  const content = req.body.content ? String(req.body.content).trim() : ''
  const requestedParentId = req.body.parentCommentId ? Number(req.body.parentCommentId) : null
  if (!content) return res.status(400).json({ message: '回复内容不能为空' })
  if (content.length > 500) return res.status(400).json({ message: '回复最多500字' })
  try {
    const { rows } = await query('SELECT * FROM posts WHERE post_id = ?', [postId])
    if (rows.length === 0) return res.status(404).json({ message: '帖子不存在' })
    let parentId = null, replyToUserId = null
    if (requestedParentId) {
      const { rows: parents } = await query('SELECT comment_id, parent_comment_id, user_id FROM post_comments WHERE comment_id = ? AND post_id = ?', [requestedParentId, postId])
      if (!parents.length) return res.status(400).json({ message: '要回复的评论不存在' })
      parentId = parents[0].parent_comment_id || parents[0].comment_id
      replyToUserId = parents[0].user_id
    }
    await query(
      'INSERT INTO post_comments (post_id, user_id, parent_comment_id, reply_to_user_id, content) VALUES (?, ?, ?, ?, ?)',
      [postId, req.user.userId, parentId, replyToUserId, content]
    )
    res.status(201).json({ message: '回复成功' })
  } catch (err) {
    console.error('回复帖子失败:', err.message)
    res.status(500).json({ message: '回复失败', error: err.message })
  }
})
// ============================================================
// 物品留言（评论）
// ============================================================

// 物品留言列表
socialRouter.get('/items/:itemId/comments', async (req, res) => {
  const itemId = Number(req.params.itemId)
  try {
    const { rows } = await query(
      `SELECT c.*, ${AUTHOR_SELECT.trim()}, ${REPLY_SELECT.trim()}
       FROM item_comments c JOIN users u ON u.user_id = c.user_id
       LEFT JOIN users ru ON ru.user_id = c.reply_to_user_id
       WHERE c.item_id = ? ORDER BY c.created_at ASC`,
      [itemId]
    )
    res.json(rows.map(r => toCommentRow(r)))
  } catch (err) {
    console.error('获取物品留言失败:', err.message)
    res.status(500).json({ message: '获取留言失败', error: err.message })
  }
})

// 发表物品留言（登录）
socialRouter.post('/items/:itemId/comments', requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId)
  const content = req.body.content ? String(req.body.content).trim() : ''
  const requestedParentId = req.body.parentCommentId ? Number(req.body.parentCommentId) : null
  if (!content) return res.status(400).json({ message: '留言内容不能为空' })
  if (content.length > 500) return res.status(400).json({ message: '留言最多500字' })
  try {
    const { rows } = await query('SELECT * FROM items WHERE item_id = ?', [itemId])
    if (rows.length === 0) return res.status(404).json({ message: '物品不存在' })
    let parentId = null, replyToUserId = null
    if (requestedParentId) {
      const { rows: parents } = await query('SELECT comment_id, parent_comment_id, user_id FROM item_comments WHERE comment_id = ? AND item_id = ?', [requestedParentId, itemId])
      if (!parents.length) return res.status(400).json({ message: '要回复的评论不存在' })
      parentId = parents[0].parent_comment_id || parents[0].comment_id
      replyToUserId = parents[0].user_id
    }
    await query(
      'INSERT INTO item_comments (item_id, user_id, parent_comment_id, reply_to_user_id, content) VALUES (?, ?, ?, ?, ?)',
      [itemId, req.user.userId, parentId, replyToUserId, content]
    )
    res.status(201).json({ message: '留言成功' })
  } catch (err) {
    console.error('发表物品留言失败:', err.message)
    res.status(500).json({ message: '留言失败', error: err.message })
  }
})

// ============================================================
// 物品收藏
// ============================================================

// 收藏 / 取消收藏（切换）
socialRouter.post('/items/:itemId/favorite', requireAuth, async (req, res) => {
  const itemId = Number(req.params.itemId)
  const userId = req.user.userId
  try {
    const { rows } = await query('SELECT * FROM items WHERE item_id = ?', [itemId])
    if (rows.length === 0) return res.status(404).json({ message: '物品不存在' })
    const exist = await query(
      'SELECT * FROM item_favorites WHERE user_id = ? AND item_id = ?',
      [userId, itemId]
    )
    let favorited = false
    if (exist.rows.length > 0) {
      await query('DELETE FROM item_favorites WHERE user_id = ? AND item_id = ?', [userId, itemId])
    } else {
      await query('INSERT INTO item_favorites (user_id, item_id) VALUES (?, ?)', [userId, itemId])
      favorited = true
    }
    const count = await query(
      'SELECT COUNT(*) AS n FROM item_favorites WHERE item_id = ?',
      [itemId]
    )
    res.json({ favorited, favoriteCount: Number(count.rows[0].n || 0) })
  } catch (err) {
    console.error('收藏操作失败:', err.message)
    res.status(500).json({ message: '操作失败', error: err.message })
  }
})

// 我的收藏列表
socialRouter.get('/favorites', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT i.*, u.name AS owner_name, u.nickname AS owner_nickname, u.avatar_url AS owner_avatar, u.signature AS owner_signature,
              (SELECT COUNT(*) FROM item_favorites f WHERE f.item_id = i.item_id) AS favorite_count,
              1 AS favorited,
              (SELECT COUNT(*) FROM item_comments c WHERE c.item_id = i.item_id) AS comment_count
       FROM item_favorites fav
       JOIN items i ON i.item_id = fav.item_id
       JOIN users u ON u.user_id = i.owner_id
       WHERE fav.user_id = ?
       ORDER BY fav.created_at DESC`,
      [req.user.userId]
    )
    res.json(rows.map(toItemRow))
  } catch (err) {
    console.error('获取我的收藏失败:', err.message)
    res.status(500).json({ message: '获取收藏失败', error: err.message })
  }
})
