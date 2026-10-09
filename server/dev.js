import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const commands = [
  [process.execPath, ['server/index.js']],
  [process.execPath, ['node_modules/vite/bin/vite.js']],
]
const children = commands.map(([command, args]) => spawn(command, args, {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
}))
let stopping = false

function stop(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode === null) child.kill()
  }
  process.exitCode = exitCode
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('Unable to start development process:', error)
    stop(1)
  })
  child.on('exit', (code) => stop(code || 0))
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
