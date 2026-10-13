<script setup>
import { computed, ref, watch } from 'vue'
import { user } from '../store.js'
import { avatarUrl } from '../utils.js'

const props = defineProps({
  person: { type: Object, default: null },
  userId: { type: [Number, String], default: null },
  src: { type: String, default: undefined },
  name: { type: String, default: '' },
  alt: { type: String, default: '' },
})
const person = computed(() => {
  const id = props.userId ?? props.person?.userId
  return id != null && Number(id) === Number(user.value?.userId) ? user.value : props.person
})
const source = computed(() => avatarUrl(props.src ?? person.value?.avatarUrl))
const initial = computed(() => Array.from(props.name || person.value?.nickname || person.value?.name || '用户')[0])
const failed = ref(false)
watch(source, () => { failed.value = false })
</script>

<template>
  <span class="avatar">
    <img v-if="source && !failed" :key="source" :src="source" :alt="alt" @error="failed = true" />
    <span v-else aria-hidden="true">{{ initial }}</span>
  </span>
</template>
