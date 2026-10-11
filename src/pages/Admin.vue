<script setup>
import { ref, computed, watch } from 'vue'
import { useResource, useAction } from '../composables.js'
import { send } from '../api.js'
import { user } from '../store.js'
import { dateText } from '../utils.js'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import StatePanel from '../components/StatePanel.vue'
import Pagination from '../components/Pagination.vue'
const tab = ref('users'), keyword = ref(''), page = ref(1), modal = ref(null), password = ref('')
const { data, loading, error, load } = useResource(() => ({ users: '/users', disputes: '/refunds/disputes', logs: '/api/v1/logs' }[tab.value]))
const { busy, error: formError, run } = useAction()
const form = ref({ accountNo: '', name: '', password: '', role: 'user' })
const filtered = computed(() => data.value.filter(row => !keyword.value || JSON.stringify(row).toLowerCase().includes(keyword.value.toLowerCase())))
const visible = computed(() => filtered.value.slice((page.value - 1) * 12, page.value * 12))
watch([tab, keyword], () => { page.value = 1 })
async function update(u, body, text) { if (window.confirm(text) && await run(() => send(`/users/${u.userId}`, body, 'PUT'))) load(true) }
async function remove(u) { if (window.confirm(`永久删除账号「${u.accountNo}」？此操作不可恢复。`) && await run(() => send(`/users/${u.userId}`, undefined, 'DELETE'), '账号已删除')) load(true) }
async function save() {
  const task = modal.value === 'new' ? () => send('/users', form.value) : () => send(`/users/${modal.value.userId}`, { password: password.value }, 'PUT')
  if (await run(task)) { modal.value = null; password.value = ''; load(true) }
}
async function judge(row, verdict) { if (window.confirm(`确认${verdict === 'approve' ? '通过' : '驳回'}退款申请？判决将通知双方。`) && await run(() => send(`/rent-requests/${row.requestId}/refund/${verdict}`), '判决已提交')) load(true) }
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <div class="eyebrow">JIWUZHI ADMINISTRATION</div>
        <h1>
          管理工作台
          <span class="heading-dot">.</span>
        </h1>
        <p>用心维护每一份信任，让社区有序生长。</p>
      </div>
      <div class="row-actions">
        <RouterLink to="/books" class="btn">管理图书</RouterLink>
        <button class="btn primary" @click="modal = 'new'; form = { accountNo: '', name: '', password: '', role: 'user' }; formError = ''">
          <Icon name="plus" :size="17" />
          创建账号
        </button>
      </div>
    </div>
    <section class="admin-banner">
      <Icon name="shield" :size="32" />
      <div>
        <strong>社区的秩序，来自每一次认真维护</strong>
        <p>管理用户账号、处理退款纠纷、查看操作记录。</p>
      </div>
      <span class="pill">管理员</span>
    </section>
    <div class="feed-toolbar">
      <div class="tabs">
        <button v-for="(label, key) in { users: '用户管理', disputes: '退款纠纷', logs: '操作日志' }" :key="key" :class="{ active: tab === key }" @click="tab = key; keyword = ''">{{ label }}</button>
      </div>
      <div class="compact-search">
        <Icon name="search" :size="17" />
        <input v-model="keyword" placeholder="搜索当前列表" aria-label="搜索管理记录" />
      </div>
    </div>
    <StatePanel :loading="loading" :error="error" :empty="!filtered.length" title="暂无相关记录" @retry="load(true)" />
    <div v-if="!loading && !error && visible.length" class="table-wrap panel">
      <table v-if="tab === 'users'">
        <thead>
          <tr>
            <th>用户</th>
            <th>账号</th>
            <th>角色</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in visible" :key="u.userId">
            <td>
              <strong>{{ u.name }}</strong>
              <small v-if="Number(u.userId) === Number(user.userId)">（我）</small>
            </td>
            <td>{{ u.accountNo }}</td>
            <td>{{ u.role === 'user' ? '普通用户' : '管理员' }}</td>
            <td>
              <span class="status-tag" :class="{ off: u.status !== 'active' }">{{ u.status === 'active' ? '正常' : '已停用' }}</span>
            </td>
            <td>
              <div v-if="Number(u.userId) !== Number(user.userId)" class="table-actions">
                <button class="text-btn" :disabled="busy" @click="update(u, { status: u.status === 'active' ? 'inactive' : 'active' }, '确定修改账号启用状态？')">{{ u.status === 'active' ? '停用' : '启用' }}</button>
                <button class="text-btn" :disabled="busy" @click="update(u, { role: u.role === 'user' ? 'reader_admin' : 'user' }, '确定调整此账号的管理员权限？')">切换角色</button>
                <button class="text-btn" :disabled="busy" @click="modal = u; password = ''; formError = ''">重置密码</button>
                <button class="text-btn danger" :disabled="busy" @click="remove(u)">删除</button>
              </div>
              <span v-else class="muted">当前登录账号</span>
            </td>
          </tr>
        </tbody>
      </table>
      <table v-else-if="tab === 'logs'">
        <thead>
          <tr>
            <th>时间</th>
            <th>操作人</th>
            <th>操作</th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in visible" :key="log.id">
            <td class="nowrap">{{ dateText(log.createdAt) }}</td>
            <td>{{ log.operator }}</td>
            <td>{{ log.action }}</td>
            <td>{{ log.detail }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else>
        <article v-for="d in visible" :key="d.requestId" class="dispute-row">
          <div class="section-head">
            <h3>{{ d.itemTitle }}</h3>
            <span class="status-tag">{{ { applied: '待判决', approved: '已通过', rejected: '已驳回' }[d.refundStatus] }}</span>
          </div>
          <p class="prose">{{ d.refundReason }}</p>
          <p class="muted prose">{{ d.refundEvidenceText }}</p>
          <a v-if="d.refundImage" :href="d.refundImage" target="_blank" rel="noopener" class="text-btn">查看证明附件</a>
          <div class="action-bar">
            <RouterLink :to="`/orders/${d.requestId}`" class="btn small">订单详情</RouterLink>
            <template v-if="d.refundStatus === 'applied'">
              <button class="btn primary small" :disabled="busy" @click="judge(d, 'approve')">通过退款</button>
              <button class="btn small" :disabled="busy" @click="judge(d, 'reject')">驳回申请</button>
            </template>
          </div>
        </article>
      </div>
    </div>
    <Pagination v-model:page="page" :total="filtered.length" />
    <Modal v-if="modal" :title="modal === 'new' ? '创建用户账号' : `重置 ${modal.name} 的密码`" :busy="busy" @close="modal = null">
      <form class="form-stack" @submit.prevent="save">
        <template v-if="modal === 'new'">
          <label>
            账号
            <input v-model="form.accountNo" maxlength="30" required />
          </label>
          <label>
            姓名
            <input v-model="form.name" maxlength="30" required />
          </label>
          <label>
            初始密码
            <input v-model="form.password" type="password" autocomplete="new-password" minlength="4" required />
          </label>
          <label>
            用户角色
            <select v-model="form.role">
              <option value="user">普通用户</option>
              <option value="reader_admin">管理员</option>
            </select>
          </label>
        </template>
        <label v-else>
          新密码
          <input v-model="password" type="password" autocomplete="new-password" minlength="4" required />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <button class="btn primary" :disabled="busy">{{ busy ? '保存中…' : '确认保存' }}</button>
      </form>
    </Modal>
  </div>
</template>
