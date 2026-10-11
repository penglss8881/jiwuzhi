// 数据库迁移：为 users 表补充密保问题字段（注册/找回密码功能用）
// 用法：在项目根目录执行  node config/migrate-add-security.js
import mysql from 'mysql2/promise'
import dbConfig from './db.js'

async function main() {
  const conn = await mysql.createConnection(dbConfig)

  const [cols] = await conn.execute(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
  )
  const existing = new Set(cols.map(c => c.COLUMN_NAME))

  const addColumn = async (name, ddl) => {
    if (existing.has(name)) {
      console.log(`跳过：users.${name} 已存在`)
      return
    }
    await conn.execute(ddl)
    console.log(`✅ 已添加字段 users.${name}`)
  }

  await addColumn(
    'security_question',
    "ALTER TABLE users ADD COLUMN security_question VARCHAR(200) NULL COMMENT '密保问题' AFTER status"
  )
  await addColumn(
    'security_answer',
    "ALTER TABLE users ADD COLUMN security_answer VARCHAR(500) NULL COMMENT '密保答案（PBKDF2哈希）' AFTER security_question"
  )

  await conn.end()
  console.log('🎉 users 表迁移完成')
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message)
  process.exit(1)
})
