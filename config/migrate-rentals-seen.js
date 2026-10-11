// 数据库迁移：租借管理红点（记录用户上次查看"租借管理"的时间）
// 用法：在项目根目录执行  node config/migrate-rentals-seen.js
// 说明：只新增字段，不影响现有数据，可重复执行（幂等）
import mysql from 'mysql2/promise'
import dbConfig from './db.js'

async function main() {
  const conn = await mysql.createConnection(dbConfig)

  const [cols] = await conn.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
  )
  const existing = new Set(cols.map(c => c.COLUMN_NAME))
  if (existing.has('rentals_seen_at')) {
    console.log('跳过：users.rentals_seen_at 已存在')
  } else {
    await conn.execute("ALTER TABLE users ADD COLUMN rentals_seen_at DATETIME NULL COMMENT '上次查看租借管理的时间（红点已读标记）' AFTER address")
    console.log('✅ 已添加 users.rentals_seen_at')
  }

  await conn.end()
  console.log('🎉 租借管理红点迁移完成')
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message)
  process.exit(1)
})
