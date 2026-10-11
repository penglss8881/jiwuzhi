// 数据库迁移：好友关系表（申请→同意机制）
// 用法：node config/migrate-friends.js
// 说明：只新增表，不影响已有数据，可重复执行（幂等）
import mysql from 'mysql2/promise'
import dbConfig from './db.js'

async function main() {
  const conn = await mysql.createConnection(dbConfig)

  await conn.execute(`
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
  console.log('✅ 已就绪表: friendships')

  await conn.end()
  console.log('🎉 好友关系数据库迁移完成')
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message)
  process.exit(1)
})
