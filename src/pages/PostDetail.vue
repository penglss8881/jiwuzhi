<script setup>
import { useRoute, useRouter } from 'vue-router'
import { useResource, useAction } from '../composables.js'
import { send } from '../api.js'
import { user } from '../store.js'
import { dateText, goBack } from '../utils.js'
import Comments from '../components/Comments.vue'
import StatePanel from '../components/StatePanel.vue'
import Icon from '../components/Icon.vue'
const route = useRoute(), router = useRouter()
const { data: post, loading, error, load } = useResource(() => `/posts/${route.params.postId}`, null, 0)
const { busy, run } = useAction()
const back = () => goBack(router, '/')
async function remove() { if (window.confirm('确定删除这篇帖子吗？删除后无法恢复。') && await run(() => send(`/posts/${post.value.postId}`, undefined, 'DELETE'), '帖子已删除')) router.push('/') }
async function toggleLike() {
  if (!post.value) return
  await run(async () => Object.assign(post.value, await send(`/posts/${post.value.postId}/like`)), '')
}
</script>
<template>
  <div class="detail-width">
    <button type="button" class="back-link" @click="back">
      <Icon name="back" :size="17" />
      返回上一页
    </button>
    <StatePanel :loading="loading" :error="error" @retry="load(true)" />
    <template v-if="post && !loading && !error">
      <article class="panel post-detail">
        <div class="post-author">
          <span class="avatar">{{ (post.author?.name || '用户').slice(0, 1) }}</span>
          <div>
            <RouterLink :to="`/users/${post.authorId}`"><strong>{{ post.author?.name }}</strong></RouterLink>
            <small>{{ dateText(post.createdAt) }}</small>
          </div>
          <button v-if="user.isAdmin || Number(user.userId) === Number(post.authorId)" class="btn danger small push-right" :disabled="busy" @click="remove">删除帖子</button>
        </div>
        <h1>{{ post.title }}</h1>
        <p class="prose">{{ post.content }}</p>
        <div class="detail-images">
          <img v-for="(src, i) in post.images" :key="i" :src="src" alt="帖子配图" loading="lazy" decoding="async" />
        </div>
        <div class="post-foot">
          <button class="moment-action" :class="{ liked: post.liked }" :aria-pressed="!!post.liked" :disabled="busy" @click="toggleLike">
            <Icon name="heart" :size="17" /> {{ post.liked ? '已赞' : '赞' }} <span>{{ post.likeCount || 0 }}</span>
          </button>
          <span>
            <Icon name="eye" :size="16" />
            {{ post.views }}
            次浏览
          </span>
          <span>
            <Icon name="chat" :size="16" />
            {{ post.commentCount }}
            条讨论
          </span>
        </div>
      </article>
      <Comments :key="post.postId" :endpoint="`/posts/${post.postId}/comments`" />
    </template>
  </div>
</template>
