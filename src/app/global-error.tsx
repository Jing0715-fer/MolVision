'use client'

// r102：global-error 兜底（app router 根级错误边界）——root layout 自身渲染抛错时
// Next.js 卸载整树，src/app/error.tsx（段级边界）不在卸载路径上，浏览器只剩
// framework 原生报错白屏。本文件是最后一道 UI 防线：自渲染 <html><body>（global-error
// 约定），不依赖任何项目组件（错误时组件树不可信）、不 import store/i18n（自身要
// 零失败面）——双语文案内联硬编码（无 i18n 依赖的必然取舍）。
// 注：开发模式 Next dev overlay 会优先接管；本边界主要服务生产构建。
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const detail = error?.digest ? ` · digest ${error.digest}` : ''
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body style={{ margin: 0, background: '#101215', color: '#e7e2d9', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
        <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 28, fontWeight: 700, letterSpacing: '0.08em', margin: 0 }}>
            MolVision
          </p>
          <h1 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
            渲染遇到意外错误 / Unexpected rendering error
          </h1>
          <p style={{ fontSize: 12, opacity: 0.7, margin: 0, maxWidth: 480, lineHeight: 1.7 }}>
            界面进入错误边界。点击下方按钮重试渲染；若持续出现，请刷新页面或检查控制台详情。
            {detail}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 8, padding: '10px 22px', borderRadius: 8, border: '1px solid #3a3f47',
              background: '#1a1e24', color: '#e7e2d9', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            }}
          >
            重试渲染 / Retry
          </button>
        </main>
      </body>
    </html>
  )
}
