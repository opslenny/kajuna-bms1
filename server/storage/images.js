import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const storageRoot = path.resolve(process.env.IMAGE_STORAGE_DIR || path.resolve(process.cwd(), 'data', 'images'))
const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const storageProvider = process.env.IMAGE_STORAGE_PROVIDER || (process.env.VERCEL ? 'supabase' : 'filesystem')
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '')
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET || 'bms-images'

if (!['filesystem', 'supabase'].includes(storageProvider)) {
  throw new Error('IMAGE_STORAGE_PROVIDER must be filesystem or supabase.')
}
if (storageProvider === 'supabase' && (!supabaseUrl || !supabaseSecretKey)) {
  throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required when IMAGE_STORAGE_PROVIDER=supabase.')
}
if (storageProvider === 'supabase') {
  const parsedUrl = new URL(supabaseUrl)
  if (parsedUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsedUrl.hostname)) {
    throw new Error('SUPABASE_URL must use HTTPS.')
  }
}

function storagePath(key) {
  if (typeof key !== 'string' || key.includes('..') || key.startsWith('/') || key.includes('\\')) return null
  const absolutePath = path.resolve(storageRoot, key)
  if (!absolutePath.startsWith(`${storageRoot}${path.sep}`)) return null
  return absolutePath
}

function supabaseObjectUrl(key, access = '') {
  const bucket = encodeURIComponent(supabaseBucket)
  const prefix = access ? `/${access}` : ''
  if (!key) return `${supabaseUrl}/storage/v1/object${prefix}/${bucket}`
  const encodedKey = key.split('/').map(encodeURIComponent).join('/')
  return `${supabaseUrl}/storage/v1/object${prefix}/${bucket}/${encodedKey}`
}

async function supabaseRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: supabaseSecretKey,
      Authorization: `Bearer ${supabaseSecretKey}`,
      ...options.headers,
    },
  })
  return response
}

async function requireSupabaseSuccess(response, action) {
  if (response.ok) return
  const details = (await response.text()).slice(0, 500)
  throw new Error(`Supabase Storage ${action} failed (${response.status}): ${details}`)
}

export async function storeUserImage(ownerType, ownerId, image, mimeType) {
  if (!['businesses', 'users', 'products'].includes(ownerType) || !idPattern.test(ownerId) || !extensions[mimeType]) {
    throw new Error('Invalid image storage identity.')
  }
  const key = `${ownerType}/${ownerId}/${randomUUID()}.${extensions[mimeType]}`
  if (storageProvider === 'supabase') {
    const response = await supabaseRequest(supabaseObjectUrl(key), {
      method: 'POST',
      headers: { 'Content-Type': mimeType, 'x-upsert': 'false' },
      body: image,
    })
    await requireSupabaseSuccess(response, 'upload')
    return key
  }

  const absolutePath = storagePath(key)
  await mkdir(path.dirname(absolutePath), { recursive: true, mode: 0o700 })
  await writeFile(absolutePath, image, { mode: 0o600, flag: 'wx' })
  return key
}

export async function readUserImage(ownerType, ownerId, key) {
  if (!['businesses', 'users', 'products'].includes(ownerType) || !idPattern.test(ownerId)
    || typeof key !== 'string' || !key.startsWith(`${ownerType}/${ownerId}/`)
    || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(key.slice(`${ownerType}/${ownerId}/`.length))) {
    return null
  }
  if (storageProvider === 'supabase') {
    const response = await supabaseRequest(supabaseObjectUrl(key, 'authenticated'))
    if (response.status === 404) return null
    await requireSupabaseSuccess(response, 'download')
    return Buffer.from(await response.arrayBuffer())
  }

  try {
    return await readFile(storagePath(key))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

export async function removeStoredImage(key) {
  if (storageProvider === 'supabase') {
    const safeKey = safeStorageKey(key)
    const response = await supabaseRequest(supabaseObjectUrl(null), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [safeKey] }),
    })
    await requireSupabaseSuccess(response, 'delete')
    return
  }

  const absolutePath = storagePath(key)
  if (!absolutePath) return
  await rm(absolutePath, { force: true })
}

function safeStorageKey(key) {
  if (typeof key !== 'string') throw new Error('Invalid image storage key.')
  const [ownerType, ownerId, filename, ...extra] = key.split('/')
  if (extra.length || !['businesses', 'users', 'products'].includes(ownerType)
    || !idPattern.test(ownerId) || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(filename)) {
    throw new Error('Invalid image storage key.')
  }
  return key
}
