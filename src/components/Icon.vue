<script setup>
import { BookOpen, LayoutGrid, MessageCircle, Heart, Package, ClipboardList, UserRound, ShieldCheck, Search, Plus, ArrowUpRight, ArrowRight, ArrowLeft, ChevronRight, ChevronLeft, X, Menu, LogOut, Bell, Leaf, Upload, Eye, Check, RefreshCw, Send, Paperclip, Trash2, Pencil, Settings, Sparkles, Download, SlidersHorizontal, Monitor, PenLine, Coffee, Dumbbell, MoreHorizontal, LockKeyhole, UserPlus, UserMinus, UserCheck } from 'lucide-vue-next'
defineProps({ name: String, size: { type: [Number, String], default: 20 } })
const icons = { book: BookOpen, grid: LayoutGrid, chat: MessageCircle, heart: Heart, box: Package, orders: ClipboardList, user: UserRound, shield: ShieldCheck, search: Search, plus: Plus, arrow: ArrowUpRight, right: ArrowRight, back: ArrowLeft, next: ChevronRight, prev: ChevronLeft, close: X, menu: Menu, logout: LogOut, bell: Bell, leaf: Leaf, upload: Upload, eye: Eye, check: Check, refresh: RefreshCw, send: Send, clip: Paperclip, trash: Trash2, edit: Pencil, settings: Settings, spark: Sparkles, download: Download, filter: SlidersHorizontal, monitor: Monitor, pen: PenLine, coffee: Coffee, sport: Dumbbell, more: MoreHorizontal, lock: LockKeyhole, userPlus: UserPlus, userMinus: UserMinus, userCheck: UserCheck }
</script>
<template>
  <component :is="icons[name] || BookOpen" :size="size" :stroke-width="1.7" aria-hidden="true" />
</template>
