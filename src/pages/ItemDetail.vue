<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useResource, useAction } from '../composables.js'
import { apiFetch, send } from '../api.js'
import { user } from '../store.js'
import { goBack, money, itemStatus } from '../utils.js'
import Icon from '../components/Icon.vue'
import Cover from '../components/Cover.vue'
import Modal from '../components/Modal.vue'
import Comments from '../components/Comments.vue'
import StatePanel from '../components/StatePanel.vue'
import UserAvatar from '../components/UserAvatar.vue'
const route = useRoute(), router = useRouter()
const { data: item, loading, error, load } = useResource(() => `/items/${route.params.itemId}`, null, 0)
const { busy, error: formError, run } = useAction()
const modal = ref(false)
const form = ref({ type: 'buyout', phone: '', address: '', note: '' })
const owner = computed(() => Number(item.value?.ownerId) === Number(user.value?.userId))
const amount = computed(() => item.value?.buyoutPrice)
const back = () => goBack(router, '/plaza')
onMounted(async () => { try { const me = await apiFetch('/users/me', { ttl: 30000 }); form.value.phone = me.phone || ''; form.value.address = me.address || '' } catch { /* Contact fields remain editable. */ } })
async function favorite() { await run(async () => { const res = await send(`/items/${item.value.itemId}/favorite`); Object.assign(item.value, res) }, '') }
async function submit() {
  await run(async () => {
    const result = await send(`/items/${item.value.itemId}/rent-requests`, { ...form.value, phone: form.value.phone.trim(), address: form.value.address.trim() })
    modal.value = false
    window.dispatchEvent(new Event('rentals-updated'))
    await router.push(`/orders/${result.requestId}`)
  }, '订单已创建，请在订单页完成模拟支付')
}
</script>
<template>
  <div>
    <button type="button" class="back-link" @click="back">
      <Icon name="back" :size="17" />
      返回上一页
    </button>
    <StatePanel :loading="loading" :error="error" @retry="load(true)" />
    <template v-if="item && !loading && !error">
      <section class="item-detail panel">
        <Cover :src="item.coverImageUrl" :title="item.title" :category="item.category" />
        <div class="item-detail-info">
          <div class="row-meta">
            <span class="status-tag" :class="item.status">{{ itemStatus(item.status) }}</span>
            <span>{{ item.category }}</span>
          </div>
          <h1>{{ item.title }}</h1>
          <div v-if="item.buyoutEnabled" class="detail-price">
            <small>¥</small>
            {{ money(item.price) }}
            <span>{{ item.priceUnit }}</span>
          </div>
          <p v-else class="notice">卖家尚未确认商品售价，暂不可购买。</p>
          <RouterLink :to="`/users/${item.ownerId}`" class="seller-line" aria-label="查看卖家主页">
            <UserAvatar :person="{ userId: item.ownerId, name: item.ownerName, avatarUrl: item.ownerAvatar }" />
            <div>
              <strong>{{ item.ownerName || '用户' }}</strong>
              <small>{{ item.ownerSignature || '让每一件好物，都有下一段故事。' }}</small>
            </div>
          </RouterLink>
          <h3>关于这件好物</h3>
          <p class="prose muted">{{ item.description || '物主暂未添加描述，可以通过私信了解更多。' }}</p>
          <div class="detail-cta">
            <template v-if="!owner && item.status === 'on_sale' && item.buyoutEnabled">
              <button class="btn primary" @click="formError = ''; modal = true">
                立即购买
                <Icon name="arrow" :size="18" />
              </button>
            </template>
            <RouterLink v-if="owner" to="/warehouse" class="btn primary">管理这件物品</RouterLink>
            <RouterLink v-else :to="`/chat?uid=${item.ownerId}&itemId=${item.itemId}`" class="btn">
              <Icon name="chat" :size="17" />
              联系物主
            </RouterLink>
            <button class="btn" :disabled="busy" :aria-pressed="!!item.favorited" @click="favorite">
              <Icon name="heart" :size="17" />
              {{ item.favorited ? '已收藏' : '收藏' }}
              {{ item.favoriteCount }}
            </button>
          </div>
          <p class="detail-note">
            <Icon name="shield" :size="15" />
            请先沟通成色与交接方式，再提交申请。
          </p>
        </div>
      </section>
      <Comments :key="item.itemId" :endpoint="`/items/${item.itemId}/comments`" />
    </template>
    <Modal v-if="modal" title="购买这件好物" :busy="busy" @close="modal = false">
      <form class="form-stack" @submit.prevent="submit">
        <div class="order-summary">
          <strong>{{ item.title }}</strong>
          <span>
            预计金额
            <b>¥{{ money(amount) }}</b>
          </span>
        </div>
        <label>
          联系电话
          <input v-model="form.phone" type="tel" autocomplete="tel" maxlength="30" required />
        </label>
        <label>
          收货 / 交接地址
          <input v-model="form.address" autocomplete="street-address" maxlength="255" required />
        </label>
        <label>
          备注
          <textarea v-model="form.note" rows="3" maxlength="500" placeholder="还有什么想告诉物主的？"></textarea>
        </label>
        <p class="notice">提交后进入订单页选择模拟支付方式。此系统不会发生真实扣款。</p>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <button class="btn primary" :disabled="busy">{{ busy ? '提交中…' : '创建订单并继续' }}</button>
      </form>
    </Modal>
  </div>
</template>
