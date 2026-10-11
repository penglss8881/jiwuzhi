// 数据库迁移：用户角色由"读者(reader)"改为"普通用户(user)"
// 用法：在项目根目录执行  node config/migrate-user-role.js
// 说明：幂等可重复执行；先把既有 reader 行迁移为 user，再收紧枚举去掉 reader
import mysql from 'mysql2/promise'
import dbConfig from './db.js'

async function main() {
  const conn = await mysql.createConnection(dbConfig)

  const getRoleType = async () => {
    const [cols] = await conn.execute(
      "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'"
    )
    return cols[0] ? cols[0].t : ''
  }

  let type = await getRoleType()
  if (!type.includes("'user'")) {
    await conn.execute(
      "ALTER TABLE users MODIFY role ENUM('user', 'reader', 'reader_admin', 'book_admin') NOT NULL DEFAULT 'user'"
    )
    console.log('✅ 角色枚举已加入 user')
  } else {
    console.log('跳过：枚举已包含 user')
  }

  const [result] = await conn.execute("UPDATE users SET role = 'user' WHERE role = 'reader'")
  console.log(`✅ 已将 ${result.affectedRows} 个 reader 账号迁移为 user（普通用户）`)

  type = await getRoleType()
  if (type.includes("'reader'")) {
    await conn.execute(
      "ALTER TABLE users MODIFY role ENUM('user', 'reader_admin', 'book_admin') NOT NULL DEFAULT 'user'"
    )
    console.log('✅ 已从枚举中移除 reader')
  } else {
    console.log('跳过：枚举中已无 reader')
  }

  await conn.end()
  console.log('🎉 用户角色迁移完成：普通账号角色统一为 user（普通用户）')
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message)
  process.exit(1)
})
