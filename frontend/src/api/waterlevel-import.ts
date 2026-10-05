import { parseCsv } from '@/data/csv'
import {
  allReadings,
  appendReadings,
  listReadings,
} from '@/data/waterlevel-store'
import { listRows, saveRows } from '@/data/local-store'
import type {
  EntryRow,
  ExceedanceSpan,
  ImportPointSummary,
  ImportRejection,
  WaterLevelImportResult,
  WaterLevelReading,
} from '@/data/types'

const MODULE_KEY = 'waterlevel'
const CODE_FIELD = '监测编号'
const NAME_FIELD = '监测点位'
const VALUE_FIELD = '水位读数'
const WARN_FIELD = '警戒水位'
const TIME_FIELD = '采集时间'
const OPERATOR_FIELD = '监测人'
const JUDGE_FIELD = '超标判定'
const STATE_FIELD = '监测状态'

// 导入模板固定四列：警戒水位在点位台账上预置，文件里不接受，防止读数导入顺手改掉警戒线。
export const IMPORT_HEADERS = [CODE_FIELD, VALUE_FIELD, TIME_FIELD, OPERATOR_FIELD]

type PointInfo = {
  id: number
  code: string
  name: string
  warnLevel: number
  row: EntryRow
}

// 把「2026-10-05 08:30」「2026-10-05T08:30」「2026/10/05 8:30」统一认成可比较的 YYYY-MM-DD HH:mm:ss。
export function normalizeTime(input: string): string {
  const raw = input.trim().replace(/\//g, '-').replace('T', ' ')
  const match = raw.match(/^(\d{4}-\d{1,2}-\d{1,2})(?:[ ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (!match) {
    return ''
  }
  const [, datePart, hour = '00', minute = '00', second = '00'] = match
  const [year, month, day] = datePart.split('-').map((part) => Number(part))
  if (month < 1 || month > 12 || day < 1 || day > 31 || Number(hour) > 23 || Number(minute) > 59) {
    return ''
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)} ${pad(Number(hour))}:${pad(Number(minute))}:${pad(Number(second))}`
}

export function toNumber(input: string): number {
  const value = Number(input.trim())
  return Number.isFinite(value) ? value : Number.NaN
}

export function formatDuration(minutes: number): string {
  if (minutes <= 0) {
    return '0分钟'
  }
  const days = Math.floor(minutes / (60 * 24))
  const hours = Math.floor((minutes % (60 * 24)) / 60)
  const mins = minutes % 60
  const parts: string[] = []
  if (days > 0) parts.push(`${days}天`)
  if (hours > 0) parts.push(`${hours}小时`)
  if (mins > 0 || parts.length === 0) parts.push(`${mins}分钟`)
  return parts.join('')
}

function timeToMinutes(value: string): number {
  return new Date(value.replace(' ', 'T')).getTime() / 60000
}

// 按时间排序后，把「读数 > 警戒水位」的连续读数切成一段段越限时段；
// 段后第一条回落读数作为结束时刻；最后一条仍越限则时段持续至今（ongoing）。
export function buildExceedanceSpans(
  pointCode: string,
  pointName: string,
  warnLevel: number,
  readings: WaterLevelReading[],
): ExceedanceSpan[] {
  const sorted = [...readings].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt))
  const spans: ExceedanceSpan[] = []
  let segment: WaterLevelReading[] = []

  const flush = (next: WaterLevelReading | null) => {
    if (segment.length === 0) return
    const start = segment[0].collectedAt
    const lastOver = segment[segment.length - 1]
    const end = next ? next.collectedAt : lastOver.collectedAt
    const durationMinutes = Math.max(0, Math.round(timeToMinutes(end) - timeToMinutes(start)))
    spans.push({
      pointCode,
      pointName,
      start,
      end,
      durationMinutes,
      durationLabel: formatDuration(durationMinutes),
      ongoing: next === null,
      peak: Math.max(...segment.map((item) => item.value)),
    })
    segment = []
  }

  for (const reading of sorted) {
    if (reading.value > warnLevel) {
      segment.push(reading)
    } else {
      flush(reading)
    }
  }
  flush(null)
  return spans
}

type PlannedItem = WaterLevelReading & { line: number }

type ImportPlan = {
  accepted: PlannedItem[]
  duplicates: { line: number; pointCode: string }[]
  rejections: ImportRejection[]
  pointCodesTouched: Set<string>
  dataLineCount: number
}

function planImport(
  text: string,
  points: PointInfo[],
  readingStore: Record<string, WaterLevelReading[]>,
  operator: string,
): ImportPlan {
  const { headers, rows } = parseCsv(text)
  const accepted: PlannedItem[] = []
  const duplicates: { line: number; pointCode: string }[] = []
  const rejections: ImportRejection[] = []
  const pointCodesTouched = new Set<string>()

  // 数据从第 2 行起（第 1 行表头），报错直接点出抄表文件里的行号。
  const required = [CODE_FIELD, VALUE_FIELD, TIME_FIELD]
  const missingHeaders = required.filter((header) => !headers.includes(header))
  if (missingHeaders.length > 0) {
    return {
      accepted,
      duplicates,
      rejections: [{ line: 1, pointCode: '', reason: `表头缺少列：${missingHeaders.join('、')}` }],
      pointCodesTouched,
      dataLineCount: rows.length,
    }
  }

  const byCode = new Map(points.map((point) => [point.code, point]))
  // 同一文件内：监测编号 + 采集时间 完全相同只留第一条。
  const seenInFile = new Set<string>()

  rows.forEach((raw, index) => {
    const line = index + 2
    const code = (raw[CODE_FIELD] ?? '').trim()
    const valueText = (raw[VALUE_FIELD] ?? '').trim()
    const timeText = (raw[TIME_FIELD] ?? '').trim()
    const rowOperator = (raw[OPERATOR_FIELD] ?? '').trim() || operator

    if (!code) {
      rejections.push({ line, pointCode: code, reason: '监测编号为空，整行退回' })
      return
    }
    if (!byCode.has(code)) {
      rejections.push({ line, pointCode: code, reason: `监测编号「${code}」在点位台账中不存在，整行退回` })
      return
    }
    const value = toNumber(valueText)
    if (!Number.isFinite(value)) {
      rejections.push({ line, pointCode: code, reason: `水位读数「${valueText}」不是有效数字，整行退回` })
      return
    }
    const collectedAt = normalizeTime(timeText)
    if (!collectedAt) {
      rejections.push({
        line,
        pointCode: code,
        reason: `采集时间「${timeText}」无法识别，应形如 2026-10-05 08:00，整行退回`,
      })
      return
    }

    const dedupeKey = `${code}@${collectedAt}`
    if (seenInFile.has(dedupeKey)) {
      duplicates.push({ line, pointCode: code })
      return
    }
    const alreadyStored = (readingStore[code] ?? []).some((item) => item.collectedAt === collectedAt)
    if (alreadyStored) {
      duplicates.push({ line, pointCode: code })
      return
    }
    seenInFile.add(dedupeKey)
    accepted.push({ pointCode: code, value, collectedAt, operator: rowOperator, line })
    pointCodesTouched.add(code)
  })

  return { accepted, duplicates, rejections, pointCodesTouched, dataLineCount: rows.length }
}

// 纯函数版本：吃进点位台账、存量读数和文件文本，吐出结果与更新后的台账/读数，换回后端时整层搬走。
export function evaluateWaterLevelImport(
  text: string,
  pointRows: EntryRow[],
  readingStore: Record<string, WaterLevelReading[]>,
  operator = '',
): {
  result: WaterLevelImportResult
  updatedPoints: EntryRow[]
  updatedReadings: Record<string, WaterLevelReading[]>
} {
  const points: PointInfo[] = pointRows
    .map((row) => {
      const code = String(row[CODE_FIELD] ?? '').trim()
      const warnLevel = toNumber(String(row[WARN_FIELD] ?? ''))
      return code && Number.isFinite(warnLevel)
        ? { id: Number(row.id), code, name: String(row[NAME_FIELD] ?? code), warnLevel, row }
        : null
    })
    .filter((item): item is PointInfo => item !== null)

  const plan = planImport(text, points, readingStore, operator)

  // 合并新读数：同编号同时刻已在 plan 阶段剔重。
  const merged: Record<string, WaterLevelReading[]> = {}
  for (const point of points) {
    merged[point.code] = [...(readingStore[point.code] ?? [])]
  }
  for (const reading of plan.accepted) {
    merged[reading.pointCode].push({
      pointCode: reading.pointCode,
      value: reading.value,
      collectedAt: reading.collectedAt,
      operator: reading.operator,
    })
  }
  for (const code of Object.keys(merged)) {
    merged[code].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt))
  }

  const duplicateByCode = new Map<string, number>()
  for (const item of plan.duplicates) {
    duplicateByCode.set(item.pointCode, (duplicateByCode.get(item.pointCode) ?? 0) + 1)
  }

  const pointSummaries: ImportPointSummary[] = []
  const allSpans: ExceedanceSpan[] = []
  const updatedPoints = pointRows.map((row) => ({ ...row }))

  for (const point of points) {
    if (!plan.pointCodesTouched.has(point.code)) continue
    const readings = merged[point.code]
    const spans = buildExceedanceSpans(point.code, point.name, point.warnLevel, readings)
    const latest = readings[readings.length - 1]
    const overLimit = latest ? latest.value > point.warnLevel : false
    pointSummaries.push({
      pointCode: point.code,
      pointName: point.name,
      imported: plan.accepted.filter((item) => item.pointCode === point.code).length,
      duplicated: duplicateByCode.get(point.code) ?? 0,
      overLimit,
      spans,
    })
    allSpans.push(...spans)

    // 回写点位台账：只碰读数侧字段，警戒水位一个字符都不改。
    const index = updatedPoints.findIndex((row) => Number(row.id) === point.id)
    if (index < 0 || !latest) continue
    const current = updatedPoints[index]
    const previousStatus = String(current.status)
    // 待采集 -> 已采集是本次导入的主流程；最新读数越限则额外进入超警戒态并标记异常。
    const nextStatus = overLimit
      ? '超警戒'
      : previousStatus === '待采集'
        ? '已采集'
        : previousStatus === '超警戒'
          ? '水位正常'
          : previousStatus
    updatedPoints[index] = {
      ...current,
      [VALUE_FIELD]: latest.value.toFixed(2),
      [TIME_FIELD]: latest.collectedAt,
      [OPERATOR_FIELD]: latest.operator || String(current[OPERATOR_FIELD] ?? ''),
      [JUDGE_FIELD]: overLimit ? '超警戒' : '正常',
      [STATE_FIELD]: nextStatus,
      status: nextStatus,
      pending: nextStatus === '待采集',
      abnormal: overLimit,
    }
  }

  const untouchedPoints = points
    .filter((point) => !plan.pointCodesTouched.has(point.code))
    .map((point) => ({ pointCode: point.code, pointName: point.name }))

  const result: WaterLevelImportResult = {
    totalLines: plan.dataLineCount,
    importedCount: plan.accepted.length,
    duplicateCount: plan.duplicates.length,
    rejectedCount: plan.rejections.length,
    rejections: plan.rejections,
    pointSummaries,
    exceededPoints: pointSummaries.filter((summary) => summary.overLimit),
    untouchedPoints,
    spans: allSpans,
  }

  return { result, updatedPoints, updatedReadings: merged }
}

// 接 localStorage 的落地版本：页面只调这一个。
export function importWaterLevelReadings(text: string, operator = ''): WaterLevelImportResult {
  const pointRows = listRows(MODULE_KEY)
  const { result, updatedPoints, updatedReadings } = evaluateWaterLevelImport(
    text,
    pointRows,
    allReadings(),
    operator,
  )

  const fresh: WaterLevelReading[] = []
  for (const summary of result.pointSummaries) {
    const beforeTimes = new Set(listReadings(summary.pointCode).map((item) => item.collectedAt))
    for (const reading of updatedReadings[summary.pointCode] ?? []) {
      if (!beforeTimes.has(reading.collectedAt)) {
        fresh.push(reading)
      }
    }
  }
  if (fresh.length > 0) {
    appendReadings(fresh)
  }
  saveRows(MODULE_KEY, updatedPoints)
  return result
}

export function waterLevelTemplateContent(): string {
  return `﻿${IMPORT_HEADERS.join(',')}\nWATE-0001,5.36,2026-10-05 08:00,张三\nWATE-0002,8.12,2026-10-05 08:00,李四\n`
}
