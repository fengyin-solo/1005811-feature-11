<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">城市排水防涝泵站运行与内涝处置管理平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向排水泵站台账、泵组运行、排水管网与检查井养护、水位雨量监测、内涝点处置、闸门调度与抢险队出动的一体化城市排水防涝运行管理工作台。</span>
        <span class="head-user">当前值班：{{ store.operator }} · {{ store.shiftLabel }}</span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const navItems = [{ label: "运营概览", path: "/" }, { label: "泵站台账", path: "/pumpstation" }, { label: "泵组运行", path: "/pumprun" }, { label: "排水管网", path: "/drainpipe" }, { label: "检查井维护", path: "/manhole" }, { label: "管网清淤", path: "/dredge" }, { label: "水位监测", path: "/waterlevel" }, { label: "雨量监测", path: "/rainfall" }, { label: "内涝点处置", path: "/waterlog" }, { label: "闸门调度", path: "/floodgate" }, { label: "泵组检修", path: "/pumpmaint" }, { label: "拍门检修", path: "/sluice" }, { label: "格栅清污", path: "/screen" }, { label: "排口巡查", path: "/outfallpatrol" }, { label: "防涝预警发布", path: "/floodwarn" }, { label: "抢险队调度", path: "/rescueteam" }, { label: "排水设备台账", path: "/drainequipment" }, { label: "管道内窥检测", path: "/cctvinspect" }, { label: "排水调度方案", path: "/dispatchplan" }]
</script>
