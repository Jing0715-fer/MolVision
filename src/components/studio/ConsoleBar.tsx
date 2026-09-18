'use client'

// 命令行控制台（PyMOL 风格）
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Terminal, X } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { runCommand, COMMAND_HELP } from '@/lib/molecular/commands'
import { cn } from '@/lib/utils'

const HISTORY_KEY = 'molvision-cmd-history'

export function ConsoleBar() {
  const ui = useMolStore(s => s.ui)
  const setUi = useMolStore(s => s.setUi)
  const consoleLog = useMolStore(s => s.consoleLog)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
      if (Array.isArray(saved)) return saved
    } catch { /* ignore */ }
    return []
  })
  const [histIdx, setHistIdx] = useState(-1)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [consoleLog, ui.consoleOpen])

  useEffect(() => {
    if (ui.consoleOpen) inputRef.current?.focus()
  }, [ui.consoleOpen])

  const submit = () => {
    const cmd = input.trim()
    if (!cmd) return
    runCommand(cmd)
    const next = [...history.filter(h => h !== cmd), cmd].slice(-50)
    setHistory(next)
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    setHistIdx(-1)
    setInput('')
    setSuggestions([])
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      submit()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (!history.length) return
      const idx = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(idx)
      setInput(history[idx] ?? '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx < 0) return
      const idx = histIdx + 1
      if (idx >= history.length) { setHistIdx(-1); setInput('') }
      else { setHistIdx(idx); setInput(history[idx]) }
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (suggestions.length) {
        setInput(suggestions[0])
        setSuggestions([])
      }
    } else if (e.key === 'Escape') {
      setUi({ consoleOpen: false })
    }
  }

  if (!ui.consoleOpen) return null

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 border-t border-border/70 bg-popover/95 shadow-2xl backdrop-blur-md">
      <div className="flex h-8 items-center gap-2 border-b border-border/50 px-3">
        <Terminal className="h-3.5 w-3.5 text-emerald-500" />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">命令行</span>
        <span className="text-[10px] text-muted-foreground/60">help 查看命令</span>
        <button
          onClick={() => setUi({ consoleOpen: false })}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div ref={logRef} className="mol-scroll h-36 overflow-y-auto px-3 py-1.5 font-mono text-[11px] leading-relaxed">
        {consoleLog.map((l, i) => (
          <div key={i} className={cn(
            'whitespace-pre-wrap break-all',
            l.type === 'in' ? 'text-emerald-600 dark:text-emerald-400' : l.type === 'err' ? 'text-destructive' : 'text-foreground/80',
          )}>
            {l.type === 'in' && <span className="text-muted-foreground/50">» </span>}
            {l.text}
          </div>
        ))}
      </div>
      <div className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 transition-colors duration-200 focus-within:border-emerald-500/60 focus-within:bg-emerald-500/[0.05] focus-within:shadow-[inset_0_0_0_1px_rgba(16,185,129,0.25)]">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <input
          ref={inputRef}
          value={input}
          onChange={e => {
            setInput(e.target.value)
            const v = e.target.value.toLowerCase()
            if (v && !v.includes(' ')) {
              setSuggestions(COMMAND_HELP.map(h => h.cmd.split(' ')[0]).filter(c => c.startsWith(v)).slice(0, 1))
            } else setSuggestions([])
          }}
          onKeyDown={onKeyDown}
          placeholder="load 4hhb · select site = within 5 of resn HEM · color red site · show cartoon …"
          className="flex-1 bg-transparent font-mono text-xs outline-none caret-emerald-600 placeholder:text-muted-foreground/40 dark:caret-emerald-400"
          spellCheck={false}
          autoComplete="off"
        />
        <kbd className="hidden shrink-0 rounded border border-border/60 bg-muted/60 px-1 font-mono text-[9px] text-muted-foreground/70 sm:inline">↵</kbd>
      </div>
    </div>
  )
}
