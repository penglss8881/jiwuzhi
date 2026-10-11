// 数据库迁移：买断订单支付与物流流程
// 用法：在项目根目录执行  node config/migrate-orders.js
// 说明：只在 rent_requests 新增字段（支付/确认/发货/签收/退款），不影响现有数据，可重复执行（幂等）
import mysql from 'mysql2/promise'
import dbConfig from './db.js'

async function main() {
  const conn = await mysql.createConnection(dbConfig)
  const addColumn = async (name, ddl) => {
    const [cols] = await conn.execute(
      'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
      ['rent_requests']
    )
    if (cols.some(c => c.COLUMN_NAME === name)) {
      console.log(`跳过：rent_requests.${name} 已存在`)
      return
    }
    await conn.execute(`ALTER TABLE rent_requests ADD COLUMN ${ddl}`)
    console.log(`✅ 已添加 rent_requests.${name}`)
  }

  await addColumn('pay_method', "pay_method ENUM('wechat','alipay') NULL COMMENT '支付方式(模拟)' AFTER status")
  await addColumn('paid_at', "paid_at DATETIME NULL COMMENT '支付时间(模拟)' AFTER pay_method")
  await addColumn('handled_at', "handled_at DATETIME NULL COMMENT '卖家确认/婉拒时间' AFTER paid_at")
  await addColumn('shipped_at', "shipped_at DATETIME NULL COMMENT '卖家发货时间' AFTER handled_at")
  await addColumn('received_at', "received_at DATETIME NULL COMMENT '买家签收时间' AFTER shipped_at")
  await addColumn('refunded_at', "refunded_at DATETIME NULL COMMENT '退款时间(模拟)' AFTER received_at")
  await addColumn('refund_status', "refund_status ENUM('applied','approved','rejected') NULL COMMENT '退款申请状态' AFTER refunded_at")
  await addColumn('refund_applied_at', "refund_applied_at DATETIME NULL COMMENT '买家申请退款时间' AFTER refund_status")
  await addColumn('refund_reason', "refund_reason VARCHAR(500) NULL COMMENT '退款理由' AFTER refund_applied_at")
  await addColumn('refund_image', "refund_image VARCHAR(500) NULL COMMENT '退款凭证图片' AFTER refund_reason")
  await addColumn('refund_handled_at', "refund_handled_at DATETIME NULL COMMENT '卖家处理退款时间' AFTER refund_image")

  await conn.end()
  console.log('🎉 买断订单支付与物流字段迁移完成')
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message)
  process.exit(1)
})
