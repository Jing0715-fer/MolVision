'use client'

// MolVision 主页面：工具栏 + 左面板 + 3D 视口（取景框刻度线）+ 序列条 + 墨色仪表状态栏
import dynamic from 'next/dynamic'
import { Toolbar } from '@/components/studio/Toolbar'
import { LeftPanel } from '@/components/studio/LeftPanel'
import { SequenceBar } from '@/components/studio/SequenceBar'
import { ConsoleBar } from '@/components/studio/ConsoleBar'
import { StatusBar } from '@/components/studio/StatusBar'
import { LoadDialog } from '@/components/studio/LoadDialog'
import { HelpDialog } from '@/components/studio/HelpDialog'
import { HistoryDialog } from '@/components/studio/HistoryDialog'
import { CommandPalette } from '@/components/studio/CommandPalette'
import { AgentPanel } from '@/components/studio/AgentPanel'

const MolViewer = dynamic(() => import('@/components/molecular/MolViewer'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-foreground/70" />
        <span className="text-xs text-muted-foreground">正在初始化渲染引擎…</span>
      </div>
    </div>
  ),
})

export default function Home() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <Toolbar />
      <div className="relative flex min-h-0 flex-1">
        <LeftPanel />
        <main className="relative min-w-0 flex-1" aria-label="3D 分子视图">
          <MolViewer />
          {/* 仪器取景框：四角刻度线（签名细节，不拦截交互） */}
          <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
            <span className="corner-tick tl" />
            <span className="corner-tick tr" />
            <span className="corner-tick bl" />
            <span className="corner-tick br" />
          </div>
          <ConsoleBar />
          <AgentPanel />
        </main>
      </div>
      <SequenceBar />
      <StatusBar />
      <LoadDialog />
      <HelpDialog />
      <HistoryDialog />
      <CommandPalette />
    </div>
  )
}
