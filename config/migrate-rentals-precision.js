// 数据库迁移：租借管理红点的毫秒级时间精度
// 背景：created_at 为秒级 DATETIME 时，同一秒内"查看页面"与"新申请"无法区分先后，
//       导致红点统计存在歧义；升级为 DATETIME(3) 毫秒精度后严格比较
// 用法：node config/migrate-rentals-precision.js （幂等，可重复执行）
import mysql from 'mysql2/promise'
import dbConfig from './db.js'

async function main() {
  const conn = await mysql.createConnection(dbConfig)

  await conn.execute('ALTER TABLE rent_requests MODIFY created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3)')
  console.log('✅ rent_requests.created_at 已升级为 DATETIME(3) 毫秒精度')

  await conn.execute('ALTER TABLE users MODIFY rentals_seen_at DATETIME(3) NULL COMMENT \'上次查看租借管理的时间（红点已读标记）\'')
  console.log('✅ users.rentals_seen_at 已升级为 DATETIME(3) 毫秒精度')

  await conn.end()
  console.log('🎉 红点时间精度迁移完成')
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message)
  process.exit(1)
})
