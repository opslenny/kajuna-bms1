import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const keyLength = 64
const cost = 16_384

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const key = await scrypt(password, salt, keyLength, { N: cost, r: 8, p: 1 })
  return `scrypt$${cost}$${salt}$${Buffer.from(key).toString('hex')}`
}

export async function verifyPassword(password, encoded) {
  const [algorithm, encodedCost, salt, expectedHex] = encoded.split('$')
  if (algorithm !== 'scrypt' || Number(encodedCost) !== cost || !salt || !/^[a-f0-9]{128}$/i.test(expectedHex ?? '')) {
    return false
  }
  const expected = Buffer.from(expectedHex, 'hex')
  const actual = Buffer.from(await scrypt(password, salt, expected.length, { N: cost, r: 8, p: 1 }))
  return timingSafeEqual(actual, expected)
}
