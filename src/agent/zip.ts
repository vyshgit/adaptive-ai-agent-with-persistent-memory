// Minimal STORE-method (uncompressed) zip writer.
// Everything it writes is validated UTF-8 text far under 4 GiB, so 32-bit
// fields are safe. No data descriptors: sizes/CRC are known up front.
const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

// CRC-32 over the file data only — zips never include the name in the CRC.
function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

type Part = ArrayBuffer | Uint8Array
function length(part: Part) { return part.byteLength }

/** Build a zip archive of the given text files (paths already validated). */
export function zipFiles(files: { path: string; content: string }[]): Blob {
  const chunks: Part[] = []
  const central: Part[] = []
  const encoder = new TextEncoder()
  const directory = new Date()
  const time = ((directory.getHours() << 11) | (directory.getMinutes() << 5) | (directory.getSeconds() >> 1)) & 0xffff
  const date = (((directory.getFullYear() - 1980) << 9) | ((directory.getMonth() + 1) << 5) | directory.getDate()) & 0xffff
  const entries = files.map(file => ({ name: encoder.encode(file.path), data: encoder.encode(file.content) }))
  let offset = 0
  for (const { name, data } of entries) {
    const crc = crc32(data)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true) // zip 2.0 so UTF-8 names need no 3.0 marker
    local.setUint16(6, 0x0800, true) // UTF-8 name flag
    local.setUint16(8, 0, true) // store
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, data.byteLength, true)
    local.setUint32(22, data.byteLength, true)
    local.setUint16(26, name.byteLength, true)
    local.setUint16(28, 0, true)
    chunks.push(local.buffer, name, data)
    const header = new DataView(new ArrayBuffer(46))
    header.setUint32(0, 0x02014b50, true)
    header.setUint16(4, 20, true)
    header.setUint16(6, 20, true)
    header.setUint16(8, 0x0800, true)
    header.setUint16(10, 0, true)
    header.setUint16(12, time, true)
    header.setUint16(14, date, true)
    header.setUint32(16, crc, true)
    header.setUint32(20, data.byteLength, true)
    header.setUint32(24, data.byteLength, true)
    header.setUint16(28, name.byteLength, true)
    header.setUint32(42, offset, true)
    central.push(header.buffer, name)
    offset += 30 + name.byteLength + data.byteLength
  }
  const centralSize = central.reduce((total, part) => total + length(part), 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)
  return new Blob([...chunks, ...central, end.buffer] as unknown as BlobPart[], { type: 'application/zip' })
}
