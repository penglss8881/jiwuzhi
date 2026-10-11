<script setup>
import Icon from './Icon.vue'
defineProps({ loading: Boolean, error: String, empty: Boolean, title: { type: String, default: '这里还没有内容' }, description: { type: String, default: '试试调整筛选条件，或发布你的第一条内容。' } })
defineEmits(['retry'])
</script>
<template>
  <div v-if="loading" class="skeleton-list" role="status" aria-label="正在加载">
    <div v-for="i in 3" :key="i" class="skeleton-card">
      <div class="skeleton line short"></div>
      <div class="skeleton line"></div>
      <div class="skeleton line medium"></div>
    </div>
  </div>
  <div v-else-if="error" class="empty-state" role="alert">
    <span class="empty-icon">
      <Icon name="refresh" :size="28" />
    </span>
    <h3>暂时无法加载</h3>
    <p>{{ error }}</p>
    <button class="btn" @click="$emit('retry')">重新加载</button>
  </div>
  <div v-else-if="empty" class="empty-state">
    <span class="empty-icon">
      <Icon name="book" :size="28" />
    </span>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <slot />
  </div>
</template>
