// 数据库迁移：物品租借平台（C2C 上架/求租/私信）
// 用法：在项目根目录执行  node config/migrate-platform.js
// 说明：只新增字段与表，不影响现有 books/borrow_records 数据，可重复执行
import mysql from 'mysql2/promise'
import dbConfig from './db.js'

async function main() {
  const conn = await mysql.createConnection(dbConfig)

  // 1. users 表新增个人资料字段
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
  await addColumn('nickname', "ALTER TABLE users ADD COLUMN nickname VARCHAR(50) NULL COMMENT '昵称' AFTER name")
  await addColumn('avatar_url', "ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500) NULL COMMENT '头像' AFTER nickname")
  await addColumn('signature', "ALTER TABLE users ADD COLUMN signature VARCHAR(200) NULL COMMENT '个性签名' AFTER avatar_url")
  await addColumn('phone', "ALTER TABLE users ADD COLUMN phone VARCHAR(30) NULL COMMENT '联系电话' AFTER signature")
  await addColumn('address', "ALTER TABLE users ADD COLUMN address VARCHAR(255) NULL COMMENT '常用地址' AFTER phone")

  // 2. 新建平台表
  const ddlList = [
    `CREATE TABLE IF NOT EXISTS items (
      item_id INT PRIMARY KEY AUTO_INCREMENT,
      owner_id INT NOT NULL,
      title VARCHAR(100) NOT NULL COMMENT '物品名称',
      category VARCHAR(50) NOT NULL DEFAULT '其他',
      description TEXT COMMENT '描述',
      price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '租金/价格',
      price_unit VARCHAR(20) NOT NULL DEFAULT '元/天',
      cover_image_url VARCHAR(500),
      status ENUM('on_sale','rented','off') DEFAULT 'on_sale',
      views INT NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_owner (owner_id),
      INDEX idx_status (status),
      INDEX idx_category (category),
      FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS rent_requests (
      request_id INT PRIMARY KEY AUTO_INCREMENT,
      item_id INT NOT NULL,
      requester_id INT NOT NULL,
      phone VARCHAR(30) NOT NULL COMMENT '联系电话',
      address VARCHAR(255) NOT NULL COMMENT '取货/收货地址',
      expect_days INT NULL COMMENT '期望租期(天)',
      note VARCHAR(500) NULL,
      status ENUM('pending','agreed','declined','canceled') DEFAULT 'pending',
      pay_method ENUM('wechat','alipay') NULL COMMENT '支付方式(模拟)',
      paid_at DATETIME NULL COMMENT '支付时间(模拟)',
      handled_at DATETIME NULL COMMENT '卖家确认/婉拒时间',
      shipped_at DATETIME NULL COMMENT '卖家发货时间',
      received_at DATETIME NULL COMMENT '买家签收时间',
      refunded_at DATETIME NULL COMMENT '退款时间(模拟)',
      refund_status ENUM('applied','approved','rejected') NULL COMMENT '退款申请状态',
      refund_applied_at DATETIME NULL COMMENT '买家申请退款时间',
      refund_reason VARCHAR(500) NULL COMMENT '退款理由',
      refund_image VARCHAR(500) NULL COMMENT '退款凭证图片',
      refund_handled_at DATETIME NULL COMMENT '卖家处理退款时间',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_item (item_id),
      INDEX idx_requester (requester_id),
      FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE,
      FOREIGN KEY (requester_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS conversations (
      conversation_id INT PRIMARY KEY AUTO_INCREMENT,
      user_a_id INT NOT NULL,
      user_b_id INT NOT NULL,
      item_id INT NULL,
      last_message VARCHAR(500) NULL,
      last_time DATETIME NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_pair (user_a_id, user_b_id),
      INDEX idx_a (user_a_id),
      INDEX idx_b (user_b_id),
      FOREIGN KEY (user_a_id) REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (user_b_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS messages (
      message_id INT PRIMARY KEY AUTO_INCREMENT,
      conversation_id INT NOT NULL,
      sender_id INT NOT NULL,
      content VARCHAR(1000) NOT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_conv (conversation_id, created_at),
      FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ]
  for (const ddl of ddlList) {
    const tableMatch = ddl.match(/CREATE TABLE IF NOT EXISTS (\w+)/)
    await conn.execute(ddl)
    console.log(`✅ 已就绪表: ${tableMatch[1]}`)
  }

  await conn.end()
  console.log('🎉 平台数据库迁移完成')
}

main().catch(err => {
  console.error('❌ 迁移失败:', err.message)
  process.exit(1)
})
