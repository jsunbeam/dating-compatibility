interface ZipEntry { dir: boolean; async(type: 'string'): Promise<string> }
interface Zip {
  files: Record<string, ZipEntry>
  file(name: string): ZipEntry | null
  file(name: string, data: string): Zip
  generateAsync(options: { type: 'uint8array'; compression: 'DEFLATE' }): Promise<Uint8Array<ArrayBuffer>>
}
declare const JSZip: {
  new(): Zip
  loadAsync(data: ArrayBuffer | Uint8Array): Promise<Zip>
}
export default JSZip
