<script setup>
import { ref, computed } from 'vue'
import { useResource } from '../composables.js'
import ItemCard from '../components/ItemCard.vue'
import StatePanel from '../components/StatePanel.vue'
import Pagination from '../components/Pagination.vue'
const page = ref(1)
const { data: items, loading, error, load } = useResource('/items?sort=hot')
const start = computed(() => (page.value - 1) * 12)
const visible = computed(() => items.value.slice(start.value, start.value + 12))
// 推荐理由标签：优先匹配收藏热度，其次按综合热度排名，最后给新上架的好物
function badgeFor(item, rank) {
  if ((item.favoriteCount || 0) >= 3) return '收藏热门'
  if (rank === 0) return '今日最热'
  if (rank < 3) return '人气推荐'
  if (Date.now() - new Date(item.createdAt).getTime() < 7 * 864e5) return '新上架'
  return ''
}
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <div class="eyebrow">CURATED FOR YOU</div>
        <h1>
          推荐好物
          <span class="heading-dot">.</span>
        </h1>
        <p>按浏览量、收藏与留言互动综合热度排序，为你精选的在售好物。</p>
      </div>
      <RouterLink to="/plaza" class="btn">去逛全部市集</RouterLink>
    </div>
    <StatePanel :loading="loading" :error="error" :empty="!items.length" title="还没有可推荐的好物" description="等大家发布更多闲置后，这里会热闹起来。" @retry="load(true)" />
    <template v-if="!loading && !error && items.length">
      <div class="item-grid">
        <ItemCard v-for="(item, i) in visible" :key="item.itemId" :item="item" :badge="badgeFor(item, start + i)" />
      </div>
      <Pagination v-model:page="page" :total="items.length" />
    </template>
  </div>
</template>
