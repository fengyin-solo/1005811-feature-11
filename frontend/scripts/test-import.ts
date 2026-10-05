import { evaluateWaterLevelImport } from '../src/api/waterlevel-import'
import type { EntryRow, WaterLevelReading } from '../src/data/types'

const points: EntryRow[] = [
  { id: 1, status: '待采集', pending: true, abnormal: false,
    监测编号: 'WATE-0001', 监测点位: '滨河路1号检查井', 水位读数: '', 警戒水位: '5.20',
    采集时间: '', 监测人: '', 超标判定: '未采集', 监测状态: '待采集' },
  { id: 2, status: '待采集', pending: true, abnormal: false,
    监测编号: 'WATE-0002', 监测点位: '东郊泵站前池', 水位读数: '', 警戒水位: '8.50',
    采集时间: '', 监测人: '', 超标判定: '未采集', 监测状态: '待采集' },
  { id: 3, status: '待采集', pending: true, abnormal: false,
    监测编号: 'WATE-0003', 监测点位: '西河渠节制闸', 水位读数: '', 警戒水位: '6.80',
    采集时间: '', 监测人: '', 超标判定: '未采集', 监测状态: '待采集' },
]

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('PASS:', msg)
  }
}

// 场景一：越限-持续-回落，重复行，错误编号，错误时间，缺读数
const csv1 = [
  '监测编号,水位读数,采集时间,监测人',
  'WATE-0001,5.30,2026-10-05 08:00,张三',   // 越限
  'WATE-0001,5.60,2026-10-05 09:00,张三',   // 越限
  'WATE-0001,5.10,2026-10-05 10:30,张三',   // 回落 -> 持续150分钟
  'WATE-0001,5.30,2026-10-05 08:00,张三',   // 同编号同时刻重复
  'WATE-9999,3.00,2026-10-05 08:00,李四',   // 编号不存在 -> 退回第6行
  'WATE-0002,abc,2026-10-05 08:00,李四',    // 读数非法 -> 退回第7行
  'WATE-0002,8.00,2026/10/05 9点,李四',     // 时间非法 -> 退回第8行
  'WATE-0002,8.60,2026-10-05 09:00,李四',   // 仍越限 ongoing
].join('\n')

let store: Record<string, WaterLevelReading[]> = {}
let out = evaluateWaterLevelImport(csv1, points, store, '值班管理员')
let r = out.result

assert(r.totalLines === 8, `数据行计数 8，实际 ${r.totalLines}`)
assert(r.importedCount === 4, `成功导入 4，实际 ${r.importedCount}`)
assert(r.duplicateCount === 1, `重复 1，实际 ${r.duplicateCount}`)
assert(r.rejectedCount === 3, `退回 3，实际 ${r.rejectedCount}`)
assert(r.rejections.map((x) => x.line).join(',') === '6,7,8', `退回行号 6,7,8，实际 ${r.rejections.map((x) => x.line).join(',')}`)
assert(r.rejections[0].pointCode === 'WATE-9999', '退回项点出错误编号')

const p1 = out.updatedPoints.find((p) => p.监测编号 === 'WATE-0001')!
assert(p1.status === '已采集', `点位1 状态已采集，实际 ${p1.status}`)
assert(String(p1.警戒水位) === '5.20', `点位1 警戒水位未被改，实际 ${p1.警戒水位}`)
assert(p1.水位读数 === '5.10', `点位1 最新读数 5.10，实际 ${p1.水位读数}`)
assert(p1.超标判定 === '正常', `点位1 判定正常，实际 ${p1.超标判定}`)

const p2 = out.updatedPoints.find((p) => p.监测编号 === 'WATE-0002')!
assert(p2.status === '超警戒' && p2.abnormal === true, `点位2 超警戒，实际 ${p2.status}`)
assert(p2.警戒水位 === '8.50', `点位2 警戒水位保持 8.50，实际 ${p2.警戒水位}`)

const p3 = out.updatedPoints.find((p) => p.监测编号 === 'WATE-0003')!
assert(p3.status === '待采集', `点位3 未导入仍待采集，实际 ${p3.status}`)
assert(r.untouchedPoints.map((x) => x.pointCode).join(',') === 'WATE-0003', `未导入点名 WATE-0003，实际 ${r.untouchedPoints.map((x) => x.pointCode).join(',')}`)

const span1 = r.spans.find((s) => s.pointCode === 'WATE-0001')!
assert(span1.durationMinutes === 150, `点位1 越限150分钟，实际 ${span1.durationMinutes}`)
assert(span1.ongoing === false, '点位1 已回落 ongoing=false')
const span2 = r.spans.find((s) => s.pointCode === 'WATE-0002')!
assert(span2.durationMinutes === 0 && span2.ongoing === true, '点位2 越限中 ongoing=true')
assert(r.exceededPoints.length === 1 && r.exceededPoints[0].pointCode === 'WATE-0002', '当前越限点位只有 WATE-0002')

// 场景二：第二次导入，与库内已有时刻重复只留一条；越限持续跨天
store = out.updatedReadings
const csv2 = [
  '监测编号,水位读数,采集时间,监测人',
  'WATE-0001,5.30,2026-10-05 08:00,张三',   // 库内已存在 -> 重复
  'WATE-0001,5.40,2026-10-06 08:00,张三',   // 再次越限
  'WATE-0001,5.40,2026-10-06 08:00,张三',   // 文件内重复
  'WATE-0001,5.00,2026-10-07 09:00,张三',   // 回落 -> 25小时
].join('\n')
out = evaluateWaterLevelImport(csv2, points, store, '值班管理员')
r = out.result
assert(r.importedCount === 2, `二次导入成功 2，实际 ${r.importedCount}`)
assert(r.duplicateCount === 2, `二次重复 2，实际 ${r.duplicateCount}`)
const span3 = r.spans.find((s) => s.start.startsWith('2026-10-06'))!
assert(span3.durationMinutes === 25 * 60, `跨天越限 1天1小时 (${span3.durationMinutes})，实际 ${span3.durationMinutes}`)
assert(span3.durationLabel === '1天1小时', `时长文案，实际 ${span3.durationLabel}`)

// 场景三：表头缺列直接整体报错
const bad = '监测编号,水位读数\nWATE-0001,5.0'
out = evaluateWaterLevelImport(bad, points, {}, 'x')
assert(out.result.rejectedCount === 1 && out.result.rejections[0].line === 1, '表头缺列第1行报错')

// 场景四：空监测人使用默认值班人
const csv4 = '监测编号,水位读数,采集时间,监测人\nWATE-0003,6.00,2026-10-05 08:00,'
out = evaluateWaterLevelImport(csv4, points, {}, '值班管理员')
assert(out.updatedReadings['WATE-0003'][0].operator === '值班管理员', '默认监测人回填')

// 场景五：已经是越限态的点位导入正常读数 -> 水位正常；已采集再导入保持已采集
const csv5 = '监测编号,水位读数,采集时间,监测人\nWATE-0002,8.00,2026-10-05 10:00,李四'
const statePoints: EntryRow[] = [
  { id: 2, status: '超警戒', pending: false, abnormal: true,
    监测编号: 'WATE-0002', 监测点位: '东郊泵站前池', 水位读数: '8.60', 警戒水位: '8.50',
    采集时间: '2026-10-05 09:00', 监测人: '李四', 超标判定: '超警戒', 监测状态: '超警戒' },
]
const prev: Record<string, WaterLevelReading[]> = {
  'WATE-0002': [{ pointCode: 'WATE-0002', value: 8.6, collectedAt: '2026-10-05 09:00:00', operator: '李四' }],
}
out = evaluateWaterLevelImport(csv5, statePoints, prev, '值班管理员')
assert(out.updatedPoints[0].status === '水位正常', `超警戒->水位正常，实际 ${out.updatedPoints[0].status}`)
assert(out.updatedPoints[0].abnormal === false, '回落清除异常标记')

// 场景六：CRLF 换行、UTF-8 BOM、引号包裹字段也能解析；读数恰好等于警戒水位不算越限
const csv6 = '﻿监测编号,水位读数,采集时间,监测人\r\n"WATE-0001","5.20","2026-10-05 12:00","王五"\r\n'
out = evaluateWaterLevelImport(csv6, points, {}, '值班管理员')
assert(out.result.importedCount === 1, `BOM+CRLF+引号行正常导入，实际 ${out.result.importedCount}`)
assert(out.result.spans.length === 0, '读数等于警戒水位不算越限')
assert(out.updatedPoints[0].status === '已采集', '待采集点位导入后转已采集')

console.log('done')
