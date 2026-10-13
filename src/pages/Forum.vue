<script setup>
import { ref, computed, watch } from 'vue'
import { useResource, useAction } from '../composables.js'
import { send, upload } from '../api.js'
import { dateText } from '../utils.js'
import { user } from '../store.js'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import StatePanel from '../components/StatePanel.vue'
import UserAvatar from '../components/UserAvatar.vue'
import Pagination from '../components/Pagination.vue'
import { recognizeImageText } from '../recognize-image.js'
const keyword = ref(''), query = ref(''), sort = ref('latest'), page = ref(1), composing = ref(false), uploading = ref(false), ocrBusy = ref(false), ocrProgress = ref(0), ocrFile = ref(null)
const form = ref({ title: '', content: '', images: [] })
const url = computed(() => `/posts?${new URLSearchParams({ keyword: query.value, sort: sort.value })}`)
const { data: posts, loading, error, load } = useResource(url)
const { busy, error: formError, run } = useAction()
watch(url, () => { page.value = 1 })
const visiblePosts = computed(() => posts.value.slice((page.value - 1) * 8, page.value * 8))
const hot = computed(() => [...posts.value].sort((a, b) => b.views - a.views).slice(0, 4))
function compose() { form.value = { title: '', content: '', images: [] }; formError.value = ''; ocrFile.value = null; ocrProgress.value = 0; composing.value = true }
async function pick(e) {
  uploading.value = true
  await run(async () => { for (const file of Array.from(e.target.files).slice(0, 6 - form.value.images.length)) { ocrFile.value ||= file; const result = await upload(file); form.value.images.push(result.url) } }, '')
  uploading.value = false; e.target.value = ''
}
async function recognizePhoto() {
  if (!ocrFile.value) return
  ocrBusy.value = true; ocrProgress.value = 0; formError.value = ''
  try {
    const text = await recognizeImageText(ocrFile.value, value => { ocrProgress.value = value })
    if (!text) { formError.value = '图片里没有识别到清晰文字，可以直接写一句分享。'; return }
    form.value.content = [form.value.content.trim(), text].filter(Boolean).join('\n')
    if (!form.value.title.trim()) form.value.title = text.split(/\r?\n/).find(line => line.trim())?.slice(0, 40) || ''
  } catch (error) { formError.value = `图片文字识别失败：${error.message}` }
  finally { ocrBusy.value = false }
}
async function submit() {
  const content = form.value.content.trim()
  const title = form.value.title.trim() || content.split(/\r?\n/)[0].slice(0, 40) || '分享了一张照片'
  if (await run(() => send('/posts', { ...form.value, title, content }), '新帖子已发布')) { composing.value = false; page.value = 1; load(true) }
}
async function toggleLike(post) { await run(async () => Object.assign(post, await send(`/posts/${post.postId}/like`)), '') }
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <div class="eyebrow">JIWUZHI · MOMENTS & MARKET</div>
        <h1>
          生活广场
          <span class="heading-dot">.</span>
        </h1>
        <p>发照片、说近况，也让喜欢的东西遇见新主人。</p>
      </div>
      <button class="btn primary" @click="compose">
        <Icon name="plus" :size="18" />
        分享此刻
      </button>
    </div>
    <section class="hero-banner">
      <div class="hero-copy">
        <span class="pill">
          <Icon name="leaf" :size="14" />
          分享经验，连接同好
        </span>
        <h2>
          今天发生了什么？
          <br />
          分享生活，也交换好物。
        </h2>
        <p>认识同好、看看新鲜事，发现正在交易的好东西。</p>
        <RouterLink to="/plaza" class="btn hero-button">
          逛交易市集
          <Icon name="right" :size="17" />
        </RouterLink>
      </div>
      <div class="book-scene" aria-hidden="true">
        <div class="hero-orbit"></div>
        <div class="book-stand"></div>
        <div class="drawn-book book-one">
            <small>REAL EXPERIENCE</small>
          <b>
            真实体验
            <br />
            值得分享
          </b>
          <span>有观点，也有温度</span>
        </div>
        <div class="drawn-book book-two">
          <small>DISCOVER & CONNECT</small>
          <b>
            兴趣
            <br />
            与同好
          </b>
          <span>每一次表达，都可能遇见回应</span>
        </div>
        <div class="book-spark">✳</div>
        <span class="scene-label">A NEW CHAPTER STARTS HERE</span>
      </div>
    </section>
    <div class="community-layout">
      <section>
        <div class="feed-toolbar">
          <div class="tabs">
            <button :class="{ active: sort === 'latest' }" @click="sort = 'latest'">
              <Icon name="spark" :size="17" />
              朋友圈
            </button>
            <button :class="{ active: sort === 'hot' }" @click="sort = 'hot'">热门讨论</button>
          </div>
          <form class="compact-search" @submit.prevent="query = keyword.trim()">
            <Icon name="search" :size="17" />
            <input v-model="keyword" aria-label="搜索帖子" placeholder="搜索社区内容" />
            <button class="icon-btn" aria-label="开始搜索">
              <Icon name="right" :size="16" />
            </button>
          </form>
        </div>
        <button class="moment-launch" @click="compose">
          <UserAvatar :person="user" />
          <span class="moment-launch-copy">分享新鲜事、照片，或正在交易的好物…</span>
          <span class="moment-launch-photo"><Icon name="upload" :size="17" />照片</span>
        </button>
        <StatePanel :loading="loading" :error="error" :empty="!posts.length" title="朋友圈，从你的分享开始" description="发一张照片、说一句近况，或者分享一件正在交易的好物。" @retry="load(true)">
          <button class="btn primary" @click="compose">分享第一条动态</button>
        </StatePanel>
        <div v-if="!loading && !error" class="feed">
          <article v-for="post in visiblePosts" :key="post.postId" class="post-card">
            <div class="post-author">
              <UserAvatar :person="post.author" :user-id="post.authorId" />
              <div>
                <RouterLink :to="`/users/${post.authorId}`"><strong>{{ post.author?.name || '用户' }}</strong></RouterLink>
                <small>{{ dateText(post.createdAt) }} · 分享了新动态</small>
              </div>
              <span class="post-topic">新鲜事</span>
            </div>
            <div class="moment-content">
              <h2><RouterLink :to="`/posts/${post.postId}`" class="moment-title-link">{{ post.title }}</RouterLink></h2>
              <p class="post-excerpt">{{ post.content }}</p>
              <RouterLink :to="`/posts/${post.postId}`" class="moment-open" :aria-label="`打开动态：${post.title}`">
              <div v-if="post.images?.length" class="post-images moment-images">
                <img v-for="(src, i) in post.images.slice(0, 3)" :key="i" :src="src" alt="帖子配图" loading="lazy" decoding="async" />
              </div>
              </RouterLink>
              <div class="moment-actions">
                <button class="moment-action" :class="{ liked: post.liked }" :aria-pressed="!!post.liked" :disabled="busy" @click="toggleLike(post)">
                  <Icon name="heart" :size="17" /> {{ post.liked ? '已赞' : '赞' }} <span>{{ post.likeCount || 0 }}</span>
                </button>
                <RouterLink :to="`/posts/${post.postId}`" class="moment-action">
                  <Icon name="chat" :size="17" /> 留言 <span>{{ post.commentCount }}</span>
                </RouterLink>
                <RouterLink :to="`/posts/${post.postId}`" class="moment-action moment-more">查看动态 <Icon name="arrow" :size="15" /></RouterLink>
              </div>
              <div class="post-foot">
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
                <span class="read-more">
                  参与讨论
                  <Icon name="arrow" :size="16" />
                </span>
              </div>
            </div>
          </article>
        </div>
        <Pagination v-model:page="page" :total="posts.length" :size="8" />
      </section>
      <aside class="community-aside">
        <section class="panel welcome-card">
          <span class="greeting">HI, {{ user?.nickname || user?.name || '朋友' }}</span>
          <h3>分享一个瞬间</h3>
          <p>
            一次真实体验，一个实用观点，
            <br />
            都可能帮到正在寻找答案的人。
          </p>
          <button class="btn soft full-width" @click="compose">
            <Icon name="pen" :size="17" />
            发一条朋友圈
          </button>
        </section>
        <section class="panel">
          <div class="section-head">
            <h3>社区热议</h3>
            <Icon name="spark" :size="18" />
          </div>
          <p v-if="!hot.length" class="muted aside-note">新的讨论正在等你开启。</p>
          <RouterLink v-for="(post, i) in hot" :key="post.postId" :to="`/posts/${post.postId}`" class="hot-topic">
            <span>{{ String(i + 1).padStart(2, '0') }}</span>
            <div>
              <strong>{{ post.title }}</strong>
              <small>{{ post.views }} 次浏览 · {{ post.commentCount }} 条讨论</small>
            </div>
          </RouterLink>
        </section>
        <section class="community-guide">
          <span class="small-label">COMMUNITY NOTES</span>
          <h3>好的社区，由我们一起创造</h3>
          <p>
            <Icon name="check" :size="15" />
            真实描述，让每份信任有回应
          </p>
          <p>
            <Icon name="check" :size="15" />
            友善交流，尊重不同的声音
          </p>
          <p>
            <Icon name="check" :size="15" />
            真实交易，让好物安心流动
          </p>
        </section>
        <p class="aside-footer">一个观点 · 一次交流 · 一群有趣的同好</p>
      </aside>
    </div>
    <Modal v-if="composing" title="分享此刻" :busy="busy || uploading || ocrBusy" @close="composing = false">
      <form class="form-stack" @submit.prevent="submit">
        <div class="compose-self"><UserAvatar :person="user" /><strong>{{ user?.nickname || user?.name || '和朋友分享' }}</strong></div>
        <label class="moment-compose-label">
          <span class="sr-only">分享内容</span>
          <textarea v-model="form.content" rows="5" maxlength="5000" placeholder="此刻的心情、刚发现的好物，或者一张照片…" autofocus></textarea>
        </label>
        <label v-if="form.title" class="moment-title-label">动态标题（可选）<input v-model="form.title" maxlength="100" placeholder="不填会自动取正文开头" /></label>
        <div class="upload-previews">
          <div v-for="(src, i) in form.images" :key="src">
            <img :src="src" alt="配图预览" />
            <button type="button" class="icon-btn" aria-label="移除配图" @click="form.images.splice(i, 1)">
              <Icon name="close" :size="14" />
            </button>
          </div>
        </div>
        <label v-if="form.images.length < 6" class="upload-control">
          <Icon name="upload" :size="18" />
          {{ uploading ? '上传中…' : '拍照 / 添加照片' }}
          <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" multiple :disabled="busy || uploading" @change="pick" />
        </label>
        <div v-if="ocrFile" class="ocr-tools">
          <button type="button" class="text-btn" :disabled="ocrBusy || busy" @click="recognizePhoto"><Icon name="spark" :size="16" />{{ ocrBusy ? `正在识字 ${ocrProgress}%` : '识别照片中的文字并填入' }}</button>
          <small>适合书封、包装和标签上的文字。</small>
        </div>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <button class="btn primary moment-submit" :disabled="busy || uploading || ocrBusy || (!form.content.trim() && !form.images.length)">{{ busy ? '发布中…' : '发布动态' }}</button>
      </form>
    </Modal>
  </div>
</template>
