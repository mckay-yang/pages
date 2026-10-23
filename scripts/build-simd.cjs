// Build the register-only SIMD kernels with the installed Clang; no packages or linker required.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'burn-simd-'));
function leb(value) {
  const bytes = [];
  do { const byte = value & 127; value >>>= 7; bytes.push(byte | (value ? 128 : 0)); } while(value);
  return bytes;
}
try {
  const object = path.join(temp, 'kernel.o');
  execFileSync(process.env.CLANG || 'clang', ['--target=wasm32', '-msimd128', '-O3', '-ffp-contract=off', '-c', path.join(root, 'src/burn-simd.c'), '-o', object]);
  const input = fs.readFileSync(object), sections = [];
  let offset = 8;
  function readLeb() {
    let value = 0, shift = 0, byte;
    do { byte = input[offset++]; value |= (byte & 127) << shift; shift += 7; } while(byte & 128);
    return value;
  }
  while(offset < input.length) {
    const start = offset, id = input[offset++], length = readLeb(); offset += length;
    if(id !== 0 && id !== 7) sections.push({ id, bytes: input.subarray(start, offset) });
  }
  // These kernels have no external calls, globals, data relocations or stack accesses.
  // Add exports to the standard Wasm object and validate both function identities below.
  const names = ['float_kernel', 'integer_kernel'];
  const exports = [2, ...names.flatMap((name, i) => [...leb(name.length), ...Buffer.from(name), 0, ...leb(i)])];
  const result = [input.subarray(0, 8)]; let added = false;
  for(const section of sections) {
    if(section.id >= 10 && !added) { result.push(Buffer.from([7, ...leb(exports.length), ...exports])); added = true; }
    result.push(section.bytes);
  }
  const binary = Buffer.concat(result), module = new WebAssembly.Module(binary);
  if(WebAssembly.Module.imports(module).some(item => item.module !== 'env' || item.name !== '__linear_memory' || item.kind !== 'memory')) throw Error('Unexpected kernel imports; use register-only functions');
  const { exports: kernels } = new WebAssembly.Instance(module, { env: { __linear_memory: new WebAssembly.Memory({ initial: 2 }) } });
  if(Math.abs(kernels.float_kernel(200000, .5) - 51.93329620361328) > .00001 || kernels.integer_kernel(100000, 7) !== 1131745732) throw Error('Kernel export or arithmetic verification failed');
  const file = path.join(root, 'docs/index.html'), html = fs.readFileSync(file, 'utf8');
  const pattern = /const simdBinary = '[A-Za-z0-9+/=]*';/;
  if(!pattern.test(html)) throw Error('Missing embedded SIMD marker');
  fs.writeFileSync(file, html.replace(pattern, "const simdBinary = '" + binary.toString('base64') + "';"));
  console.log(`Embedded ${binary.length} bytes of validated SIMD kernels`);
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
