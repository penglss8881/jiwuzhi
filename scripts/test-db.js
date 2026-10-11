// 数据库连接测试脚本
import { testConnection, closePool } from '../config/database.js'

async function main() {
  console.log('====================================')
  console.log('🎯 MySQL数据库连接测试')
  console.log('====================================\n')
  
  // 测试连接
  const result = await testConnection()
  
  console.log('\n====================================')
  if (result.success) {
    console.log('✅ 测试结果: 成功')
    console.log(`📋 数据库: ${result.database}`)
    console.log(`📍 主机: ${result.host}`)
  } else {
    console.log('❌ 测试结果: 失败')
    console.log(`📝 错误信息: ${result.message}`)
    console.log(`💡 建议: ${result.suggestion}`)
    if (result.errorCode) {
      console.log(`🔢 错误代码: ${result.errorCode}`)
    }
  }
  console.log('====================================')
  
  // 关闭连接池
  await closePool()
}

// 执行测试
main().catch((error) => {
  console.error('❌ 测试脚本执行失败:', error.message)
  process.exit(1)
})