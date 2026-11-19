export type Sealed = { iv: string; ciphertext: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0))
}

export async function deriveKey(password: string, salt: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: decode(salt), iterations: 600_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function seal(key: CryptoKey, label: string, value: unknown): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(label) }, key, encoder.encode(JSON.stringify(value)),
  )
  return { iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) }
}

export async function unseal<T>(key: CryptoKey, label: string, value: Sealed): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decode(value.iv), additionalData: encoder.encode(label) }, key, decode(value.ciphertext),
  )
  return JSON.parse(decoder.decode(plaintext)) as T
}
