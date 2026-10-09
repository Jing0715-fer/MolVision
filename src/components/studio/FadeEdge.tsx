'use client'

// 横向滚动行 + 动态双缘渐隐（mask 实现，不依赖背景色）：
// 内容超宽时右缘渐隐提示可滚动；已滚动时左缘渐隐；滚到头自动摘除对应侧
// ——解决「序列条/时间轴等长内容横向滚动无提示，看起来像内容被裁掉」的可用性问题
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function FadeEdge({
  children,
  className,
  edge = 24,
}: {
  children: ReactNode
  className?: string
  /** 渐隐宽度（px），与 globals.css 的 .mol-fade-* 渐变宽度保持一致 */
  edge?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [fadeL, setFadeL] = useState(false)
  const [fadeR, setFadeR] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const remaining = el.scrollWidth - el.clientWidth - el.scrollLeft
      setFadeL(el.scrollLeft > 4)
      setFadeR(remaining > 4)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    // 内容/容器尺寸变化（结构切换、面板拖宽、窗口缩放）时重估
    const ro = new ResizeObserver(update)
    ro.observe(el)
    // r101-rev-b：内容增删重估——RO 只观察容器自身盒子，children 增减改变的
    // scrollWidth 不触发回调（内容增长且无滚动发生时右缘渐隐提示永远不出现，
    // 直到下次 scroll/resize）。MutationObserver 观察 childList/subtree 与
    // RO 同生命周期 disconnect——一处修复 ConsoleBar（命令 chips 随输入增长）/
    // SequenceBar（序列行切换）/MovieTimeline（关键帧增删）三消费者
    const mo = new MutationObserver(update)
    mo.observe(el, { childList: true, subtree: true, characterData: false })
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
      mo.disconnect()
    }
  }, [])

  return (
    <div
      ref={ref}
      style={{ '--mol-fade-w': `${edge}px` } as React.CSSProperties}
      className={cn(
        'mol-scroll-x flex min-w-0 flex-1 overflow-x-auto',
        fadeL && 'mol-fade-l',
        fadeR && 'mol-fade-r',
        className,
      )}
    >
      {children}
    </div>
  )
}
