import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
await build({ root, configFile: false, plugins: [react()], build: { outDir: 'dist' } })
