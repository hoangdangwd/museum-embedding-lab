import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',workers:1,fullyParallel:false,timeout:30000,
  use:{baseURL:'http://127.0.0.1:4179',viewport:{width:390,height:844},trace:'retain-on-failure'},
  projects:[
    {name:'chromium',use:{browserName:'chromium',launchOptions:process.env.PLAYWRIGHT_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH} : {}}},
    {name:'firefox',use:{browserName:'firefox'}},
    {name:'webkit',use:{browserName:'webkit'}},
  ],
  outputDir:'reports/browser-results',reporter:'list',
  webServer:{command:'node scripts/demo-server.mjs',url:'http://127.0.0.1:4179/healthz',reuseExistingServer:false,timeout:30000},
});
