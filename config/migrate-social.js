// 数据库迁移：论坛帖子 + 物品评论/收藏
// 用法：node config/migrate-social.js
// 说明：只新增表，不影响已有数据，可重复执行
import mysql from 'mysql2/promise'
import dbConfig from './db.js'

async function main() {
  const conn = await mysql.createConnection(dbConfig)

  const ddlList = [
    `CREATE TABLE IF NOT EXISTS posts (
      post_id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      title VARCHAR(100) NOT NULL COMMENT '帖子标题',
      content TEXT COMMENT '正文',
      images TEXT COMMENT '图片URL列表(JSON数组)',
      views INT NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_created (created_at),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS post_comments (
      comment_id INT PRIMARY KEY AUTO_INCREMENT,
      post_id INT NOT NULL,
      user_id INT NOT NULL,
      parent_comment_id INT DEFAULT NULL,
      reply_to_user_id INT DEFAULT NULL,
      content VARCHAR(500) NOT NULL COMMENT '回复内容',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_post (post_id),
      INDEX idx_post_comment_parent (parent_comment_id),
      FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS item_comments (
      comment_id INT PRIMARY KEY AUTO_INCREMENT,
      item_id INT NOT NULL,
      user_id INT NOT NULL,
      parent_comment_id INT DEFAULT NULL,
      reply_to_user_id INT DEFAULT NULL,
      content VARCHAR(500) NOT NULL COMMENT '留言内容',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_item (item_id),
      INDEX idx_item_comment_parent (parent_comment_id),
      FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS item_favorites (
      user_id INT NOT NULL,
      item_id INT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, item_id),
      INDEX idx_item (item_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ]

  for (const ddl of ddlList) {
    const m = ddl.match(/CREATE TABLE IF NOT EXISTS (\w+)/)
    await conn.execute(ddl)
    console.log(`✅ 已就绪表: ${m[1]}`)
  }

  for (const table of ['post_comments', 'item_comments']) {
    for (const column of ['parent_comment_id INT DEFAULT NULL', 'reply_to_user_id INT DEFAULT NULL']) {
      const name = column.split(' ')[0]
      const [rows] = await conn.execute(
        'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
        [table, name]
      )
      if (!rows.length) await conn.execute(`ALTER TABLE ${table} ADD COLUMN ${column}`)
    }
  }

  await conn.end()
  console.log('🎉 论坛/评论/收藏数据库迁移完成')
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message)
  process.exit(1)
})
