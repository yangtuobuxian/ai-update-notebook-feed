const deepseekPage = 'https://api-docs.deepseek.com/zh-cn/updates/'
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

