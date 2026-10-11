// 数据库迁移：退款凭证扩展 + 交易记录单侧删除
// 用法：在项目根目录执行  node config/migrate-trade-history.js
// 说明：只新增字段，不影响现有数据，可重复执行（幂等）
import mysql from 'mysql2/promise'
import dbConfig from './db.js'

async function main() {
  const conn = await mysql.createConnection(dbConfig)

  const addColumn = async (table, name, ddl) => {
    const [cols] = await conn.execute(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      [table]
    )
    const existing = new Set(cols.map(c => c.COLUMN_NAME))
    if (existing.has(name)) {
      console.log(`跳过：${table}.${name} 已存在`)
      return
    }
    await conn.execute(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
    console.log(`✅ 已添加 ${table}.${name}`)
  }

  // 退款证明：支持文字形式（与文件/图片凭证二选一或并存）
  await addColumn('rent_requests', 'refund_evidence_text', "refund_evidence_text TEXT NULL COMMENT '退款证明文字' AFTER refund_reason")
  // 交易记录单侧删除标记：各账号删除自己的记录，不影响对方显示
  await addColumn('rent_requests', 'deleted_by_owner', "deleted_by_owner TINYINT(1) NOT NULL DEFAULT 0 COMMENT '卖家已删除记录' AFTER refund_handled_at")
  await addColumn('rent_requests', 'deleted_by_requester', "deleted_by_requester TINYINT(1) NOT NULL DEFAULT 0 COMMENT '买家已删除记录' AFTER deleted_by_owner")

  await conn.end()
  console.log('🎉 退款凭证与记录删除迁移完成')
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message)
  process.exit(1)
})
