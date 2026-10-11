<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useResource, useAction } from '../composables.js'
import { send, upload } from '../api.js'
import { categories, money, itemStatus } from '../utils.js'
import Icon from '../components/Icon.vue'
import Cover from '../components/Cover.vue'
import Modal from '../components/Modal.vue'
import StatePanel from '../components/StatePanel.vue'
import Pagination from '../components/Pagination.vue'
import { recognizeImageText } from '../recognize-image.js'
const route = useRoute(), router = useRouter()
const { data: items, loading, error, load } = useResource('/items/mine')
const { busy, error: formError, run } = useAction()
const empty = () => ({ title: '', category: '图书', price: '', description: '', coverImageUrl: '' })
const modal = ref(null), form = ref(empty()), filter = ref(''), page = ref(1)
const ocrFile = ref(null), ocrBusy = ref(false), ocrProgress = ref(0)
const filtered = computed(() => items.value.filter(i => !filter.value || i.status === filter.value))
const visible = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10))
watch(filter, () => { page.value = 1 })
watch(() => route.query.new, value => { if (value === '1') { edit(); router.replace('/warehouse') } }, { immediate: true })
function edit(item) { form.value = item ? { ...empty(), ...item } : empty(); modal.value = item?.itemId || 'new'; formError.value = ''; ocrFile.value = null; ocrProgress.value = 0 }
async function pick(e) {
  if (e.target.files[0]) {
    ocrFile.value = e.target.files[0]
    await run(async () => { form.value.coverImageUrl = (await upload(ocrFile.value)).url }, '')
  }
  e.target.value = ''
}
async function recognizePhoto() {
  if (!ocrFile.value) return
  ocrBusy.value = true; ocrProgress.value = 0; formError.value = ''
  try {
    const text = await recognizeImageText(ocrFile.value, value => { ocrProgress.value = value })
    if (!text) { formError.value = '图片里没有识别到清晰文字，请手动补充物品信息。'; return }
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    if (!form.value.title.trim()) form.value.title = (lines[0] || text).slice(0, 60)
    if (!form.value.description.trim()) form.value.description = text.slice(0, 1500)
    const categoryHints = [
      ['图书', /书|ISBN|出版社|作者|文学|教材/], ['数码', /手机|电脑|耳机|相机|数码|型号|GB|USB/i],
      ['文具', /文具|笔|本子|钢笔|尺/], ['体育', /运动|球|健身|瑜伽|羽毛球/],
      ['生活用品', /水杯|收纳|家居|生活|锅|灯具/],
    ]
    const match = categoryHints.find(([, pattern]) => pattern.test(text))
    if (match) form.value.category = match[0]
  } catch (error) { formError.value = `图片文字识别失败：${error.message}` }
  finally { ocrBusy.value = false }
}
async function save() {
  const data = { ...form.value, price: Number(form.value.price), priceUnit: '元/件', buyoutEnabled: true, buyoutPrice: Number(form.value.price) }
  if (await run(() => send(modal.value === 'new' ? '/items' : `/items/${modal.value}`, data, modal.value === 'new' ? 'POST' : 'PUT'), '物品已保存')) { modal.value = null; load(true) }
}
async function status(item, value) { if (await run(() => send(`/items/${item.itemId}/status`, { status: value }, 'PUT'))) load(true) }
async function remove(item) { if (window.confirm(`确定删除「${item.title}」吗？此操作不可恢复。`) && await run(() => send(`/items/${item.itemId}`, undefined, 'DELETE'), '物品已删除')) load(true) }
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <div class="eyebrow">YOUR LITTLE WAREHOUSE</div>
        <h1>
          我的发布
          <span class="heading-dot">.</span>
        </h1>
        <p>每一件闲置，都值得一个新的开始。</p>
      </div>
      <button class="btn primary" @click="edit()">
        <Icon name="plus" :size="18" />
        发布闲置
      </button>
    </div>
    <div class="stat-grid">
      <div class="stat-card">
        <span>全部物品</span>
        <strong>
          {{ items.length }}
          <small>件</small>
        </strong>
        <Icon name="box" />
      </div>
      <div v-for="s in ['on_sale', 'rented', 'off']" :key="s" class="stat-card">
        <span>{{ itemStatus(s) }}</span>
        <strong>
          {{ items.filter(i => i.status === s).length }}
          <small>件</small>
        </strong>
        <Icon :name="s === 'on_sale' ? 'leaf' : s === 'rented' ? 'orders' : 'book'" />
      </div>
    </div>
    <div class="tabs standalone">
      <button :class="{ active: !filter }" @click="filter = ''">全部物品</button>
      <button v-for="s in ['on_sale', 'rented', 'off']" :key="s" :class="{ active: filter === s }" @click="filter = s">{{ itemStatus(s) }}</button>
    </div>
    <StatePanel :loading="loading" :error="error" :empty="!filtered.length" title="给好物一个新去处" description="书籍、数码、生活用品都能交易，让好东西继续发挥价值。" @retry="load(true)">
      <button class="btn primary" @click="edit()">发布闲置</button>
    </StatePanel>
    <div v-if="!loading && !error" class="list-panel">
      <article v-for="item in visible" :key="item.itemId" class="inventory-row">
        <RouterLink :to="`/items/${item.itemId}`" class="row-cover">
          <Cover :src="item.coverImageUrl" :title="item.title" :category="item.category" />
        </RouterLink>
        <div class="row-main">
          <RouterLink :to="`/items/${item.itemId}`">
            <h3>{{ item.title }}</h3>
          </RouterLink>
          <div class="row-meta">
            <span class="status-tag" :class="item.status">{{ itemStatus(item.status) }}</span>
            <span>{{ item.category }}</span>
            <span>{{ item.views || 0 }} 次浏览</span>
          </div>
          <strong class="price-text">
            ¥
            {{ item.buyoutEnabled ? money(item.price) : '待确认售价' }}
            <small>{{ item.priceUnit }}</small>
          </strong>
        </div>
        <div class="row-actions">
          <button class="btn small" :disabled="busy" @click="edit(item)">编辑</button>
          <button v-if="item.status === 'on_sale'" class="btn small" :disabled="busy" @click="status(item, 'off')">下架</button>
          <button v-if="item.status === 'on_sale'" class="btn small" :disabled="busy" @click="status(item, 'rented')">标记已售出</button>
          <button v-else class="btn small" :disabled="busy" @click="status(item, 'on_sale')">重新上架</button>
          <RouterLink v-if="item.status === 'rented'" to="/rentals" class="btn small">处理订单</RouterLink>
          <button class="icon-btn danger" :disabled="busy" :aria-label="`删除 ${item.title}`" @click="remove(item)">
            <Icon name="trash" :size="17" />
          </button>
        </div>
      </article>
    </div>
    <Pagination v-model:page="page" :total="filtered.length" :size="10" />
    <Modal v-if="modal" :title="modal === 'new' ? '发布一件好物' : '编辑物品'" :busy="busy || ocrBusy" @close="modal = null">
      <form class="form-stack" @submit.prevent="save">
        <label>
          物品名称
          <input v-model="form.title" required maxlength="60" placeholder="为你的好物起一个清晰的名字" />
        </label>
        <div class="form-grid">
          <label>
            分类
            <select v-model="form.category">
              <option v-for="c in categories" :key="c">{{ c }}</option>
            </select>
          </label>
          <label>
          商品售价（元）
            <input v-model="form.price" type="number" min="0.01" max="999999" step="0.01" required />
          </label>
        </div>
        <p class="form-hint">填写整件商品的售价，买家按此价格购买。旧商品请先确认售价再保存。</p>
        <label class="upload-control">
          <Icon name="upload" :size="18" />
          {{ busy ? '上传中…' : '拍照 / 上传商品照片' }}
          <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" capture="environment" :disabled="busy || ocrBusy" @change="pick" />
        </label>
        <div v-if="form.coverImageUrl" class="cover-preview">
          <img :src="form.coverImageUrl" alt="封面预览" />
          <button type="button" class="text-btn" @click="form.coverImageUrl = ''">移除封面</button>
        </div>
        <div v-if="ocrFile" class="ocr-tools">
          <button type="button" class="text-btn" :disabled="ocrBusy || busy" @click="recognizePhoto"><Icon name="spark" :size="16" />{{ ocrBusy ? `正在识字 ${ocrProgress}%` : '识别照片文字，辅助填写商品信息' }}</button>
          <small>可读取书封、包装和标签；商品类别按文字关键词给出建议。</small>
        </div>
        <label>
          物品描述
          <textarea v-model="form.description" rows="4" maxlength="5000" placeholder="介绍成色、使用情况和交接方式…"></textarea>
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <button class="btn primary" :disabled="busy || !form.title.trim()">{{ busy ? '保存中…' : '保存并完成' }}</button>
      </form>
    </Modal>
  </div>
</template>
