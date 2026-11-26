import { createHash } from 'node:crypto'

const deepseekPage = 'https://api-docs.deepseek.com/zh-cn/updates/'
const publishers = { qwen: 'Qwen', seed: 'ByteDance-Seed', meta: 'meta-llama' }
const announcements = {
  seed: [['2026-02-14', 'Seed 2.0 发布 Pro、Lite、Mini 和 Code 四个版本', 'https://seed.bytedance.com/en/blog/seed-2-0-official-launch',
    '字节跳动 Seed 发布 Seed 2.0 系列，包括 Pro、Lite、Mini 三种通用版本和面向编程的 Code 版本。']],
  meta: [['2026-07-09', 'Meta 发布 Muse Spark 1.1', 'https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/',
    'Meta 推出 Muse Spark 1.1，并在发布时开放 Meta Model API 的公开预览。']]
}
function cardRecord(product, url, date, title, description, dateBasis) {
  const key = createHash('sha256').update(url).digest('hex').slice(0, 20)
  return { id: product + '-' + key, product, url, date, dateBasis, publishedAt: null, version: '',
    highlights: [title], evidence: description }
}
export function modelCardEntries(product, cards) {
  const org = publishers[product]
  if (!org || !Array.isArray(cards)) throw new Error('模型卡目录格式异常')
  const result = []
  for (const card of cards) {
    const [owner, name, extra] = String(card.id || '').split('/')
    if (owner !== org || extra !== undefined || !/^[a-z0-9][a-z0-9._-]{0,130}$/i.test(name || '') ||
        !['text-generation', 'image-text-to-text', 'any-to-any'].includes(card.pipeline_tag) ||
        /(?:FP8|GPTQ|AWQ|GGUF|Int4|SpinQuant|QLORA|benchmark|bench$|^Llama-Guard|(?:^|-)base$)/i.test(name) ||
        !Number.isFinite(Date.parse(card.createdAt))) continue
    const url = 'https://huggingface.co/' + owner + '/' + name
    if (result.some(item => item.url === url)) continue
    const task = { 'text-generation': '文本生成', 'image-text-to-text': '图文输入、文本输出', 'any-to-any': '多模态输入输出' }[card.pipeline_tag]
    result.push(cardRecord(product, url, card.createdAt.slice(0, 10), name + ' 官方模型卡',
      owner + ' 的官方模型仓库收录了 ' + name + '，模型卡标注的任务为' + task + '。可在原文查看使用示例和许可条件。', 'card'))
    if (result.length === 6) break
  }
  if (!result.length) throw new Error('未读到官方模型卡')
  for (const [date, title, url, body] of announcements[product] || []) result.push(cardRecord(product, url, date, title, body, 'release'))
  return result
}
export async function fetchModelCards(product) {
  const query = new URLSearchParams({ author: publishers[product], sort: 'createdAt', direction: '-1', limit: '100', full: 'true' })
  const response = await request('https://huggingface.co/api/models?' + query)
  return modelCardEntries(product, await response.json())
}
const modelLogs = {
  glm: { page: 'https://docs.bigmodel.cn/cn/update/new-releases', marker: /^\*\*(\d{4})-(\d{1,2})-(\d{1,2})\*\*[ \t]*$/gm },
  kimi: { page: 'https://platform.kimi.com/docs/changelog', marker: /^\*\*(\d{4})年(\d{1,2})月\*\*[ \t]*$/gm }
}
const githubSources = {
  codex: { repo: 'openai/codex', tag: /^rust-v(\d+\.\d+\.\d+)$/ },
  claude: { repo: 'anthropics/claude-code', tag: /^v(\d+\.\d+\.\d+)$/ },
  ollama: { repo: 'ollama/ollama', tag: /^v(\d+\.\d+\.\d+)$/ }
}

async function request(url) {
  const headers = { 'User-Agent': 'AI-Update-Notebook/1.0' }
  if (new URL(url).origin === 'https://api.github.com' && process.env.GH_RELEASES_TOKEN) {
    headers.Authorization = 'Bearer ' + process.env.GH_RELEASES_TOKEN
  }
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30000)
  })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  return response
}

function plainText(markdown) {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s*\(#\d+(?:,\s*#\d+)*\)/g, '')
    .replace(/^[ \t]*[-*]\s+|[\x60*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function fetchReleases(product) {
  const { repo, tag: tagPattern } = githubSources[product]
  const releaseApi = 'https://api.github.com/repos/' + repo + '/releases'
  const entries = []
  for (let page = 1; page <= 10 && entries.length < 6; page++) {
    const response = await request(releaseApi + '?per_page=10&page=' + page)
    const releases = await response.json()
    if (!Array.isArray(releases)) throw new Error('GitHub 发布列表格式异常')
    for (const release of releases) {
      const tag = release.tag_name
      const version = tagPattern.exec(tag)?.[1]
      if (release.draft || release.prerelease || !version) continue
      if (entries.some(entry => entry.id === product + '-' + tag)) continue
      const body = release.body || ''
      const points = body.split(/\r?\n/)
        .filter(line => /^[-*] /.test(line))
        .slice(0, 3).map(plainText)
      // Model announcements can start with a heading and a paragraph before the maintenance bullets.
      if (product === 'ollama') {
        const opening = body.split(/^##\s+(?:What's Changed|Full Changelog)/im)[0]
        const lead = opening.split(/\r?\n/).find(line => /^\[?\p{L}/u.test(line.trim()))
        if (lead) points.unshift(plainText(lead))
      }
      entries.push({
        id: product + '-' + tag, product, version,
        date: new Date(Date.parse(release.published_at) + 8 * 3600000).toISOString().slice(0, 10),
        publishedAt: release.published_at,
        url: release.html_url, highlights: points,
        evidence: (release.body || '').split(/^## (?:Changelog|Contributors|Full Changelog)/mi)[0].slice(0, 4200)
      })
    }
    if (releases.length < 10) break
  }
  return entries.slice(0, 6)
}

export async function fetchDeepSeek() {
  const response = await request('https://api-docs.deepseek.com/zh-cn/updates.md')
  const markdown = (await response.text()).replace(/\r\n/g, '\n')
  const blocks = [...markdown.matchAll(/^##\s+时间\s*[:：]\s*(\d{4}-\d{2}-\d{2})[ \t]*$/gm)]
  return blocks.slice(0, 6).map((block, index) => {
    const section = markdown.slice(block.index + block[0].length, blocks[index + 1]?.index)
    const headings = [...section.matchAll(/^###\s+(.+)$/gm)].map(match => plainText(match[1]))
    const firstParagraph = section.split(/\n\s*\n/).map(text => text.trim())
      .find(text => /^[\p{L}\d]/u.test(text))
    return {
      id: 'deepseek-' + block[1], product: 'deepseek', version: '',
      date: block[1], publishedAt: null,
      url: deepseekPage + '#' + encodeURIComponent('时间-' + block[1]),
      highlights: headings.length ? headings : [plainText(firstParagraph || '查看官方更新日志')],
      evidence: section.trim().slice(0, 4200)
    }
  })
}

export function parseModelLog(product, markdown) {
  const { page, marker } = modelLogs[product]
  const source = markdown.replace(/\r\n?/g, '\n')
  const sections = [...source.matchAll(marker)]
  const records = []
  for (const [i, header] of sections.entries()) {
    const [, year, month, day] = header
    const date = [year, month.padStart(2, '0'), ...(day ? [day.padStart(2, '0')] : [])].join('-')
    if (+month < 1 || +month > 12 || (day && (!Date.parse(date) || new Date(date).toISOString().slice(0, 10) !== date))) continue
    const body = source.slice(header.index + header[0].length, sections[i + 1]?.index).split(/^##\s/m)[0].trim()
    const clean = line => plainText(line.replace(/^(?:###\s+|[-*]\s+)/, '').replace(/^[^\p{L}\d]+/u, '').replace(/[<>]/g, ''))
    const lines = body.split('\n').filter(line => line.trim())
    const titles = product === 'glm' ? lines.slice(0, 1) : lines.filter(line => /^### /.test(line))
    const bullets = lines.filter(line => /^[-*] /.test(line))
    const highlights = (titles.length ? titles : bullets).map(clean).filter(Boolean)
    if (!highlights.length || (product === 'glm' && !/\bGLM\b/i.test(highlights[0]))) continue
    const description = (product === 'glm' ? bullets : lines.filter(line => !/^#/.test(line))).map(clean).filter(Boolean)
    const anchor = day ? [year, month, day].join('-') : year + '年' + month + '月'
    records.push({ id: product + '-' + date, product, date, version: '', publishedAt: null,
      url: page + '#' + encodeURIComponent(anchor), highlights,
      evidence: (description.join('\n\n') || highlights.join('\n\n')).slice(0, 4200) })
    if (records.length === 6) break
  }
  return records
}

export async function fetchModelLog(product) {
  const response = await request(modelLogs[product].page + '.md')
  return parseModelLog(product, await response.text())
}

