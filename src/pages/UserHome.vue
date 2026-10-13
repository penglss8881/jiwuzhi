<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useResource, useAction } from '../composables.js'
import { send } from '../api.js'
import { user, notify } from '../store.js'
import { dateText, goBack } from '../utils.js'
import Icon from '../components/Icon.vue'
import ItemCard from '../components/ItemCard.vue'
import StatePanel from '../components/StatePanel.vue'
import UserAvatar from '../components/UserAvatar.vue'
import Pagination from '../components/Pagination.vue'
const route = useRoute(), router = useRouter(), tab = ref('items'), page = ref(1)
const uid = computed(() => String(route.params.userId))
const { data: person, loading, error, load } = useResource(() => `/users/${encodeURIComponent(uid.value)}/profile`, null, 0)
const items = useResource(() => person.value?.userId === Number(uid.value) ? `/items?ownerId=${uid.value}` : null)
const posts = useResource(() => person.value?.userId === Number(uid.value) ? `/posts?authorId=${uid.value}` : null)
const current = computed(() => tab.value === 'items' ? items : posts)
const visible = computed(() => current.value.data.value.slice((page.value - 1) * 12, page.value * 12))
const own = computed(() => Number(uid.value) === Number(user.value?.userId))
const friend = useResource(() => own.value ? null : `/friends/status/${encodeURIComponent(uid.value)}`, { status: 'none', requestId: null }, 0)
const { busy: friendBusy, run: friendRun } = useAction()
async function refreshFriend() { await friend.load(true); window.dispatchEvent(new Event('friends-updated')) }
async function addFriend() {
  await friendRun(async () => {
    const result = await send('/friends/requests', { userId: Number(uid.value) })
    notify(result.accepted ? '你们已成为好友' : '好友申请已发送')
  }, '')
  await refreshFriend()
}
async function acceptFriend() { if (await friendRun(() => send(`/friends/requests/${friend.data.value.requestId}/accept`), '已添加好友')) await refreshFriend() }
async function rejectFriend() { if (await friendRun(() => send(`/friends/requests/${friend.data.value.requestId}`, undefined, 'DELETE'), '已拒绝该申请')) await refreshFriend() }
async function withdrawFriend() { if (await friendRun(() => send(`/friends/requests/${friend.data.value.requestId}`, undefined, 'DELETE'), '已撤回申请')) await refreshFriend() }
async function removeFriend() { if (window.confirm('确定移除这位好友？') && await friendRun(() => send(`/friends/${Number(uid.value)}`, undefined, 'DELETE'), '已移除好友')) await refreshFriend() }
const back = () => goBack(router, '/plaza?scope=users')
watch(uid, () => { tab.value = 'items'; page.value = 1 })
watch(tab, () => { page.value = 1 })
</script>
<template>
  <div>
    <button type="button" class="back-link" @click="back"><Icon name="back" :size="17" />返回上一页</button>
    <StatePanel :loading="loading" :error="error" @retry="load(true)" />
    <template v-if="person && !loading && !error">
      <section class="public-profile panel">
        <div class="profile-cover"><span>GOOD THINGS & EVERYDAY MOMENTS</span></div>
        <div class="public-profile-info">
          <UserAvatar class="profile-portrait" :person="person" alt="用户头像" />
          <div class="profile-identity"><div class="eyebrow">{{ own ? '我的主页' : 'TA 的主页' }}</div><h1>{{ person.name }}</h1><p>{{ person.signature || '把喜欢的好物，分享给同样喜欢的人。' }}</p></div>
          <div v-if="!own" class="profile-actions">
            <button v-if="friend.data.value.status === 'none'" class="btn primary" :disabled="friendBusy" @click="addFriend"><Icon name="userPlus" :size="18" />加好友</button>
            <template v-else-if="friend.data.value.status === 'pending_out'">
              <button class="btn" disabled><Icon name="userCheck" :size="18" />已申请，等待验证</button>
              <button class="text-btn" :disabled="friendBusy" @click="withdrawFriend">撤回</button>
            </template>
            <template v-else-if="friend.data.value.status === 'pending_in'">
              <button class="btn primary" :disabled="friendBusy" @click="acceptFriend"><Icon name="userCheck" :size="18" />接受申请</button>
              <button class="btn" :disabled="friendBusy" @click="rejectFriend">拒绝</button>
            </template>
            <template v-else-if="friend.data.value.status === 'friends'">
              <span class="pill"><Icon name="userCheck" :size="15" />已是好友</span>
              <button class="text-btn danger" :disabled="friendBusy" @click="removeFriend">移除</button>
            </template>
            <RouterLink :to="`/chat?uid=${person.userId}`" class="btn"><Icon name="chat" :size="18" />发私信</RouterLink>
          </div>
          <RouterLink v-else to="/profile" class="btn">编辑资料</RouterLink>
        </div>
      </section>
      <div class="tabs standalone" role="tablist" aria-label="主页内容">
        <button role="tab" :aria-selected="tab === 'items'" :class="{ active: tab === 'items' }" @click="tab = 'items'">{{ own ? '我的好物' : 'TA 的好物' }}</button>
        <button role="tab" :aria-selected="tab === 'posts'" :class="{ active: tab === 'posts' }" @click="tab = 'posts'">{{ own ? '我的动态' : 'TA 的动态' }}</button>
      </div>
      <StatePanel :loading="current.loading.value" :error="current.error.value" :empty="!current.data.value.length" :title="tab === 'items' ? '还没有在售好物' : '还没有发布动态'" description="以后再来看看，或发消息聊一聊。" @retry="current.load(true)" />
      <template v-if="!current.loading.value && !current.error.value">
        <div v-if="tab === 'items'" class="item-grid"><ItemCard v-for="item in visible" :key="item.itemId" :item="item" /></div>
        <div v-else class="profile-moments">
          <article v-for="post in visible" :key="post.postId" class="post-card">
            <small class="muted">{{ dateText(post.createdAt) }}</small>
            <RouterLink :to="`/posts/${post.postId}`"><h2>{{ post.title }}</h2><p class="prose">{{ post.content }}</p><div v-if="post.images?.length" class="post-images moment-images"><img v-for="(src, i) in post.images" :key="i" :src="src" alt="动态配图" loading="lazy" /></div></RouterLink>
            <RouterLink :to="`/posts/${post.postId}`" class="moment-action"><Icon name="heart" :size="16" />{{ post.likeCount || 0 }}<Icon name="chat" :size="16" />{{ post.commentCount || 0 }} · 查看动态</RouterLink>
          </article>
        </div>
        <Pagination v-model:page="page" :total="current.data.value.length" />
      </template>
    </template>
  </div>
</template>
