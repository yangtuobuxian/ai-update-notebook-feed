import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const run = promisify(execFile)
let server

export async function startRunnerModel() {
  const work = await mkdtemp(join(tmpdir(), 'notebook-model-'))
  const script = fileURLToPath(new URL('./prepare-model.sh', import.meta.url))
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C.UTF-8' }
  console.log('正在为新导读加载 Qwen3-4B')
  const prepared = await run('bash', [script, work], { env, timeout: 8 * 60000 })
  const binary = prepared.stdout.trim()
  server = spawn(binary, ['--model', join(work, 'model.gguf'), '--host', '127.0.0.1',
    '--port', '19842', '--alias', 'notebook-qwen', '--parallel', '1', '--ctx-size', '4096',
    '--threads', '4', '--reasoning', 'off'], {
    env: { ...env, LD_LIBRARY_PATH: dirname(binary) }, stdio: ['ignore', 'ignore', 'inherit']
  })
  let error
  server.on('error', value => { error = value })
  for (let attempt = 0; attempt < 80; attempt++) {
    if (error || server.exitCode !== null) throw new Error('导读模型启动失败', { cause: error })
    try {
      const response = await fetch('http://127.0.0.1:19842/health', { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch { /* The listener starts after the model is loaded. */ }
    await delay(1000)
  }
  throw new Error('导读模型启动超时')
}

export function stopRunnerModel() { server?.kill() }
