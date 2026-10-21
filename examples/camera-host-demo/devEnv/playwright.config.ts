/**
 * camera-host-demo 的 Agent HTTP 桥接端到端验收配置(2026-10-19,Task 8,
 * spec §13.4):webServer 同时拉起 demo Vite 与测试桥接进程,测试经 Node
 * fetch 走纯 HTTP 驱动场景,不点页面 DOM。
 *
 * 端口固定(E2E 专用段,不与 playground 8082 / 桥接默认 43110 冲突):
 * demo 5199、bridge 43199。桥接 token 只是测试常量,经环境变量名传递
 * (--token-env,CLI 不接受命令行直传),绝不打印真实值;浏览器侧经
 * VITE_CAMERA_STUDIO_AGENT_* 注入(main.tsx 只在三者齐全时连桥接)。
 *
 * CORS:浏览器页面 origin 是 http://localhost:5199,桥接 corsOrigins 精确
 * 放行该 origin(文件传输 fetch 需要);WS upgrade 的鉴权是 subprotocol
 * token,不经 CORS。corsOrigins 只给桥接(服务端),不进浏览器配置。
 */
import path from 'path'
import type {PlaywrightTestConfig} from '@playwright/test'
import {devices} from '@playwright/test'

const DEMO_PORT = 5199
const BRIDGE_PORT = 43199
const DEMO_ORIGIN = `http://localhost:${DEMO_PORT}`
const BRIDGE_HTTP = `http://127.0.0.1:${BRIDGE_PORT}`
const BRIDGE_WS = `ws://127.0.0.1:${BRIDGE_PORT}`

/** 测试常量 token(非真实密钥):只经环境变量名传给桥接 CLI,不进命令行 */
const E2E_TOKEN = 'camera-studio-e2e-test-token'
const E2E_TOKEN_ENV = 'CAMERA_STUDIO_E2E_TOKEN'

// 配置进程即 webServer 子进程的父进程:改 process.env 会被两个 webServer
// 继承(env 选项缺省 = process.env);测试 worker 进程同样继承,测试文件
// 从 env 读回桥接地址与 token,两处不漂移
process.env[E2E_TOKEN_ENV] = E2E_TOKEN
process.env.CAMERA_STUDIO_E2E_BRIDGE_HTTP = BRIDGE_HTTP
process.env.VITE_CAMERA_STUDIO_AGENT_WS = BRIDGE_WS
process.env.VITE_CAMERA_STUDIO_AGENT_HTTP = BRIDGE_HTTP
process.env.VITE_CAMERA_STUDIO_AGENT_TOKEN = E2E_TOKEN

const repoRoot = path.resolve(__dirname, '../../..')

const config: PlaywrightTestConfig = {
  testDir: '../src',
  /* agent.e2e.ts(纯 HTTP 传输层)+ agent-skill.e2e.ts(SKILL CLI 端到端) */
  testMatch: /agent(?:-skill)?\.e2e\.ts/,
  /* 真实浏览器 + GLB 导入 + 视频录制:单用例上限放宽到 5 分钟 */
  timeout: 300_000,
  expect: {timeout: 15_000},
  forbidOnly: !!process.env.CI,
  retries: 0,
  /* 单桥接实例只接受一个活动场景会话:串行 */
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: DEMO_ORIGIN,
    /* 只在失败时保留排查材料 */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {args: ['--no-sandbox']},
      },
    },
  ],
  outputDir: '../test-results/',
  webServer: [
    {
      // demo Vite;reuseExistingServer 必须 false:复用到未注入
      // VITE_CAMERA_STUDIO_AGENT_* 的旧服务器会让测试挂得莫名其妙
      command: `pnpm dev --port ${DEMO_PORT} --strictPort`,
      url: DEMO_ORIGIN,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // 测试桥接:先增量重建 dist(tsc -b,源码与产物不脱节),再起 CLI。
      // --token-env 只传环境变量名;--cors-origin 精确放行 demo origin
      command:
        `pnpm --filter @dreamerbird/camera-studio-bridge build:ts && ` +
        `node packages/camera-studio-bridge/dist/cli.js ` +
        `--port ${BRIDGE_PORT} --token-env ${E2E_TOKEN_ENV} ` +
        `--cors-origin ${DEMO_ORIGIN}`,
      // /v1/health 无凭据返回 401,playwright 视 401 为就绪
      url: `${BRIDGE_HTTP}/v1/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      cwd: repoRoot,
      stdout: 'pipe',
    },
  ],
}

export default config
