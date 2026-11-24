import { collect, publicFeed } from './pipeline.mjs'
import { startRunnerModel, stopRunnerModel } from './runner-model.mjs'
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('./', import.meta.url))
const feedFile = path.join(root, 'state.json')
async function readPrevious() {
  try { return JSON.parse(await readFile(feedFile, 'utf8')) }
  catch (error) {
    if (error.code === 'ENOENT') return { sources: {}, entries: [] }
    throw error
  }
}

const previous = await readPrevious()
const useRunner = process.env.NOTEBOOK_RUNNER_MODEL === '1'
let modelReady
const generate = (process.env.NOTEBOOK_MODEL_URL || useRunner) ? async messages => {
  if (useRunner) await (modelReady ||= startRunnerModel())
  const url = useRunner ? 'http://127.0.0.1:19842/v1/chat/completions' : process.env.NOTEBOOK_MODEL_URL
  const headers = { 'Content-Type': 'application/json' }
  if (process.env.NOTEBOOK_MODEL_KEY) headers.Authorization = 'Bearer ' + process.env.NOTEBOOK_MODEL_KEY
  const response = await fetch(url, {
    method: 'POST', headers, signal: AbortSignal.timeout(120000),
    body: JSON.stringify({ model: useRunner ? 'notebook-qwen' : process.env.NOTEBOOK_MODEL_NAME, messages, temperature: 0, max_tokens: 500,
      response_format: { type: 'json_schema', json_schema: { name: 'release_guide', strict: true,
        schema: { type: 'object', properties: Object.fromEntries(['title','summary','audience','action'].map(k => [k,{ type: 'string' }])),
          required: ['title','summary','audience','action'], additionalProperties: false } } } })
  })
  if (!response.ok) throw new Error('模型请求失败 ' + response.status)
  return (await response.json()).choices[0].message.content
} : undefined
let collected
try { collected = await collect(previous, { generate }) }
finally { stopRunnerModel() }
const { snapshot, warnings, calls, successes } = collected
for (const warning of warnings) console.warn(warning)
console.log('导读模型调用 ' + calls + ' 次')
await mkdir(path.dirname(feedFile), { recursive: true })
const temporary = feedFile + '.' + randomUUID() + '.tmp'
try {
  await writeFile(temporary, JSON.stringify(snapshot, null, 2) + '\n')
  await rename(temporary, feedFile)
} finally {
  await rm(temporary, { force: true })
}
console.log('已保存 ' + snapshot.entries.length + ' 条，新增 ' + (snapshot.entries.length - previous.entries.length) + ' 条')
const site = path.join(root, 'site')
await mkdir(site, { recursive: true })
await writeFile(path.join(site, 'feed.json'), JSON.stringify(publicFeed(snapshot)) + '\n')
await writeFile(path.join(site, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>更新簿</title><h1>更新簿</h1><p>Codex CLI 与 DeepSeek API 的官方更新及中文导读。</p><a href="./feed.json">读取更新列表（JSON）</a></html>')
if (process.env.GITHUB_OUTPUT) {
  const changed = JSON.stringify(previous.entries) !== JSON.stringify(snapshot.entries) ||
    Object.keys(snapshot.sources).some(key => previous.sources[key]?.available !== snapshot.sources[key].available)
  const { appendFile } = await import('node:fs/promises')
  await appendFile(process.env.GITHUB_OUTPUT, 'changed=' + changed + '\n')
}
if (!successes) throw new Error('两个来源均未成功，继续保留上次发布的数据')
