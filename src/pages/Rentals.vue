<script setup>
import { ref, computed, onMounted } from 'vue'
import { useResource, useAction } from '../composables.js'
import { send } from '../api.js'
import { money, dateText, orderStage, orderAmount } from '../utils.js'
import Cover from '../components/Cover.vue'
import StatePanel from '../components/StatePanel.vue'
import Pagination from '../components/Pagination.vue'
const tab = ref('incoming'), page = ref(1)
const incoming = useResource('/rent-requests/incoming'), outgoing = useResource('/rent-requests/outgoing')
const { busy, run } = useAction()
const current = computed(() => tab.value === 'incoming' ? incoming : outgoing)
const list = computed(() => current.value.data.value)
const visible = computed(() => list.value.slice((page.value - 1) * 10, page.value * 10))
async function markSeen() { try { await send('/rent-requests/mark-seen'); window.dispatchEvent(new Event('rentals-updated')) } catch { /* Non-blocking read receipt. */ } }
onMounted(markSeen)
const canDelete = r => r.requestType === 'buyout' && (['declined', 'canceled'].includes(r.status) || r.refundStatus === 'approved' || !!r.receivedAt)
async function remove(r) { if (window.confirm('从你的列表移除这条已结束的交易记录？对方的记录不受影响。') && await run(() => send(`/rent-requests/${r.requestId}`, undefined, 'DELETE'), '记录已移除')) current.value.load(true) }
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <div class="eyebrow">EVERY EXCHANGE MATTERS</div>
        <h1>
          交易订单
          <span class="heading-dot">.</span>
        </h1>
        <p>从下单到收货，让每一次交易都有迹可循。</p>
      </div>
      <RouterLink to="/plaza" class="btn">发现更多好物</RouterLink>
    </div>
    <div class="tabs standalone">
      <button :class="{ active: tab === 'incoming' }" @click="tab = 'incoming'; page = 1">
        我卖出的
        <span>{{ incoming.data.value.length }}</span>
      </button>
      <button :class="{ active: tab === 'outgoing' }" @click="tab = 'outgoing'; page = 1">
        我买到的
        <span>{{ outgoing.data.value.length }}</span>
      </button>
    </div>
    <StatePanel :loading="current.loading.value" :error="current.error.value" :empty="!list.length" title="还没有交易订单" description="去逛交易市集，或发布一件好物，让下一次交易从这里开始。" @retry="current.load(true)" />
    <div v-if="!current.loading.value && !current.error.value" class="order-list">
      <article v-for="r in visible" :key="r.requestId" class="panel order-card">
        <div class="order-card-head">
          <span>订单 #{{ r.requestId }} · {{ dateText(r.createdAt) }}</span>
          <span class="status-tag">{{ orderStage(r) }}</span>
        </div>
        <div class="inventory-row">
          <RouterLink :to="`/items/${r.itemId}`" class="row-cover">
            <Cover :src="r.coverImageUrl" :title="r.itemTitle" />
          </RouterLink>
          <div class="row-main">
            <h3>{{ r.itemTitle }}</h3>
            <p class="muted">{{ r.requestType === 'buyout' ? '商品订单' : '历史订单（只读）' }} · {{ tab === 'incoming' ? r.requesterName : r.ownerName }}</p>
            <strong class="price-text">
              ¥
              {{ money(orderAmount(r)) }}
              <small>{{ r.paidAt ? '已模拟支付' : '待模拟支付' }}</small>
            </strong>
          </div>
          <div class="row-actions">
            <RouterLink :to="`/orders/${r.requestId}`" class="btn primary small">查看 / 处理订单</RouterLink>
            <button v-if="canDelete(r)" class="btn small" :disabled="busy" @click="remove(r)">移除记录</button>
          </div>
        </div>
      </article>
    </div>
    <Pagination v-model:page="page" :total="list.length" :size="10" />
  </div>
</template>
