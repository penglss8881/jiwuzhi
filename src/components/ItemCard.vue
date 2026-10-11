<script setup>
import { computed, ref, watch } from 'vue'
import { send } from '../api.js'
import { useAction } from '../composables.js'
import { money, messageTime } from '../utils.js'
import Icon from './Icon.vue'
import Cover from './Cover.vue'
const props = defineProps({ item: Object, badge: { type: String, default: '' } })
const emit = defineEmits(['unfavorite'])
const fav = ref(Boolean(props.item.favorited)), count = ref(props.item.favoriteCount || 0)
watch(() => props.item, item => { fav.value = Boolean(item.favorited); count.value = item.favoriteCount || 0 })
const { busy, run } = useAction()
const href = computed(() => `/items/${props.item.itemId}`)
const publishedAt = computed(() => props.item.createdAt ? `${messageTime(props.item.createdAt)}发布` : '发布时间待确认')
const ownerName = computed(() => props.item.ownerName || '用户')
async function toggle() { await run(async () => { const result = await send(`${href.value}/favorite`); fav.value = result.favorited; count.value = result.favoriteCount; if (!result.favorited) emit('unfavorite', props.item.itemId) }, '') }
</script>
<template>
  <article class="item-card objective-item-card">
    <RouterLink :to="href" class="item-media">
      <Cover :src="item.coverImageUrl" :title="item.title" :category="item.category" />
      <span class="category-tag">{{ item.category }}</span>
      <span v-if="badge" class="item-badge">{{ badge }}</span>
    </RouterLink>
    <button class="favorite-btn" :class="{ favorited: fav }" :aria-label="fav ? `取消收藏 ${item.title}` : `收藏 ${item.title}`" :aria-pressed="fav" :disabled="busy" @click="toggle">
      <Icon name="heart" :size="18" />
    </button>
    <div class="item-body">
      <RouterLink :to="href" class="item-summary-link">
        <h3>{{ item.title }}</h3>
        <p class="objective-item-description">{{ item.description || '卖家暂未补充物品描述，交易前请先询问具体情况。' }}</p>
        <div class="objective-item-facts">
          <span><Icon name="check" :size="13" />整件出售</span>
          <span>{{ publishedAt }}</span>
        </div>
      </RouterLink>
      <div class="item-price objective-item-price">
        <span>整件售价</span>
        <strong>
          <small>¥</small>
          {{ item.buyoutEnabled ? money(item.price) : '待确认售价' }}
        </strong>
      </div>
      <div class="item-owner">
        <RouterLink :to="`/users/${item.ownerId}`" class="owner-profile-link">
          <span class="avatar tiny"><img v-if="item.ownerAvatar" :src="item.ownerAvatar" alt="" /><template v-else>{{ ownerName.slice(0, 1) }}</template></span>
          <span><strong>{{ ownerName }}</strong><small>卖家发布</small></span>
        </RouterLink>
        <span class="push-right objective-owner-note"><Icon name="shield" :size="14" />交易前核验</span>
      </div>
      <div class="item-actions objective-item-actions">
        <span class="objective-engagement">
          <Icon name="chat" :size="15" />
          {{ item.commentCount || 0 }} 条留言
          <Icon name="heart" :size="14" />
          {{ count }} 人收藏
        </span>
        <RouterLink :to="`/chat?uid=${item.ownerId}&itemId=${item.itemId}`" class="push-right objective-contact-link">联系卖家</RouterLink>
        <RouterLink :to="href" class="objective-detail-link">
          查看详情
          <Icon name="arrow" :size="14" />
        </RouterLink>
      </div>
    </div>
  </article>
</template>
