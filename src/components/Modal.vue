<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import Icon from './Icon.vue'
defineProps({ title: String, busy: Boolean })
const emit = defineEmits(['close'])
const dialog = ref(null)
let previous, overflow
onMounted(() => { previous = document.activeElement; overflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; dialog.value.showModal() })
onUnmounted(() => { document.body.style.overflow = overflow; previous?.focus() })
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" class="modal" @cancel.prevent="!busy && emit('close')" @click="e => e.target === dialog && !busy && emit('close')">
      <div class="modal-inner">
        <header class="section-head">
          <h2>{{ title }}</h2>
          <button class="icon-btn" aria-label="关闭弹窗" :disabled="busy" @click="emit('close')">
            <Icon name="close" />
          </button>
        </header>
        <slot />
      </div>
    </dialog>
  </Teleport>
</template>
