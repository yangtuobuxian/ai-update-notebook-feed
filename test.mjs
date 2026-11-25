import test from 'node:test'
import assert from 'node:assert/strict'
import { collect, emptyFeed, legacyFeed, parseGuide, publicFeed } from './pipeline.mjs'
import { parseModelLog } from './sources.mjs'

test('GLM 规范化日期但保留原文锚点，过滤无关发布；Kimi 按月收录并支持没有小标题的月份', () => {
  const glm = parseModelLog('glm', '**2026-8-19**\r\n\r\nGLM-5.3 上线\r\n* 新版模型支持更长代码。\r\n**2026-08-18**\r\n其他产品上线')
  assert.equal(glm.length, 1)
  assert.equal(glm[0].date, '2026-08-19')
  assert.ok(glm[0].url.endsWith('#2026-8-19'))
  const kimi = parseModelLog('kimi', '**2026年10月**\n### 新模型上线\n模型支持长文。\n### 批处理\n新增模型。\n**2026年8月**\n* 文件接口升级')
  assert.deepEqual(kimi.map(record => record.date), ['2026-10', '2026-08'])
  assert.deepEqual(kimi[0].highlights, ['新模型上线', '批处理'])
  assert.equal(kimi[1].highlights[0], '文件接口升级')
  assert.equal(decodeURIComponent(kimi[0].url).split('#')[1], '2026年10月')
  assert.deepEqual(parseModelLog('kimi', '<html>wrong page</html>'), [])
})

test('快照满额时仍保留低频模型更新，四来源旧版继续收到兼容记录', async () => {
  const busy = Array.from({ length: 205 }, (_, i) => entry('release-' + i))
  const monthly = { ...deep, id: 'kimi-2025-11', product: 'kimi', date: '2025-11' }
  const { snapshot } = await collect(emptyFeed, { fetchers: { ...fetchers(busy), kimi: async () => [monthly] } })
  assert.equal(snapshot.entries.length, 200)
  assert.ok(snapshot.entries.some(item => item.id === monthly.id))
  const old = legacyFeed(snapshot, ['codex', 'claude', 'deepseek', 'ollama'])
  assert.equal(old.sources.kimi, undefined)
  assert.ok(!old.entries.some(item => item.product === 'kimi'))
})

const t0 = '2026-01-01T00:00:00.000Z'
const later = '2026-01-01T01:00:00.000Z'
const cn = { title: '可以切换会话', summary: '新版增加了在终端切换会话的操作。', audience: '终端用户。', action: '打开会话菜单，选择需要的会话。' }
const entry = (id, patch = {}) => ({
  id, product: 'codex', version: '1.0.0', date: '2026-01-01', publishedAt: t0,
  highlights: ['Switch between sessions in the terminal.'], evidence: 'Switch between sessions in the terminal.',
  url: 'https://github.com/openai/codex/releases/tag/rust-v1.0.0', ...patch
})
const deep = entry('deepseek-example', { product: 'deepseek', version: '', highlights: ['模型更新'],
  evidence: '此版本改进模型的中文回答。', url: 'https://api-docs.deepseek.com/zh-cn/updates/#example' })
const fetchers = entries => ({ codex: async () => entries, deepseek: async () => [deep] })
const generator = async () => JSON.stringify(cn)

test('新版收录其他产品时，旧版订阅仍只收到已支持的来源和成功时间', async () => {
  const original = await collect(emptyFeed, { now: t0, fetchers: fetchers([entry('test-1')]) })
  const newer = await collect(original.snapshot, { now: later, fetchers: {
    codex: async () => [], deepseek: async () => [], claude: async () => [entry('test-claude', { product: 'claude' })]
  } })
  assert.equal(publicFeed(newer.snapshot).entries.length, 3)
  assert.equal(newer.snapshot.entries.find(item => item.product === 'claude').guide.title, 'Claude Code 发布 1.0.0')
  const old = legacyFeed(newer.snapshot)
  assert.equal(old.capturedAt, t0)
  assert.deepEqual(Object.keys(old.sources).sort(), ['codex', 'deepseek'])
  assert.deepEqual(old.entries.map(item => item.product).sort(), ['codex', 'deepseek'])
})

test('重复采集不重复生成，同一发布被修改后会重写导读并保留首次收录时间', async () => {
  const original = entry('test-1')
  const start = await collect(emptyFeed, { now: t0, fetchers: fetchers([original]), generate: generator })
  assert.equal(start.calls, 2)
  const same = await collect(start.snapshot, { now: later, fetchers: fetchers([original]), generate: generator })
  assert.equal(same.calls, 0)
  assert.equal(same.snapshot.entries.length, 2)
  const changed = await collect(same.snapshot, { now: later, fetchers: fetchers([{ ...original, evidence: 'Updated notes.' }]), generate: generator })
  assert.equal(changed.calls, 1)
  assert.equal(changed.snapshot.entries.find(x => x.id === original.id).firstSeenAt, t0)
})

test('单个来源中断保留其历史记录和上次成功时间', async () => {
  const start = await collect(emptyFeed, { now: t0, fetchers: fetchers([entry('test-1')]) })
  const offline = await collect(start.snapshot, { now: later, fetchers: {
    codex: async () => { throw new Error('timeout') }, deepseek: async () => [deep]
  } })
  assert.equal(offline.successes, 1)
  assert.deepEqual(offline.snapshot.sources.codex, { available: false, checkedAt: t0 })
  assert.equal(offline.snapshot.entries.length, 2)
  assert.equal(offline.snapshot.sources.deepseek.checkedAt, later)
})

test('全部中断保留上次的成功时间，首次全空则报告失败', async () => {
  const start = await collect(emptyFeed, { now: t0, fetchers: fetchers([entry('test-1')]) })
  const none = { codex: async () => [], deepseek: async () => [] }
  const result = await collect(start.snapshot, { now: later, fetchers: none })
  assert.equal(result.snapshot.capturedAt, t0)
  assert.equal(result.snapshot.checkedAt, later)
  assert.equal(result.successes, 0)
  await assert.rejects(collect(emptyFeed, { now: later, fetchers: none }), /首次采集/)
})

test('无效导读回退为官方中文摘录或待补充，按时间重试', async () => {
  const source = fetchers([entry('test-1')])
  const fail = await collect(emptyFeed, { now: t0, fetchers: source, generate: async () => '无效' })
  assert.deepEqual(fail.snapshot.entries.map(x => x.guide.kind).sort(), ['extract','pending'])
  const early = await collect(fail.snapshot, { now: '2026-01-01T00:30:00.000Z', fetchers: source, generate: generator })
  assert.equal(early.calls, 0)
  const recovered = await collect(early.snapshot, { now: later, fetchers: source, generate: generator })
  assert.equal(recovered.calls, 2)
  assert.ok(recovered.snapshot.entries.every(x => x.guide.kind === 'ai'))
})

test('导读验证覆盖语言、使用范围、启用条件和模型标识', () => {
  assert.equal(parseGuide(JSON.stringify(cn), 'Switch sessions.').basis, 'Switch sessions.')
  assert.match(parseGuide(JSON.stringify(cn), 'An opt-in feature.').summary, /需手动启用/)
  for (const [value, evidence] of [
    [{ ...cn, summary: 'The release switches sessions.' }, 'Switch sessions.'],
    [{ ...cn, summary: '可在 Linux 终端中使用新的切换会话操作。' }, 'Switch sessions.'],
    [{ ...cn, summary: '新版默认开启终端中切换会话的功能。' }, 'An opt-in feature.'], [cn, 'Use deepseek-v4-pro.'],
    [{ ...cn, summary: '点击终端中的会话菜单，再选择' }, 'Switch sessions.']
  ]) assert.throws(() => parseGuide(JSON.stringify(value), evidence))
})

test('单轮限额及对外只读数据', async () => {
  const batch = Array.from({ length: 10 }, (_, i) => entry('test-' + i))
  const result = await collect(emptyFeed, { now: t0, fetchers: fetchers(batch), generate: generator })
  assert.equal(result.calls, 8)
  const pub = publicFeed(result.snapshot)
  assert.equal(pub.entries.length, 11)
  for (const x of pub.entries) for (const key of ['digest', 'attempts', 'nextTry', 'attemptFormat']) assert.equal(Object.hasOwn(x, key), false)
  assert.ok(pub.entries.every(x => x.url.startsWith('https://')))
})
