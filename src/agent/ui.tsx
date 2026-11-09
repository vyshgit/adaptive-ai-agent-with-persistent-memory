import { useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Check, Copy, X } from 'lucide-react'

export const fieldClass = 'workspace-control min-h-10 w-full rounded-md border border-primary bg-primary px-lg py-md text-sm text-primary placeholder:text-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50'
const baseButton = 'workspace-control workspace-action inline-flex items-center justify-center gap-sm rounded-lg border font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50'

export function Button({ primary = false, quiet = false, size = 'md', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; quiet?: boolean; size?: 'sm' | 'md' }) {
  return <button type="button" {...props} className={`${baseButton} ${size === 'sm' ? 'min-h-8 px-md py-xs text-xs' : 'min-h-10 px-lg py-md text-sm'} ${primary ? 'border-transparent bg-brand-solid text-primary-on-brand shadow-xs hover:bg-brand-solid-hover' : quiet ? 'border-transparent text-tertiary hover:bg-secondary-hover hover:text-secondary' : 'border-primary bg-primary text-secondary shadow-xs hover:bg-primary-hover'} ${className}`} />
}

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} {...props} className={`workspace-control workspace-action inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-transparent text-tertiary hover:bg-secondary-hover hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>{children}</button>
}

const badgeStyles = {
  neutral: 'border-utility-gray-200 bg-utility-gray-50 text-utility-gray-700',
  brand: 'border-utility-brand-200 bg-utility-brand-50 text-utility-brand-700',
  success: 'border-utility-success-200 bg-utility-success-50 text-utility-success-700',
  warning: 'border-utility-warning-200 bg-utility-warning-50 text-utility-warning-700',
  error: 'border-utility-error-200 bg-utility-error-50 text-utility-error-700',
}
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof badgeStyles }) {
  return <span className={`inline-flex items-center gap-xs rounded-full border px-md py-xxs text-xs font-medium ${badgeStyles[tone]}`}>{children}</span>
}

export function Checkbox({ checked, onChange, children, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode; disabled?: boolean }) {
  return <label className={`inline-flex cursor-pointer items-start gap-sm text-sm text-secondary ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}>
    <span className="relative mt-xxs size-4 shrink-0">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} className="peer absolute inset-0 z-10 size-full cursor-inherit opacity-0" />
      <span aria-hidden="true" className={`pointer-events-none flex size-full items-center justify-center rounded-xs border peer-focus-visible:ring-2 peer-focus-visible:ring-focus-ring ${checked ? 'border-brand bg-brand-solid text-fg-white' : 'border-primary bg-primary'}`}>
        {checked && <Check size={12} className="shrink-0" />}
      </span>
    </span>
    <span>{children}</span>
  </label>
}

export function Tabs<T extends string>({ value, onChange, tabs, id, label = 'Workspace panels' }: { value: T; onChange: (value: T) => void; tabs: { id: T; label: string }[]; id: string; label?: string }) {
  const list = useRef<HTMLDivElement>(null)
  return <div role="tablist" aria-label={label} className="flex gap-sm overflow-x-auto border-b border-secondary px-md" ref={list}
    onKeyDown={event => {
      const index = tabs.findIndex(tab => tab.id === value)
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1
      if (next >= 0) { event.preventDefault(); onChange(tabs[next].id); list.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus() }
    }}>
    {tabs.map(tab => <button key={tab.id} type="button" role="tab" id={`${id}-${tab.id}`} aria-controls={`${id}-panel`} aria-selected={value === tab.id} tabIndex={value === tab.id ? 0 : -1}
      className={`workspace-control shrink-0 border-b-2 px-lg py-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${value === tab.id ? 'border-brand text-brand-primary' : 'border-transparent text-tertiary hover:text-secondary'}`}
      onClick={() => onChange(tab.id)}>{tab.label}</button>)}
  </div>
}

export function Modal({ title, children, footer, onClose, wide = false, bodyClassName = '' }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean; bodyClassName?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const node = dialog.current!
    const previous = document.activeElement
    node.showModal()
    return () => {
      node.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  // StrictMode replays setup → cleanup → setup. Its queued close event arrives
  // after showModal() reopens the dialog, so only report an actually closed modal.
  return <dialog ref={dialog} aria-labelledby={id} tabIndex={-1} onClose={event => { if (!event.currentTarget.open) onClose() }} onKeyDown={event => {
    if (event.key !== 'Tab' || event.defaultPrevented) return
    // Native modal dialogs make the background inert, but some browsers send
    // focus to browser chrome before wrapping. Keep keyboard navigation inside.
    const node = event.currentTarget
    const controls = [...node.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]')]
      .filter(control => control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0 && getComputedStyle(control).visibility !== 'hidden')
    const first = controls[0], last = controls.at(-1)
    const active = document.activeElement
    if (!first) { event.preventDefault(); node.focus() }
    else if (event.shiftKey && (active === first || !controls.includes(active as HTMLElement))) { event.preventDefault(); last!.focus() }
    else if (!event.shiftKey && (active === last || !controls.includes(active as HTMLElement))) { event.preventDefault(); first.focus() }
  }} className={`workspace-dialog m-auto w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} overflow-hidden rounded-xl border border-primary bg-primary p-none text-primary shadow-2xl backdrop:bg-overlay backdrop:opacity-70`}>
    <div className="workspace-dialog-content flex min-h-0 flex-col">
      <header className="flex shrink-0 items-center justify-between gap-lg border-b border-secondary p-xl">
        <h2 id={id} className="text-lg font-semibold">{title}</h2>
        <IconButton label="Close dialog" onClick={() => dialog.current?.close()}><X size={18} /></IconButton>
      </header>
      <div className={`min-h-0 flex-1 overflow-y-auto p-xl ${bodyClassName}`}>{children}</div>
      {footer && <footer className="flex shrink-0 flex-wrap justify-end gap-sm border-t border-secondary p-xl">{footer}</footer>}
    </div>
  </dialog>
}

export function CopyButton({ text, label = 'Copy blob ID' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  return <span className="inline-flex items-center gap-xs">
    <IconButton label={copied ? 'Copied' : label} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setCopied(true); setFailed(false) } catch { setFailed(true) }
    }}>{copied ? <Check size={14} /> : <Copy size={14} />}</IconButton>
    {failed && <span role="status" className="text-xs text-tertiary">Select the text to copy.</span>}
  </span>
}
