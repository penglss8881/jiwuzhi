<script setup>
import { ref, watch } from 'vue'
import Icon from './Icon.vue'
const props = defineProps({ src: String, title: String, category: { type: String, default: '图书' } })
const broken = ref(false)
watch(() => props.src, () => { broken.value = false })
const names = { 图书: 'book', 文具: 'pen', 数码: 'monitor', 生活用品: 'coffee', 体育: 'sport', 其他: 'box' }
</script>
<template>
  <div class="cover" :class="`cover-${category}`">
    <img v-if="src && !broken" :src="src" :alt="title || '封面'" loading="lazy" decoding="async" @error="broken = true" />
    <div v-else class="cover-placeholder">
      <Icon :name="names[category] || 'book'" :size="46" />
      <span>{{ title || '让闲置，再次闪光' }}</span>
      <small>JIWUZHI · SHARE & TRADE</small>
    </div>
  </div>
</template>
