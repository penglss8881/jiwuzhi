// 初始化测试数据脚本
import { query } from './database.js'
import { hashPassword } from './security.js'

// 初始图书数据（含归属人，book_code 自动生成）
const initialBooks = [
  { isbn: '9787115275790', title: 'JavaScript高级程序设计', author: 'Nicholas C. Zakas', owner: '张三' },
  { isbn: '9787115494924', title: 'React实战', author: 'Alex Banks', owner: '李四' },
  { isbn: '9787302330646', title: '算法导论', author: 'Thomas H. Cormen', owner: null },
  { isbn: '9787111407010', title: '深入理解计算机系统', author: 'Randal E. Bryant', owner: null },
  { isbn: '9787111407003', title: '设计模式', author: 'Erich Gamma', owner: null },
  { isbn: '9787115377375', title: 'Node.js实战', author: 'Mike Cantelon', owner: null },
  { isbn: '9787111544937', title: 'Python编程：从入门到实践', author: 'Eric Matthes', owner: null },
  { isbn: '9787115393929', title: 'Vue.js设计与实现', author: '霍春阳', owner: null },
]

// 初始用户数据（密码使用 PBKDF2 哈希）
const initialUsers = [
  { accountNo: '20260001', name: '张三', password: '123456', role: 'user' },
  { accountNo: '20260002', name: '李四', password: '123456', role: 'user' },
  { accountNo: 'A0001', name: '读者管理员-王老师', password: 'admin123', role: 'reader_admin' },
  { accountNo: 'B0001', name: '二手书管理员-陈老师', password: 'admin123', role: 'book_admin' },
]

/**
 * 初始化测试数据
 */
export async function initTestData() { // 初始化默认测试账号和图书数据
  try {
    console.log('📦 开始初始化测试数据...')

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ')

    // 先插入用户数据（密码使用 PBKDF2 哈希，账号明文存储）
    for (const user of initialUsers) {
      const { rows } = await query('SELECT * FROM users WHERE account_no = ?', [user.accountNo])
      if (rows.length === 0) {
        await query(
          'INSERT INTO users (account_no, name, password, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [user.accountNo, user.name, hashPassword(user.password), user.role, 'active', now]
        )
        console.log(`✅ 插入用户: ${user.name} (${user.accountNo})`)
      } else {
        console.log(`⚠️ 用户已存在: ${user.name}`)
      }
    }

    // 插入图书数据（自动生成 book_code）
    for (let i = 0; i < initialBooks.length; i++) {
      const book = initialBooks[i]
      const { rows } = await query('SELECT * FROM books WHERE isbn = ? AND title = ?', [book.isbn, book.title])
      if (rows.length === 0) {
        // 生成 book_code
        const { rows: maxRow } = await query(
          "SELECT book_code FROM books WHERE book_code IS NOT NULL ORDER BY internal_id DESC LIMIT 1"
        )
        let nextNum = i + 1
        if (maxRow.length > 0 && maxRow[0].book_code) {
          const match = maxRow[0].book_code.match(/\d+/)
          if (match) nextNum = parseInt(match[0], 10) + 1
        }
        const bookCode = `BOOK-${String(nextNum).padStart(5, '0')}`
        await query(
          'INSERT INTO books (book_code, isbn, title, author, owner, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [bookCode, book.isbn, book.title, book.author, book.owner || null, 'available', now]
        )
        console.log(`✅ 插入图书: ${bookCode} - ${book.title}${book.owner ? ' (归属: ' + book.owner + ')' : ''}`)
      } else {
        console.log(`⚠️ 图书已存在: ${book.title}`)
      }
    }

    console.log('\n🎉 测试数据初始化完成！')
    return true
  } catch (error) {
    console.error('❌ 初始化测试数据失败:', error.message)
    throw error
  }
}

// 如果直接运行此文件，则执行初始化
if (import.meta.url === `file://${process.argv[1]}`) {
  initTestData().then(() => {
    console.log('✅ 初始化完成，程序退出')
    process.exit(0)
  }).catch((error) => {
    console.error('❌ 初始化失败:', error.message)
    process.exit(1)
  })
}
