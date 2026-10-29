import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: process.env.WEB_TEST_URL || 'http://127.0.0.1:3000',
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  ...(process.env.CHROMIUM_PATH
    ? {
        use: {
          baseURL: process.env.WEB_TEST_URL || 'http://127.0.0.1:3000',
          headless: true,
          trace: 'retain-on-failure' as const,
          launchOptions: { executablePath: process.env.CHROMIUM_PATH },
        },
      }
    : {}),
  reporter: 'list',
});
