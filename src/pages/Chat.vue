<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { apiFetch, send, upload } from '../api.js'
import { useVisiblePoll, useAction, useResource } from '../composables.js'
import { user } from '../store.js'
import { dateTimestamp, messageTime } from '../utils.js'
import Icon from '../components/Icon.vue'
import StatePanel from '../components/StatePanel.vue'
const route = useRoute(), convos = ref([]), active = ref(null), messages = ref([]), draft = ref(''), error = ref(''), loading = ref(true), messageLoading = ref(false), scroller = ref(null), search = ref('')
const { busy, run } = useAction()
const tab = ref('chats')
const friends = useResource('/friends')
const requests = useResource('/friends/requests', { incoming: [], outgoing: [] })
const friendCount = computed(() => requests.data.value.incoming?.length || 0)
let disposed = false, version = 0, initialising = true, messageVersion = 0
const selected = computed(() => convos.value.find(c => c.conversationId === active.value))
const filtered = computed(() => convos.value.filter(c => (c.otherUser?.name || '').includes(search.value)))
async function loadConvos() { const data = await apiFetch('/conversations'); if (!disposed) convos.value = data; return data }
async function loadMessages(cid, scroll = false) {
  const id = ++messageVersion
  const list = await apiFetch(`/conversations/${cid}/messages`)
  if (disposed || cid !== active.value || id !== messageVersion) return
  const nearBottom = !scroller.value || scroller.value.scrollHeight - scroller.value.scrollTop - scroller.value.clientHeight < 100
  const changed = list.length !== messages.value.length || list.at(-1)?.messageId !== messages.value.at(-1)?.messageId
  messages.value = list
  window.dispatchEvent(new Event('unread-updated'))
  if (scroll || (changed && nearBottom)) { await nextTick(); if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight }
}
async function select(cid) {
  active.value = cid; messages.value = []; error.value = ''; messageLoading.value = true
  try { await loadMessages(cid, true); await loadConvos() } catch (e) { error.value = e.message }
  finally { if (active.value === cid) messageLoading.value = false }
}
async function init() {
  const id = ++version; initialising = true; loading.value = true; error.value = ''
  try {
    let list = await loadConvos()
    if (disposed || id !== version) return
    let cid = list[0]?.conversationId
    if (route.query.uid && Number(route.query.uid) !== Number(user.value.userId)) {
      const result = await send('/conversations', { otherUserId: Number(route.query.uid), itemId: route.query.itemId ? Number(route.query.itemId) : null })
      if (disposed || id !== version) return
      cid = result.conversationId; list = await loadConvos()
    }
    if (cid) await select(cid)
  } catch (e) { if (!disposed) error.value = e.message }
  finally { if (id === version) { loading.value = false; initialising = false } }
}
watch(() => route.query.uid, init, { immediate: true })
useVisiblePoll(async () => { if (initialising) return; try { await loadConvos(); if (active.value) await loadMessages(active.value); await requests.load(true); if (tab.value === 'friends') await friends.load(true) } catch (e) { error.value = e.message } }, 5000)
onUnmounted(() => { disposed = true; version++; messageVersion++; window.removeEventListener('friends-updated', onFriendsUpdated) })
async function submit() {
  const content = draft.value.trim(), cid = active.value
  if (!content || !cid) return
  if (await run(() => send(`/conversations/${cid}/messages`, { content }), '')) { if (active.value === cid) draft.value = ''; await refreshAfterSend(cid) }
}
async function refreshAfterSend(cid) { try { await loadMessages(cid, true); await loadConvos() } catch (e) { error.value = e.message } }
async function attach(e) {
  const cid = active.value
  await run(async () => { for (const file of Array.from(e.target.files).slice(0, 5)) { const result = await upload(file, true); await send(`/conversations/${cid}/messages`, { msgType: file.type.startsWith('image/') ? 'image' : 'file', fileUrl: result.url, fileName: file.name, fileSize: file.size }) } await refreshAfterSend(cid) }, '')
  e.target.value = ''
}
function canRecall(m) { return Number(m.senderId) === Number(user.value.userId) && !m.recalled && Date.now() - dateTimestamp(m.createdAt) < 120000 }
async function recall(m) { if (window.confirm('确定撤回这条消息？') && await run(() => send(`/conversations/${active.value}/messages/${m.messageId}/recall`), '已撤回')) refreshAfterSend(active.value) }
async function remove(c) { if (window.confirm(`移除与「${c.otherUser.name}」的会话？仅影响你的列表。`) && await run(() => send(`/conversations/${c.conversationId}`, undefined, 'DELETE'), '会话已移除')) { if (active.value === c.conversationId) { active.value = null; messages.value = [] } await loadConvos() } }
async function openConversation(uid) {
  await run(async () => {
    const result = await send('/conversations', { otherUserId: Number(uid), itemId: null })
    await loadConvos()
    await select(result.conversationId)
    tab.value = 'chats'
  }, '')
}
function reloadFriends() { requests.load(true); friends.load(true); window.dispatchEvent(new Event('friends-updated')) }
const onFriendsUpdated = () => { requests.load(true); friends.load(true) }
onMounted(() => window.addEventListener('friends-updated', onFriendsUpdated))
async function acceptRequest(r) { if (await run(() => send(`/friends/requests/${r.requestId}/accept`), '已添加好友')) reloadFriends() }
async function rejectRequest(r) { if (await run(() => send(`/friends/requests/${r.requestId}`, undefined, 'DELETE'), '已拒绝该申请')) reloadFriends() }
async function withdrawRequest(r) { if (await run(() => send(`/friends/requests/${r.requestId}`, undefined, 'DELETE'), '已撤回申请')) reloadFriends() }
async function removeFriend(f) { if (window.confirm(`移除好友「${f.user.name}」？`) && await run(() => send(`/friends/${f.user.userId}`, undefined, 'DELETE'), '已移除好友')) reloadFriends() }
function keydown(e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit() } }
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <div class="eyebrow">A CONVERSATION STARTS HERE</div>
        <h1>
          消息中心
          <span class="heading-dot">.</span>
        </h1>
        <p>聊聊好物，认识同样热爱生活的人。</p>
      </div>
      <span class="pill">
        <span class="live-dot"></span>
        定时同步消息
      </span>
    </div>
    <div v-if="error" class="inline-error" role="alert">
      {{ error }}
      <button class="text-btn" @click="init">重试</button>
    </div>
    <div class="chat-layout" :class="{ 'has-conversation': active }">
      <aside class="conversation-list">
        <div class="tabs chat-tabs" role="tablist" aria-label="消息与好友">
          <button role="tab" :aria-selected="tab === 'chats'" :class="{ active: tab === 'chats' }" @click="tab = 'chats'">会话</button>
          <button role="tab" :aria-selected="tab === 'friends'" :class="{ active: tab === 'friends' }" @click="tab = 'friends'">
            好友
            <span v-if="friendCount">{{ friendCount }}</span>
          </button>
        </div>
        <template v-if="tab === 'chats'">
          <RouterLink to="/plaza?scope=users" class="user-lookup text-btn"><Icon name="search" :size="17" />去市集搜用户，查看 TA 的主页</RouterLink>
          <div class="conversation-search">
            <Icon name="search" :size="17" />
            <input v-model="search" aria-label="搜索联系人" placeholder="搜索联系人" />
          </div>
          <StatePanel :loading="loading" :empty="!loading && !convos.length" title="还没有会话" description="在好物详情页联系物主，即可开始交流。" />
          <div v-for="c in filtered" :key="c.conversationId" class="conversation" :class="{ active: c.conversationId === active }">
            <button class="conversation-select" @click="select(c.conversationId)">
              <span class="avatar">{{ (c.otherUser?.name || '用户').slice(0, 1) }}</span>
              <span class="conversation-copy">
                <strong>{{ c.otherUser?.name }}</strong>
                <small>{{ c.lastMessage || '开始聊聊吧' }}</small>
              </span>
              <span v-if="c.unread" class="badge-count">{{ c.unread }}</span>
            </button>
            <button class="icon-btn" :aria-label="`删除与 ${c.otherUser?.name} 的会话`" :disabled="busy" @click="remove(c)">
              <Icon name="trash" :size="14" />
            </button>
          </div>
        </template>
        <template v-else>
          <section class="friend-group">
            <h3>收到的申请</h3>
            <p v-if="!requests.data.value.incoming.length" class="friend-empty">暂时没有新的好友申请</p>
            <div v-for="r in requests.data.value.incoming" :key="r.requestId" class="friend-row">
              <RouterLink class="friend-person" :to="`/users/${r.user.userId}`">
                <span class="avatar"><img v-if="r.user.avatarUrl" :src="r.user.avatarUrl" alt="" /><template v-else>{{ r.user.name.slice(0, 1) }}</template></span>
                <span class="conversation-copy"><strong>{{ r.user.name }}</strong><small>{{ messageTime(r.createdAt) }} · 申请加你为好友</small></span>
              </RouterLink>
              <div class="friend-actions">
                <button class="btn primary small" :disabled="busy" @click="acceptRequest(r)">接受</button>
                <button class="btn small" :disabled="busy" @click="rejectRequest(r)">拒绝</button>
              </div>
            </div>
          </section>
          <section class="friend-group">
            <h3>
              我的好友
              <small>{{ friends.data.value.length }}</small>
            </h3>
            <p v-if="!friends.data.value.length" class="friend-empty">还没有好友，去 TA 的主页打个招呼吧</p>
            <div v-for="f in friends.data.value" :key="f.friendshipId" class="friend-row">
              <button type="button" class="friend-person" @click="openConversation(f.user.userId)">
                <span class="avatar"><img v-if="f.user.avatarUrl" :src="f.user.avatarUrl" alt="" /><template v-else>{{ f.user.name.slice(0, 1) }}</template></span>
                <span class="conversation-copy"><strong>{{ f.user.name }}</strong><small>{{ f.user.signature || '点击发消息' }}</small></span>
              </button>
              <div class="friend-actions">
                <button class="text-btn" :disabled="busy" @click="openConversation(f.user.userId)">发消息</button>
                <button class="text-btn danger" :disabled="busy" @click="removeFriend(f)">移除</button>
              </div>
            </div>
          </section>
          <section class="friend-group">
            <h3>我发出的申请</h3>
            <p v-if="!requests.data.value.outgoing.length" class="friend-empty">没有等待验证的申请</p>
            <div v-for="r in requests.data.value.outgoing" :key="r.requestId" class="friend-row">
              <RouterLink class="friend-person" :to="`/users/${r.user.userId}`">
                <span class="avatar"><img v-if="r.user.avatarUrl" :src="r.user.avatarUrl" alt="" /><template v-else>{{ r.user.name.slice(0, 1) }}</template></span>
                <span class="conversation-copy"><strong>{{ r.user.name }}</strong><small>{{ messageTime(r.createdAt) }} · 等待验证</small></span>
              </RouterLink>
              <div class="friend-actions">
                <button class="text-btn" :disabled="busy" @click="withdrawRequest(r)">撤回</button>
              </div>
            </div>
          </section>
        </template>
      </aside>
      <section class="chat-main">
        <template v-if="selected">
          <header class="chat-header">
            <button class="icon-btn chat-back" aria-label="返回会话列表" @click="active = null">
              <Icon name="back" />
            </button>
            <span class="avatar">{{ (selected.otherUser?.name || '用户').slice(0, 1) }}</span>
            <div>
              <RouterLink :to="`/users/${selected.otherUser?.userId}`"><strong>{{ selected.otherUser?.name }}</strong></RouterLink>
              <small>点击名字查看主页 · 友善沟通</small>
            </div>
            <RouterLink v-if="selected.itemId" :to="`/items/${selected.itemId}`" class="text-btn push-right">
              相关物品
              <Icon name="arrow" :size="16" />
            </RouterLink>
          </header>
          <div ref="scroller" class="chat-messages" role="log" aria-label="聊天消息">
            <StatePanel v-if="messageLoading" loading />
            <div v-for="m in messages" :key="m.messageId" class="message" :class="{ mine: Number(m.senderId) === Number(user.userId), recalled: m.recalled }">
              <span v-if="m.recalled" class="recall-text">消息已撤回</span>
              <template v-else>
                <small :title="String(m.createdAt)">{{ messageTime(m.createdAt) }}</small>
                <div class="message-bubble">
                  <a v-if="m.msgType === 'image'" :href="m.fileUrl" target="_blank" rel="noopener">
                    <img :src="m.fileUrl" :alt="m.fileName || '聊天图片'" loading="lazy" />
                  </a>
                  <a v-else-if="m.msgType === 'file'" :href="m.fileUrl" target="_blank" rel="noopener" class="file-message">
                    <Icon name="clip" />
                    {{ m.fileName }}
                    <small>{{ Math.ceil(m.fileSize / 1024) }} KB</small>
                  </a>
                  <span v-else>{{ m.content }}</span>
                </div>
                <button v-if="canRecall(m)" class="text-btn recall-action" :disabled="busy" @click="recall(m)">撤回</button>
              </template>
            </div>
          </div>
          <form class="chat-composer" @submit.prevent="submit">
            <textarea v-model="draft" aria-label="消息内容" placeholder="输入消息…" rows="3" maxlength="2000" :disabled="busy" @keydown="keydown"></textarea>
            <div>
              <label class="icon-btn attachment-label" title="发送图片或文件">
                <Icon name="clip" />
                <input type="file" multiple :disabled="busy" aria-label="发送附件" @change="attach" />
              </label>
              <small class="muted">Enter 发送 · Shift + Enter 换行</small>
              <button class="btn primary small push-right" :disabled="busy || !draft.trim()">
                <Icon name="send" :size="15" />
                {{ busy ? '发送中…' : '发送' }}
              </button>
            </div>
          </form>
        </template>
        <div v-else class="chat-placeholder">
          <Icon name="chat" :size="48" />
          <h2>每一次交流，都是新的相遇</h2>
          <p>选择一位用户，开始你们的对话。</p>
          <RouterLink to="/plaza" class="btn">去逛交易市集</RouterLink>
        </div>
      </section>
    </div>
  </div>
</template>
