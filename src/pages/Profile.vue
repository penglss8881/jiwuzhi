<script setup>
import { ref, watch } from 'vue'
import { useResource, useAction } from '../composables.js'
import { send, upload } from '../api.js'
import { user, setUser } from '../store.js'
import { dateText } from '../utils.js'
import Icon from '../components/Icon.vue'
import Modal from '../components/Modal.vue'
import StatePanel from '../components/StatePanel.vue'
const { data: profile, loading, error, load } = useResource('/users/me', null, 0)
const { busy, error: formError, run } = useAction()
const form = ref({}), identity = ref(false), idForm = ref({ realName: '', idCard: '' })
watch(profile, value => { if (value) form.value = { nickname: value.nickname, signature: value.signature, avatarUrl: value.avatarUrl, phone: value.phone, address: value.address } })
async function save() { if (await run(() => send('/users/me/profile', form.value, 'PUT'), '个人资料已保存')) { setUser({ ...user.value, nickname: form.value.nickname, avatarUrl: form.value.avatarUrl }); load(true) } }
async function pick(e) {
  const input = e.target, file = input.files[0]
  input.value = ''
  if (!file) return
  const previous = form.value.avatarUrl
  const preview = URL.createObjectURL(file)
  form.value.avatarUrl = preview
  const saved = await run(async () => {
    const avatarUrl = (await upload(file)).url
    await send('/users/me/profile', { avatarUrl }, 'PUT')
    form.value.avatarUrl = avatarUrl
  }, '头像已更新')
  URL.revokeObjectURL(preview)
  if (saved) setUser({ ...user.value, avatarUrl: form.value.avatarUrl })
  else form.value.avatarUrl = previous
}
async function removeAvatar() {
  if (await run(() => send('/users/me/profile', { avatarUrl: '' }, 'PUT'), '头像已移除')) {
    form.value.avatarUrl = ''
    setUser({ ...user.value, avatarUrl: '' })
  }
}
async function saveIdentity() { if (await run(() => send('/users/me/profile', idForm.value, 'PUT'), '实名信息已保存')) { identity.value = false; idForm.value = { realName: '', idCard: '' }; load(true) } }
async function unbind() { if (window.confirm('确认解除实名绑定？') && await run(() => send('/users/me/profile', { realName: '', idCard: '' }, 'PUT'), '已解除实名绑定')) load(true) }
</script>
<template>
  <div>
    <div class="page-heading">
      <div>
        <div class="eyebrow">A LITTLE MORE ABOUT YOU</div>
        <h1>
          个人中心
          <span class="heading-dot">.</span>
        </h1>
        <p>完善资料，让每一次交流更有温度。</p>
      </div>
    </div>
    <StatePanel :loading="loading" :error="error" @retry="load(true)" />
    <div v-if="profile && !loading && !error" class="profile-layout">
      <aside class="panel profile-card">
        <div class="profile-avatar">
          <img v-if="form.avatarUrl" :src="form.avatarUrl" alt="头像" />
          <span v-else>{{ (form.nickname || profile.name || '书').slice(0, 1) }}</span>
        </div>
        <h2>{{ form.nickname || profile.name }}</h2>
        <p class="muted">@{{ profile.accountNo }}</p>
        <span class="status-tag">{{ profile.isAdmin ? '平台管理员' : '集物志社区成员' }}</span>
        <p class="profile-signature">{{ form.signature || '让好物和好故事，在这里相遇。' }}</p>
        <div class="profile-links">
          <RouterLink :to="`/users/${profile.userId}`"><Icon name="user" :size="18" />查看我的主页<Icon name="next" :size="16" /></RouterLink>
          <RouterLink to="/warehouse">
            <Icon name="box" :size="18" />
            我的发布
            <Icon name="next" :size="16" />
          </RouterLink>
          <RouterLink to="/rentals">
            <Icon name="orders" :size="18" />
            我的订单
            <Icon name="next" :size="16" />
          </RouterLink>
          <RouterLink to="/favorites">
            <Icon name="heart" :size="18" />
            我的收藏
            <Icon name="next" :size="16" />
          </RouterLink>
        </div>
        <small class="muted">加入于 {{ dateText(profile.createdAt).slice(0, 10) }}</small>
      </aside>
      <div>
        <form class="panel form-stack" @submit.prevent="save">
          <h2>基本资料</h2>
          <label class="upload-control">
            <Icon name="upload" :size="18" />
            更换头像
            <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" :disabled="busy" @change.stop="pick" />
          </label>
          <button v-if="form.avatarUrl" type="button" class="text-btn" :disabled="busy" @click="removeAvatar">移除头像</button>
          <div class="form-grid two">
            <label>
              登录账号
              <input :value="profile.accountNo" disabled />
            </label>
            <label>
              注册名称
              <input :value="profile.name" disabled />
            </label>
          </div>
          <label>
            昵称
            <input v-model="form.nickname" maxlength="30" placeholder="你希望大家怎么称呼你" />
          </label>
          <label>
            个性签名
            <input v-model="form.signature" maxlength="200" placeholder="用一句话介绍自己" />
          </label>
          <div class="form-grid two">
            <label>
              联系电话
              <input v-model="form.phone" type="tel" autocomplete="tel" maxlength="30" />
            </label>
            <label>
              交接地址
              <input v-model="form.address" autocomplete="street-address" maxlength="255" />
            </label>
          </div>
          <p v-if="formError" class="error-text">{{ formError }}</p>
          <div>
            <button class="btn primary" :disabled="busy">{{ busy ? '保存中…' : '保存修改' }}</button>
          </div>
        </form>
        <section class="panel">
          <div class="section-head">
            <h2>实名信息</h2>
            <span class="status-tag">{{ profile.idCardBound ? '已绑定' : '未绑定' }}</span>
          </div>
          <p class="muted">{{ profile.idCardBound ? `${profile.realName} · ${profile.idCard}` : '实名信息为选填，可在需要时绑定。' }}</p>
          <div class="action-bar">
            <button class="btn" :disabled="busy" @click="identity = true; idForm = { realName: profile.realName || '', idCard: '' }; formError = ''">{{ profile.idCardBound ? '修改绑定' : '绑定实名信息' }}</button>
            <button v-if="profile.idCardBound" class="btn danger" :disabled="busy" @click="unbind">解除绑定</button>
          </div>
        </section>
      </div>
    </div>
    <Modal v-if="identity" title="绑定实名信息" :busy="busy" @close="identity = false">
      <form class="form-stack" @submit.prevent="saveIdentity">
        <label>
          真实姓名
          <input v-model="idForm.realName" maxlength="30" required />
        </label>
        <label>
          身份证号码
          <input v-model="idForm.idCard" maxlength="18" pattern="(\d{15}|\d{17}[\dXx])" required />
        </label>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <button class="btn primary" :disabled="busy">保存实名信息</button>
      </form>
    </Modal>
  </div>
</template>
