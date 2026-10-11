<script setup>
import { computed } from 'vue'
import Icon from './Icon.vue'
const props = defineProps({ total: Number, page: Number, size: { type: Number, default: 12 } })
defineEmits(['update:page'])
const count = computed(() => Math.max(1, Math.ceil(props.total / props.size)))
</script>
<template>
  <div v-if="total > size" class="pagination">
    <span>共 {{ total }} 条</span>
    <button class="icon-btn" :disabled="page <= 1" aria-label="上一页" @click="$emit('update:page', page - 1)">
      <Icon name="prev" />
    </button>
    <span>{{ page }} / {{ count }}</span>
    <button class="icon-btn" :disabled="page >= count" aria-label="下一页" @click="$emit('update:page', page + 1)">
      <Icon name="next" />
    </button>
  </div>
</template>
