<script setup>
import { ref, reactive } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { send } from '../api.js'
import { setUser } from '../store.js'
import { useAction } from '../composables.js'
import Icon from '../components/Icon.vue'
const router = useRouter(), route = useRoute(), mode = ref('login'), question = ref(''), reset = ref(false)
const { busy, error, run } = useAction()
const form = reactive({ accountNo: '', password: '', name: '', confirm: '', securityQuestion: '', securityAnswer: '', realName: '', idCard: '', bind: false })
function switchMode(value) { mode.value = value; error.value = ''; reset.value = false; form.password = ''; form.confirm = ''; form.securityAnswer = '' }
async function submit() {
  if (mode.value === 'login') {
    await run(async () => {
      const data = await send('/users/login', { accountNo: form.accountNo.trim(), password: form.password })
      setUser(data)
      const redirect = String(route.query.redirect || '/')
      await router.replace(redirect.startsWith('/') && !redirect.startsWith('//') && !redirect.startsWith('/login') ? redirect : '/')
    }, '欢迎回到集物志')
  } else if (mode.value === 'register') {
    if (form.password !== form.confirm) { error.value = '两次输入的密码不一致'; return }
    if (await run(() => send('/users/register', { accountNo: form.accountNo.trim(), name: form.name.trim(), password: form.password, securityQuestion: form.securityQuestion, securityAnswer: form.securityAnswer, realName: form.bind ? form.realName : undefined, idCard: form.bind ? form.idCard : undefined }), '注册成功，请登录')) switchMode('login')
  } else if (!reset.value) {
    await run(async () => { const data = await send('/users/forgot-question', { accountNo: form.accountNo.trim() }); question.value = data.securityQuestion; reset.value = true }, '')
  } else {
    if (form.password !== form.confirm) { error.value = '两次输入的密码不一致'; return }
    if (await run(() => send('/users/forgot-reset', { accountNo: form.accountNo.trim(), securityAnswer: form.securityAnswer, newPassword: form.password }), '密码已重置，请重新登录')) switchMode('login')
  }
}
</script>
<template>
  <div class="login-page">
    <section class="login-story">
      <RouterLink to="/login" class="brand">
        <span class="brand-mark">
          <Icon name="spark" :size="26" />
        </span>
        <span>
          集物志
          <small>JIWUZHI · SHARE & TRADE</small>
        </span>
      </RouterLink>
      <div class="login-story-copy">
        <span class="eyebrow">好物有去处，观点有回响</span>
        <h1>
          分享真实生活，
          <br />
          也让闲置继续流转。
        </h1>
        <p>
          发布经验与观点，认识兴趣相投的人；也让闲置好物再次被需要。
          <br />
          在集物志，每一种认真生活都有回应。
        </p>
        <div class="book-scene login-books" aria-hidden="true">
          <div class="book-stand"></div>
          <div class="drawn-book book-one">
            <small>REAL EXPERIENCE</small>
            <b>
              认真生活
              <br />
              真诚分享
            </b>
            <span>有用，也有趣</span>
          </div>
          <div class="drawn-book book-two">
            <small>DISCOVER & CONNECT</small>
            <b>
              观点
              <br />
              与同好
            </b>
            <span>每一次表达，都可能遇见回应</span>
          </div>
          <div class="book-spark">✳</div>
        </div>
      </div>
      <p class="login-story-footer">
        <Icon name="leaf" :size="17" />
        让分享创造价值，让闲置找到归宿。
      </p>
    </section>
    <main id="main" class="login-form-side">
      <div class="login-form-wrap">
        <span class="eyebrow">WELCOME TO JIWUZHI</span>
        <h2>{{ mode === 'login' ? '很高兴，再次见到你' : mode === 'register' ? '加入集物志社区' : '找回登录密码' }}</h2>
        <p class="muted">{{ mode === 'login' ? '登录账号，继续探索你的下一份心动。' : mode === 'register' ? '加入社区，让分享成为日常。' : '通过注册时设置的密保问题验证身份。' }}</p>
        <form class="form-stack" @submit.prevent="submit">
          <label v-if="mode === 'register'">
            你的名字
            <input v-model="form.name" autocomplete="name" maxlength="30" placeholder="大家该怎么称呼你" required />
          </label>
          <label>
            登录账号
            <input v-model="form.accountNo" autocomplete="username" placeholder="请输入账号" maxlength="30" :disabled="mode === 'forgot' && reset" required />
          </label>
          <template v-if="mode !== 'forgot' || reset">
            <label v-if="mode === 'forgot'">
              {{ question }}
              <input v-model="form.securityAnswer" placeholder="请输入密保答案" required />
            </label>
            <label>
              {{ mode === 'forgot' ? '新密码' : '密码' }}
              <input v-model="form.password" type="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" minlength="4" placeholder="请输入密码，至少 4 位" required />
            </label>
            <label v-if="mode !== 'login'">
              确认密码
              <input v-model="form.confirm" type="password" autocomplete="new-password" minlength="4" placeholder="再次输入密码" required />
            </label>
          </template>
          <template v-if="mode === 'register'">
            <label>
              密保问题
              <select v-model="form.securityQuestion" required>
                <option disabled value="">请选择密保问题</option>
                <option>您的出生城市是？</option>
                <option>您最喜欢的书籍是？</option>
                <option>您小学的名称是？</option>
              </select>
            </label>
            <label>
              密保答案
              <input v-model="form.securityAnswer" required />
            </label>
            <label class="check-label">
              <input v-model="form.bind" type="checkbox" />
              绑定实名信息（选填）
            </label>
            <template v-if="form.bind">
              <label>
                真实姓名
                <input v-model="form.realName" required />
              </label>
              <label>
                身份证号
                <input v-model="form.idCard" maxlength="18" pattern="(\d{15}|\d{17}[\dXx])" required />
              </label>
            </template>
          </template>
          <div v-if="mode === 'login'" class="login-options">
            <span>
              <Icon name="shield" :size="15" />
              账号安全登录
            </span>
            <button class="text-btn" type="button" @click="switchMode('forgot')">忘记密码？</button>
          </div>
          <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
          <button class="btn primary login-submit" :disabled="busy">
            {{ busy ? '请稍候…' : mode === 'login' ? '登 录' : mode === 'register' ? '创建账号' : reset ? '重置密码' : '验证账号' }}
            <Icon name="right" :size="18" />
          </button>
        </form>
        <p class="login-switch">
          {{ mode === 'login' ? '还没有集物志账号？' : '已有账号？' }}
          <button class="text-btn" @click="switchMode(mode === 'login' ? 'register' : 'login')">{{ mode === 'login' ? '立即注册' : '返回登录' }}</button>
        </p>
        <p class="login-tip">普通用户与管理员使用同一入口，登录后自动匹配权限。</p>
      </div>
      <footer>集物志 · 闲置交易与兴趣社区</footer>
    </main>
  </div>
</template>
