// 极简 CSV 解析：支持引号包裹、逗号转义、首行表头；返回表头与按行对象数组。
export type ParsedCsv = {
  headers: string[]
  rows: Record<string, string>[]
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ',' && !inQuotes) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells.map((cell) => cell.trim())
}

export function parseCsv(text: string): ParsedCsv {
  const content = text.replace(/^﻿/, '')
  const rawLines = content.split(/\r\n|\r|\n/)
  const lines = rawLines.filter((line) => line.trim() !== '')
  if (lines.length === 0) {
    return { headers: [], rows: [] }
  }
  const headers = splitCsvLine(lines[0]).map((h) => h.trim())
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? ''
    })
    return row
  })
  return { headers, rows }
}
