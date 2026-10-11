// 数据库连接配置
import 'dotenv/config'

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  database: process.env.DB_NAME || 'plssss',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  timezone: '+08:00',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000, // 10秒连接超时
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
}

export default dbConfig
