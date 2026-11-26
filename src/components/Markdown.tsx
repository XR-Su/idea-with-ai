import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
export function Markdown({ text }: { text: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
    img: ({ alt }) => <span className="image-placeholder">[图片：{alt || '外部图片'}]</span>,
  }}>{text}</ReactMarkdown></div>;
}
