import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const imageRoot = path.resolve(process.env.IMAGE_STORAGE_DIR || path.resolve(process.cwd(), 'data', 'images'))
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '')
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'bms-images'
const contentTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }

if (!supabaseUrl || !secretKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required.')
}
if (new URL(supabaseUrl).protocol !== 'https:') {
  throw new Error('SUPABASE_URL must use HTTPS.')
}

async function collectImages(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectImages(fullPath))
    } else if (entry.isFile()) {
      files.push(fullPath)
    } else {
      throw new Error(`Unsupported filesystem entry in image directory: ${fullPath}`)
    }
  }
  return files
}

async function uploadImage(file) {
  const contentType = contentTypes[path.extname(file).toLowerCase()]
  if (!contentType) throw new Error(`Unsupported image format: ${file}`)

  const key = path.relative(imageRoot, file).split(path.sep).join('/')
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedKey}`, {
    method: 'POST',
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: await readFile(file),
  })

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500)
    throw new Error(`Supabase Storage upload failed for ${key} (${response.status}): ${details}`)
  }
  console.info(`Uploaded ${key}`)
}

try {
  const files = await collectImages(imageRoot)
  for (const file of files) await uploadImage(file)
  console.info(`Uploaded ${files.length} image(s) to Supabase Storage bucket "${bucket}".`)
} catch (error) {
  console.error('Image migration failed:', error.message)
  process.exitCode = 1
}
