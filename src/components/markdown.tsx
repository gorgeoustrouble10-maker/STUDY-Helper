'use client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
export function Markdown({ body }: {
    body: string;
}) { return <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex, rehypeHighlight]} components={{ a: ({ href, children, ...props }) => <a {...props} href={href} rel="noopener noreferrer" target={href?.startsWith('http') ? '_blank' : undefined}>{children}</a>, img: ({ src, alt }) => typeof src === 'string' ? <img src={src} alt={alt || ''} loading="lazy"/> : null, h2: ({ children }) => <h2 id={String(children).replace(/\s/g, '-')}>{children}</h2> }}>{body}</ReactMarkdown></div>; }
