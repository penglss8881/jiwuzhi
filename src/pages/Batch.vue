<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { send, getToken } from '../api.js'
import { useAction } from '../composables.js'
import { goBack } from '../utils.js'
import Icon from '../components/Icon.vue'
const router = useRouter()
const { busy, error, run } = useAction()
const result = ref(null)
const fields = ref(['bookCode', 'isbn', 'title', 'author', 'status'])
const options = { bookCode: '书号', isbn: 'ISBN', title: '书名', author: '作者', owner: '归属人', status: '状态', borrowerName: '借阅人', borrowDate: '借阅日期' }
const back = () => goBack(router, '/books')
function download(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
function template() { download(new Blob(['\uFEFFISBN,书名,作者,归属人\r\n9780000000000,示例书名,示例作者,\r\n'], { type: 'text/csv;charset=utf-8' }), '图书导入模板.csv') }
async function pick(e) {
  const file = e.target.files[0]; if (!file) return
  result.value = null
  await run(async () => {
    if (file.size > 5 * 1024 * 1024) throw new Error('导入文件不能超过 5MB')
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' })
    if (!rows.length) throw new Error('文件内容为空')
    if (rows.length > 1000) throw new Error('每次最多导入 1000 行，请拆分文件后重试')
    const keys = Object.keys(rows[0])
    if (![['ISBN', 'isbn', 'Isbn'], ['书名', 'title', 'Title'], ['作者', 'author', 'Author']].every(group => group.some(k => keys.includes(k)))) throw new Error('文件必须包含 ISBN、书名、作者三列表头')
    const books = rows.map(r => ({ isbn: String(r.ISBN || r.isbn || r.Isbn || ''), title: r.书名 || r.title || r.Title || '', author: r.作者 || r.author || r.Author || '', owner: r.归属人 || r.owner || r.Owner || null }))
    result.value = await send('/api/v1/books/batch', { books })
  }, '')
  e.target.value = ''
}
async function exportFile(format) { await run(async () => {
  const response = await fetch(`/api/v1/books/export${format === 'csv' ? '/csv' : ''}?fields=${encodeURIComponent(fields.value.join(','))}`, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || '导出失败')
  download(await response.blob(), `图书清单-${new Date().toISOString().slice(0, 10)}.${format}`)
}, '文件已导出') }
</script>
<template>
  <div class="detail-width">
    <button type="button" class="back-link" @click="back">
      <Icon name="back" :size="17" />
      返回上一页
    </button>
    <div class="page-heading">
      <div>
        <div class="eyebrow">LIBRARY DATA TOOLS</div>
        <h1>图书导入与导出</h1>
        <p>一次整理，让图书管理更轻松。</p>
      </div>
    </div>
    <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    <section class="panel">
      <div class="section-head">
        <h2>批量导入</h2>
        <button class="text-btn" @click="template">
          <Icon name="download" :size="17" />
          下载 CSV 模板
        </button>
      </div>
      <p class="muted">支持 Excel / CSV 文件，需包含 ISBN、书名、作者。每次最多 1000 行，书号自动生成。</p>
      <label class="upload-drop">
        <Icon name="upload" :size="30" />
        <strong>{{ busy ? '正在处理，请稍候…' : '选择需要导入的文件' }}</strong>
        <span>XLSX / XLS / CSV · 最大 5MB</span>
        <input type="file" accept=".xlsx,.xls,.csv" :disabled="busy" @change="pick" />
      </label>
      <div v-if="result" class="import-result">
        <p>
          成功导入
          <strong>{{ result.inserted }}</strong>
          条，失败
          <strong>{{ result.failed }}</strong>
          条
        </p>
        <div v-if="result.errors?.length" class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>行号</th>
                <th>ISBN</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(e, i) in result.errors" :key="i">
                <td>{{ e.row }}</td>
                <td>{{ e.isbn }}</td>
                <td>{{ e.reason }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
    <section class="panel">
      <h2>导出图书清单</h2>
      <p class="muted">选择需要的字段，下载为 Excel 或 CSV。</p>
      <div class="field-checks">
        <label v-for="(label, value) in options" :key="value" class="check-label">
          <input v-model="fields" type="checkbox" :value="value" />
          {{ label }}
        </label>
      </div>
      <div class="action-bar">
        <button class="btn primary" :disabled="busy || !fields.length" @click="exportFile('xlsx')">
          <Icon name="download" :size="17" />
          导出 Excel
        </button>
        <button class="btn" :disabled="busy || !fields.length" @click="exportFile('csv')">导出 CSV</button>
      </div>
    </section>
  </div>
</template>
