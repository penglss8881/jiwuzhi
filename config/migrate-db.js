// 数据库迁移脚本：book_code 书号 + owner 归属人 + 密码加密
import { query } from './database.js'
import { decryptField, encryptField } from './security.js'

/**
 * 完整迁移（幂等，可重复执行）：
 * 1. 添加 owner 列
 * 2. 添加 book_code 列并生成书号
 * 3. 迁移 borrow_records 外键 book_isbn → book_code
 * 4. 修改 isbn 为普通索引
 * 5. 扩展 users.account_no 并加密
 */
export async function migrateDatabase() {
  try {
    console.log('📦 开始数据库迁移...\n')

    // ===== 步骤 1：books 表添加 owner =====
    console.log('1/6 添加 owner 列...')
    try {
      await query(`ALTER TABLE books ADD COLUMN owner VARCHAR(100) DEFAULT NULL COMMENT '书籍归属人' AFTER author`)
      console.log('   ✅ 已添加 owner 列')
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
        console.log('   ⚠️  owner 列已存在，跳过')
      } else { throw err }
    }
    await query('CREATE INDEX idx_owner ON books(owner)').catch(() => {})
    console.log('   ✅ owner 索引就绪')

    // ===== 步骤 2：books 表添加 book_code =====
    console.log('\n2/6 添加 book_code 列...')
    let bookCodeExists = false
    try {
      await query(`ALTER TABLE books ADD COLUMN book_code VARCHAR(20) DEFAULT NULL COMMENT '自定义书号' AFTER internal_id`)
      console.log('   ✅ 已添加 book_code 列')
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
        bookCodeExists = true
        console.log('   ⚠️  book_code 列已存在')
      } else { throw err }
    }

    // 为未设置 book_code 的书记生成书号
    const { rows: missingCode } = await query(
      'SELECT internal_id, isbn FROM books WHERE book_code IS NULL OR book_code = "" ORDER BY internal_id ASC'
    )
    if (missingCode.length > 0) {
      // 找到已有最大编号
      const { rows: maxRow } = await query(
        "SELECT book_code FROM books WHERE book_code IS NOT NULL AND book_code != '' ORDER BY internal_id DESC LIMIT 1"
      )
      let nextNum = 1
      if (maxRow.length > 0 && maxRow[0].book_code) {
        const match = maxRow[0].book_code.match(/\d+/)
        if (match) nextNum = parseInt(match[0], 10) + 1
      }
      for (const book of missingCode) {
        const code = `BOOK-${String(nextNum++).padStart(5, '0')}`
        await query('UPDATE books SET book_code = ? WHERE internal_id = ?', [code, book.internal_id])
      }
      console.log(`   ✅ 已为 ${missingCode.length} 本书生成书号`)
    } else {
      console.log('   ✅ 所有图书已有书号')
    }

    // 确保 book_code NOT NULL + UNIQUE
    await query("ALTER TABLE books MODIFY COLUMN book_code VARCHAR(20) NOT NULL COMMENT '自定义书号'").catch(() => {})
    try {
      await query('ALTER TABLE books ADD UNIQUE KEY uk_book_code (book_code)')
      console.log('   ✅ book_code 唯一约束已添加')
    } catch (err) {
      if (err.message.includes('Duplicate') || err.message.includes('already exists')) {
        console.log('   ⚠️  book_code 唯一约束已存在')
      } else { throw err }
    }

    // ===== 步骤 3：迁移 borrow_records 外键 =====
    console.log('\n3/6 迁移 borrow_records 外键...')
    // 先检查 borrow_records 是否有 book_code 列
    let brHasBookCode = false
    try {
      await query('SELECT book_code FROM borrow_records LIMIT 1')
      brHasBookCode = true
    } catch {
      brHasBookCode = false
    }

    if (!brHasBookCode) {
      // 删除旧外键
      try {
        await query('ALTER TABLE borrow_records DROP FOREIGN KEY borrow_records_ibfk_1')
        console.log('   ✅ 已删除旧外键 borrow_records_ibfk_1')
      } catch (err) {
        console.log('   ⚠️  旧外键不存在或已删除:', err.message.split('\n')[0])
      }

      // 添加 book_code 列
      await query("ALTER TABLE borrow_records ADD COLUMN book_code VARCHAR(20) DEFAULT NULL COMMENT '书号' AFTER record_id")
      console.log('   ✅ 已添加 book_code 列')

      // 根据旧 isbn 值更新 book_code
      await query(`UPDATE borrow_records br
        JOIN books b ON br.book_isbn = b.isbn
        SET br.book_code = b.book_code`)
      console.log('   ✅ borrow_records.book_code 已同步')

      // 删除旧列
      await query('ALTER TABLE borrow_records DROP COLUMN book_isbn')
      console.log('   ✅ 已删除旧列 book_isbn')

      // 重建外键
      await query(
        'ALTER TABLE borrow_records ADD CONSTRAINT fk_br_book_code FOREIGN KEY (book_code) REFERENCES books(book_code) ON DELETE CASCADE'
      )
      console.log('   ✅ 新外键 fk_br_book_code 已创建')
    } else {
      console.log('   ⚠️  borrow_records 已有 book_code 列，跳过')
    }

    // ===== 步骤 4：修改 books.isbn 为普通索引 =====
    console.log('\n4/6 修改 ISBN 约束...')
    try {
      await query('ALTER TABLE books DROP INDEX uk_isbn')
      console.log('   ✅ 已删除 isbn 唯一约束')
    } catch (err) {
      console.log('   ⚠️  isbn 唯一约束不存在或已删除')
    }
    try {
      await query('CREATE INDEX idx_isbn ON books(isbn)')
      console.log('   ✅ isbn 普通索引已创建')
    } catch (err) {
      if (err.message.includes('Duplicate') || err.message.includes('already exists')) {
        console.log('   ⚠️  isbn 索引已存在')
      } else { throw err }
    }

    // ===== 步骤 5：users 表 account_no 还原为明文 + 密码加密 =====
    console.log('\n5/6 处理 users 表...')

    // 5a. 解密 account_no（如果曾被加密）
    const { rows: users } = await query('SELECT user_id, account_no, password FROM users')
    let decryptedCount = 0
    for (const user of users) {
      if (user.account_no.startsWith('aes256gcm$')) {
        const plain = decryptField(user.account_no)
        await query('UPDATE users SET account_no = ? WHERE user_id = ?', [plain, user.user_id])
        decryptedCount++
        console.log(`   ✅ 已解密账号 ID: ${user.user_id}`)
      }
    }
    console.log(decryptedCount > 0 ? `   共解密 ${decryptedCount} 条账号` : '   ✅ 所有账号已是明文')

    // 5b. 扩展密码列并加密已有的 PBKDF2 哈希
    try {
      await query("ALTER TABLE users MODIFY COLUMN password VARCHAR(500) NOT NULL DEFAULT '123456' COMMENT '密码（PBKDF2哈希+AES加密）'")
      console.log('   ✅ password 列宽已扩展为 VARCHAR(500)')
    } catch (err) {
      console.log('   ⚠️  列宽调整失败（可能已修改）:', err.message.split('\n')[0])
    }

    let encryptedPwCount = 0
    for (const user of users) {
      if (user.password.startsWith('aes256gcm$')) {
        continue // 已加密
      }
      const encrypted = encryptField(user.password)
      await query('UPDATE users SET password = ? WHERE user_id = ?', [encrypted, user.user_id])
      encryptedPwCount++
      console.log(`   ✅ 已加密密码 ID: ${user.user_id}`)
    }
    console.log(encryptedPwCount > 0 ? `   共加密 ${encryptedPwCount} 条密码` : '   ✅ 所有密码已加密')

    // 5c. 确保 account_no 列类型和索引
    try {
      await query("ALTER TABLE users MODIFY COLUMN account_no VARCHAR(50) NOT NULL COMMENT '账号'")
    } catch (err) { /* ignore */ }
    await query('ALTER TABLE users DROP INDEX idx_account_no').catch(() => {})
    await query('CREATE UNIQUE INDEX idx_account_no ON users(account_no)').catch(() => {})
    console.log('   ✅ account_no 唯一索引已确认')

    // ===== 步骤 6：更新种子数据 =====
    console.log('\n6/6 刷新种子数据...')
    try {
      // 如果种子用户不存在，插入它们
      const { hashPassword } = await import('./security.js')
      const initialUsers = [
        { accountNo: '20260001', name: '张三', password: '123456', role: 'reader' },
        { accountNo: '20260002', name: '李四', password: '123456', role: 'reader' },
        { accountNo: 'A0001', name: '读者管理员-王老师', password: 'admin123', role: 'reader_admin' },
        { accountNo: 'B0001', name: '二手书管理员-陈老师', password: 'admin123', role: 'book_admin' },
      ]
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
      for (const u of initialUsers) {
        const { rows: exist } = await query('SELECT * FROM users WHERE account_no = ?', [u.accountNo])
        if (exist.length === 0) {
          await query(
            'INSERT INTO users (account_no, name, password, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [u.accountNo, u.name, hashPassword(u.password), u.role, 'active', now]
          )
          console.log(`   ✅ 插入用户: ${u.name} (${u.accountNo})`)
        }
      }
    } catch (err) {
      console.log('   ⚠️  种子用户刷新失败:', err.message.split('\n')[0])
    }

    console.log('\n🎉 数据库迁移完成！')
    return true
  } catch (error) {
    console.error('❌ 数据库迁移失败:', error.message)
    throw error
  }
}

// 直接运行则执行迁移
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateDatabase()
    .then(() => {
      console.log('✅ 迁移完成，程序退出')
      process.exit(0)
    })
    .catch((error) => {
      console.error('❌ 迁移失败:', error.message)
      process.exit(1)
    })
}
