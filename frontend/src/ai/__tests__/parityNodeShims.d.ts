// The two Node built-ins the selector parity test reads its cases with. The
// app's tsconfig carries no Node types, and vitest runs under Node.
declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array;
  export function writeFileSync(path: string | URL, data: string): void;
}
declare module 'node:zlib' {
  export function gunzipSync(buf: Uint8Array): Uint8Array;
}
