<template>
  <section class="page" data-module="waterlevel">
    <header class="page-head">
      <div>
        <h2>水位监测管理</h2>
        <p class="page-desc">维护水位监测记录，围绕监测编号、监测点位、水位读数、警戒水位做登记、批量导入、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openImport">批量导入水位读数</button>
        <button class="btn" type="button" @click="downloadTemplate">下载导入模板</button>
        <button class="btn" type="button" @click="exportRows">导出水位监测清单</button>
      </div>
    </header>

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
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-exceeded': isExceeded(row) }">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '水位读数'">
              <button v-if="hasReadings(row)" class="link" type="button" @click="openHistory(row)">
                {{ row[column] ?? '—' }}
              </button>
              <span v-else>{{ row[column] && row[column] !== '' ? row[column] : '—' }}</span>
              <span v-if="isExceeded(row)" class="exceed-tag" title="最新读数越过警戒线">越限</span>
            </template>
            <template v-else>{{ displayCell(row, column) }}</template>
          </td>
          <td>
            <span :class="{ 'exceed-tag': row.status === '超警戒' }">{{ row.status }}</span>
          </td>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无水位监测数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 个水位监测点位</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 批量导入弹窗 -->
    <div v-if="importOpen" class="modal-mask" @click.self="closeImport">
      <div class="modal-card import-modal">
        <header class="modal-head">
          <h3>批量导入水位读数</h3>
          <button class="link" type="button" @click="closeImport">关闭</button>
        </header>
        <div class="modal-body">
          <ol class="import-tips">
            <li>文件为 CSV（UTF-8），列：监测编号、水位读数、采集时间、监测人（可留空，默认当前值班人）。</li>
            <li>监测编号对不上点位台账的整行退回，结果里指出具体行号。</li>
            <li>同一监测编号同一采集时间重复导入只保留一条，重复行计入结果但不入库。</li>
            <li>警戒水位按点位预先设好，导入只写读数，不接收、不修改警戒水位。</li>
            <li>越过警戒线的读数会单独标出，并按时间序列计算每次越限持续时长。</li>
          </ol>
          <input ref="fileInput" class="file-input" type="file" accept=".csv,text/csv" @change="onFilePicked" />
          <p v-if="parseError" class="error-text">{{ parseError }}</p>

          <section v-if="report" class="import-report">
            <h4>导入结果</h4>
            <p class="report-summary">
              文件共 {{ report.totalLines }} 行数据：成功导入
              <strong>{{ report.importedCount }}</strong> 条，重复跳过
              <strong>{{ report.duplicateCount }}</strong> 条，退回
              <strong class="error-text">{{ report.rejectedCount }}</strong> 条。
            </p>

            <div v-if="report.rejections.length" class="report-block">
              <h5 class="error-text">退回明细（整行未导入）</h5>
              <ul class="report-list">
                <li v-for="item in report.rejections" :key="`${item.line}-${item.reason}`">
                  第 {{ item.line }} 行<template v-if="item.pointCode">（{{ item.pointCode }}）</template>：{{ item.reason }}
                </li>
              </ul>
            </div>

            <div v-if="report.exceededPoints.length" class="report-block">
              <h5 class="exceed-text">越限读数点位（{{ report.exceededPoints.length }} 个）</h5>
              <ul class="report-list">
                <li v-for="point in report.exceededPoints" :key="point.pointCode">
                  {{ point.pointCode }} · {{ point.pointName }}
                  <ul class="span-list">
                    <li v-for="span in point.spans" :key="`${span.start}-${span.end}`">
                      {{ span.start }} 起越限，{{ span.ongoing ? `至最新读数 ${span.end} 仍未回落` : `${span.end} 回落` }}，
                      持续 <strong>{{ span.durationLabel }}</strong>，峰值 {{ span.peak.toFixed(2) }}m
                    </li>
                  </ul>
                </li>
              </ul>
            </div>
            <p v-else-if="report.importedCount" class="report-ok">本次导入的读数均在警戒线以下。</p>

            <div v-if="report.pointSummaries.length" class="report-block">
              <h5>各点位导入情况</h5>
              <ul class="report-list">
                <li v-for="point in report.pointSummaries" :key="point.pointCode">
                  {{ point.pointCode }} · {{ point.pointName }}：导入 {{ point.imported }} 条
                  <template v-if="point.duplicated">，重复跳过 {{ point.duplicated }} 条</template>
                  <template v-if="point.overLimit">，<span class="exceed-tag">最新读数越限</span></template>
                </li>
              </ul>
            </div>

            <div v-if="report.untouchedPoints.length" class="report-block">
              <h5>本次未导入读数的点位（{{ report.untouchedPoints.length }} 个，仍为待采集）</h5>
              <ul class="report-list">
                <li v-for="point in report.untouchedPoints" :key="point.pointCode">
                  {{ point.pointCode }} · {{ point.pointName }}
                </li>
              </ul>
            </div>
          </section>
        </div>
      </div>
    </div>

    <!-- 点位读数曲线/明细抽屉 -->
    <div v-if="historyPoint" class="modal-mask" @click.self="closeHistory">
      <div class="modal-card history-modal">
        <header class="modal-head">
          <h3>{{ historyPoint[codeField] }} · {{ historyPoint[nameField] }} 读数明细</h3>
          <button class="link" type="button" @click="closeHistory">关闭</button>
        </header>
        <div class="modal-body">
          <p class="page-desc">
            预置警戒水位 {{ historyPoint[warnField] }}m；红色行为越过警戒线的读数。
          </p>
          <table class="data-table">
            <thead>
              <tr>
                <th>采集时间</th>
                <th>水位读数(m)</th>
                <th>监测人</th>
                <th>越限判定</th>
                <th>越限持续</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in historyViewRows"
                :key="item.reading.collectedAt"
                :class="{ 'row-exceeded': item.exceeded }"
              >
                <td>{{ item.reading.collectedAt }}</td>
                <td>{{ item.reading.value.toFixed(2) }}</td>
                <td>{{ item.reading.operator || '—' }}</td>
                <td>{{ item.exceeded ? '越限' : '正常' }}</td>
                <td>{{ item.durationLabel }}</td>
              </tr>
              <tr v-if="!historyRows.length">
                <td colspan="5" class="empty-state">该点位暂无已导入读数</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
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
  buildExceedanceSpans,
  importWaterLevelReadings,
  waterLevelTemplateContent,
} from '@/api/waterlevel-import'
import { listReadings } from '@/data/waterlevel-store'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, ExceedanceSpan, WaterLevelImportResult, WaterLevelReading } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('waterlevel')
const columns = ['监测编号', '监测点位', '水位读数', '警戒水位', '采集时间', '监测人', '超标判定', '监测状态']
const codeField = '监测编号'
const nameField = '监测点位'
const valueField = '水位读数'
const warnField = '警戒水位'
const actions = ['提交采集', '判定正常', '标记超警戒']
const statuses = ['待采集', '已采集', '水位正常', '超警戒']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const stats = computed(() => [
  { label: '待采集点位', value: rows.value.filter((row) => String(row.status) === '待采集').length },
  { label: '已采集点位', value: rows.value.filter((row) => String(row.status) === '已采集').length },
  { label: '超警戒点位数', value: rows.value.filter((row) => String(row.status) === '超警戒').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const readingsByCode = ref<Record<string, WaterLevelReading[]>>({})

function warnValue(row: EntryRow): number {
  return Number(row[warnField])
}

function isExceeded(row: EntryRow): boolean {
  const value = Number(row[valueField])
  return Number.isFinite(value) && value > warnValue(row)
}

function displayCell(row: EntryRow, column: string): string {
  const value = row[column]
  return value === '' || value === null || value === undefined ? '—' : String(value)
}

function hasReadings(row: EntryRow): boolean {
  return (readingsByCode.value[String(row[codeField])] ?? []).length > 0
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
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

function downloadTemplate() {
  const blob = new Blob([waterLevelTemplateContent()], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = '水位读数导入模板.csv'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// ---- 批量导入 ----
const importOpen = ref(false)
const parseError = ref('')
const report = ref<WaterLevelImportResult | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

function openImport() {
  importOpen.value = true
  report.value = null
  parseError.value = ''
}

function closeImport() {
  importOpen.value = false
  reload()
}

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  parseError.value = ''
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const text = String(reader.result ?? '')
      report.value = importWaterLevelReadings(text, store.operator)
      reload()
    } catch (error) {
      parseError.value = error instanceof Error ? error.message : '文件解析失败'
    }
  }
  reader.onerror = () => {
    parseError.value = '文件读取失败，请重试'
  }
  reader.readAsText(file, 'utf-8')
  input.value = ''
}

// ---- 点位读数明细 ----
const historyPoint = ref<EntryRow | null>(null)
const historyRows = ref<WaterLevelReading[]>([])
const historySpans = ref<ExceedanceSpan[]>([])

function openHistory(row: EntryRow) {
  historyPoint.value = row
  const code = String(row[codeField])
  historyRows.value = listReadings(code)
  historySpans.value = buildExceedanceSpans(
    code,
    String(row[nameField]),
    warnValue(row),
    historyRows.value,
  )
}

// 读数按时间倒序展示；每段越限的第一条（最早一条）上挂该段持续时长。
const historyViewRows = computed(() => {
  const startLabels = new Map(historySpans.value.map((span) => [span.start, span.durationLabel]))
  return [...historyRows.value]
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
    .map((reading) => ({
      reading,
      exceeded: historyPoint.value !== null && reading.value > warnValue(historyPoint.value),
      durationLabel: startLabels.get(reading.collectedAt) ?? '',
    }))
})

function closeHistory() {
  historyPoint.value = null
  historyRows.value = []
  historySpans.value = []
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    readingsByCode.value = {}
    for (const row of rows.value) {
      readingsByCode.value[String(row[codeField])] = listReadings(String(row[codeField]))
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '水位监测列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
}
.row-exceeded {
  background: #fef3f2;
}
.exceed-tag {
  display: inline-block;
  margin-left: 6px;
  padding: 0 8px;
  border-radius: 999px;
  background: #d92d20;
  color: #fff;
  font-size: 12px;
  line-height: 20px;
}
.exceed-text {
  color: #b42318;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(16, 24, 40, 0.45);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 16px;
  z-index: 50;
  overflow-y: auto;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  width: 720px;
  max-width: 100%;
  box-shadow: 0 12px 32px rgba(16, 24, 40, 0.2);
}
.import-modal {
  width: 760px;
}
.history-modal {
  width: 860px;
}
.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}
.modal-head h3 {
  margin: 0;
  font-size: 16px;
}
.modal-body {
  padding: 14px 18px 18px;
}
.import-tips {
  margin: 0 0 12px;
  padding-left: 20px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.8;
}
.file-input {
  margin-bottom: 12px;
}
.import-report h4 {
  margin: 8px 0;
}
.report-summary {
  font-size: 13px;
}
.report-block {
  margin-top: 12px;
}
.report-block h5 {
  margin: 0 0 6px;
  font-size: 13px;
}
.report-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.8;
}
.span-list {
  margin: 2px 0;
  padding-left: 18px;
  color: #475467;
}
.report-ok {
  font-size: 13px;
  color: #067647;
}
</style>
