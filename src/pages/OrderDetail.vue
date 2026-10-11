<script setup>
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useResource, useAction } from '../composables.js'
import { send, upload } from '../api.js'
import { goBack, money, dateText, orderStage, orderAmount } from '../utils.js'
import Cover from '../components/Cover.vue'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import StatePanel from '../components/StatePanel.vue'
const route = useRoute(), router = useRouter()
const { data: order, loading, error, load } = useResource(() => `/rent-requests/${route.params.requestId}`, null, 0)
const { busy, error: actionError, run } = useAction()
const payOpen = ref(false), refundOpen = ref(false), payMethod = ref('wechat'), refund = ref({ reason: '', image: '', evidenceText: '' })
const buyer = computed(() => order.value?.role === 'buyer'), seller = computed(() => order.value?.role === 'seller')
const closed = computed(() => ['declined', 'canceled'].includes(order.value?.status) || !!order.value?.refundedAt || order.value?.refundStatus === 'approved')
const canRefund = computed(() => buyer.value && order.value?.requestType === 'buyout' && order.value?.paidAt && !closed.value && order.value?.refundStatus !== 'applied')
const other = computed(() => buyer.value ? order.value?.owner : order.value?.requester)
const back = () => goBack(router, '/rentals')
const timeline = computed(() => {
  if (!order.value) return []
  const o = order.value, steps = [['创建申请', o.createdAt], ['模拟支付', o.paidAt], [o.status === 'declined' ? '卖家婉拒' : o.status === 'canceled' ? '订单取消' : '卖家确认', o.handledAt], ['物品发出', o.shippedAt], ['确认签收', o.receivedAt]]
  if (o.refundedAt) steps.push(['模拟退款完成', o.refundedAt])
  return steps
})
async function action(suffix, body, method = 'POST', confirmText = '') {
  if (confirmText && !window.confirm(confirmText)) return
  if (await run(() => send(`/rent-requests/${order.value.requestId}${suffix}`, body, method))) { payOpen.value = false; refundOpen.value = false; await load(true); window.dispatchEvent(new Event('rentals-updated')) }
}
async function pick(e) { if (e.target.files[0]) await run(async () => { refund.value.image = (await upload(e.target.files[0], true)).url }, '') }
async function submitRefund() { if (!refund.value.image && !refund.value.evidenceText.trim()) { actionError.value = '请填写证明文字或上传证明文件'; return } await action('/refund', refund.value) }
</script>
<template>
  <div class="detail-width">
    <button type="button" class="back-link" @click="back">
      <Icon name="back" :size="17" />
      返回上一页
    </button>
    <StatePanel :loading="loading" :error="error" @retry="load(true)" />
    <template v-if="order && !loading && !error">
      <div class="page-heading">
        <div>
          <div class="eyebrow">ORDER #{{ order.requestId }}</div>
          <h1>{{ orderStage(order) }}</h1>
          <p>{{ order.requestType === 'buyout' ? '商品订单' : '历史订单（只读）' }} · {{ dateText(order.createdAt) }}</p>
        </div>
        <span class="pill">
          <Icon name="shield" :size="16" />
          模拟交易
        </span>
      </div>
      <section class="panel">
        <div class="inventory-row">
          <RouterLink :to="`/items/${order.itemId}`" class="row-cover">
            <Cover :src="order.coverImageUrl" :title="order.itemTitle" />
          </RouterLink>
          <div class="row-main">
            <h2>{{ order.itemTitle }}</h2>
            <p class="muted">{{ order.requestType === 'buyout' ? '好物交易，一口价购买' : '旧业务已停止，遗留事项请联系管理员处理。' }}</p>
            <RouterLink :to="`/chat?uid=${other?.userId}&itemId=${order.itemId}`" class="text-btn">联系{{ buyer ? '物主' : '申请人' }} · {{ other?.name }}</RouterLink>
          </div>
          <strong class="detail-price">
            <small>¥</small>
            {{ money(orderAmount(order)) }}
          </strong>
        </div>
        <div class="order-info">
          <div>
            <small>联系电话</small>
            <strong>{{ order.phone }}</strong>
          </div>
          <div>
            <small>收货 / 交接地址</small>
            <strong>{{ order.address }}</strong>
          </div>
          <div>
            <small>订单备注</small>
            <strong>{{ order.note || '无' }}</strong>
          </div>
          <div>
            <small>支付状态</small>
            <strong>{{ order.paidAt ? `已通过${order.payMethod === 'alipay' ? '支付宝' : '微信'}模拟支付` : '尚未支付' }}</strong>
          </div>
        </div>
        <div v-if="!closed && order.requestType === 'buyout'" class="action-bar">
          <template v-if="buyer">
            <button v-if="order.status === 'pending' && !order.paidAt" class="btn primary" :disabled="busy" @click="payOpen = true; actionError = ''">模拟支付</button>
            <button v-if="order.status === 'pending'" class="btn" :disabled="busy" @click="action('', { status: 'canceled' }, 'PUT', '确定取消订单？已支付的费用将模拟退回。')">取消订单</button>
            <button v-if="order.status === 'agreed' && order.shippedAt && !order.receivedAt" class="btn primary" :disabled="busy" @click="action('/receive', undefined, 'POST', '请确认你已收到物品，是否继续？')">确认收货</button>
            <button v-if="canRefund" class="btn" :disabled="busy" @click="refundOpen = true; actionError = ''; refund = { reason: '', image: '', evidenceText: '' }">申请退款</button>
          </template>
          <template v-if="seller">
            <template v-if="order.status === 'pending' && order.paidAt">
              <button class="btn primary" :disabled="busy" @click="action('', { status: 'agreed' }, 'PUT', '确认接受申请并安排交接？')">接受申请</button>
              <button class="btn" :disabled="busy" @click="action('', { status: 'declined' }, 'PUT', '婉拒后将模拟退回已付费用，是否继续？')">婉拒申请</button>
            </template>
            <button v-if="order.status === 'agreed' && !order.shippedAt" class="btn primary" :disabled="busy" @click="action('/ship', undefined, 'POST', '确认物品已经发出？')">确认发货</button>
          </template>
        </div>
      </section>
      <section v-if="order.refundStatus" class="panel">
        <h2>售后退款</h2>
        <p>
          <span class="status-tag">{{ { applied: '处理中', approved: '已同意', rejected: '已拒绝' }[order.refundStatus] }}</span>
        </p>
        <p class="prose">退款原因：{{ order.refundReason }}</p>
        <p class="prose">证明说明：{{ order.refundEvidenceText || '无' }}</p>
        <a v-if="order.refundImage" :href="order.refundImage" target="_blank" rel="noopener" class="text-btn">
          查看证明附件
          <Icon name="arrow" :size="15" />
        </a>
        <div v-if="order.refundStatus === 'applied' && (seller || order.role === 'admin')" class="action-bar">
          <button class="btn primary" :disabled="busy" @click="action('/refund/approve', undefined, 'POST', '确定同意退款？费用将模拟退回。')">同意退款</button>
          <button class="btn" :disabled="busy" @click="action('/refund/reject', undefined, 'POST', '确定拒绝这次退款申请？')">拒绝退款</button>
        </div>
      </section>
      <section class="panel">
        <h2>订单进度</h2>
        <ol class="timeline">
          <li v-for="([title, time], i) in timeline" :key="title" :class="{ done: time }">
            <span class="timeline-dot">
              <Icon v-if="time" name="check" :size="13" />
              <template v-else>{{ i + 1 }}</template>
            </span>
            <div>
              <strong>{{ title }}</strong>
              <small>{{ time ? dateText(time) : closed ? '流程已关闭' : '尚未完成' }}</small>
            </div>
          </li>
        </ol>
      </section>
    </template>
    <Modal v-if="payOpen" title="模拟收银台" :busy="busy" @close="payOpen = false">
      <form class="form-stack" @submit.prevent="action('/pay', { payMethod })">
        <div class="payment-amount">
          <small>需支付金额</small>
          <strong>¥{{ money(orderAmount(order)) }}</strong>
        </div>
        <p class="notice">这是演示支付，不会调用真实支付渠道，也不会扣款。</p>
        <label class="payment-option">
          <input v-model="payMethod" type="radio" value="wechat" />
          微信支付（模拟）
        </label>
        <label class="payment-option">
          <input v-model="payMethod" type="radio" value="alipay" />
          支付宝（模拟）
        </label>
        <p v-if="actionError" class="error-text">{{ actionError }}</p>
        <button class="btn primary" :disabled="busy">{{ busy ? '处理中…' : '确认模拟支付' }}</button>
      </form>
    </Modal>
    <Modal v-if="refundOpen" title="申请售后退款" :busy="busy" @close="refundOpen = false">
      <form class="form-stack" @submit.prevent="submitRefund">
        <label>
          退款原因
          <textarea v-model="refund.reason" rows="3" maxlength="500" required></textarea>
        </label>
        <label>
          证明文字
          <textarea v-model="refund.evidenceText" rows="3" maxlength="1000" placeholder="描述问题，或上传证明文件"></textarea>
        </label>
        <label class="upload-control">
          <Icon name="upload" :size="18" />
          {{ refund.image ? '已上传，点击更换' : '上传证明文件（20MB 以内）' }}
          <input type="file" :disabled="busy" @change="pick" />
        </label>
        <p v-if="actionError" class="error-text">{{ actionError }}</p>
        <button class="btn primary" :disabled="busy">提交退款申请</button>
      </form>
    </Modal>
  </div>
</template>
