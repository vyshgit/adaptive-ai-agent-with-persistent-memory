import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { safeMarkdownUrl } from './markdownSafety.ts'

const components: Components = {
  // The workspace already owns h1/h2. Message headings start at h3.
  h1: ({ children }) => <h3 className="text-xl font-semibold">{children}</h3>,
  h2: ({ children }) => <h4 className="text-lg font-semibold">{children}</h4>,
  h3: ({ children }) => <h5 className="text-md font-semibold">{children}</h5>,
  h4: ({ children }) => <h6 className="text-md font-semibold">{children}</h6>,
  h5: ({ children }) => <h6 className="text-sm font-semibold">{children}</h6>,
  h6: ({ children }) => <h6 className="text-sm font-semibold">{children}</h6>,
  p: ({ children }) => <p>{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc space-y-sm pl-2xl">{children}</ul>,
  ol: ({ children, start }) => <ol start={start} className="list-decimal space-y-sm pl-2xl">{children}</ol>,
  li: ({ children }) => <li className="pl-xs">{children}</li>,
  blockquote: ({ children }) => <blockquote className="space-y-lg border-l-2 border-primary pl-xl text-secondary">{children}</blockquote>,
  hr: () => <hr className="border-secondary" />,
  pre: ({ children }) => <pre tabIndex={0} className="workspace-scroll max-w-full overflow-x-auto rounded-lg border border-secondary bg-secondary p-xl font-mono text-sm leading-relaxed text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">{children}</pre>,
  code: ({ children, className }) => <code className={`font-mono text-sm ${className || ''}`}>{children}</code>,
  a: ({ children, href, title }) => {
    const safe = safeMarkdownUrl(href || '')
    return safe ? <a href={safe} title={title} target="_blank" rel="noopener noreferrer" className="rounded-sm text-brand-primary underline decoration-border-primary underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">{children}</a> : <span>{children}</span>
  },
  // Do not auto-fetch model-provided URLs (including tracking images). Only their
  // descriptive text is rendered; raw HTML and executable content are ignored.
  img: ({ alt }) => <span className="text-sm text-tertiary">{alt ? `[Image: ${alt}]` : '[Image]'} · not loaded</span>,
  table: ({ children }) => <div tabIndex={0} role="region" aria-label="Message table" className="workspace-scroll max-w-full overflow-x-auto rounded-lg border border-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"><table className="w-full border-collapse text-left text-sm">{children}</table></div>,
  thead: ({ children }) => <thead className="bg-secondary text-secondary">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-secondary last:border-none">{children}</tr>,
  th: ({ children, style }) => <th style={style} className="px-lg py-md font-semibold">{children}</th>,
  td: ({ children, style }) => <td style={style} className="px-lg py-lg align-top">{children}</td>,
  input: ({ checked }) => <input type="checkbox" checked={Boolean(checked)} disabled aria-label={checked ? 'Completed task' : 'Incomplete task'} className="mr-sm" />,
}

export default function MarkdownMessage({ content }: { content: string }) {
  return <div className="workspace-markdown min-w-0 space-y-lg break-words text-md leading-relaxed">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components} urlTransform={(url, key) => key === 'href' ? safeMarkdownUrl(url) : ''}>{content}</Markdown>
  </div>
}
