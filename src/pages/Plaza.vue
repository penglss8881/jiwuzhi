<script setup>
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useResource } from '../composables.js'
import { categories } from '../utils.js'
import Icon from '../components/Icon.vue'
import ItemCard from '../components/ItemCard.vue'
import StatePanel from '../components/StatePanel.vue'
import Pagination from '../components/Pagination.vue'
import UserAvatar from '../components/UserAvatar.vue'
const route = useRoute(), router = useRouter()
const routeQuery = ref({ ...route.query })
watch(() => route.query, value => { if (route.path === '/plaza') routeQuery.value = { ...value } })
const keyword = ref(String(route.query.keyword || '')), page = ref(1)
const allowedSorts = new Set(['latest', 'price_asc', 'price_desc'])
const category = computed(() => categories.includes(String(routeQuery.value.category || '')) ? String(routeQuery.value.category) : '')
const sort = computed(() => allowedSorts.has(String(routeQuery.value.sort || '')) ? String(routeQuery.value.sort) : 'latest')
const scope = computed(() => routeQuery.value.scope === 'users' ? 'users' : 'items')
const queryText = computed(() => String(routeQuery.value.keyword || '').trim())
const url = computed(() => scope.value === 'items' ? `/items?${new URLSearchParams({ keyword: queryText.value, category: category.value, sort: sort.value })}` : null)
const { data: items, loading, error, load } = useResource(url)
const { data: people, loading: peopleLoading, error: peopleError, load: loadPeople } = useResource(() => queryText.value ? `/users/search?q=${encodeURIComponent(queryText.value)}` : null)
watch(routeQuery, () => { keyword.value = String(routeQuery.value.keyword || ''); page.value = 1 })
const visible = computed(() => items.value.slice((page.value - 1) * 12, page.value * 12))
function filter(key, value) { const query = { ...route.query }; if (value) query[key] = value; else delete query[key]; router.replace({ path: '/plaza', query }) }
const icons = ['book', 'pen', 'monitor', 'coffee', 'sport', 'box']
</script>
<template>
  <div class="focus-market-page">
    <div class="page-heading focus-market-heading">
      <div>
        <div class="eyebrow">02 / CAMPUS EXCHANGE</div>
        <h1>
          发现好物
          <span class="heading-dot">.</span>
        </h1>
        <p>发现所需，也让闲置找到下一位主人。</p>
      </div>
      <RouterLink to="/warehouse?new=1" class="btn primary">
        <Icon name="plus" :size="18" />
        发布闲置
      </RouterLink>
    </div>
    <section class="exchange-banner" aria-label="校园好物交换站">
      <div class="exchange-copy">
        <span class="exchange-kicker"><span aria-hidden="true"></span> GOOD THINGS, SECOND STORIES</span>
        <h2>物尽其用，<br class="exchange-mobile-break" />故事继续<span>。</span></h2>
        <p>从一本旧书，到一件心头好。<br />在校园里，让闲置与需要再次相遇。</p>
        <div class="exchange-meta"><span>发现好物</span><i aria-hidden="true">/</i><span>连接同好</span><i aria-hidden="true">/</i><span>循环新生</span></div>
      </div>
      <div class="exchange-art" aria-hidden="true">
        <span class="exchange-art-label">JIWUZHI COLLECTION</span>
        <svg viewBox="0 0 320 220" fill="none">
          <path d="M17 28H68M17 28V66M303 153V191H253" stroke="currentColor" stroke-width="1" opacity=".5" />
          <path d="M55 155 158 209 271 146 170 95Z" fill="#1f2727" opacity=".12" />
          <path d="m72 97 91 45 91-47v69l-91 47-91-45Z" fill="#202727" />
          <path d="m163 142 91-47v69l-91 47Z" fill="#35403a" />
          <path d="m72 97 91-47 91 45-91 47Z" fill="#596047" />
          <path d="m93 101 58-29 32 16-58 31Z" fill="#e7e2bd" />
          <path d="m100 96 13-58 47 16-12 58Z" fill="#1e2828" stroke="#f0e7ba" stroke-width="2" />
          <path d="m113 38 5-5 48 16-6 5Z" fill="#f0e7ba" />
          <path d="m119 52 28 9M115 64l27 9" stroke="#efd35c" stroke-width="2" />
          <path d="m153 104 12-63 42 21-8 67Z" fill="#d7d4b7" stroke="#202727" stroke-width="2" />
          <path d="m165 41 7-4 42 21-7 4Z" fill="#f4edd3" />
          <path d="m181 66-7 35 15 7 5-35Z" fill="#515d4d" />
          <path d="m163 142-25-24-89-44 23 23ZM163 142l22-23 92-46-23 22Z" fill="#eee5b5" stroke="#202727" stroke-width="1.5" />
          <path d="m97 138 25 13M97 146l16 9" stroke="#efd35c" stroke-width="2" />
          <path d="m210 144 22-11v20l-22 11Z" stroke="#c8cbb0" />
          <path d="M236 25v24M224 37h24" stroke="#202727" stroke-width="2" />
          <circle cx="64" cy="48" r="3" fill="#202727" />
          <path d="M273 37h20M273 44h13M27 169h25" stroke="#202727" opacity=".45" />
        </svg>
        <span class="exchange-art-foot">RE:CIRCULATE <b>↗</b></span>
      </div>
    </section>
    <section class="market-toolbar panel focus-market-toolbar">
      <div class="focus-search-row">
        <form class="market-search" @submit.prevent="filter('keyword', keyword.trim())">
          <Icon name="search" />
          <input v-model="keyword" aria-label="搜索商品或用户" placeholder="搜索书名、物品，或输入账号 / 昵称找人" maxlength="100" />
          <button class="btn primary">搜索</button>
        </form>
        <div class="tabs search-scope" role="tablist" aria-label="搜索类型">
          <button role="tab" :aria-selected="scope === 'items'" :class="{ active: scope === 'items' }" @click="filter('scope', '')">商品</button>
          <button role="tab" :aria-selected="scope === 'users'" :class="{ active: scope === 'users' }" @click="filter('scope', 'users')">用户<span v-if="queryText && !peopleLoading && !peopleError">（{{ people.length }}）</span></button>
        </div>
      </div>
      <div v-if="scope === 'items'" class="filter-row focus-filter-row">
        <div class="category-tabs">
          <button :class="{ active: !category }" @click="filter('category', '')">
            <Icon name="grid" :size="16" />
            全部好物
          </button>
          <button v-for="(c, i) in categories" :key="c" :class="{ active: category === c }" @click="filter('category', c)">
            <Icon :name="icons[i]" :size="16" />
            {{ c }}
          </button>
        </div>
        <label class="focus-sort">
          <span class="sr-only">物品排序</span>
          <Icon name="filter" :size="15" />
          <select :value="sort" aria-label="物品排序" @change="filter('sort', $event.target.value)">
            <option value="latest">最新发布</option>
            <option value="price_asc">价格从低到高</option>
            <option value="price_desc">价格从高到低</option>
          </select>
        </label>
      </div>
    </section>
    <section v-if="scope === 'users'" class="people-results">
      <p class="muted">支持按账号、昵称、名称模糊搜索（输入一部分即可匹配）。点击用户进入主页，查看好物和动态。</p>
      <StatePanel :loading="peopleLoading" :error="peopleError" :empty="!people.length" :title="queryText ? '没有找到相关用户' : '想找谁？在上方输入账号或昵称'" description="试试更短的关键词，或用账号、昵称的一部分来搜索。" @retry="loadPeople(true)" />
      <RouterLink v-for="person in (!peopleLoading && !peopleError ? people : [])" :key="person.userId" :to="`/users/${person.userId}`" class="panel person-result">
        <UserAvatar :person="person" />
        <div><h2>{{ person.name }}</h2><small v-if="person.accountNo">账号 {{ person.accountNo }}</small><p>{{ person.signature || '来我的主页，看看好物与生活。' }}</p></div>
        <span class="text-btn push-right">查看主页 <Icon name="arrow" :size="18" /></span>
      </RouterLink>
    </section>
    <template v-else>
    <div v-if="!loading && !error" class="results-toolbar focus-results-toolbar">
      <span><strong>{{ items.length }}</strong> 件在售</span>
      <span class="focus-trust-note">
        <Icon name="shield" :size="16" />
        信息由卖家填写，交易前请查看详情并核验实物
      </span>
    </div>
    <StatePanel :loading="loading" :error="error" :empty="!items.length" title="还没遇见合适的好物" description="换个关键词或分类再找找，也可以发布自己的闲置。" @retry="load(true)" />
    <div v-if="!loading && !error" class="item-grid">
      <ItemCard v-for="item in visible" :key="item.itemId" :item="item" />
    </div>
    <Pagination v-model:page="page" :total="items.length" />
    </template>
  </div>
</template>
