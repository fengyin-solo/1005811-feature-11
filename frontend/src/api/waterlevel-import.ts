import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

// 水位读数批量导入：只写「水位读数 / 采集时间 / 监测人」，警戒水位是点位预设，导入绝不动它。
const MODULE_KEY = 'waterlevel'

export type ImportLineError = {
  line: number
  content: string
  reason: string
}

export type ExceedanceRecord = {
  code: string
  point: string
  time: string
  reading: number
  threshold: number
  duration: string
}

export type WaterlevelImportResult = {
  ok: boolean
  created: number
  updated: number
  duplicated: number
  errors: ImportLineError[]
  exceedances: ExceedanceRecord[]
  missingPoints: string[]
  message: string
}

type ParsedLine = {
  code: string
  reading: number
  time: Date
  timeText: string
  observer: string
}

const TIME_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/

export function parseCollectTime(raw: string): Date | null {
  const text = raw.trim().replace(/\//g, '-').replace('T', ' ')
  const match = TIME_PATTERN.exec(text)
  if (!match) {
    return null
  }
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day)
  ) {
    return null
  }
  return date
}

export function formatCollectTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function durationLabel(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes <= 0) {
    return '单次越限'
  }
  if (minutes < 60) {
    return `${minutes}分钟`
  }
  const hours = minutes / 60
  return `${Number(hours.toFixed(1))}小时`
}

function rowKey(code: string, timeText: string): string {
  return `${code}|${timeText}`
}

export function importWaterlevelReadings(text: string): WaterlevelImportResult {
  const rows = listRows(MODULE_KEY)
  const errors: ImportLineError[] = []
  const exceedances: ExceedanceRecord[] = []
  const empty: WaterlevelImportResult = {
    ok: false,
    created: 0,
    updated: 0,
    duplicated: 0,
    errors,
    exceedances,
    missingPoints: [],
    message: '',
  }
  if (!text.trim()) {
    return { ...empty, message: '没有可导入的内容，请先粘贴或选择读数文件' }
  }

  // 点位预设：同一监测编号可能有多条历史读数，点位名和警戒水位以已有记录为准。
  const presetByCode = new Map<string, EntryRow>()
  for (const row of rows) {
    const code = String(row['监测编号'] ?? '').trim()
    if (code && !presetByCode.has(code)) {
      presetByCode.set(code, row)
    }
  }

  const parsed: ParsedLine[] = []
  const seenInFile = new Set<string>()
  let duplicated = 0

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNo = index + 1
    const line = rawLine.trim()
    if (!line) {
      return
    }
    if (lineNo === 1 && line.includes('监测编号')) {
      return // 表头行，跳过
    }
    const cells = line.split(/[，,\t]/).map((cell) => cell.trim())
    if (cells.length < 3 || cells.length > 4) {
      errors.push({ line: lineNo, content: line, reason: '每行应为 3~4 列：监测编号,水位读数,采集时间,监测人(选填)' })
      return
    }
    const [code, readingRaw, timeRaw, observer = ''] = cells
    if (!presetByCode.has(code)) {
      errors.push({ line: lineNo, content: line, reason: `监测编号「${code}」对不上任何监测点位，整行退回` })
      return
    }
    const reading = Number(readingRaw)
    if (readingRaw === '' || !Number.isFinite(reading)) {
      errors.push({ line: lineNo, content: line, reason: `水位读数「${readingRaw}」不是数字，整行退回` })
      return
    }
    const time = parseCollectTime(timeRaw)
    if (!time) {
      errors.push({ line: lineNo, content: line, reason: `采集时间「${timeRaw}」无法识别，整行退回` })
      return
    }
    const timeText = formatCollectTime(time)
    const key = rowKey(code, timeText)
    if (seenInFile.has(key)) {
      duplicated += 1 // 同一监测编号同一时刻，文件里只留第一条
      return
    }
    seenInFile.add(key)
    parsed.push({ code, reading, time, timeText, observer })
  })

  const next = [...rows]
  const indexByKey = new Map<string, number>()
  // 点位还空着的待采集记录（只有预设、没有读数的占位行）：导入时优先填它，状态从待采集转已采集
  const placeholderByCode = new Map<string, number[]>()
  next.forEach((row, index) => {
    const code = String(row['监测编号'] ?? '').trim()
    if (!code) {
      return
    }
    const timeRaw = String(row['采集时间'] ?? '').trim()
    const time = timeRaw ? parseCollectTime(timeRaw) : null
    if (time) {
      indexByKey.set(rowKey(code, formatCollectTime(time)), index)
    } else if (row.status === '待采集') {
      const list = placeholderByCode.get(code) ?? []
      list.push(index)
      placeholderByCode.set(code, list)
    }
  })

  let created = 0
  let updated = 0
  let maxId = next.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  const touchedCodes = new Set<string>()

  const sorted = [...parsed].sort((a, b) =>
    a.code === b.code ? a.time.getTime() - b.time.getTime() : a.code < b.code ? -1 : 1,
  )
  for (const item of sorted) {
    touchedCodes.add(item.code)
    const preset = presetByCode.get(item.code)!
    const key = rowKey(item.code, item.timeText)
    const at = indexByKey.get(key)
    const placeholders = placeholderByCode.get(item.code)
    const reuseAt = at === undefined && placeholders?.length ? placeholders.shift()! : -1
    if (at !== undefined || reuseAt >= 0) {
      // 同一编号同一时刻已存在（或点位有待采集占位行）：只更新读数等采集字段，警戒水位保持原样
      const target = at !== undefined ? at : reuseAt
      next[target] = {
        ...next[target],
        水位读数: item.reading,
        采集时间: item.timeText,
        监测人: item.observer || String(next[target]['监测人'] ?? '') || '批量导入',
        监测状态: '已采集',
        status: '已采集',
        pending: true,
      }
      indexByKey.set(key, target)
      updated += 1
    } else {
      maxId += 1
      next.push({
        id: maxId,
        status: '已采集',
        pending: true,
        abnormal: false,
        监测编号: item.code,
        监测点位: preset['监测点位'],
        水位读数: item.reading,
        警戒水位: preset['警戒水位'], // 沿用点位预设，导入不写警戒水位
        采集时间: item.timeText,
        监测人: item.observer || '批量导入',
        超标判定: '未越限',
        监测状态: '已采集',
      })
      indexByKey.set(key, next.length - 1)
      created += 1
    }
  }

  // 越限判定与持续时长：按监测编号把读数按时间排序，连续越限的一段算一次越限，
  // 时长从首次越限算到回落到警戒线以下（没有回落读数则算到该段最后一次越限）。
  for (const code of touchedCodes) {
    const preset = presetByCode.get(code)!
    const threshold = Number(preset['警戒水位'])
    const point = String(preset['监测点位'] ?? '')
    const readings = next
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => String(row['监测编号'] ?? '').trim() === code)
      .map(({ row, index }) => ({
        index,
        time: parseCollectTime(String(row['采集时间'] ?? '')),
        reading: Number(row['水位读数']),
      }))
      .filter((item) => item.time !== null && Number.isFinite(item.reading))
      .sort((a, b) => a.time!.getTime() - b.time!.getTime())

    if (!Number.isFinite(threshold)) {
      for (const item of readings) {
        next[item.index] = { ...next[item.index], 超标判定: '警戒水位未设定', abnormal: false }
      }
      continue
    }

    let run: typeof readings = []
    const closeRun = (fallBackTime: Date | null) => {
      if (run.length === 0) {
        return
      }
      const start = run[0].time!
      const end = fallBackTime ?? run[run.length - 1].time!
      const duration = durationLabel(end.getTime() - start.getTime())
      for (const item of run) {
        next[item.index] = { ...next[item.index], 超标判定: `越限·持续${duration}`, abnormal: true }
        exceedances.push({
          code,
          point,
          time: formatCollectTime(item.time!),
          reading: item.reading,
          threshold,
          duration,
        })
      }
      run = []
    }
    for (const item of readings) {
      if (item.reading > threshold) {
        run.push(item)
      } else {
        closeRun(item.time)
        next[item.index] = { ...next[item.index], 超标判定: '未越限', abnormal: false }
      }
    }
    closeRun(null)
  }

  // 没导进来的点位逐个点名：本次没收到读数、且仍停留在待采集的监测编号
  const missingPoints: string[] = []
  const pendingByCode = new Map<string, string>()
  for (const row of next) {
    const code = String(row['监测编号'] ?? '').trim()
    if (code && row.status === '待采集' && !touchedCodes.has(code)) {
      pendingByCode.set(code, String(row['监测点位'] ?? ''))
    }
  }
  for (const [code, point] of pendingByCode) {
    missingPoints.push(point ? `${code}（${point}）` : code)
  }

  if (created + updated > 0) {
    saveRows(MODULE_KEY, next)
  }

  const parts = [`新增 ${created} 条、更新 ${updated} 条读数`]
  if (duplicated > 0) {
    parts.push(`同编号同时刻重复 ${duplicated} 条已合并`)
  }
  if (errors.length > 0) {
    parts.push(`退回 ${errors.length} 行`)
  }
  if (exceedances.length > 0) {
    parts.push(`${exceedances.length} 条读数越限`)
  }
  if (missingPoints.length > 0) {
    parts.push(`${missingPoints.length} 个点位未导入`)
  }
  return {
    ok: errors.length === 0 && created + updated > 0,
    created,
    updated,
    duplicated,
    errors,
    exceedances,
    missingPoints,
    message: `导入完成：${parts.join('，')}`,
  }
}

export function waterlevelImportTemplate(): { filename: string; content: string } {
  const lines = [
    '监测编号,水位读数,采集时间,监测人',
    'WATE-0001,3.62,2026-10-05 08:00,张三',
    'WATE-0001,3.71,2026-10-05 09:00,张三',
  ]
  return { filename: '水位读数导入模板.csv', content: `\uFEFF${lines.join('\n')}` }
}
