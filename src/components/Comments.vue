<script setup>
import { computed, nextTick, ref } from 'vue'
import { useResource, useAction } from '../composables.js'
import { send } from '../api.js'
import { dateText } from '../utils.js'
import StatePanel from './StatePanel.vue'
const props = defineProps({ endpoint: String })
const { data, loading, error, load } = useResource(() => props.endpoint)
const { busy, run } = useAction()
const reply = ref(''), target = ref(null), editor = ref(null)
const threads = computed(() => {
  const roots = [], byId = new Map()
  for (const comment of data.value) byId.set(Number(comment.commentId), { ...comment, replies: [] })
  for (const comment of byId.values()) {
    const parent = byId.get(Number(comment.parentCommentId))
    if (parent) parent.replies.push(comment)
    else roots.push(comment)
  }
  return roots
})
async function startReply(comment) {
  target.value = comment
  await nextTick()
  editor.value?.focus()
}
function cancelReply() { target.value = null }
async function submit() {
  const body = { content: reply.value.trim(), ...(target.value ? { parentCommentId: target.value.commentId } : {}) }
  if (await run(() => send(props.endpoint, body), target.value ? '回复已发布' : '留言已发布')) {
    reply.value = ''
    target.value = null
    await load(true)
  }
}
</script>
<template>
  <section class="panel">
    <h2>
      交流与留言
      <small>{{ data.length }}</small>
    </h2>
    <form class="reply-form" @submit.prevent="submit">
      <div v-if="target" class="reply-target">
        <span>回复 {{ target.author?.name || '用户' }}</span>
        <button type="button" class="text-btn" @click="cancelReply">取消</button>
      </div>
      <label class="sr-only" for="reply">发表留言</label>
      <textarea id="reply" ref="editor" v-model="reply" rows="3" maxlength="500" :placeholder="target ? `回复 ${target.author?.name || '用户'}…` : '友善交流，让每一次相遇更有温度…'" required></textarea>
      <button class="btn primary" :disabled="busy || !reply.trim()">{{ busy ? '发布中…' : target ? '发布回复' : '发表留言' }}</button>
    </form>
    <StatePanel :loading="loading" :error="error" :empty="!data.length" title="成为第一个留言的人" description="关于这件物品，有什么想问卖家或提醒大家的？" @retry="load(true)" />
    <div v-for="comment in threads" :key="comment.commentId" class="comment-thread">
      <article class="comment">
        <div class="avatar"><img v-if="comment.author?.avatarUrl" :src="comment.author.avatarUrl" alt="" /><template v-else>{{ (comment.author?.name || '用户').slice(0, 1) }}</template></div>
        <div>
          <RouterLink class="comment-author" :to="`/users/${comment.author?.userId}`">{{ comment.author?.name || '用户' }}</RouterLink>
          <small>{{ dateText(comment.createdAt) }}</small>
          <p>{{ comment.content }}</p>
          <button type="button" class="text-btn comment-reply" @click="startReply(comment)">回复</button>
        </div>
      </article>
      <div v-if="comment.replies.length" class="comment-replies">
        <article v-for="child in comment.replies" :key="child.commentId" class="comment">
          <div class="avatar tiny"><img v-if="child.author?.avatarUrl" :src="child.author.avatarUrl" alt="" /><template v-else>{{ (child.author?.name || '用户').slice(0, 1) }}</template></div>
          <div>
            <RouterLink class="comment-author" :to="`/users/${child.author?.userId}`">{{ child.author?.name || '用户' }}</RouterLink>
            <RouterLink v-if="child.replyTo" class="reply-to" :to="`/users/${child.replyTo.userId}`">回复 @{{ child.replyTo.name }}</RouterLink>
            <small>{{ dateText(child.createdAt) }}</small>
            <p>{{ child.content }}</p>
            <button type="button" class="text-btn comment-reply" @click="startReply(child)">回复</button>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
