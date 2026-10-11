import express from 'express'
import cors from 'cors'
import compression from 'compression'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import xlsx from 'xlsx'
import { query, testConnection } from './config/database.js'
import { hashPassword, verifyPassword, signToken, verifyToken, encryptField } from './config/security.js'
import { platformRouter } from './config/platform-routes.js'
import { socialRouter } from './config/social-routes.js'
import { friendRouter } from './config/friend-routes.js'

// ============================================================
// 【后端主入口 server.js】职责：
//   1. 创建 Express 应用：CORS + JSON 解析 + 全局请求日志(密码/密保答案等字段打码)
//   2. 配置 multer 图片上传：白名单类型(JPG/PNG/GIF/WebP) + 5MB 限制 + 随机文件名
//   3. 挂载路由：
//      - /uploads                    图片静态访问 + 登录用户上传图片
//      - /api/v1 platformRouter      物品租借平台(物品/求租/私信/资料)
//      - /api/v1 friendRouter        好友(申请/同意/列表/解除)
//      - /api/v1 socialRouter        论坛/物品留言/收藏
//      - /api/v1 二手书模块接口      图书/用户/借阅记录/操作日志(定义在本文件)
//   4. 启动时先测试数据库连接，成功后监听 3001 端口
//
// 一次请求的流转：
//   浏览器 →(开发期经 Vite 代理)→ Express → 请求日志中间件 → JSON 解析
//   → 鉴权中间件(解析 Bearer token → 反查数据库确认用户有效未禁用)
//   → 权限校验(requireAdmin) → 业务路由 → SQL 操作 → JSON 响应
// ============================================================
const app = express()
const PORT = process.env.PORT || 3001

const allowedOrigins = String(process.env.APP_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)
app.use(cors(allowedOrigins.length ? { origin: allowedOrigins } : undefined))
app.use(compression({ threshold: 1024 }))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Opt-in compact request logging; never print request bodies or credentials.
app.use((req, res, next) => {
  if (process.env.LOG_REQUESTS === '1') {
    const started = Date.now()
    res.on('finish', () => console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - started}ms`))
  }
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'private, no-cache')
  next()
})

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }))

// 图片上传配置
const uploadDir = 'uploads'
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname)
    const filename = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${ext}`
    cb(null, filename)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('只支持 JPG、PNG、GIF、WebP 格式的图片'))
    }
  }
})

// 聊天附件上传配置：图片 + 常见文档，最大 20MB
const chatUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedImages = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    const allowedDocs = [
      'application/pdf', 'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip', 'application/x-zip-compressed',
    ]
    if (allowedImages.includes(file.mimetype) || allowedDocs.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('不支持的文件类型，支持图片和常见办公文档'))
    }
  }
})

app.use('/uploads', express.static(uploadDir, { maxAge: '7d', immutable: true }))
app.use('/api/v1', platformRouter)
app.use('/api/v1', friendRouter)
app.use('/api/v1', socialRouter)

// ==================== 鉴权中间件 ====================

// 验证登录态（从 Authorization Bearer 头解析 token）
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '请先登录' })
  }
  try {
    const token = authHeader.slice(7)
    const payload = verifyToken(token)
    // 确认用户仍然存在且未被禁用
    const { rows } = await query('SELECT * FROM users WHERE user_id = ? AND status = ?', [payload.userId, 'active'])
    if (rows.length === 0) {
      return res.status(401).json({ message: '账号不存在或已禁用' })
    }
    req.user = {
      userId: payload.userId,
      name: rows[0].name,
      role: rows[0].role,
      isAdmin: rows[0].role === 'reader_admin' || rows[0].role === 'book_admin',
    }
    next()
  } catch (err) {
    return res.status(401).json({ message: '令牌无效或已过期，请重新登录' })
  }
}

// 验证管理员权限（需在 requireAuth 之后使用）
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ message: '需要管理员权限' })
  }
  next()
}

// 添加日志到数据库
const addLog = async (action, detail, operator) => {
  try {
    await query('INSERT INTO logs (action, detail, operator) VALUES (?, ?, ?)', [action, detail, operator || null])
  } catch (err) {
    console.error('日志记录失败:', err.message)
  }
}

// 生成唯一书号 BOOK-00001 格式
async function generateBookCode() {
  const { rows } = await query(
    "SELECT book_code FROM books ORDER BY internal_id DESC LIMIT 1"
  )
  if (rows.length === 0 || !rows[0].book_code) return 'BOOK-00001'
  const last = rows[0].book_code
  const match = last.match(/\d+/)
  const num = match ? parseInt(match[0], 10) + 1 : 1
  return `BOOK-${String(num).padStart(5, '0')}`
}

// 带重试的插入，防止并发下 book_code 唯一键冲突
async function insertBookWithRetry(bookData, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const bookCode = await generateBookCode()
    try {
      await query(
        'INSERT INTO books (book_code, isbn, title, author, owner, cover_image_url, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [bookCode, bookData.isbn, bookData.title, bookData.author, bookData.owner, bookData.coverImageUrl, 'available', bookData.now]
      )
      return bookCode
    } catch (err) {
      // 唯一键冲突则重试，其他错误直接抛出
      if (err.code === 'ER_DUP_ENTRY' && attempt < maxRetries - 1) {
        console.warn(`⚠️ book_code 冲突 (${bookCode})，重试第 ${attempt + 1} 次...`)
        continue
      }
      throw err
    }
  }
}

// 统一将数据库行转为前端 book 对象
function toBook(row) {
  return {
    bookCode: row.book_code,
    internalId: row.internal_id,
    isbn: row.isbn,
    title: row.title,
    author: row.author,
    owner: row.owner || null,
    status: row.status,
    borrowerName: row.borrower_name || null,
    borrowDate: row.borrow_date || null,
    coverImageUrl: row.cover_image_url,
    createdAt: row.created_at
  }
}

// ==================== 图书管理 ====================

// 获取图书列表（公开可读）
app.get('/api/v1/books', async (_, res) => {
  try {
    const { rows } = await query(
      `SELECT b.*, br.borrower_name, br.borrow_date
       FROM books b
       LEFT JOIN borrow_records br ON b.book_code = br.book_code AND br.status = 'borrowing'
       ORDER BY b.created_at DESC`
    )
    res.json(rows.map(toBook))
  } catch (err) {
    console.error('获取图书列表失败:', err.message)
    res.status(500).json({ message: '获取图书列表失败', error: err.message })
  }
})

// 添加图书（需管理员权限）
app.post('/api/v1/books', requireAuth, requireAdmin, async (req, res) => {
  const { title, author, isbn, coverImageUrl, owner } = req.body
  if (!title || !author || !isbn) return res.status(400).json({ message: '书名、作者、ISBN均为必填' })

  const isbnTrimmed = isbn.trim()
  if (isbnTrimmed.length < 10 || isbnTrimmed.length > 20) {
    return res.status(400).json({ message: `ISBN 长度不符合规范（当前 ${isbnTrimmed.length} 位，应为 10-20 位）` })
  }

  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    const bookCode = await insertBookWithRetry({
      isbn: isbnTrimmed,
      title: title.trim(),
      author: author.trim(),
      owner: owner?.trim() || null,
      coverImageUrl: coverImageUrl || null,
      now,
    })

    await addLog('二手书新增', `新增《${title.trim()}》书号: ${bookCode}${owner ? '，归属人: ' + owner.trim() : ''}`, req.user?.name)
    res.status(201).json({
      bookCode,
      isbn: isbnTrimmed,
      title: title.trim(),
      author: author.trim(),
      owner: owner?.trim() || null,
      coverImageUrl: coverImageUrl || null,
      status: 'available'
    })
  } catch (err) {
    console.error('添加图书失败:', err.message)
    res.status(500).json({ message: '添加图书失败', error: err.message })
  }
})

// ==================== 批量导出（必须在 :bookCode 之前） ====================

// 批量导出图书接口（Excel）
app.get('/api/v1/books/export', async (req, res) => {
  const { fields, search } = req.query
  let exportFields = ['bookCode', 'isbn', 'title', 'author', 'status']

  if (fields) {
    const requestedFields = fields.split(',')
    const availableFields = ['bookCode', 'isbn', 'internalId', 'title', 'author', 'owner', 'status', 'borrowerName', 'borrowDate', 'coverImageUrl', 'createdAt']
    exportFields = requestedFields.filter(f => availableFields.includes(f))
    if (exportFields.length === 0) {
      exportFields = ['bookCode', 'isbn', 'title', 'author', 'status']
    }
  }

  try {
    let sql = `SELECT b.*, br.borrower_name, br.borrow_date
       FROM books b
       LEFT JOIN borrow_records br ON b.book_code = br.book_code AND br.status = 'borrowing'`
    const params = []
    if (search && search.trim()) {
      const keyword = `%${search.trim()}%`
      sql += ` WHERE b.title LIKE ? OR b.author LIKE ? OR b.isbn LIKE ? OR b.book_code LIKE ?`
      params.push(keyword, keyword, keyword, keyword)
    }
    sql += ` ORDER BY b.created_at DESC`
    const { rows } = await query(sql, params)
    const books = rows.map(toBook)

    const fieldLabelMap = {
      bookCode: '书号',
      isbn: 'ISBN',
      internalId: '内部编号',
      title: '书名',
      author: '作者',
      owner: '归属人',
      status: '状态',
      borrowerName: '借阅人',
      borrowDate: '借阅日期',
      coverImageUrl: '封面图片',
      createdAt: '创建时间'
    }
    const statusMap = { available: '可借阅', borrowed: '已借出', discarded: '已报废' }

    const data = books.map(book => {
      const row = {}
      exportFields.forEach(field => {
        let value = book[field] !== null && book[field] !== undefined ? book[field] : ''
        if (field === 'status') {
          value = statusMap[value] || value
        }
        row[fieldLabelMap[field] || field] = value
      })
      return row
    })

    const worksheet = xlsx.utils.json_to_sheet(data)
    const workbook = xlsx.utils.book_new()
    xlsx.utils.book_append_sheet(workbook, worksheet, '图书数据')

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename=books_${Date.now()}.xlsx`)
    res.send(buffer)

    await addLog('批量导出', `导出图书 ${books.length} 本${search ? '（筛选: ' + search.trim() + '）' : ''}`)
  } catch (err) {
    res.status(500).json({ message: '导出失败', error: err.message })
  }
})

// CSV格式导出
app.get('/api/v1/books/export/csv', async (req, res) => {
  const { fields, search } = req.query
  let exportFields = ['bookCode', 'isbn', 'title', 'author', 'status']

  if (fields) {
    const requestedFields = fields.split(',')
    const availableFields = ['bookCode', 'isbn', 'internalId', 'title', 'author', 'owner', 'status', 'borrowerName', 'borrowDate', 'coverImageUrl', 'createdAt']
    exportFields = requestedFields.filter(f => availableFields.includes(f))
    if (exportFields.length === 0) {
      exportFields = ['bookCode', 'isbn', 'title', 'author', 'status']
    }
  }

  try {
    let sql = `SELECT b.*, br.borrower_name, br.borrow_date
       FROM books b
       LEFT JOIN borrow_records br ON b.book_code = br.book_code AND br.status = 'borrowing'`
    const params = []
    if (search && search.trim()) {
      const keyword = `%${search.trim()}%`
      sql += ` WHERE b.title LIKE ? OR b.author LIKE ? OR b.isbn LIKE ? OR b.book_code LIKE ?`
      params.push(keyword, keyword, keyword, keyword)
    }
    sql += ` ORDER BY b.created_at DESC`
    const { rows } = await query(sql, params)
    const books = rows.map(toBook)

    const fieldLabelMap = {
      bookCode: '书号',
      isbn: 'ISBN',
      internalId: '内部编号',
      title: '书名',
      author: '作者',
      owner: '归属人',
      status: '状态',
      borrowerName: '借阅人',
      borrowDate: '借阅日期',
      coverImageUrl: '封面图片',
      createdAt: '创建时间'
    }
    const statusMap = { available: '可借阅', borrowed: '已借出', discarded: '已报废' }
    const escapeCsvField = (value) => {
      const str = String(value == null ? '' : value)
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"'
      }
      return str
    }

    const headers = exportFields.map(f => fieldLabelMap[f] || f)
    const rowsData = books.map(book =>
      exportFields.map(field => {
        let value = book[field] !== null && book[field] !== undefined ? book[field] : ''
        if (field === 'status') {
          value = statusMap[value] || value
        }
        return escapeCsvField(value)
      })
    )

    const csvContent = [headers.join(','), ...rowsData.map(row => row.join(','))].join('\n')

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename=books_${Date.now()}.csv`)
    res.send(`﻿${csvContent}`)

    await addLog('CSV导出', `导出图书 ${books.length} 本${search ? '（筛选: ' + search.trim() + '）' : ''}`)
  } catch (err) {
    res.status(500).json({ message: '导出失败', error: err.message })
  }
})

// 获取单本图书信息（需登录）
app.get('/api/v1/books/:bookCode', requireAuth, async (req, res) => {
  const { bookCode } = req.params

  try {
    const { rows } = await query(
      `SELECT b.*, br.borrower_name, br.borrow_date
       FROM books b
       LEFT JOIN borrow_records br ON b.book_code = br.book_code AND br.status = 'borrowing'
       WHERE b.book_code = ?`,
      [bookCode]
    )
    if (rows.length === 0) {
      return res.status(404).json({ message: '图书不存在' })
    }

    res.json(toBook(rows[0]))
  } catch (err) {
    console.error('获取图书信息失败:', err.message)
    res.status(500).json({ message: '获取图书信息失败', error: err.message })
  }
})

// 更新图书信息（需管理员权限）
app.put('/api/v1/books/:bookCode', requireAuth, requireAdmin, async (req, res) => {
  const { bookCode } = req.params
  const { title, author, isbn, coverImageUrl, owner } = req.body

  if (!title || !author) {
    return res.status(400).json({ message: '书名和作者均为必填' })
  }

  try {
    const { rows } = await query('SELECT * FROM books WHERE book_code = ?', [bookCode])
    if (rows.length === 0) {
      return res.status(404).json({ message: '图书不存在' })
    }

    const current = rows[0]
    const nextIsbn = isbn !== undefined ? isbn.trim() : current.isbn
    const nextOwner = owner !== undefined ? (owner?.trim() || null) : current.owner

    await query(
      'UPDATE books SET title = ?, author = ?, isbn = ?, owner = ?, cover_image_url = ? WHERE book_code = ?',
      [title.trim(), author.trim(), nextIsbn, nextOwner, coverImageUrl !== undefined ? coverImageUrl : current.cover_image_url, bookCode]
    )

    const { rows: updatedRows } = await query(
      `SELECT b.*, br.borrower_name, br.borrow_date
       FROM books b
       LEFT JOIN borrow_records br ON b.book_code = br.book_code AND br.status = 'borrowing'
       WHERE b.book_code = ?`,
      [bookCode]
    )

    await addLog('二手书修改', `修改书号 ${bookCode}《${title.trim()}》信息`)
    res.json(toBook(updatedRows[0]))
  } catch (err) {
    console.error('更新图书失败:', err.message)
    res.status(500).json({ message: '更新图书失败', error: err.message })
  }
})

// 删除图书（需管理员权限）
app.delete('/api/v1/books/:bookCode', requireAuth, requireAdmin, async (req, res) => {
  const { bookCode } = req.params

  try {
    const { rows } = await query('SELECT * FROM books WHERE book_code = ?', [bookCode])
    if (rows.length === 0) {
      return res.status(404).json({ message: '图书不存在' })
    }

    if (rows[0].status === 'borrowed') {
      return res.status(400).json({ message: '无法删除已借出的图书' })
    }

    await query('DELETE FROM books WHERE book_code = ?', [bookCode])
    await addLog('二手书删除', `删除图书 书号: ${bookCode}`)
    res.json({ ok: true })
  } catch (err) {
    console.error('删除图书失败:', err.message)
    res.status(500).json({ message: '删除图书失败', error: err.message })
  }
})

// 借阅图书（需登录，由后端校验用户身份）
app.post('/api/v1/books/:bookCode/borrow', requireAuth, (_req, res) => {
  res.status(410).json({ message: '旧业务已停止，请到交易市集购买商品' })
})

// 归还图书（需登录）
app.post('/api/v1/books/:bookCode/return', requireAuth, async (req, res) => {
  const { bookCode } = req.params

  try {
    const { rows } = await query('SELECT * FROM books WHERE book_code = ?', [bookCode])
    if (rows.length === 0) {
      return res.status(404).json({ message: '图书不存在' })
    }

    if (rows[0].status !== 'borrowed') {
      return res.status(400).json({ message: '图书未被借出' })
    }

    const returnDate = new Date().toISOString().slice(0, 10)

    await query('UPDATE books SET status = ? WHERE book_code = ?', ['available', bookCode])
    await query(
      'UPDATE borrow_records SET return_date = ?, status = ? WHERE book_code = ? AND status = ?',
      [returnDate, 'returned', bookCode, 'borrowing']
    )

    await addLog('图书归还', `归还《${rows[0].title}》(书号: ${bookCode})`)

    const { rows: updatedRows } = await query(
      `SELECT b.*, br.borrower_name, br.borrow_date
       FROM books b
       LEFT JOIN borrow_records br ON b.book_code = br.book_code AND br.status = 'borrowing'
       WHERE b.book_code = ?`,
      [bookCode]
    )
    res.json(toBook(updatedRows[0]))
  } catch (err) {
    console.error('归还图书失败:', err.message)
    res.status(500).json({ message: '归还图书失败', error: err.message })
  }
})

// 报废图书（需管理员权限）
app.post('/api/v1/books/:bookCode/discard', requireAuth, requireAdmin, async (req, res) => {
  const { bookCode } = req.params

  try {
    const { rows } = await query('SELECT * FROM books WHERE book_code = ?', [bookCode])
    if (rows.length === 0) {
      return res.status(404).json({ message: '图书不存在' })
    }

    if (rows[0].status === 'discarded') {
      return res.status(400).json({ message: '图书已处于报废状态' })
    }

    if (rows[0].status === 'borrowed') {
      return res.status(400).json({ message: '无法报废已借出的图书，请先归还' })
    }

    await query('UPDATE books SET status = ? WHERE book_code = ?', ['discarded', bookCode])

    await addLog('图书报废', `报废《${rows[0].title}》(书号: ${bookCode})`)

    const { rows: updatedRows } = await query(
      `SELECT b.*, br.borrower_name, br.borrow_date
       FROM books b
       LEFT JOIN borrow_records br ON b.book_code = br.book_code AND br.status = 'borrowing'
       WHERE b.book_code = ?`,
      [bookCode]
    )
    res.json(toBook(updatedRows[0]))
  } catch (err) {
    console.error('报废图书失败:', err.message)
    res.status(500).json({ message: '报废图书失败', error: err.message })
  }
})

// 图片上传接口（需管理员权限）
app.post('/api/v1/uploads', requireAuth, upload.single('cover'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '请选择要上传的图片' })
    }
    const imageUrl = `/uploads/${req.file.filename}`
    res.json({ url: imageUrl, filename: req.file.filename })
  } catch (err) {
    res.status(500).json({ message: '图片上传失败', error: err.message })
  }
})

// 图片上传接口（租借平台使用，需登录）— 前端经 Vite 代理以 /uploads 访问
app.post('/uploads', requireAuth, upload.single('cover'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '请选择要上传的图片' })
    }
    const imageUrl = `/uploads/${req.file.filename}`
    res.json({ url: imageUrl, filename: req.file.filename })
  } catch (err) {
    res.status(500).json({ message: '图片上传失败', error: err.message })
  }
})

// 聊天附件上传接口（图片/文档，最大 20MB，需登录）
app.post('/uploads/chat', requireAuth, chatUpload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: '请选择要上传的文件' })
    }
    res.json({ url: `/uploads/${req.file.filename}`, size: req.file.size })
  } catch (err) {
    res.status(500).json({ message: '文件上传失败', error: err.message })
  }
})

// 删除图片接口（需管理员权限）
app.delete('/api/v1/uploads/:filename', requireAuth, (req, res) => {
  const { filename } = req.params
  try {
    const filePath = path.join(uploadDir, filename)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ message: '图片删除失败', error: err.message })
  }
})

// 批量导入图书接口（需管理员权限）
app.post('/api/v1/books/batch', requireAuth, requireAdmin, async (req, res) => {
  const { books } = req.body
  if (!Array.isArray(books) || books.length === 0) {
    return res.status(400).json({ message: '请提供要导入的图书数据' })
  }

  const results = { inserted: 0, failed: 0, errors: [] }
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')

  for (let i = 0; i < books.length; i++) {
    const book = books[i]
    const rowNum = i + 1

    // 逐字段验证
    const missingFields = []
    if (!book.title || !String(book.title).trim()) missingFields.push('书名')
    if (!book.author || !String(book.author).trim()) missingFields.push('作者')
    if (!book.isbn || !String(book.isbn).trim()) missingFields.push('ISBN')

    if (missingFields.length > 0) {
      results.failed++
      results.errors.push({
        row: rowNum,
        isbn: book.isbn ? String(book.isbn).trim() || '空' : '空',
        reason: `缺少必填字段：${missingFields.join('、')}`
      })
      continue
    }

    const isbnTrimmed = String(book.isbn).trim()
    if (isbnTrimmed.length < 10 || isbnTrimmed.length > 20) {
      results.failed++
      results.errors.push({
        row: rowNum,
        isbn: isbnTrimmed,
        reason: `ISBN 长度不符合规范（当前 ${isbnTrimmed.length} 位，应为 10-20 位）`
      })
      continue
    }

    try {
      const bookCode = await insertBookWithRetry({
        isbn: isbnTrimmed,
        title: String(book.title).trim(),
        author: String(book.author).trim(),
        owner: book.owner?.trim() || null,
        coverImageUrl: book.coverImageUrl || null,
        now,
      })
      results.inserted++
    } catch (err) {
      results.failed++
      results.errors.push({
        row: rowNum,
        isbn: isbnTrimmed,
        reason: `数据库写入失败: ${err.message}`
      })
    }
  }

  await addLog('批量导入', `批量导入图书：共 ${books.length} 条，新增 ${results.inserted} 本，失败 ${results.failed} 本`)
  res.json(results)
})

// ==================== 用户管理 ====================

// 获取用户列表（需管理员权限）
app.get('/api/v1/users', requireAuth, requireAdmin, async (_, res) => {
  try {
    const { rows } = await query('SELECT * FROM users ORDER BY created_at DESC')
    const users = rows.map(row => ({
      userId: row.user_id,
      accountNo: row.account_no,
      name: row.name,
      role: row.role,
      status: row.status,
      createdAt: row.created_at,
      isAdmin: row.role === 'reader_admin' || row.role === 'book_admin'
    }))
    res.json(users)
  } catch (err) {
    console.error('获取用户列表失败:', err.message)
    res.status(500).json({ message: '获取用户列表失败', error: err.message })
  }
})

// 添加用户（需管理员权限）
app.post('/api/v1/users', requireAuth, requireAdmin, async (req, res) => {
  const { accountNo, name, password, role } = req.body
  if (!accountNo || !name) return res.status(400).json({ message: '账号和姓名均为必填' })
  const nextRole = role || 'user'
  if (!['user', 'reader_admin', 'book_admin'].includes(nextRole)) {
    return res.status(400).json({ message: '角色不合法' })
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE account_no = ?', [accountNo.trim()])
    if (rows.length > 0) return res.status(409).json({ message: '账号已存在' })

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    await query(
      'INSERT INTO users (account_no, name, password, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [accountNo.trim(), name.trim(), hashPassword(password || '123456'), nextRole, 'active', now]
    )

    await addLog('用户新增', `新增用户 ${name.trim()}`, req.user?.name)
    res.status(201).json({ accountNo: accountNo.trim(), name: name.trim(), role: nextRole })
  } catch (err) {
    console.error('添加用户失败:', err.message)
    res.status(500).json({ message: '添加用户失败', error: err.message })
  }
})

// 修改自己的密码（所有已登录用户可用）
app.put('/api/v1/users/me/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword) return res.status(400).json({ message: '请输入当前密码' })
  if (!newPassword || !newPassword.trim()) return res.status(400).json({ message: '新密码不能为空' })
  if (newPassword.trim().length < 4) return res.status(400).json({ message: '新密码至少4位' })

  try {
    const { rows } = await query('SELECT * FROM users WHERE user_id = ?', [req.user.userId])
    if (rows.length === 0) return res.status(404).json({ message: '用户不存在' })

    const user = rows[0]
    if (!verifyPassword(currentPassword, user.password)) {
      return res.status(400).json({ message: '当前密码错误' })
    }

    const newHash = hashPassword(newPassword.trim())
    await query('UPDATE users SET password = ? WHERE user_id = ?', [newHash, req.user.userId])
    await addLog('密码修改', `${user.name} 修改了自己的密码`, user.name)
    res.json({ message: '密码修改成功' })
  } catch (err) {
    console.error('密码修改失败:', err.message)
    res.status(500).json({ message: '密码修改失败', error: err.message })
  }
})

// 更新用户（需管理员权限）
app.put('/api/v1/users/:userId', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params
  const { name, password, role, status } = req.body

  try {
    const { rows } = await query('SELECT * FROM users WHERE user_id = ?', [userId])
    if (rows.length === 0) {
      return res.status(404).json({ message: '用户不存在' })
    }

    const current = rows[0]
    const isSelf = Number(userId) === Number(req.user.userId)
    if (isSelf && (role !== undefined || status !== undefined)) {
      return res.status(400).json({ message: '不能修改自己的角色或账号状态' })
    }
    if (role !== undefined && !['user', 'reader_admin', 'book_admin'].includes(role)) {
      return res.status(400).json({ message: '角色不合法' })
    }
    if (status !== undefined && !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ message: '账号状态不合法' })
    }
    const nextName = name !== undefined ? name.trim() : current.name
    const nextPassword = password !== undefined ? hashPassword(password) : current.password
    const nextRole = role !== undefined ? role : current.role
    const nextStatus = status !== undefined ? status : current.status

    await query(
      'UPDATE users SET name = ?, password = ?, role = ?, status = ? WHERE user_id = ?',
      [nextName, nextPassword, nextRole, nextStatus, userId]
    )

    await addLog('用户修改', `修改用户 ID: ${userId}`)
    res.json({ message: '更新成功' })
  } catch (err) {
    console.error('更新用户失败:', err.message)
    res.status(500).json({ message: '更新用户失败', error: err.message })
  }
})

// 删除用户（需管理员权限）
app.delete('/api/v1/users/:userId', requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.params

  try {
    if (Number(userId) === Number(req.user.userId)) {
      return res.status(400).json({ message: '不能删除自己的账号' })
    }
    await query('DELETE FROM users WHERE user_id = ?', [userId])
    await addLog('用户删除', `删除用户 ID: ${userId}`)
    res.json({ ok: true })
  } catch (err) {
    console.error('删除用户失败:', err.message)
    res.status(500).json({ message: '删除用户失败', error: err.message })
  }
})

// 用户登录（密码使用 AES 加密验证，返回 HMAC 签名 token）
app.post('/api/v1/users/login', async (req, res) => {
  const { accountNo, password } = req.body

  if (!accountNo) {
    return res.status(400).json({ message: '账号不能为空' })
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE account_no = ? AND status = ?', [accountNo.trim(), 'active'])

    if (rows.length === 0) {
      return res.status(401).json({ message: '账号不存在或已禁用' })
    }

    const user = rows[0]
    const isAdmin = user.role === 'reader_admin' || user.role === 'book_admin'

    if (!verifyPassword(password || '', user.password)) {
      return res.status(401).json({ message: '密码错误' })
    }

    // 签发真正的 HMAC 签名 token（替代之前的假 token）
    const token = signToken({ userId: user.user_id, role: user.role, name: user.name })

    await addLog('用户登录', `${user.name} 登录系统`, user.name)
    res.json({
      userId: user.user_id,
      accountNo: user.account_no,
      name: user.name,
      role: user.role,
      isAdmin,
      token,
      nickname: user.nickname || null,
      avatarUrl: user.avatar_url || null,
    })
  } catch (err) {
    console.error('登录失败:', err.message)
    res.status(500).json({ message: '登录失败', error: err.message })
  }
})

// 用户注册（公开接口，注册身份固定为普通读者）
// 可选绑定身份证：仅当勾选绑定时才要求填写姓名与身份证号，敏感信息 AES 加密后存储
app.post('/api/v1/users/register', async (req, res) => {
  const { accountNo, name, password, securityQuestion, securityAnswer, realName, idCard } = req.body

  if (!accountNo || !String(accountNo).trim()) return res.status(400).json({ message: '账号不能为空' })
  if (!name || !String(name).trim()) return res.status(400).json({ message: '名称不能为空' })
  if (!password || String(password).length < 4) return res.status(400).json({ message: '密码至少4位' })
  if (!securityQuestion || !String(securityQuestion).trim()) return res.status(400).json({ message: '请选择密保问题' })
  if (!securityAnswer || !String(securityAnswer).trim()) return res.status(400).json({ message: '密保答案不能为空' })

  const account = String(accountNo).trim()
  const cleanName = String(name).trim()

  // 实名绑定：姓名与身份证号必须同时提供，且校验身份证格式（15 位或 18 位，末位可为 X）
  const hasRealName = realName !== undefined && String(realName).trim() !== ''
  const hasIdCard = idCard !== undefined && String(idCard).trim() !== ''
  if (hasRealName !== hasIdCard) return res.status(400).json({ message: '绑定身份证时，姓名和身份证号都必须填写' })
  let cleanRealName = null
  let cleanIdCard = null
  if (hasRealName && hasIdCard) {
    cleanRealName = String(realName).trim()
    cleanIdCard = String(idCard).trim().toUpperCase()
    if (!/^(\d{15}|\d{17}[\dX])$/.test(cleanIdCard)) {
      return res.status(400).json({ message: '身份证号格式不正确（15 或 18 位）' })
    }
  }

  try {
    const { rows } = await query('SELECT * FROM users WHERE account_no = ?', [account])
    if (rows.length > 0) return res.status(409).json({ message: '该账号已被注册，请换一个' })

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
    await query(
      'INSERT INTO users (account_no, name, real_name, id_card, password, role, status, security_question, security_answer, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        account,
        cleanName,
        cleanRealName ? encryptField(cleanRealName) : null,
        cleanIdCard ? encryptField(cleanIdCard) : null,
        hashPassword(password),
        'user',
        'active',
        String(securityQuestion).trim(),
        hashPassword(String(securityAnswer).trim()),
        now,
      ]
    )

    await addLog('用户注册', `新用户注册 ${cleanName}（账号 ${account}）${cleanIdCard ? '，已绑定身份证' : ''}`)
    res.status(201).json({ message: '注册成功', accountNo: account, name: cleanName, role: 'user' })
  } catch (err) {
    console.error('用户注册失败:', err.message)
    res.status(500).json({ message: '注册失败', error: err.message })
  }
})

// 找回密码第一步：根据账号返回密保问题
app.post('/api/v1/users/forgot-question', async (req, res) => {
  const { accountNo } = req.body
  if (!accountNo || !String(accountNo).trim()) return res.status(400).json({ message: '请输入账号' })

  try {
    const { rows } = await query('SELECT * FROM users WHERE account_no = ?', [String(accountNo).trim()])
    if (rows.length === 0) return res.status(404).json({ message: '账号不存在' })

    const user = rows[0]
    if (!user.security_question) {
      return res.status(400).json({ message: '该账号未设置密保问题，无法自助找回，请联系管理员重置密码' })
    }
    res.json({ accountNo: user.account_no, securityQuestion: user.security_question })
  } catch (err) {
    console.error('获取密保问题失败:', err.message)
    res.status(500).json({ message: '获取密保问题失败', error: err.message })
  }
})

// 找回密码第二步：校验密保答案并重置密码
app.post('/api/v1/users/forgot-reset', async (req, res) => {
  const { accountNo, securityAnswer, newPassword } = req.body
  if (!accountNo || !String(accountNo).trim()) return res.status(400).json({ message: '请输入账号' })
  if (!securityAnswer || !String(securityAnswer).trim()) return res.status(400).json({ message: '请输入密保答案' })
  if (!newPassword || String(newPassword).length < 4) return res.status(400).json({ message: '新密码至少4位' })

  try {
    const { rows } = await query('SELECT * FROM users WHERE account_no = ? AND status = ?', [String(accountNo).trim(), 'active'])
    if (rows.length === 0) return res.status(404).json({ message: '账号不存在或已禁用' })

    const user = rows[0]
    if (!user.security_question || !user.security_answer) {
      return res.status(400).json({ message: '该账号未设置密保问题，无法自助找回，请联系管理员重置密码' })
    }
    if (!verifyPassword(String(securityAnswer).trim(), user.security_answer)) {
      return res.status(400).json({ message: '密保答案不正确' })
    }

    await query('UPDATE users SET password = ? WHERE user_id = ?', [hashPassword(newPassword), user.user_id])
    await addLog('密码找回', `${user.name} 通过密保问题重置了密码`, user.name)
    res.json({ message: '密码重置成功，请使用新密码登录' })
  } catch (err) {
    console.error('找回密码失败:', err.message)
    res.status(500).json({ message: '找回密码失败', error: err.message })
  }
})

// ==================== 借阅记录 ====================

// 获取借阅记录（需登录）
app.get('/api/v1/borrow-records', requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT br.*, b.title AS book_title
       FROM borrow_records br
       LEFT JOIN books b ON br.book_code = b.book_code
       ORDER BY br.created_at DESC`
    )
    const records = rows.map(row => ({
      recordId: row.record_id,
      bookCode: row.book_code,
      bookTitle: row.book_title || null,
      userId: row.user_id,
      borrowerName: row.borrower_name,
      borrowDate: row.borrow_date,
      returnDate: row.return_date,
      status: row.status,
      createdAt: row.created_at
    }))
    res.json(records)
  } catch (err) {
    console.error('获取借阅记录失败:', err.message)
    res.status(500).json({ message: '获取借阅记录失败', error: err.message })
  }
})

// ==================== 日志管理 ====================

// 获取操作日志（需登录）
app.get('/api/v1/logs', requireAuth, async (_, res) => {
  try {
    const { rows } = await query('SELECT * FROM logs ORDER BY created_at DESC LIMIT 100')
    const logs = rows.map(row => ({
      id: row.id,
      action: row.action,
      detail: row.detail,
      operator: row.operator,
      createdAt: row.created_at
    }))
    res.json(logs)
  } catch (err) {
    console.error('获取日志失败:', err.message)
    res.status(500).json({ message: '获取日志失败', error: err.message })
  }
})

// 服务启动
async function startServer() {
  console.log('====================================')
  console.log('🚀 正在启动二手书管理系统...')
  console.log('====================================')

  console.log('\n📦 正在测试数据库连接...')
  const dbResult = await testConnection()

  if (dbResult.success) {
    console.log('✅ 数据库连接成功！')
    console.log(`   数据库: ${dbResult.database}`)
    console.log(`   主机: ${dbResult.host}`)
  } else {
    console.error('❌ 数据库连接失败:', dbResult.message)
    console.error('💡 建议:', dbResult.suggestion)
    process.exit(1)
  }

  app.listen(PORT, () => {
    console.log('\n🎉 服务器启动成功！')
    console.log(`📍 服务地址: http://localhost:${PORT}`)
    console.log(`📡 API文档: http://localhost:${PORT}/api/v1/books`)
    console.log('====================================')
  })
}

startServer().catch(err => {
  console.error('❌ 服务器启动失败:', err.message)
  process.exit(1)
})
