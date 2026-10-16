import React from 'react';
import { Link } from 'react-router-dom';

// A small Markdown reader for the Terms, Privacy Policy and Refund Policy (src/content/legal/*.md). It reads only what those
// pages use and builds React elements, never raw HTML, so nothing in a document can run a script.
//
// Supported: "##" and "###" headings; paragraphs; "-" bullet lists and "1." numbered lists, nested by two or three spaces;
// "> " boxes (they may hold paragraphs and lists); tables ("| a | b |" with a "|---|---|" line); **bold**, *italic*,
// [text](url) links and bare e-mail addresses. A link may go to a page of this site ("/terms"), to https:, or to mailto:.

type ListNode = { ordered: boolean; items: { text: string; children: ListNode[] }[] };
export type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; list: ListNode }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

const ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
const indentOf = (line: string) => line.length - line.trimStart().length;

function parseListAt(lines: string[], start: number, indent: number): [ListNode, number] {
  const first = ITEM.exec(lines[start])!;
  const list: ListNode = { ordered: /\d/.test(first[2]), items: [] };
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      const next = j < lines.length ? ITEM.exec(lines[j]) : null;
      // The list goes on after a blank line only with another item of the same kind (or a deeper one).
      if (next && indentOf(lines[j]) >= indent && (indentOf(lines[j]) > indent || /\d/.test(next[2]) === list.ordered)) {
        i = j;
        continue;
      }
      break;
    }
    const m = ITEM.exec(line);
    if (m) {
      const ind = m[1].length;
      if (ind < indent) break;
      if (ind === indent && /\d/.test(m[2]) !== list.ordered) break;
      if (ind > indent && list.items.length > 0) {
        const [child, next] = parseListAt(lines, i, ind);
        list.items[list.items.length - 1].children.push(child);
        i = next;
        continue;
      }
      list.items.push({ text: m[3].trim(), children: [] });
      i += 1;
      continue;
    }
    if (indentOf(line) > indent && list.items.length > 0) {
      list.items[list.items.length - 1].text += ` ${line.trim()}`;
      i += 1;
      continue;
    }
    break;
  }
  return [list, i];
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length === 2 ? 2 : 3, text: heading[2].trim() });
      i += 1;
      continue;
    }
    if (line.startsWith('>')) {
      const inner: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        inner.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ kind: 'quote', blocks: parseBlocks(inner.join('\n')) });
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        if (!/^\|?[\s:|-]+\|?$/.test(lines[i].trim())) rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push({ kind: 'table', header: rows[0] ?? [], rows: rows.slice(1) });
      continue;
    }
    if (ITEM.test(line)) {
      const [list, next] = parseListAt(lines, i, indentOf(line));
      blocks.push({ kind: 'list', list });
      i = next;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{2,3}\s/.test(lines[i]) &&
      !lines[i].startsWith('>') &&
      !lines[i].trim().startsWith('|') &&
      !ITEM.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ kind: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)\s]+\)|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const linkClass = 'font-bold text-[#15803D] hover:underline';

function renderLink(label: string, url: string, key: string): React.ReactNode {
  if (url.startsWith('/')) return <Link key={key} to={url} className={linkClass}>{label}</Link>;
  if (url.startsWith('https://') || url.startsWith('mailto:')) {
    return <a key={key} href={url} className={linkClass} rel="noopener noreferrer" target={url.startsWith('https://') ? '_blank' : undefined}>{label}</a>;
  }
  return label; // any other kind of address is shown as plain text, never as a link
}

export function renderInline(text: string, keyBase = 'i'): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = match[0];
    const key = `${keyBase}-${n++}`;
    if (token.startsWith('**')) out.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    else if (token.startsWith('*')) out.push(<em key={key}>{token.slice(1, -1)}</em>);
    else if (token.startsWith('[')) {
      const parts = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      out.push(renderLink(parts[1], parts[2], key));
    } else out.push(renderLink(token, `mailto:${token}`, key));
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const P = 'text-sm text-slate-600 leading-relaxed';

function renderList(list: ListNode, key: string): React.ReactNode {
  const Tag = list.ordered ? 'ol' : 'ul';
  return (
    <Tag key={key} className={`${list.ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1.5 my-2`}>
      {list.items.map((item, idx) => (
        <li key={`${key}-${idx}`} className={P}>
          {renderInline(item.text, `${key}-${idx}`)}
          {item.children.map((child, c) => renderList(child, `${key}-${idx}-${c}`))}
        </li>
      ))}
    </Tag>
  );
}

export function renderBlocks(blocks: Block[], keyBase = 'b'): React.ReactNode[] {
  return blocks.map((block, idx) => {
    const key = `${keyBase}-${idx}`;
    switch (block.kind) {
      case 'heading':
        return block.level === 2 ? (
          <h2 key={key} className="text-base font-extrabold text-[#0F172A] mt-7 mb-2">{renderInline(block.text, key)}</h2>
        ) : (
          <h3 key={key} className="text-sm font-extrabold text-[#0F172A] mt-5 mb-1.5">{renderInline(block.text, key)}</h3>
        );
      case 'paragraph':
        return <p key={key} className={`${P} my-2`}>{renderInline(block.text, key)}</p>;
      case 'list':
        return renderList(block.list, key);
      case 'quote':
        return (
          <div key={key} className="my-4 rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3">
            {renderBlocks(block.blocks, key)}
          </div>
        );
      case 'table':
        return (
          <div key={key} className="my-3 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr>
                  {block.header.map((cell, c) => (
                    <th key={`${key}-h${c}`} className="text-xs font-extrabold text-[#0F172A] border-b border-slate-200 py-2 pr-3 align-bottom">
                      {renderInline(cell, `${key}-h${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={`${key}-r${r}`}>
                    {row.map((cell, c) => (
                      <td key={`${key}-r${r}c${c}`} className="text-xs text-slate-600 leading-relaxed border-b border-slate-100 py-2 pr-3 align-top">
                        {renderInline(cell, `${key}-r${r}c${c}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

export const MarkdownText: React.FC<{ source: string }> = ({ source }) => <>{renderBlocks(parseBlocks(source))}</>;
