import { query, closePool } from '../config/database.js'
import { initDatabase } from '../config/init-db.js'
import { hashPassword } from '../config/security.js'

async function main() {
  const { rows } = await query(
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'users'"
  )

  if (Number(rows[0]?.count || 0) === 0) {
    console.log('数据库为空，创建当前版本的数据表…')
    await initDatabase()
  } else {
    console.log('检测到现有数据表，跳过建表；不会删除或覆盖数据。')
  }

  await query(`
    CREATE TABLE IF NOT EXISTS post_likes (
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id),
      INDEX idx_post_likes_user (user_id),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  console.log('动态点赞功能表已就绪。')

  for (const table of ['post_comments', 'item_comments']) {
    for (const column of ['parent_comment_id INT DEFAULT NULL', 'reply_to_user_id INT DEFAULT NULL']) {
      const name = column.split(' ')[0]
      const { rows: columns } = await query(
        'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
        [table, name]
      )
      if (!columns.length) await query(`ALTER TABLE ${table} ADD COLUMN ${column}`)
    }
  }
  console.log('评论回复字段已就绪。')

  await query(`
    CREATE TABLE IF NOT EXISTS friendships (
      friendship_id INT PRIMARY KEY AUTO_INCREMENT,
      requester_id INT NOT NULL COMMENT '发起申请的用户',
      addressee_id INT NOT NULL COMMENT '被申请的用户',
      status ENUM('pending','accepted') NOT NULL DEFAULT 'pending' COMMENT '申请中/已成为好友',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '申请时间',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '状态变更时间（成为好友的时间）',
      UNIQUE KEY uk_pair (requester_id, addressee_id),
      INDEX idx_addressee (addressee_id),
      INDEX idx_status (status),
      FOREIGN KEY (requester_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (addressee_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)
  console.log('好友关系表已就绪。')

  const accountNo = String(process.env.ADMIN_ACCOUNT || '').trim()
  const password = String(process.env.ADMIN_PASSWORD || '')
  const name = String(process.env.ADMIN_NAME || '系统管理员').trim()

  if (!accountNo || !password) {
    console.log('未提供 ADMIN_ACCOUNT/ADMIN_PASSWORD，跳过初始管理员创建。')
    return
  }
  if (password.length < 12) throw new Error('ADMIN_PASSWORD 至少需要 12 位')

  const { rows: existing } = await query('SELECT user_id FROM users WHERE account_no = ?', [accountNo])
  if (existing.length) {
    console.log(`管理员账号 ${accountNo} 已存在，未修改其密码。`)
    return
  }

  await query(
    'INSERT INTO users (account_no, name, password, role, status) VALUES (?, ?, ?, ?, ?)',
    [accountNo, name || '系统管理员', hashPassword(password), 'book_admin', 'active']
  )
  console.log(`已创建初始管理员账号：${accountNo}`)
}

main()
  .catch(error => {
    console.error('数据库引导失败:', error.message)
    process.exitCode = 1
  })
  .finally(() => closePool())
