import { createApp } from 'vue'
import App from './App.vue'
import router from './router.js'
import { notify } from './store.js'
import './styles.css'
const app = createApp(App)
app.config.errorHandler = error => { console.error(error); notify('页面出现异常，请刷新后重试', 'error') }
app.use(router).mount('#root')
