// 数据库连接模块
import mysql from 'mysql2/promise'
import dbConfig from './db.js'

// 创建连接池
const pool = mysql.createPool(dbConfig)

/**
 * 测试数据库连接
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function testConnection() {
  let connection = null
  try {
    // 获取连接
    connection = await pool.getConnection()
    console.log('✅ 数据库连接成功！')
    console.log(`📦 数据库: ${dbConfig.database}`)
    console.log(`📍 主机: ${dbConfig.host}:${dbConfig.port}`)
    console.log(`👤 用户: ${dbConfig.user}`)
    
    // 执行简单查询验证连接
    const [rows] = await connection.execute('SELECT 1 + 1 AS test')
    console.log(`🔍 连接验证成功: 1 + 1 = ${rows[0].test}`)
    
    return {
      success: true,
      message: '数据库连接成功',
      database: dbConfig.database,
      host: `${dbConfig.host}:${dbConfig.port}`
    }
  } catch (error) {
    console.error('❌ 数据库连接失败:', error.message)
    
    let errorType = '未知错误'
    let suggestion = '请检查数据库配置'
    
    // 分类错误类型
    if (error.code === 'ETIMEDOUT') {
      errorType = '连接超时'
      suggestion = '请检查数据库服务是否启动，网络是否畅通'
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      errorType = '认证失败'
      suggestion = '请检查用户名和密码是否正确'
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      errorType = '数据库不存在'
      suggestion = '请确认数据库名称正确，或先创建数据库'
    } else if (error.code === 'ECONNREFUSED') {
      errorType = '连接被拒绝'
      suggestion = '请检查MySQL服务是否运行在指定端口'
    }
    
    return {
      success: false,
      message: `连接失败: ${errorType} - ${error.message}`,
      errorCode: error.code,
      suggestion
    }
  } finally {
    // 释放连接
    if (connection) {
      try {
        await connection.release()
        console.log('🔌 连接已释放')
      } catch (releaseError) {
        console.error('⚠️ 连接释放失败:', releaseError.message)
      }
    }
  }
}

/**
 * 执行SQL查询
 * @param {string} sql - SQL语句
 * @param {Array} [params=[]] - 查询参数
 * @returns {Promise<{rows: Array, fields: Object}>}
 */
export async function query(sql, params = []) {
  let connection = null
  try {
    connection = await pool.getConnection()
    const [rows, fields] = await connection.execute(sql, params)
    return { rows, fields }
  } catch (error) {
    console.error('❌ SQL执行错误:', error.message)
    console.error('📝 SQL:', sql)
    console.error('📊 参数:', params)
    throw error
  } finally {
    if (connection) {
      try {
        await connection.release()
      } catch (releaseError) {
        console.error('⚠️ 连接释放失败:', releaseError.message)
      }
    }
  }
}

/**
 * 执行SQL事务
 * @param {Function} callback - 事务回调函数，接收connection参数
 * @returns {Promise<any>}
 */
export async function transaction(callback) {
  let connection = null
  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    
    const result = await callback(connection)
    
    await connection.commit()
    return result
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback()
        console.log('🔄 事务已回滚')
      } catch (rollbackError) {
        console.error('❌ 回滚失败:', rollbackError.message)
      }
    }
    throw error
  } finally {
    if (connection) {
      try {
        await connection.release()
      } catch (releaseError) {
        console.error('⚠️ 连接释放失败:', releaseError.message)
      }
    }
  }
}

/**
 * 关闭连接池
 * @returns {Promise<void>}
 */
export async function closePool() {
  try {
    await pool.end()
    console.log('✅ 连接池已关闭')
  } catch (error) {
    console.error('❌ 关闭连接池失败:', error.message)
    throw error
  }
}

export default pool