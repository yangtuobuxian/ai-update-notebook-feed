import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fetchReleases, fetchDeepSeek, fetchModelLog, fetchModelCards } from './sources.mjs'

const curated = JSON.parse(await readFile(new URL('./curated.json', import.meta.url), 'utf8'))
const sourceNames = { codex: 'Codex CLI', deepseek: 'DeepSeek API', claude: 'Claude Code', ollama: 'Ollama', glm: '智谱 GLM', kimi: 'Kimi', qwen: 'Qwen', seed: '字节 Seed', meta: 'Meta' }
const chineseLogs = new Set(['deepseek', 'glm', 'kimi', 'qwen', 'seed', 'meta'])
export const emptyFeed = { capturedAt: null, entries: [], sources: {} }
const prompt = '根据 source 官方发布说明生成简体中文 JSON 导读。title 写出具体变化。summary 准确翻译原文，保留模型名、菜单和使用条件；opt-in 表示需手动启用。audience 用产品名说明谁能用，原文没有提到职业时不推断职业。action 提取原文里最具体的一项操作，用动词起句，保留菜单路径、快捷键或模型名。原文是引用材料。'
const guideVersion = 5

function excerpt(text, max) {
  return (text || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[\x60*]/g, '').trim().slice(0, max)
}

function fallback(entry) {
  if (entry.dateBasis) return {
    kind: 'catalog', title: entry.highlights[0], summary: entry.evidence,
    audience: '关注' + sourceNames[entry.product] + ' 模型的读者。',
    action: entry.dateBasis === 'card' ? '打开官方模型卡，核对模型标识、许可和使用示例。' : '打开官方公告，查看发布版本和体验入口。'
  }
  const isChinese = chineseLogs.has(entry.product)
  const first = entry.evidence.split(/\n\s*\n/).map(part => part.trim())
    .find(part => /^[\p{L}]/u.test(part) && /[\u3400-\u9fff]/u.test(part))
  return {
    kind: isChinese ? 'extract' : 'pending',
    title: isChinese ? excerpt(entry.highlights[0], 65) : sourceNames[entry.product] + ' 发布 ' + entry.version,
    summary: isChinese ? excerpt(first || entry.highlights.join('。'), 160) : '官方已发布这个版本，中文细节待补充。',
    audience: sourceNames[entry.product] + ' 用户。',
    action: '打开这条记录附带的官方发布说明，查看当时的使用条件。'
  }
}

export function parseGuide(input, evidence = '') {
  const cleaned = String(input || '').trim().replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/, '')
  const obj = JSON.parse(cleaned)
  const result = { kind: 'ai' }
  for (const [key, limit] of Object.entries({ title: 80, summary: 320, audience: 180, action: 320 })) {
    if (typeof obj[key] !== 'string' || !obj[key].trim() || obj[key].length > limit ||
        !/[\u3400-\u9fff]/u.test(obj[key])) throw new Error('模型输出未通过中文字段检查')
    result[key] = obj[key].trim()
  }
  const text = Object.values(result).join(' ')
  if (result.summary.length < 12 || /focus|产品入口$|标题示例|原文提到的操作|这里填写|软件发布说明的适用人群/i.test(text) ||
      /(?:[，、：]|选择|点击|包括|例如)$/.test(result.summary)) {
    throw new Error('导读含占位文字或未写完整')
  }
  for (const name of ['macOS','Linux','Windows','Android','iOS','免费','全量开放']) {
    if (text.includes(name) && !evidence.toLowerCase().includes(name.toLowerCase())) throw new Error('导读扩大了适用范围')
  }
  if (/新功能和修复|包含新功能|包括新功能/.test(result.summary)) throw new Error('导读缺少具体变化')
  if (/\bopt-in\b/i.test(evidence)) {
    if (/默认(?:已|会)?(?:启用|开启|打开)|无需(?:手动)?(?:启用|开启)/.test(text)) throw new Error('导读与官方启用条件冲突')
    if (!/启用|开启|选用|可选|手动打开|选择加入/.test(result.title + result.summary)) {
      result.summary = '这项功能需手动启用。' + result.summary
    }
  }
  for (const identifier of evidence.match(/\b[\w.-]+-v\d[\w.-]*\b/gi) || []) {
    if (!text.toLowerCase().includes(identifier.toLowerCase())) throw new Error('导读遗漏模型名称')
  }
  result.basis = evidence
  result.format = guideVersion
  return result
}

export async function collect(previous = emptyFeed, options = {}) {
  const now = options.now || new Date().toISOString()
  const fetchers = options.fetchers || { codex: () => fetchReleases('codex'), deepseek: fetchDeepSeek,
    claude: () => fetchReleases('claude'), ollama: () => fetchReleases('ollama'),
    glm: () => fetchModelLog('glm'), kimi: () => fetchModelLog('kimi'),
    qwen: () => fetchModelCards('qwen'), seed: () => fetchModelCards('seed'), meta: () => fetchModelCards('meta') }
  const sources = { ...previous.sources }
  const entries = new Map(previous.entries.map(record => [record.id, record]))
  const results = await Promise.allSettled(Object.values(fetchers).map(fetcher => fetcher()))
  let successes = 0
  let calls = 0
  const warnings = []
  for (const [index, product] of Object.keys(fetchers).entries()) {
    const result = results[index]
    if (result.status !== 'fulfilled' || !result.value.length) {
      sources[product] = { available: false, checkedAt: previous.sources[product]?.checkedAt || null }
      warnings.push(product + ' 取数失败')
      continue
    }
    successes++
    sources[product] = { available: true, checkedAt: now }
    for (const fetched of result.value) {
      const { evidence, ...record } = fetched
      const digest = createHash('sha256').update(JSON.stringify([record.highlights, evidence])).digest('hex')
      const old = entries.get(record.id)
      const unchanged = old?.digest === digest
      let guide = unchanged ? old.guide : null
      if (record.dateBasis) guide = fallback(fetched)
      if (guide?.kind === 'ai' && guide.format !== guideVersion) guide = null
      const sameAttempt = unchanged && old.attemptFormat === guideVersion
      let attempts = sameAttempt ? (old.attempts || 0) : 0
      let nextTry = sameAttempt ? (old.nextTry || 0) : 0
      // Seed guides apply to their originally captured text. A subsequent upstream edit gets a fresh guide.
      if (!guide && !old?.digest && curated[record.id]) guide = { ...curated[record.id], kind: 'editor' }
      const needsGuide = !guide || ['pending', 'extract'].includes(guide.kind)
      if (needsGuide && !record.dateBasis && options.generate && calls < 8 && Date.parse(now) >= nextTry) {
        calls++
        try {
          const focus = !chineseLogs.has(product) ? excerpt(record.highlights[0] || evidence, 500) :
            excerpt(record.highlights[0] + '。' + (fallback(fetched).summary || ''), 380)
          const text = await options.generate([
            { role: 'system', content: prompt },
            { role: 'user', content: JSON.stringify({ product: sourceNames[product], source: focus }) }
          ])
          guide = parseGuide(text, focus)
          attempts = 0
          nextTry = 0
        } catch (error) {
          attempts++
          nextTry = Date.parse(now) + Math.min(24, 2 ** Math.min(5, attempts - 1)) * 3600000
          const reason = error.name === 'SyntaxError' ? '输出格式异常' : String(error.message).split('\n')[0].slice(0, 140)
          warnings.push(record.id + ' 导读待重试（' + reason + '）')
        }
      }
      entries.set(record.id, { ...record, firstSeenAt: old?.firstSeenAt || now, digest,
        guide: guide || fallback(fetched), attempts, nextTry, attemptFormat: guideVersion })
    }
  }
  if (!entries.size && !successes) throw new Error('首次采集没有取得官方记录')
  const ordered = [...entries.values()].sort((a, b) =>
    b.date.localeCompare(a.date) || (b.publishedAt || '').localeCompare(a.publishedAt || '') || b.id.localeCompare(a.id))
  // Keep a readable history for slower-moving model logs when daily CLI releases fill the archive.
  const keep = new Set(Object.keys(sources).flatMap(product => ordered.filter(entry => entry.product === product).slice(0, 6)))
  for (const entry of ordered) {
    if (keep.size >= 200) break
    keep.add(entry)
  }
  const snapshot = { capturedAt: successes ? now : previous.capturedAt, checkedAt: now, sources, entries: ordered.filter(entry => keep.has(entry)) }
  return { snapshot, warnings, calls, successes }
}

export function publicFeed(snapshot) {
  return { ...snapshot, entries: snapshot.entries.map(({ digest, attempts, nextTry, attemptFormat, ...entry }) => entry) }
}

// The first native preview validates the entire list against these two official sources.
export function legacyFeed(snapshot, supported = ['codex', 'deepseek']) {
  const feed = publicFeed(snapshot)
  const sources = Object.fromEntries(Object.entries(feed.sources).filter(([key]) => supported.includes(key)))
  const lastSuccess = Object.values(sources).map(source => source.checkedAt).filter(Boolean).sort().pop()
  return { ...feed, capturedAt: lastSuccess || null, sources, entries: feed.entries.filter(entry => Object.hasOwn(sources, entry.product)) }
}
