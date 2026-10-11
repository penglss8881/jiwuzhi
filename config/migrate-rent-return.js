// 数据库迁移：租借退货/归还（买家申请退货 → 卖家确认收到退货 → 租借结束、物品重新上架）
// 用法：在项目根目录执行  node config/migrate-rent-return.js
// 说明：只新增字段，不影响现有数据，可重复执行（幂等）
import mysql from 'mysql2/promise'
import dbConfig from './db.js'

async function main() {
  const conn = await mysql.createConnection(dbConfig)

  const addColumn = async (name, ddl) => {
    const [cols] = await conn.execute(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      ['rent_requests']
    )
    const existing = new Set(cols.map(c => c.COLUMN_NAME))
    if (existing.has(name)) {
      console.log(`跳过：rent_requests.${name} 已存在`)
      return
    }
    await conn.execute(`ALTER TABLE rent_requests ADD COLUMN ${ddl}`)
    console.log(`✅ 已添加 rent_requests.${name}`)
  }

  await addColumn('return_requested_at', "return_requested_at DATETIME NULL COMMENT '买家申请退货（归还）时间' AFTER received_at")
  await addColumn('returned_at', "returned_at DATETIME NULL COMMENT '卖家确认收到退货（归还完成）时间' AFTER return_requested_at")

  await conn.end()
  console.log('🎉 租借退货字段迁移完成')
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message)
  process.exit(1)
})
