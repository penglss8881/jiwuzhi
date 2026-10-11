// Runs against the configured local DB. Creates isolated fixtures and deletes only their IDs.
import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { randomUUID } from 'node:crypto'
import { query, closePool } from '../config/database.js'
import { signToken } from '../config/security.js'
import { platformRouter } from '../config/platform-routes.js'
import { socialRouter } from '../config/social-routes.js'

test('purchase-only marketplace and public profiles (real MySQL)', async t => {
  const ids = [], names = [], marker = `qa_${randomUUID().slice(0, 12)}`
  let server
  try {
    for (const suffix of ['seller', 'buyer', 'inactive']) {
      const name = `${marker}_${suffix}`
      const { rows } = await query(`INSERT INTO users (account_no, name, nickname, password, phone, address, status) VALUES (?, ?, ?, ?, ?, ?, ?)`, [name, name, name, 'not-a-login-password', '13800000000', 'private fixture address', suffix === 'inactive' ? 'inactive' : 'active'])
      ids.push(Number(rows.insertId)); names.push(name)
    }
    const [seller, buyer, inactive] = ids
    const token = id => signToken({ userId: id })
    const app = express(); app.use(express.json()); app.use('/api/v1', platformRouter, socialRouter)
    server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)) })
    const base = `http://127.0.0.1:${server.address().port}/api/v1`
    async function call(path, { method = 'GET', body, who = buyer, status = 200 } = {}) {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${token(who)}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
      const data = await response.json()
      assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`)
      return data
    }
    let itemId, orderId, oldItemId, legacyId
    await t.test('publishing always stores one sale price and rejects invalid prices', async () => {
      const item = await call('/items', { method: 'POST', who: seller, status: 201, body: { title: marker, category: '图书', price: 45, buyoutEnabled: false, buyoutPrice: 999, priceUnit: '元/天' } })
      itemId = item.itemId; assert.ok(itemId > 0)
      const detail = await call(`/items/${itemId}`)
      assert.equal(detail.price, 45); assert.equal(detail.buyoutPrice, 45); assert.equal(detail.priceUnit, '元/件'); assert.equal(detail.buyoutEnabled, true)
      await call('/items', { method: 'POST', who: seller, status: 400, body: { title: marker, category: '图书', price: 0 } })
      const old = await query(`INSERT INTO items (owner_id, title, category, price, buyout_enabled) VALUES (?, ?, '图书', 2, 0)`, [seller, `${marker}_old`])
      oldItemId = Number(old.rows.insertId)
    })
    await t.test('exact search, no fuzzy leakage, inactive users and authentication', async () => {
      const people = await call(`/users/search?q=${names[0]}`)
      assert.deepEqual(people.map(p => p.userId), [seller])
      assert.deepEqual(await call(`/users/search?q=${marker}`), [])
      assert.deepEqual(await call(`/users/search?q=${names[2]}`), [])
      await call('/users/search?q=x', { who: null, status: 401 })
    })
    await t.test('public profile excludes private fields and handles missing users', async () => {
      const profile = await call(`/users/${seller}/profile`)
      assert.deepEqual(Object.keys(profile).sort(), ['avatarUrl', 'name', 'signature', 'userId'])
      assert.equal(profile.name, names[0])
      await call(`/users/${inactive}/profile`, { status: 404 })
      await call('/users/not-an-id/profile', { status: 400 })
      await call(`/users/${seller}/profile`, { status: 401, who: null })
    })
    await t.test('profile goods and posts only belong to requested author, old prices stay hidden', async () => {
      await query(`INSERT INTO posts (user_id, title, content) VALUES (?, ?, 'seller moment'), (?, ?, 'buyer moment')`, [seller, marker, buyer, marker])
      const goods = await call(`/items?ownerId=${seller}`)
      assert.deepEqual(goods.map(i => i.itemId), [itemId])
      assert.equal((await call(`/items/${oldItemId}`)).price, null)
      const posts = await call(`/posts?authorId=${seller}&keyword=${marker}`)
      assert.equal(posts.length, 1); assert.equal(posts[0].authorId, seller)
      await call('/items?ownerId=bad', { status: 400 })
      await call('/posts?authorId=bad', { status: 400 })
      await call(`/items/${oldItemId}/rent-requests`, { method: 'POST', status: 400, body: { phone: '13800000000', address: 'test' } })
    })
    await t.test('new rental calls rejected, purchase creation and duplicate prevention', async () => {
      const contact = { phone: '13800000000', address: 'test' }
      await call(`/items/${itemId}/rent-requests`, { method: 'POST', status: 400, body: { ...contact, type: 'rent', expectDays: 7 } })
      const created = await call(`/items/${itemId}/rent-requests`, { method: 'POST', status: 201, body: contact })
      orderId = created.requestId; assert.ok(orderId > 0); assert.equal(created.feeAmount, 45)
      const order = await call(`/rent-requests/${orderId}`)
      assert.equal(order.requestType, 'buyout'); assert.equal(order.expectDays, null)
      await call(`/items/${itemId}/rent-requests`, { method: 'POST', status: 409, body: contact })
    })
    await t.test('payment, seller acceptance, shipping and buyer receipt', async () => {
      await call(`/rent-requests/${orderId}/pay`, { method: 'POST', body: { payMethod: 'wechat' } })
      await call(`/rent-requests/${orderId}`, { method: 'PUT', who: seller, body: { status: 'agreed' } })
      await call(`/rent-requests/${orderId}/ship`, { method: 'POST', who: seller })
      await call(`/rent-requests/${orderId}/receive`, { method: 'POST' })
      const order = await call(`/rent-requests/${orderId}`)
      assert.ok(order.receivedAt)
      assert.deepEqual(await call(`/items?ownerId=${seller}`), [])
      await call(`/items/${itemId}`, { method: 'PUT', who: seller, status: 409, body: { price: 99 } })
    })
    await t.test('profile messaging opens the correct existing conversation', async () => {
      const conversation = await call('/conversations', { method: 'POST', status: 201, body: { otherUserId: seller } })
      assert.ok(conversation.conversationId > 0)
      const list = await call('/conversations')
      assert.ok(list.some(c => c.conversationId === conversation.conversationId && c.otherUser.userId === seller))
    })
    await t.test('legacy records remain readable but cannot start payment or return workflows', async () => {
      const old = await query(`INSERT INTO rent_requests (item_id, requester_id, request_type, phone, address, expect_days) VALUES (?, ?, 'rent', '13800000000', 'test', 7)`, [oldItemId, buyer])
      legacyId = Number(old.rows.insertId)
      assert.equal((await call(`/rent-requests/${legacyId}`)).requestType, 'rent')
      for (const suffix of ['/pay', '/return', '/return/confirm']) await call(`/rent-requests/${legacyId}${suffix}`, { method: 'POST', body: { payMethod: 'wechat' }, status: 410 })
      await call(`/items/${oldItemId}`, { method: 'PUT', who: seller, body: { price: 80 } })
      assert.equal((await call(`/items/${oldItemId}`)).price, 80)
      assert.equal((await call(`/rent-requests/${legacyId}`)).price, 2)
    })
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    // IDs were collected only from INSERT results made in this test.
    for (const id of ids.reverse()) await query('DELETE FROM users WHERE user_id = ?', [id])
    for (const name of names) await query('DELETE FROM logs WHERE operator = ?', [name])
    await closePool()
  }
})
