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
