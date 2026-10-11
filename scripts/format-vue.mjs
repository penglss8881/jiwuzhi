// Expand templates without changing attributes or JavaScript expressions.
import { parse } from '@vue/compiler-sfc'
import { baseParse } from '@vue/compiler-dom'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
function openingTag(source) {
  let quote = ''
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quote) { if (c === quote) quote = '' }
    else if (c === '"' || c === "'") quote = c
    else if (c === '>') return source.slice(0, i + 1)
  }
  return source
}
function print(node, level) {
  const pad = '  '.repeat(level)
  if (node.type === 2) return node.content.trim() ? pad + node.loc.source.trim() : ''
  if (node.type !== 1) return pad + node.loc.source
  const source = node.loc.source
  if (!node.children.length || node.children.every(n => n.type === 2 || n.type === 5)) return pad + source.trim()
  const children = node.children.map(n => print(n, level + 1)).filter(Boolean)
  return [pad + openingTag(source), ...children, pad + `</${node.tag}>`].join('\n')
}
async function formatDir(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) await formatDir(file)
    else if (file.endsWith('.vue')) {
      const source = await readFile(file, 'utf8')
      const { descriptor } = parse(source)
      const template = descriptor.template
      if (!template) continue
      const formatted = '\n' + baseParse(template.content).children.map(n => print(n, 1)).filter(Boolean).join('\n') + '\n'
      await writeFile(file, source.slice(0, template.loc.start.offset) + formatted + source.slice(template.loc.end.offset))
    }
  }
}
await formatDir('src')
