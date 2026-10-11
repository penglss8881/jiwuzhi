import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
// Use an installed browser where available; CI can use `npx playwright install chromium`.
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
export default defineConfig({
  testDir: './tests/e2e', timeout: 30000, expect: { timeout: 8000 }, fullyParallel: true, workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 1440, height: 1000 }, launchOptions: existsSync(edge) ? { executablePath: edge } : {}, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort', port: 4173, reuseExistingServer: !process.env.CI },
})
