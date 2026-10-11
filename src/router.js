import { createRouter, createWebHistory } from 'vue-router'
import { user, notify, setUser } from './store.js'
export const pages = {
  forum: () => import('./pages/Forum.vue'), plaza: () => import('./pages/Plaza.vue'),
  warehouse: () => import('./pages/Warehouse.vue'), rentals: () => import('./pages/Rentals.vue'),
  chat: () => import('./pages/Chat.vue'), profile: () => import('./pages/Profile.vue'),
  favorites: () => import('./pages/Favorites.vue'), books: () => import('./pages/Books.vue'), admin: () => import('./pages/Admin.vue'),
  recommend: () => import('./pages/Recommend.vue'),
}
const routes = [
  { path: '/login', component: () => import('./pages/Login.vue'), meta: { title: '登录', public: true } },
  ...[
    ['/', 'forum', '生活广场'], ['/recommend', 'recommend', '推荐好物'], ['/plaza', 'plaza', '发现好物'], ['/warehouse', 'warehouse', '我的发布'],
    ['/favorites', 'favorites', '我的收藏'], ['/rentals', 'rentals', '交易订单'], ['/chat', 'chat', '消息中心'],
    ['/profile', 'profile', '个人中心'], ['/books', 'books', '书籍专区'], ['/borrowed', 'books', '我的借阅'],
    ['/add', 'books', '添加图书'], ['/admin', 'admin', '管理后台'],
  ].map(([path, name, title]) => ({ path, name: path === '/' ? 'forum' : path.slice(1), component: pages[name], meta: { title, admin: ['/admin', '/add'].includes(path), cache: ['/', '/plaza', '/favorites'].includes(path) } })),
  { path: '/posts/:postId', component: () => import('./pages/PostDetail.vue'), meta: { title: '帖子详情' } },
  { path: '/users/:userId', component: () => import('./pages/UserHome.vue'), meta: { title: '用户主页' } },
  { path: '/items/:itemId', component: () => import('./pages/ItemDetail.vue'), meta: { title: '物品详情' } },
  { path: '/orders/:requestId', component: () => import('./pages/OrderDetail.vue'), meta: { title: '订单详情' } },
  { path: '/batch', component: () => import('./pages/Batch.vue'), meta: { title: '批量导入导出', admin: true } },
  { path: '/:pathMatch(.*)*', component: () => import('./pages/NotFound.vue'), meta: { title: '页面不存在', public: true } },
]
const scrollPositions = new Map()
const router = createRouter({ history: createWebHistory(), routes, scrollBehavior: (to, _from, saved) => new Promise(resolve => setTimeout(() => resolve(saved || (to.meta.cache && scrollPositions.get(to.fullPath)) || { top: 0 }), 150)) })
router.beforeEach(to => {
  const from = router.currentRoute.value
  if (from.meta.cache) scrollPositions.set(from.fullPath, { top: window.scrollY })
  if (!to.meta.public && !user.value?.token) return { path: '/login', query: { redirect: to.fullPath } }
  if (['/books', '/borrowed'].includes(to.path) && !user.value?.isAdmin) return { path: '/plaza', query: { category: '图书' } }
  if (to.meta.admin && !user.value?.isAdmin) { notify('此页面需要管理员权限', 'error'); return '/' }
  if (to.path === '/login' && user.value?.token) return '/'
})
router.afterEach(to => { document.title = `${to.meta.title || '首页'} · 集物志` })
router.onError(() => notify('页面加载失败，请刷新重试', 'error'))
window.addEventListener('auth-expired', () => {
  const redirect = router.currentRoute.value.fullPath
  setUser(null); notify('登录已过期，请重新登录', 'error')
  router.replace({ path: '/login', query: { redirect } })
})
export default router
