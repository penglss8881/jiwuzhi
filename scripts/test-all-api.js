// 全量 API 测试脚本
const BASE = 'http://localhost:3001'

async function req(method, url, body, token) {
  const headers = {}
  if (token) headers['Authorization'] = 'Bearer ' + token
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

const get    = (url, token)            => req('GET', url, null, token)
const post   = (url, body, token)      => req('POST', url, body, token)
const put    = (url, body, token)      => req('PUT', url, body, token)
const del    = (url, token)            => req('DELETE', url, null, token)

let pass = 0, fail = 0
function test(name, condition, detail = '') {
  if (condition) { console.log('  \x1b[32m✅\x1b[0m ' + name); pass++ }
  else { console.log('  \x1b[31m❌\x1b[0m ' + name + (detail ? ' — ' + detail : '')); fail++ }
}

async function run() {
  // ===== 1. 登录 =====
  console.log('\n===== 1. 登录模块 =====')
  const rLogin = await post(BASE + '/api/v1/users/login', { accountNo: '20260001', password: '123456' })
  test('读者登录(200)', rLogin.status === 200)
  test('token存在且有效', typeof rLogin.data.token === 'string' && rLogin.data.token.length > 20)
  test('isAdmin=false', rLogin.data.isAdmin === false)
  const rTok = rLogin.data.token

  const aLogin = await post(BASE + '/api/v1/users/login', { accountNo: 'A0001', password: 'admin123' })
  test('管理员登录(200)', aLogin.status === 200)
  test('isAdmin=true', aLogin.data.isAdmin === true)
  const aTok = aLogin.data.token

  test('错误密码→401', (await post(BASE + '/api/v1/users/login', { accountNo: '20260001', password: 'wrong' })).status === 401)

  // ===== 2. 鉴权拦截 =====
  console.log('\n===== 2. 鉴权拦截 =====')
  test('无token加书→401', (await post(BASE + '/api/v1/books', { title:'t',author:'a',isbn:'1234567890' })).status === 401)
  test('读者加书→403', (await post(BASE + '/api/v1/books', { title:'t',author:'a',isbn:'1234567890' }, rTok)).status === 403)
  test('假token→401', (await post(BASE + '/api/v1/books', { title:'t',author:'a',isbn:'1234567890' }, 'fake.token.here')).status === 401)
  test('无token查用户→401', (await get(BASE + '/api/v1/users')).status === 401)
  test('读者查用户→403', (await get(BASE + '/api/v1/users', rTok)).status === 403)

  // ===== 3. 图书列表（公开） =====
  console.log('\n===== 3. 图书列表（公开） =====')
  const books = await get(BASE + '/api/v1/books')
  test('获取图书列表(200)', books.status === 200)
  test('图书列表格式正确', Array.isArray(books.data))

  // ===== 4. 图书CRUD =====
  console.log('\n===== 4. 图书CRUD =====')
  const add = await post(BASE + '/api/v1/books', {
    title: '调试测试图书', author: '测试者', isbn: '9787111111111', owner: '张三'
  }, aTok)
  test('添加图书(201)', add.status === 201)
  test('生成合法bookCode', /^BOOK-\d{5,}$/.test(add.data.bookCode || ''))
  const code = add.data.bookCode

  test('ISBN过短→400', (await post(BASE + '/api/v1/books', { title:'x',author:'x',isbn:'123' }, aTok)).status === 400)

  const upd = await put(BASE + '/api/v1/books/' + code, { title: '已修改书名', author: '新作者', isbn: '9787222222222' }, aTok)
  test('更新图书(200)', upd.status === 200)

  const one = await get(BASE + '/api/v1/books/' + code, rTok)
  test('获取单本(200)', one.status === 200)
  test('书名已修改', one.data.title === '已修改书名')

  // ===== 5. 旧入口停用 =====
  console.log('\n===== 5. 旧入口停用 =====')
  test('管理员旧借阅入口→410', (await post(BASE + '/api/v1/books/' + code + '/borrow', {}, aTok)).status === 410)
  test('读者旧借阅入口→410', (await post(BASE + '/api/v1/books/' + code + '/borrow', {}, rTok)).status === 410)
  test('图书仍在库', (await get(BASE + '/api/v1/books/' + code, rTok)).data.status === 'available')

  // ===== 6. 报废/删除 =====
  console.log('\n===== 6. 报废/删除 =====')
  const disc = await post(BASE + '/api/v1/books/' + code + '/discard', {}, aTok)
  test('报废(200)', disc.status === 200)
  test('状态=discarded', disc.data.status === 'discarded')

  test('删除(200)', (await del(BASE + '/api/v1/books/' + code, aTok)).status === 200)
  // 验证已删除
  test('已删除→404', (await get(BASE + '/api/v1/books/' + code, rTok)).status === 404)

  // ===== 7. 用户管理 =====
  console.log('\n===== 7. 用户管理 =====')
  test('管理员查用户(200)', (await get(BASE + '/api/v1/users', aTok)).status === 200)

  const testAccount = `TEST${Date.now()}`
  const addUser = await post(BASE + '/api/v1/users', {
    accountNo: testAccount, name: '测试账号', password: 'mypwd123', role: 'user'
  }, aTok)
  test('创建用户(201)', addUser.status === 201)

  // Get the new user's ID from user list
  const userList = await get(BASE + '/api/v1/users', aTok)
  const newUser = userList.data.find(u => u.accountNo === testAccount)
  test('找到新用户', !!newUser)

  // Cleanup
  if (newUser) await del(BASE + '/api/v1/users/' + newUser.userId, aTok)

  // ===== 8. 日志（借还操作日志持久化） =====
  console.log('\n===== 8. 操作日志 =====')
  const logs = await get(BASE + '/api/v1/logs', aTok)
  test('日志(200)', logs.status === 200)
  test('有记录', Array.isArray(logs.data) && logs.data.length > 0)
  // ===== 9. 批量导入 =====
  console.log('\n===== 9. 批量导入 =====')
  const batch = await post(BASE + '/api/v1/books/batch', {
    books: [
      { isbn: '9787333333333', title: '批量书1', author: '作者A' },
      { isbn: '9787444444444', title: '批量书2', author: '作者B' },
    ]
  }, aTok)
  test('批量导入(200)', batch.status === 200)
  test('导入2本', batch.data.inserted === 2)

  // 清理批量书
  const allBooks = await get(BASE + '/api/v1/books')
  for (const b of allBooks.data) {
    if (b.title && (b.title.startsWith('批量书') || b.title === '批量1' || b.title === '批量2')) {
      await del(BASE + '/api/v1/books/' + b.bookCode, aTok)
    }
  }

  // ===== 10. 验证数据库加密 =====
  console.log('\n===== 10. 数据库密码加密验证 =====')
  // 通过用户列表确认密码字段不会暴露明文
  const usersRes = await get(BASE + '/api/v1/users', aTok)
  test('用户列表不返回password字段', usersRes.data.every(u => u.password === undefined))

  // ===== 结果 =====
  console.log('\n===== 🏆 测试结果 =====')
  console.log('  通过: \x1b[32m' + pass + '\x1b[0m')
  console.log('  失败: \x1b[31m' + fail + '\x1b[0m')
  if (fail > 0) {
    console.log('\n❌ 有测试失败，请检查！')
    process.exit(1)
  } else {
    console.log('\n✅ 全部测试通过！')
  }
}

run().catch(e => { console.error('测试异常:', e.message); process.exit(2) })
