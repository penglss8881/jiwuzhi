import crypto from 'node:crypto'

const PASSWORD_PREFIX = 'pbkdf2$'
const ITERATIONS = 120000
const KEY_LENGTH = 64
const DIGEST = 'sha256'

// AES-256-GCM 加密配置
const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16 // AES GCM 推荐 12 字节，这里使用 16 字节以兼容
const AUTH_TAG_LENGTH = 16
const ENCRYPTED_PREFIX = 'aes256gcm$'

// Token 配置
const TOKEN_EXPIRY_SECONDS = 86400 // 24 小时

/**
 * 获取加密密钥（32 字节，用于 AES-256）
 * 优先使用环境变量 SECRET_KEY，否则使用默认密钥（生产环境请务必设置环境变量）
 */
function getEncryptionKey() {
  const envKey = process.env.SECRET_KEY
  if (envKey && envKey.length >= 32) {
    return Buffer.from(envKey.slice(0, 32), 'utf8')
  }
  // 默认密钥 — 生产环境务必通过 .env 设置 SECRET_KEY
  const defaultKey = 'library-mgmt-default-secret-key!!'
  return Buffer.from(defaultKey.padEnd(32, '!').slice(0, 32), 'utf8')
}

// ==================== 密码处理（PBKDF2 单向哈希，不可逆） ====================

/**
 * 密码哈希（PBKDF2，不可逆）
 * @param {string} password - 明文密码
 * @returns {string} PBKDF2 哈希，格式: pbkdf2$iterations$salt$derived
 */
export function hashPassword(password) {
  if (!password) return ''
  const salt = crypto.randomBytes(32).toString('hex')
  const derived = crypto.pbkdf2Sync(String(password), salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex')
  return `${PASSWORD_PREFIX}${ITERATIONS}$${salt}$${derived}`
}

/**
 * 校验密码
 * 支持三种存储格式：
 * 1. PBKDF2 哈希（pbkdf2$...） — 当前格式
 * 2. AES 加密的 PBKDF2 哈希（aes256gcm$ 包裹 pbkdf2$） — 过渡期格式
 * 3. AES 加密的明文（aes256gcm$ 包裹纯明文） — 过渡期格式
 * @param {string} password - 用户输入的明文密码
 * @param {string} storedPassword - 数据库中存储的密码
 * @returns {boolean}
 */
export function verifyPassword(password, storedPassword) {
  if (!storedPassword) return false
  if (!password) return false

  // 如果外层是 AES 加密，先解密
  const inner = storedPassword.startsWith(ENCRYPTED_PREFIX)
    ? decryptField(storedPassword)
    : storedPassword

  if (!inner) return false

  // 格式 1 & 2：PBKDF2 哈希验证
  if (inner.startsWith(PASSWORD_PREFIX)) {
    const [, iterationsText, salt, derived] = inner.split('$')
    const iterations = Number(iterationsText)
    const candidate = crypto.pbkdf2Sync(String(password), salt, iterations, KEY_LENGTH, DIGEST).toString('hex')
    return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(derived, 'hex'))
  }

  // 格式 3（过渡期）：AES 加密的明文，直接比对
  return String(password) === inner
}

// ==================== 字段加密 ====================

/**
 * 加密敏感字段（如账号 account_no）
 * @param {string} plaintext - 明文
 * @returns {string} 加密后的字符串，格式: aes256gcm$iv_hex$authTag_hex$ciphertext_hex
 */
export function encryptField(plaintext) {
  if (!plaintext) return plaintext
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
  let encrypted = cipher.update(String(plaintext), 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${ENCRYPTED_PREFIX}${iv.toString('hex')}$${authTag.toString('hex')}$${encrypted}`
}

/**
 * 解密敏感字段
 * @param {string} ciphertext - 加密后的字符串
 * @returns {string} 明文
 */
export function decryptField(ciphertext) {
  if (!ciphertext) return ciphertext
  // 如果不是加密格式，直接返回原值（兼容旧数据）
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) {
    return ciphertext
  }
  try {
    const key = getEncryptionKey()
    const parts = ciphertext.slice(ENCRYPTED_PREFIX.length).split('$')
    if (parts.length !== 3) return ciphertext
    const [ivHex, authTagHex, encryptedHex] = parts
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH })
    decipher.setAuthTag(authTag)
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch (_err) {
    // 解密失败时返回原值（兼容损坏数据或密钥变更）
    return ciphertext
  }
}

// ==================== Token 签发与验证（HMAC-SHA256） ====================

/**
 * 签发登录令牌
 * @param {{ userId: number, role: string, name: string }} payload
 * @returns {string} JWT-like token
 */
export function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({
    userId: payload.userId,
    role: payload.role,
    name: payload.name,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS,
  })).toString('base64url')
  const signature = crypto.createHmac('sha256', getEncryptionKey())
    .update(`${header}.${body}`)
    .digest('base64url')
  return `${header}.${body}.${signature}`
}

/**
 * 验证令牌签名与有效期
 * @param {string} token
 * @returns {{ userId: number, role: string, name: string }}
 */
export function verifyToken(token) {
  if (!token || typeof token !== 'string') {
    throw new Error('令牌格式无效')
  }
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('令牌格式无效')
  }
  const [headerB64, bodyB64, signature] = parts
  const expectedSig = crypto.createHmac('sha256', getEncryptionKey())
    .update(`${headerB64}.${bodyB64}`)
    .digest('base64url')

  const sigBuf = Buffer.from(signature, 'base64url')
  const expBuf = Buffer.from(expectedSig, 'base64url')
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('令牌签名验证失败')
  }

  const payload = JSON.parse(Buffer.from(bodyB64, 'base64url').toString('utf8'))
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('令牌已过期，请重新登录')
  }
  return { userId: payload.userId, role: payload.role, name: payload.name }
}
