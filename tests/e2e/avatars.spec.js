import { test, expect } from '@playwright/test'
import { mockApp } from './fixtures.js'

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0v8AAAAASUVORK5CYII=', 'base64')

async function chatWithAvatars(page) {
  const state = await mockApp(page)
  const peer = { userId: 2, name: '鹿鸣', avatarUrl: 'uploads/peer-avatar.png' }
  state.messages.push(
    { messageId: 1, senderId: 2, content: '这本书还在。', msgType: 'text', createdAt: '2026-10-08T10:00:00Z' },
    { messageId: 2, senderId: 1, content: '我想了解一下。', msgType: 'text', createdAt: '2026-10-08T10:01:00Z' },
  )
  await page.route('**/uploads/*.png', route => route.fulfill({ contentType: 'image/png', body: pixel }))
  await page.route('**/api/v1/conversations', route => route.request().method() === 'GET'
    ? route.fulfill({ json: [{ conversationId: 1, otherUser: peer, lastMessage: '我想了解一下。', unread: 0 }] })
    : route.fallback())
  return { ...state, peer }
}

test('uploaded avatar follows the user into messages and moments, then removal clears it everywhere', async ({ page }) => {
  await chatWithAvatars(page)
  await page.route('**/uploads', route => route.fulfill({ json: { url: '/uploads/my-avatar.png' } }))
  await page.goto('/profile')
  await page.locator('.upload-control input[type=file]').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: pixel })
  await expect(page.locator('.profile-avatar img')).toHaveAttribute('src', '/uploads/my-avatar.png')
  await expect(page.locator('.sidebar-account img')).toHaveAttribute('src', '/uploads/my-avatar.png')

  await page.locator('.sidebar').getByRole('link', { name: '消息中心' }).click()
  await expect(page.locator('.message.mine .message-avatar img')).toHaveAttribute('src', '/uploads/my-avatar.png')
  for (const location of ['.conversation-select', '.chat-header', '.message:not(.mine)']) {
    await expect(page.locator(`${location} .avatar img`)).toHaveAttribute('src', '/uploads/peer-avatar.png')
    await expect(page.locator(`${location} .avatar img`)).toHaveJSProperty('naturalWidth', 1)
  }

  await page.locator('.sidebar').getByRole('link', { name: '生活广场' }).click()
  await expect(page.locator('.moment-launch .avatar img')).toHaveAttribute('src', '/uploads/my-avatar.png')
  await page.getByRole('button', { name: '分享此刻', exact: true }).click()
  await expect(page.locator('.compose-self .avatar img')).toHaveAttribute('src', '/uploads/my-avatar.png')
  await page.keyboard.press('Escape')
  await page.locator('.sidebar').getByRole('link', { name: '个人中心', exact: true }).click()
  await page.getByRole('button', { name: '移除头像', exact: true }).click()
  await expect(page.locator('.profile-avatar img')).toHaveCount(0)
  await expect(page.locator('.sidebar-account img')).toHaveCount(0)
  await page.locator('.sidebar').getByRole('link', { name: '消息中心' }).click()
  await expect(page.locator('.message.mine .message-avatar')).toHaveText('林')
  await expect(page.locator('.message.mine .message-avatar img')).toHaveCount(0)
})

test('conversation polling refreshes all peer avatars, with a fallback and recovery for missing files', async ({ page }) => {
  const { peer } = await chatWithAvatars(page)
  await page.goto('/chat')
  await expect(page.locator('.chat-header .avatar img')).toHaveAttribute('src', '/uploads/peer-avatar.png')
  peer.avatarUrl = './uploads/peer-updated.png'
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  for (const location of ['.conversation-select', '.chat-header', '.message:not(.mine)']) {
    await expect(page.locator(`${location} .avatar img`)).toHaveAttribute('src', '/uploads/peer-updated.png')
  }
  await page.route('**/uploads/missing.png', route => route.fulfill({ status: 404, body: 'Missing' }))
  peer.avatarUrl = '/uploads/missing.png'
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.locator('.chat-header .avatar img')).toHaveCount(0)
  await expect(page.locator('.chat-header .avatar')).toHaveText('鹿')
  peer.avatarUrl = '/uploads/recovered.png'
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.locator('.chat-header .avatar img')).toHaveAttribute('src', '/uploads/recovered.png')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('textbox', { name: '消息内容' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('an avatar changed in another tab updates existing messages without a reload', async ({ page, context }) => {
  await chatWithAvatars(page)
  await page.goto('/chat')
  await expect(page.locator('.message.mine .message-avatar')).toHaveText('林')
  const otherTab = await context.newPage()
  await otherTab.route('**/avatar-sync-test', route => route.fulfill({ contentType: 'text/html', body: '<title>Avatar sync</title>' }))
  await otherTab.goto('/avatar-sync-test')
  await otherTab.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('library_current_user'))
    localStorage.setItem('library_current_user', JSON.stringify({ ...current, avatarUrl: '/uploads/another-tab.png' }))
  })
  await page.bringToFront()
  await expect(page.locator('.message.mine .message-avatar img')).toHaveAttribute('src', '/uploads/another-tab.png')
  await expect(page.locator('.sidebar-account img')).toHaveAttribute('src', '/uploads/another-tab.png')
  await otherTab.evaluate(() => {
    const current = JSON.parse(localStorage.getItem('library_current_user'))
    localStorage.setItem('library_current_user', JSON.stringify({ ...current, avatarUrl: '' }))
  })
  await expect(page.locator('.message.mine .message-avatar img')).toHaveCount(0)
  await expect(page.locator('.message.mine .message-avatar')).toHaveText('林')
  await otherTab.close()
})
