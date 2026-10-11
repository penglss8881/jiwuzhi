import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

const run = (label, args) => {
  const child = spawn(process.execPath, args, {
    stdio: 'inherit',
    shell: false,
    cwd: projectRoot,
  })

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[${label}] exited with code ${code}`)
    }
  })

  return child
}

const api = run('api', ['server.js'])
const web = run('web', [path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')])

const cleanup = () => {
  if (!api.killed) api.kill()
  if (!web.killed) web.kill()
  process.exit(0)
}

process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
