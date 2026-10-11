// 数据库表初始化脚本
import { query } from './database.js'

// 按外键依赖顺序删除旧表（reservations 为历史遗留表，应用代码已不使用，一并清理）
const dropOrder = ['reservations', 'post_likes', 'post_comments', 'posts', 'item_comments', 'item_favorites', 'friendships', 'messages', 'conversations', 'rent_requests', 'items', 'borrow_records', 'logs', 'books', 'users']

// 用户表 — 密码：PBKDF2 哈希 + AES-256-GCM 加密
const createUsersTable = `
CREATE TABLE users (
  user_id INT PRIMARY KEY AUTO_INCREMENT,
  account_no VARCHAR(50) UNIQUE NOT NULL COMMENT '账号',
  name VARCHAR(100) NOT NULL,
  real_name VARCHAR(200) NULL COMMENT '真实姓名（AES加密）',
  id_card VARCHAR(300) NULL COMMENT '身份证号（AES加密）',
  nickname VARCHAR(50) NULL COMMENT '昵称',
  avatar_url VARCHAR(500) NULL COMMENT '头像',
  signature VARCHAR(200) NULL COMMENT '个性签名',
  phone VARCHAR(30) NULL COMMENT '联系电话',
  address VARCHAR(255) NULL COMMENT '常用地址',
  rentals_seen_at DATETIME(3) NULL COMMENT '上次查看租借管理的时间（红点已读标记）',
  password VARCHAR(500) NOT NULL DEFAULT '123456' COMMENT '密码（PBKDF2哈希+AES加密）',
  role ENUM('user', 'reader_admin', 'book_admin') DEFAULT 'user',
  status ENUM('active', 'inactive') DEFAULT 'active',
  security_question VARCHAR(200) NULL COMMENT '密保问题',
  security_answer VARCHAR(500) NULL COMMENT '密保答案（PBKDF2哈希）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_account_no (account_no),
  INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

// 物品表（C2C 上架）
const createItemsTable = `
CREATE TABLE items (
  item_id INT PRIMARY KEY AUTO_INCREMENT,
  owner_id INT NOT NULL,
  title VARCHAR(100) NOT NULL COMMENT '物品名称',
  category VARCHAR(50) NOT NULL DEFAULT '其他',
  description TEXT COMMENT '描述',
  price DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '租金/价格',
  price_unit VARCHAR(20) NOT NULL DEFAULT '元/天',
  buyout_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否支持买断',
  buyout_price DECIMAL(10,2) NULL COMMENT '买断价（一口价）',
  cover_image_url VARCHAR(500),
  status ENUM('on_sale','rented','off') DEFAULT 'on_sale',
  views INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_owner (owner_id),
  INDEX idx_status (status),
  INDEX idx_category (category),
  FOREIGN KEY (owner_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

// 求租申请表
const createRentRequestsTable = `
CREATE TABLE rent_requests (
  request_id INT PRIMARY KEY AUTO_INCREMENT,
  item_id INT NOT NULL,
  request_type ENUM('rent', 'buyout') NOT NULL DEFAULT 'rent' COMMENT '租借/买断',
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
  created_at DATETIME(3) DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_item (item_id),
  INDEX idx_requester (requester_id),
  FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE,
  FOREIGN KEY (requester_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

// 会话表（两人唯一对）
const createConversationsTable = `
CREATE TABLE conversations (
  conversation_id INT PRIMARY KEY AUTO_INCREMENT,
  user_a_id INT NOT NULL,
  user_b_id INT NOT NULL,
  item_id INT NULL,
  deleted_by_a TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'user_a 已删除',
  deleted_by_b TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'user_b 已删除',
  last_message VARCHAR(500) NULL,
  last_time DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_pair (user_a_id, user_b_id),
  INDEX idx_a (user_a_id),
  INDEX idx_b (user_b_id),
  FOREIGN KEY (user_a_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (user_b_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

// 消息表
const createMessagesTable = `
CREATE TABLE messages (
  message_id INT PRIMARY KEY AUTO_INCREMENT,
  conversation_id INT NOT NULL,
  sender_id INT NOT NULL,
  content VARCHAR(1000) NOT NULL,
  msg_type ENUM('text', 'image', 'file') NOT NULL DEFAULT 'text' COMMENT '消息类型',
  file_url VARCHAR(500) NULL COMMENT '附件地址',
  file_name VARCHAR(200) NULL COMMENT '附件原始文件名',
  file_size INT NULL COMMENT '附件大小(字节)',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  recalled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已撤回',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_conv (conversation_id, created_at),
  FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`


// 论坛帖子表
const createPostsTable = `
CREATE TABLE posts (
  post_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  title VARCHAR(100) NOT NULL COMMENT '帖子标题',
  content TEXT COMMENT '正文',
  images TEXT COMMENT '图片URL列表(JSON数组)',
  views INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_created (created_at),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

// 帖子回复表
const createPostCommentsTable = `
CREATE TABLE post_comments (
  comment_id INT PRIMARY KEY AUTO_INCREMENT,
  post_id INT NOT NULL,
  user_id INT NOT NULL,
  parent_comment_id INT DEFAULT NULL,
  reply_to_user_id INT DEFAULT NULL,
  content VARCHAR(500) NOT NULL COMMENT '回复内容',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_post (post_id),
  INDEX idx_post_comment_parent (parent_comment_id),
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

const createPostLikesTable = `
CREATE TABLE post_likes (
  post_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),
  INDEX idx_post_likes_user (user_id),
  FOREIGN KEY (post_id) REFERENCES posts(post_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

// 物品留言表
const createItemCommentsTable = `
CREATE TABLE item_comments (
  comment_id INT PRIMARY KEY AUTO_INCREMENT,
  item_id INT NOT NULL,
  user_id INT NOT NULL,
  parent_comment_id INT DEFAULT NULL,
  reply_to_user_id INT DEFAULT NULL,
  content VARCHAR(500) NOT NULL COMMENT '留言内容',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_item (item_id),
  INDEX idx_item_comment_parent (parent_comment_id),
  FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

// 物品收藏表
const createItemFavoritesTable = `
CREATE TABLE item_favorites (
  user_id INT NOT NULL,
  item_id INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, item_id),
  INDEX idx_item (item_id),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(item_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

// 好友关系表 — 申请→同意机制，同一对用户仅一条记录（方向由 requester/addressee 区分）
const createFriendshipsTable = `
CREATE TABLE friendships (
  friendship_id INT PRIMARY KEY AUTO_INCREMENT,
  requester_id INT NOT NULL COMMENT '发起申请的用户',
  addressee_id INT NOT NULL COMMENT '被申请的用户',
  status ENUM('pending','accepted') NOT NULL DEFAULT 'pending' COMMENT '申请中/已成为好友',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '申请时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '状态变更时间（成为好友的时间）',
  UNIQUE KEY uk_pair (requester_id, addressee_id),
  INDEX idx_addressee (addressee_id),
  INDEX idx_status (status),
  FOREIGN KEY (requester_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (addressee_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`
// 图书表 — book_code 为主标识，ISBN 可重复
const createBooksTable = `
CREATE TABLE books (
  internal_id INT AUTO_INCREMENT,
  book_code VARCHAR(20) NOT NULL COMMENT '自定义书号（唯一标识）',
  isbn VARCHAR(20) NOT NULL COMMENT 'ISBN（可重复）',
  title VARCHAR(255) NOT NULL,
  author VARCHAR(100) NOT NULL,
  owner VARCHAR(100) DEFAULT NULL COMMENT '书籍归属人',
  cover_image_url VARCHAR(500),
  status ENUM('available', 'borrowed', 'discarded') DEFAULT 'available',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (internal_id),
  UNIQUE KEY uk_book_code (book_code),
  INDEX idx_isbn (isbn),
  INDEX idx_status (status),
  INDEX idx_title (title),
  INDEX idx_owner (owner)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

// 借阅记录表 — 通过 book_code 关联图书
const createBorrowRecordsTable = `
CREATE TABLE borrow_records (
  record_id INT PRIMARY KEY AUTO_INCREMENT,
  book_code VARCHAR(20) NOT NULL,
  user_id INT,
  borrower_name VARCHAR(100) NOT NULL,
  borrow_date DATE NOT NULL,
  return_date DATE,
  status ENUM('borrowing', 'returned') DEFAULT 'borrowing',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_book_code (book_code),
  INDEX idx_status (status),
  INDEX idx_user_id (user_id),
  FOREIGN KEY (book_code) REFERENCES books(book_code) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

// 操作日志表
const createLogsTable = `
CREATE TABLE logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  action VARCHAR(100) NOT NULL,
  detail TEXT,
  operator VARCHAR(100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

/**
 * 初始化数据库表
 */
export async function initDatabase() {
  try {
    console.log('📦 开始初始化数据库表...')

    // 先删除旧表
    console.log('🗑️  删除旧表...')
    for (const table of dropOrder) {
      await query(`DROP TABLE IF EXISTS \`${table}\``)
      console.log(`  ✅ 删除表: ${table}`)
    }

    // 创建新表（注意顺序：先创建被引用的表）
    await query(createUsersTable)
    console.log('✅ 用户表创建成功')

    await query(createBooksTable)
    console.log('✅ 图书表创建成功')

    await query(createBorrowRecordsTable)
    console.log('✅ 借阅记录表创建成功')

    await query(createLogsTable)
    console.log('✅ 操作日志表创建成功')

    await query(createItemsTable)
    console.log('✅ 物品表创建成功')

    await query(createRentRequestsTable)
    console.log('✅ 求租申请表创建成功')

    await query(createConversationsTable)
    console.log('✅ 会话表创建成功')

    await query(createMessagesTable)
    console.log('✅ 消息表创建成功')
    await query(createPostsTable)
    console.log('✅ 论坛帖子表创建成功')

    await query(createPostLikesTable)
    console.log('✅ 帖子点赞表创建成功')

    await query(createPostCommentsTable)
    console.log('✅ 帖子回复表创建成功')

    await query(createItemCommentsTable)
    console.log('✅ 物品留言表创建成功')

    await query(createItemFavoritesTable)
    console.log('✅ 物品收藏表创建成功')

    await query(createFriendshipsTable)
    console.log('✅ 好友关系表创建成功')

    console.log('\n🎉 数据库表初始化完成！')
    return true
  } catch (error) {
    console.error('❌ 数据库表初始化失败:', error.message)
    throw error
  }
}

// 如果直接运行此文件，则执行初始化
if (import.meta.url === `file://${process.argv[1]}`) {
  initDatabase().catch((error) => {
    console.error('❌ 初始化失败:', error.message)
    process.exit(1)
  })
}
