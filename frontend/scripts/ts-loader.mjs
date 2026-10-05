// 仅用于本地脚本跑 TS：把 @/ 别名解析到 src，并把 .ts 用 typescript 转译成 JS。
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const tsPath = require.resolve('typescript')
const tsLib = require(tsPath)
const srcRoot = pathToFileURL(`${process.cwd()}/src/`).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const candidate = new URL(specifier.slice(2), srcRoot).pathname
    for (const tryPath of [candidate, `${candidate}.ts`, `${candidate}/index.ts`]) {
      if (existsSync(tryPath)) {
        return { url: pathToFileURL(tryPath).href, shortCircuit: true }
      }
    }
  }
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !specifier.endsWith('.mts')) {
    const base = context.parentURL
    const candidate = fileURLToPath(new URL(specifier, base))
    for (const tryPath of [candidate, `${candidate}.ts`, `${candidate}/index.ts`]) {
      if (existsSync(tryPath)) {
        return { url: pathToFileURL(tryPath).href, shortCircuit: true }
      }
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const source = readFileSync(fileURLToPath(url), 'utf8')
    const { outputText } = tsLib.transpileModule(source, {
      compilerOptions: { module: tsLib.ModuleKind.ESNext, target: tsLib.ScriptTarget.ES2020 },
      fileName: fileURLToPath(url),
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  }
  return nextLoad(url, context)
}
