<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useResource, useAction } from '../composables.js'
import { apiFetch, send, upload } from '../api.js'
import { user } from '../store.js'
import { dateText } from '../utils.js'
import Icon from '../components/Icon.vue'
import Cover from '../components/Cover.vue'
import Modal from '../components/Modal.vue'
import StatePanel from '../components/StatePanel.vue'
import Pagination from '../components/Pagination.vue'
const route = useRoute(), router = useRouter()
const { data: books, loading, error, load } = useResource('/api/v1/books')
const { busy, error: formError, run } = useAction()
const records = ref([]), recordError = ref(''), recordsLoading = ref(false), keyword = ref(''), filter = ref(''), page = ref(1), modal = ref(null)
const empty = () => ({ title: '', author: '', isbn: '', owner: '', coverImageUrl: '' }), form = ref(empty())
const borrowed = computed(() => route.path === '/borrowed')
const filtered = computed(() => books.value.filter(b => (!filter.value || b.status === filter.value) && [b.title, b.author, b.isbn, b.bookCode].join(' ').toLowerCase().includes(keyword.value.trim().toLowerCase())))
const visible = computed(() => filtered.value.slice((page.value - 1) * 12, page.value * 12))
const ownRecords = computed(() => records.value.filter(r => user.value.isAdmin || Number(r.userId) === Number(user.value.userId)))
const statusText = s => ({ available: '可借阅', borrowed: '已借出', discarded: '已报废' }[s] || s)
watch([keyword, filter], () => { page.value = 1 })
watch(() => route.path, path => { modal.value = null; if (path === '/add') edit(); if (path === '/borrowed') loadRecords() }, { immediate: true })
async function loadRecords() { recordsLoading.value = true; recordError.value = ''; try { records.value = await apiFetch('/api/v1/borrow-records') } catch (e) { recordError.value = e.message } finally { recordsLoading.value = false } }
function edit(book) { form.value = book ? { ...empty(), ...book } : empty(); modal.value = book?.bookCode || 'new'; formError.value = '' }
async function save() { if (await run(() => send(modal.value === 'new' ? '/api/v1/books' : `/api/v1/books/${modal.value}`, form.value, modal.value === 'new' ? 'POST' : 'PUT'), '图书已保存')) { modal.value = null; load(true); if (route.path === '/add') router.replace('/books') } }
async function pick(e) { if (e.target.files[0]) await run(async () => { form.value.coverImageUrl = (await upload(e.target.files[0])).url }, '') }
async function act(book, action) {
  const text = { borrow: '借阅', return: '归还', discard: '报废', delete: '删除' }[action]
  if (!window.confirm(`确定${text}「${book.title || book.bookTitle}」吗？`)) return
  const endpoint = `/api/v1/books/${book.bookCode}${action === 'delete' ? '' : `/${action}`}`
  if (await run(() => send(endpoint, action === 'borrow' ? { borrowerName: user.value.name, userId: user.value.userId } : undefined, action === 'delete' ? 'DELETE' : 'POST'), `${text}成功`)) { load(true); if (borrowed.value) loadRecords() }
}
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <div class="eyebrow">ONE BOOK, MANY READERS</div>
        <h1>
          {{ borrowed ? '我的借阅' : '图书馆' }}
          <span class="heading-dot">.</span>
        </h1>
        <p>读过的好书，值得被更多人遇见。</p>
      </div>
      <div class="row-actions">
        <RouterLink :to="borrowed ? '/books' : '/borrowed'" class="btn">{{ borrowed ? '返回图书馆' : '借阅记录' }}</RouterLink>
        <template v-if="user.isAdmin">
          <RouterLink to="/batch" class="btn">导入 / 导出</RouterLink>
          <button class="btn primary" @click="edit()">
            <Icon name="plus" :size="17" />
            添加图书
          </button>
        </template>
      </div>
    </div>
    <template v-if="borrowed">
      <StatePanel :loading="recordsLoading" :error="recordError" :empty="!ownRecords.length" title="还没有借阅记录" description="去图书馆发现你的下一本好书。" @retry="loadRecords" />
      <section v-if="!recordsLoading && !recordError" class="list-panel">
        <article v-for="r in ownRecords" :key="r.recordId" class="inventory-row">
          <div class="row-main">
            <h3>{{ r.bookTitle || r.bookCode }}</h3>
            <p class="muted">{{ r.borrowerName }} · 借阅于 {{ dateText(r.borrowDate) }}</p>
            <span class="status-tag">{{ r.returnDate ? `已归还 · ${dateText(r.returnDate)}` : '借阅中' }}</span>
          </div>
          <button v-if="!r.returnDate && r.status === 'borrowing'" class="btn primary small" :disabled="busy" @click="act(r, 'return')">归还图书</button>
        </article>
      </section>
    </template>
    <template v-else>
      <div class="panel book-filters">
        <div class="compact-search">
          <Icon name="search" :size="18" />
          <input v-model="keyword" aria-label="搜索图书" placeholder="搜索书名、作者、ISBN 或书号" />
        </div>
        <select v-model="filter" aria-label="图书状态">
          <option value="">全部状态</option>
          <option value="available">可借阅</option>
          <option value="borrowed">已借出</option>
          <option value="discarded">已报废</option>
        </select>
      </div>
      <StatePanel :loading="loading" :error="error" :empty="!filtered.length" title="暂时没有符合条件的图书" @retry="load(true)" />
      <div v-if="!loading && !error" class="item-grid">
        <article v-for="book in visible" :key="book.bookCode" class="item-card book-card">
          <Cover :src="book.coverImageUrl" :title="book.title" />
          <div class="item-body">
            <span class="status-tag">{{ statusText(book.status) }}</span>
            <h3>{{ book.title }}</h3>
            <p class="muted">{{ book.author }}</p>
            <small class="muted">
              ISBN
              {{ book.isbn }}
              <br />
              书号
              {{ book.bookCode }}
            </small>
            <p v-if="book.borrowerName" class="muted">借阅人：{{ book.borrowerName }}</p>
            <div class="action-bar">
              <template v-if="user.isAdmin">
                <button class="btn small" :disabled="busy" @click="edit(book)">编辑</button>
                <button v-if="book.status !== 'borrowed' && book.status !== 'discarded'" class="btn small" :disabled="busy" @click="act(book, 'discard')">报废</button>
                <button class="icon-btn danger" :disabled="busy" aria-label="删除图书" @click="act(book, 'delete')">
                  <Icon name="trash" :size="16" />
                </button>
              </template>
            </div>
          </div>
        </article>
      </div>
      <Pagination v-model:page="page" :total="filtered.length" />
    </template>
    <Modal v-if="modal" :title="modal === 'new' ? '添加图书' : '编辑图书'" :busy="busy" @close="modal = null; route.path === '/add' && router.replace('/books')">
      <form class="form-stack" @submit.prevent="save">
        <label>
          书名
          <input v-model="form.title" required />
        </label>
        <div class="form-grid two">
          <label>
            作者
            <input v-model="form.author" required />
          </label>
          <label>
            ISBN
            <input v-model="form.isbn" required />
          </label>
        </div>
        <label>
          归属人
          <input v-model="form.owner" />
        </label>
        <label class="upload-control">
          <Icon name="upload" :size="17" />
          上传封面
          <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" :disabled="busy" @change="pick" />
        </label>
        <div v-if="form.coverImageUrl" class="cover-preview">
          <img :src="form.coverImageUrl" alt="封面预览" />
          <button type="button" class="text-btn" @click="form.coverImageUrl = ''">移除封面</button>
        </div>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <button class="btn primary" :disabled="busy">保存图书</button>
      </form>
    </Modal>
  </div>
</template>
