import type { NextConfig } from "next";

// 安全响应头（r65-main 建议② / r66-a 落地）
//
// 说明：
// - 务实版 CSP：Next dev 模式 HMR 需要 'unsafe-eval'；three.js 有 blob: worker
//   与 data:/blob: 纹理；Tailwind/Radix 有内联样式与内联脚本。
// - ⚠️ 绝对不要添加 X-Frame-Options 或 CSP frame-ancestors：
//   本沙箱的 Preview Panel 以 iframe 内嵌本应用，任何限制性 framing 策略
//   （DENY/SAMEORIGIN/白名单外祖先）都会直接弄坏用户预览。此处有意不设。
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' blob: data:",
      "worker-src 'self' blob:",
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  // r88：Preview Panel 经 space-z.ai 网关域名跨域请求 /_next/* 资源，
  // Next 16 dev 模式默认告警（未来大版本将直接拒绝）→ 显式放行。
  // 精确 host + 通配 双写保险（preview-chat-<sessionId>.space-z.ai）。
  // r91 补救：一旦配置 allowedDevOrigins，block 模式即生效（node_modules/
  // next/dist/server/lib/router-utils/block-cross-site.js：mode = 'block'）——
  // 默认名单仅 localhost/*.localhost，127.0.0.1 直连（本机 E2E / curl Origin
  // 场景 / 部分内网预览）被 403 拒掉 /_next/webpack-hmr websocket 升级 →
  // 客户端重连 25 次全败 → 自发 location.reload() 循环（页面静默丢状态，
  // 被用户感知为「模板有问题」——r91 实测根因）。显式补入回环 IP。
  allowedDevOrigins: [
    "*.space-z.ai",
    "preview-chat-10834185-7554-44e7-afcd-0c972a710c5e.space-z.ai",
    "127.0.0.1",
  ],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
