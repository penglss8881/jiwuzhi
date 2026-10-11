// 数据库迁移：买断机制 + 聊天增强（附件/撤回/删除会话）
// 用法：在项目根目录执行  node config/migrate-buyout.js
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

  // ===== 买断机制 =====
  await addColumn('items', 'buyout_enabled', "buyout_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否支持买断' AFTER price_unit")
  await addColumn('items', 'buyout_price', "buyout_price DECIMAL(10,2) NULL COMMENT '买断价（一口价）' AFTER buyout_enabled")
  await addColumn('rent_requests', 'request_type', "request_type ENUM('rent', 'buyout') NOT NULL DEFAULT 'rent' COMMENT '租借/买断' AFTER item_id")

  // ===== 聊天增强 =====
  await addColumn('messages', 'msg_type', "msg_type ENUM('text', 'image', 'file') NOT NULL DEFAULT 'text' COMMENT '消息类型' AFTER content")
  await addColumn('messages', 'file_url', "file_url VARCHAR(500) NULL COMMENT '附件地址' AFTER msg_type")
  await addColumn('messages', 'file_name', "file_name VARCHAR(200) NULL COMMENT '附件原始文件名' AFTER file_url")
  await addColumn('messages', 'file_size', "file_size INT NULL COMMENT '附件大小(字节)' AFTER file_name")
  await addColumn('messages', 'recalled', "recalled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已撤回' AFTER is_read")
  // 会话删除标记（按用户各自删除，类似微信：删除后对方新消息可重新唤起会话）
  await addColumn('conversations', 'deleted_by_a', "deleted_by_a TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'user_a 已删除' AFTER item_id")
  await addColumn('conversations', 'deleted_by_b', "deleted_by_b TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'user_b 已删除' AFTER deleted_by_a")

  await conn.end()
  console.log('🎉 买断与聊天增强迁移完成')
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message)
  process.exit(1)
})
