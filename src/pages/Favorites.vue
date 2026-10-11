<script setup>
import { computed, ref, watch } from 'vue'
import { useResource } from '../composables.js'
import ItemCard from '../components/ItemCard.vue'
import StatePanel from '../components/StatePanel.vue'
import Pagination from '../components/Pagination.vue'
const { data, loading, error, load } = useResource('/favorites')
const page = ref(1), visible = computed(() => data.value.slice((page.value - 1) * 12, page.value * 12))
watch(() => data.value.length, length => { page.value = Math.min(page.value, Math.max(1, Math.ceil(length / 12))) })
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <div class="eyebrow">SAVED FOR ANOTHER DAY</div>
        <h1>
          我的收藏
          <span class="heading-dot">.</span>
        </h1>
        <p>把心动好好收藏，{{ data.length }} 件好物在这里等你。</p>
      </div>
      <RouterLink to="/plaza" class="btn">继续逛交易市集</RouterLink>
    </div>
    <StatePanel :loading="loading" :error="error" :empty="!data.length" title="收藏你的第一份心动" description="点击好物卡片上的爱心，就能在这里找到它。" @retry="load(true)">
      <RouterLink to="/plaza" class="btn primary">去逛交易市集</RouterLink>
    </StatePanel>
    <div v-if="!loading && !error" class="item-grid">
      <ItemCard v-for="item in visible" :key="item.itemId" :item="item" @unfavorite="id => data = data.filter(i => i.itemId !== id)" />
    </div>
    <Pagination v-model:page="page" :total="data.length" />
  </div>
</template>
