// 数据库迁移：实名认证（身份证绑定）
// 用法：在项目根目录执行  node config/migrate-idcard.js
// 说明：只新增字段，不影响现有数据，可重复执行（幂等）
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
    console.log(`✅ 已添加 users.${name}`)
  }

  // 实名姓名与身份证号均为敏感信息，密文存储（AES-256-GCM 加密）
  await addColumn('real_name', "ALTER TABLE users ADD COLUMN real_name VARCHAR(200) NULL COMMENT '实名姓名（AES加密）' AFTER name")
  await addColumn('id_card', "ALTER TABLE users ADD COLUMN id_card VARCHAR(300) NULL COMMENT '身份证号（AES加密）' AFTER real_name")

  await conn.end()
  console.log('🎉 实名认证字段迁移完成')
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message)
  process.exit(1)
})
