/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 一条水位读数：属于某个监测点位（pointCode 对应点位台账的「监测编号」），带采集时刻。
export type WaterLevelReading = {
  pointCode: string
  value: number
  collectedAt: string
  operator: string
}

// 越过警戒线的连续时段：从首次越限读数到回落（或最新读数，仍在越限）之间的持续时长。
export type ExceedanceSpan = {
  pointCode: string
  pointName: string
  start: string
  end: string
  durationMinutes: number
  durationLabel: string
  ongoing: boolean
  peak: number
}

export type ImportRejection = {
  line: number
  pointCode: string
  reason: string
}

export type ImportPointSummary = {
  pointCode: string
  pointName: string
  imported: number
  duplicated: number
  overLimit: boolean
  spans: ExceedanceSpan[]
}

export type WaterLevelImportResult = {
  totalLines: number
  importedCount: number
  duplicateCount: number
  rejectedCount: number
  rejections: ImportRejection[]
  pointSummaries: ImportPointSummary[]
  exceededPoints: ImportPointSummary[]
  // 本次文件里没覆盖到的点位（点名用，不只报总数）
  untouchedPoints: { pointCode: string; pointName: string }[]
  spans: ExceedanceSpan[]
}
