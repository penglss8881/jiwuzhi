<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { user, toast, setUser } from './store.js'
import { apiFetch, clearCache, send } from './api.js'
import { useVisiblePoll, useAction } from './composables.js'
import { pages } from './router.js'
import Icon from './components/Icon.vue'
import Modal from './components/Modal.vue'
const route = useRoute(), router = useRouter()
const mobile = ref(false), search = ref(''), unread = ref(0), pending = ref(0), friendPending = ref(0), passwordOpen = ref(false)
const refreshKey = ref(0), refreshing = ref(false)
const pwd = ref({ currentPassword: '', newPassword: '', confirm: '' })
const { busy, error, run } = useAction()
const nav = [
  { path: '/', name: '生活广场', icon: 'grid', key: 'forum' }, { path: '/recommend', name: '推荐好物', icon: 'spark', key: 'recommend' },
  { path: '/plaza', name: '发现好物', icon: 'box', key: 'plaza' },
  { path: '/warehouse', name: '我的发布', icon: 'plus', key: 'warehouse' }, { path: '/favorites', name: '我的收藏', icon: 'heart', key: 'favorites' },
  { path: '/rentals', name: '交易订单', icon: 'orders', key: 'rentals' }, { path: '/chat', name: '消息中心', icon: 'chat', key: 'chat' },
]
const displayName = computed(() => user.value?.nickname || user.value?.name || '社区用户')
const updateBadges = useVisiblePoll(async () => {
  const token = user.value?.token
  if (!token) return
  const results = await Promise.allSettled([apiFetch('/conversations/unread-count', { ttl: 5000 }), apiFetch('/rent-requests/pending-count', { ttl: 5000 }), apiFetch('/friends/pending-count', { ttl: 5000 })])
  if (user.value?.token !== token) return
  if (results[0].status === 'fulfilled') unread.value = Number(results[0].value.total || 0)
  if (results[1].status === 'fulfilled') pending.value = Number(results[1].value.total || 0)
  if (results[2].status === 'fulfilled') friendPending.value = Number(results[2].value.total || 0)
}, 20000)
watch(() => route.fullPath, () => { mobile.value = false })
watch(user, value => { unread.value = 0; pending.value = 0; friendPending.value = 0; if (value) updateBadges(); else if (!route.meta.public) router.replace('/login') })
const badgeEvent = () => updateBadges()
onMounted(() => { window.addEventListener('unread-updated', badgeEvent); window.addEventListener('rentals-updated', badgeEvent); window.addEventListener('friends-updated', badgeEvent) })
onUnmounted(() => { window.removeEventListener('unread-updated', badgeEvent); window.removeEventListener('rentals-updated', badgeEvent); window.removeEventListener('friends-updated', badgeEvent) })
function logout() { setUser(null); passwordOpen.value = false; router.replace('/login') }
function prefetch(key) { if (!navigator.connection?.saveData) pages[key]?.().catch(() => {}) }
function refreshCurrent() {
  if (refreshing.value) return
  refreshing.value = true
  clearCache()
  refreshKey.value++
  window.setTimeout(() => { refreshing.value = false }, 500)
}
async function changePassword() {
  if (pwd.value.newPassword !== pwd.value.confirm) { error.value = '两次输入的密码不一致'; return }
  if (await run(() => send('/users/me/password', { currentPassword: pwd.value.currentPassword, newPassword: pwd.value.newPassword }, 'PUT'), '密码已修改')) passwordOpen.value = false
}
</script>
<template>
  <a href="#main" class="skip-link">跳到主要内容</a>
  <div v-if="user && route.path !== '/login'" class="app-shell">
    <div v-if="mobile" class="nav-shade" @click="mobile = false"></div>
    <aside class="sidebar" :class="{ open: mobile }" aria-label="主导航">
      <RouterLink to="/" class="brand">
        <span class="brand-mark">
          <Icon name="spark" :size="24" />
        </span>
        <span>
          集物志
          <small>好物有去处，观点有回响</small>
        </span>
      </RouterLink>
      <div class="nav-caption">探索与发现</div>
      <nav>
        <RouterLink v-for="(n, i) in nav" :key="n.path" :to="n.path" class="nav-link" :class="{ selected: route.path === n.path, 'nav-gap': i === 3 }" @mouseenter="prefetch(n.key)" @focus="prefetch(n.key)">
          <Icon :name="n.icon" />
          <span>{{ n.name }}</span>
          <span v-if="(n.key === 'chat' && (unread + friendPending)) || (n.key === 'rentals' && pending)" class="badge-count">{{ Math.min(99, n.key === 'chat' ? unread + friendPending : pending) }}</span>
        </RouterLink>
      </nav>
      <div class="nav-caption">更多服务</div>
      <RouterLink to="/profile" class="nav-link" :class="{ selected: route.path === '/profile' }">
        <Icon name="user" />
        <span>个人中心</span>
      </RouterLink>
      <RouterLink v-if="user.isAdmin" to="/admin" class="nav-link" :class="{ selected: route.path === '/admin' }">
        <Icon name="shield" />
        <span>管理后台</span>
      </RouterLink>
      <div class="sidebar-bottom">
        <div class="eco-note">
          <Icon name="leaf" />
          <strong>分享，也是一种连接</strong>
          <p>
            分享真实经验
            <br />
            也让闲置遇到需要的人。
          </p>
          <RouterLink to="/warehouse?new=1">
            让闲置焕新
            <Icon name="arrow" :size="16" />
          </RouterLink>
        </div>
        <div class="sidebar-account">
          <RouterLink to="/profile" class="account-link">
            <span class="avatar"><img v-if="user.avatarUrl" :src="user.avatarUrl" alt="" /><template v-else>{{ displayName.slice(0, 1) }}</template></span>
            <span>
              <strong>{{ displayName }}</strong>
              <small>{{ user.isAdmin ? '平台管理员' : '集物志社区成员' }}</small>
            </span>
          </RouterLink>
          <button class="icon-btn" aria-label="退出登录" title="退出登录" @click="logout">
            <Icon name="logout" :size="18" />
          </button>
        </div>
      </div>
    </aside>
    <div class="workspace">
      <header class="topbar">
        <div class="breadcrumb">
          <button class="icon-btn mobile-menu" aria-label="打开导航" @click="mobile = !mobile">
            <Icon name="menu" />
          </button>
          <span class="muted">集物志</span>
          <Icon name="next" :size="14" />
          <strong>{{ route.meta.title }}</strong>
        </div>
        <div class="topbar-actions">
          <form v-if="route.path !== '/plaza'" class="global-search" @submit.prevent="router.push({ path: '/plaza', query: search.trim() ? { keyword: search.trim() } : {} })">
            <Icon name="search" :size="17" />
            <input v-model="search" aria-label="全站搜索商品或用户" placeholder="搜索商品 / 用户账号 / 昵称…" maxlength="100" />
            <kbd>↵</kbd>
          </form>
          <RouterLink to="/chat" class="icon-btn notification" aria-label="查看消息">
            <Icon name="bell" />
            <i v-if="unread"></i>
          </RouterLink>
          <button class="icon-btn" :class="{ refreshing }" title="刷新当前页面" aria-label="刷新当前页面" :disabled="refreshing" @click="refreshCurrent">
            <Icon name="refresh" :size="19" />
          </button>
          <button class="icon-btn" title="修改密码" aria-label="修改密码" @click="pwd = { currentPassword: '', newPassword: '', confirm: '' }; error = ''; passwordOpen = true">
            <Icon name="lock" :size="19" />
          </button>
        </div>
      </header>
      <main id="main" class="main-content">
        <RouterView v-slot="{ Component, route: current }">
          <Transition name="page" mode="out-in">
            <KeepAlive :max="4" :include="['Forum', 'Plaza', 'Favorites']">
              <component :is="Component" :key="`${user.userId}:${current.path}:${refreshKey}`" />
            </KeepAlive>
          </Transition>
        </RouterView>
      </main>
      <footer class="site-footer">
        <span>集物志 JIWUZHI · 好物有去处，观点有回响</span>
        <span>真实分享 · 友善交易</span>
      </footer>
    </div>
  </div>
  <RouterView v-else />
  <Transition name="toast">
    <div v-if="toast.text" class="toast" :class="toast.type" role="status" aria-live="polite">
      <Icon :name="toast.type === 'error' ? 'close' : 'check'" :size="18" />
      {{ toast.text }}
      <button class="icon-btn" aria-label="关闭提示" @click="toast.text = ''">
        <Icon name="close" :size="14" />
      </button>
    </div>
  </Transition>
  <Modal v-if="passwordOpen" title="修改登录密码" :busy="busy" @close="passwordOpen = false">
    <form class="form-stack" @submit.prevent="changePassword">
      <label>
        当前密码
        <input v-model="pwd.currentPassword" type="password" autocomplete="current-password" required />
      </label>
      <label>
        新密码
        <input v-model="pwd.newPassword" type="password" autocomplete="new-password" minlength="4" required />
      </label>
      <label>
        确认新密码
        <input v-model="pwd.confirm" type="password" autocomplete="new-password" minlength="4" required />
      </label>
      <p v-if="error" class="error-text">{{ error }}</p>
      <button class="btn primary" :disabled="busy">{{ busy ? '保存中…' : '确认修改' }}</button>
    </form>
  </Modal>
</template>
