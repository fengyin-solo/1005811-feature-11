import type { WaterLevelReading } from './types'

// 水位读数时序库：一个监测点位对应多条按采集时间排列的读数，与点位台账分开存。
const READING_STORAGE_KEY = 'drainage-pump:waterlevel-readings'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedReadings(): Record<string, WaterLevelReading[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  const raw = window.localStorage.getItem(READING_STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(READING_STORAGE_KEY, JSON.stringify({}))
    return {}
  }
  try {
    return JSON.parse(raw) as Record<string, WaterLevelReading[]>
  } catch {
    window.localStorage.setItem(READING_STORAGE_KEY, JSON.stringify({}))
    return {}
  }
}

let readingCache: Record<string, WaterLevelReading[]> | null = null

export function allReadings(): Record<string, WaterLevelReading[]> {
  if (readingCache === null) {
    readingCache = seedReadings()
  }
  return readingCache
}

export function listReadings(pointCode: string): WaterLevelReading[] {
  return allReadings()[pointCode] ?? []
}

export function saveReadings(store: Record<string, WaterLevelReading[]>): void {
  readingCache = store
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(READING_STORAGE_KEY, JSON.stringify(store))
  }
}

export function appendReadings(items: WaterLevelReading[]): void {
  const store = clone(allReadings())
  for (const item of items) {
    const list = store[item.pointCode] ?? []
    list.push(clone(item))
    list.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt))
    store[item.pointCode] = list
  }
  saveReadings(store)
}

export function resetReadings(): void {
  saveReadings({})
}
