<template>
  <section class="page" data-module="waterlevel">
    <header class="page-head">
      <div>
        <h2>水位监测管理</h2>
        <p class="page-desc">维护水位监测记录，围绕监测编号、监测点位、水位读数、警戒水位做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记水位监测记录</button>
        <button class="btn" type="button" @click="toggleImport">批量导入水位读数</button>
        <button class="btn" type="button" @click="exportRows">导出水位监测清单</button>
      </div>
    </header>

    <section v-if="importVisible" class="import-panel">
      <div class="import-head">
        <h3>批量导入水位读数</h3>
        <p class="import-tip">
          每行一条：监测编号,水位读数,采集时间,监测人(选填)，支持中文逗号与 Tab 分隔。
          警戒水位按点位预先设定，导入只写读数，不会改动警戒水位；同一监测编号同一时刻重复的行只留一条。
        </p>
      </div>
      <textarea
        v-model="importText"
        class="import-textarea"
        rows="8"
        placeholder="WATE-0001,3.62,2026-10-05 08:00,张三"
      ></textarea>
      <div class="import-toolbar">
        <input type="file" accept=".csv,.txt" @change="loadFile" />
        <button class="btn ghost" type="button" @click="downloadTemplate">下载导入模板</button>
        <button class="btn primary" type="button" @click="submitImport">执行导入</button>
        <button class="btn ghost" type="button" @click="importText = ''">清空</button>
      </div>

      <div v-if="importResult" class="import-result">
        <p class="import-summary">{{ importResult.message }}</p>
        <div v-if="importResult.errors.length" class="import-block error">
          <h4>退回 {{ importResult.errors.length }} 行（整行未导入）</h4>
          <ul>
            <li v-for="item in importResult.errors" :key="item.line">
              第 {{ item.line }} 行：{{ item.reason }}（{{ item.content }}）
            </li>
          </ul>
        </div>
        <div v-if="importResult.exceedances.length" class="import-block warn">
          <h4>越限读数 {{ importResult.exceedances.length }} 条</h4>
          <ul>
            <li v-for="(item, index) in importResult.exceedances" :key="index">
              {{ item.code }}（{{ item.point }}）{{ item.time }} 读数 {{ item.reading }}m，
              警戒 {{ item.threshold }}m，越限持续 {{ item.duration }}
            </li>
          </ul>
        </div>
        <div v-if="importResult.missingPoints.length" class="import-block missing">
          <h4>未导入点位 {{ importResult.missingPoints.length }} 个</h4>
          <p>{{ importResult.missingPoints.join('、') }}</p>
        </div>
      </div>
    </section>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-exceeded': row.abnormal }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无水位监测数据，可先登记水位监测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条水位监测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  importWaterlevelReadings,
  waterlevelImportTemplate,
  type WaterlevelImportResult,
} from '@/api/waterlevel-import'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('waterlevel')
const columns = ["监测编号", "监测点位", "水位读数", "警戒水位", "采集时间", "监测人", "超标判定", "监测状态"]
const actions = ["提交采集", "判定正常", "标记超警戒"]
const statuses = ["待采集", "已采集", "水位正常", "超警戒"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const stats = computed(() => [
  { label: '待采集点位', value: rows.value.filter((row) => row.status === '待采集').length },
  { label: '水位正常点位', value: rows.value.filter((row) => row.status === '水位正常').length },
  { label: '超警戒点位数', value: rows.value.filter((row) => row.abnormal).length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const importVisible = ref(false)
const importText = ref('')
const importResult = ref<WaterlevelImportResult | null>(null)

function toggleImport() {
  importVisible.value = !importVisible.value
}

function loadFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    importText.value = String(reader.result ?? '')
    input.value = ''
  }
  reader.readAsText(file, 'utf-8')
}

function downloadTemplate() {
  const { filename, content } = waterlevelImportTemplate()
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function submitImport() {
  errorMessage.value = ''
  try {
    importResult.value = importWaterlevelReadings(importText.value)
    reload()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水位读数导入失败'
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '水位监测记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水位监测列表读取失败'
  }
}

onMounted(reload)
</script>
