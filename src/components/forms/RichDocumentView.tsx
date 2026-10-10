import type { CSSProperties, ReactNode } from "react";
import {
  richDocumentSchema,
  richMediaUrl,
  type RichBlock,
  type RichInline,
  type RichLayout,
  type RichWidth,
} from "@/contracts/rich-content";

function inline(nodes: RichInline[]): ReactNode[] {
  return nodes.map((node, index) => {
    if (node.type === "break") return <br key={index} />;
    if (node.type === "link") return <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">{inline(node.children)}</a>;
    let value: ReactNode = node.text;
    if (node.bold) value = <strong>{value}</strong>;
    if (node.italic) value = <em>{value}</em>;
    if (node.fontSize || node.fontColor) value = <span style={{
      ...(node.fontSize ? { fontSize: `${node.fontSize}px` } : {}),
      ...(node.fontColor ? { color: node.fontColor } : {}),
    }}>{value}</span>;
    return <span key={index}>{value}</span>;
  });
}

function layoutStyle(layout: RichLayout): CSSProperties {
  return {
    ...(layout.alignment ? { textAlign: layout.alignment } : {}),
    ...(layout.indent ? { paddingInlineStart: `${layout.indent * 2}rem` } : {}),
  };
}

function sizeStyle(width?: RichWidth): CSSProperties {
  return width ? { width: `${width.value}${width.unit === "percent" ? "%" : "px"}`, maxWidth: "100%" } : { maxWidth: "100%" };
}

function mediaStyle(block: { alignment?: "left" | "center" | "right"; width?: RichWidth }): CSSProperties {
  return {
    ...sizeStyle(block.width),
    ...(block.alignment === "left" ? { marginInlineStart: 0, marginInlineEnd: "auto" }
      : block.alignment === "right" ? { marginInlineStart: "auto", marginInlineEnd: 0 }
      : block.alignment === "center" ? { marginInlineStart: "auto", marginInlineEnd: "auto" } : {}),
  };
}

function safeOwnedPath(value: string | undefined): string | undefined {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\s\\\u0000-\u001f\u007f]/u.test(value)) return undefined;
  try {
    return new URL(value, "https://owned.invalid").origin === "https://owned.invalid" ? value : undefined;
  } catch { return undefined; }
}

function blocks(values: RichBlock[], imageUrls: Readonly<Record<string, string>>): ReactNode[] {
  return values.map((block, index) => {
    if (block.type === "paragraph") return <p key={index} dir={block.direction} style={layoutStyle(block)}>{inline(block.children)}</p>;
    if (block.type === "heading") {
      const children = inline(block.children), style = layoutStyle(block);
      return block.level === 2 ? <h2 key={index} dir={block.direction} style={style}>{children}</h2>
        : block.level === 3 ? <h3 key={index} dir={block.direction} style={style}>{children}</h3>
        : <h4 key={index} dir={block.direction} style={style}>{children}</h4>;
    }
    if (block.type === "quote") return <blockquote key={index}>{blocks(block.children, imageUrls)}</blockquote>;
    if (block.type === "list") {
      const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{blocks(item, imageUrls)}</li>);
      return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
    if (block.type === "table") return <div key={index} className="rich-document-table-wrap"><table><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => {
      const Cell = cell.header ? "th" : "td";
      return <Cell key={cellIndex} colSpan={cell.colSpan} rowSpan={cell.rowSpan}>{blocks(cell.children, imageUrls)}</Cell>;
    })}</tr>)}</tbody></table></div>;
    if (block.type === "image") {
      const url = safeOwnedPath(imageUrls[block.assetId]);
      return <figure key={block.nodeId} className="rich-document-image" style={mediaStyle(block)}>
        {/* Private no-store bytes must use the scoped route rather than the shared Next image cache. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt={block.alt} draggable={false} referrerPolicy="no-referrer" style={{ display: "block", maxWidth: "100%", height: "auto" }} />
          : <span role="status" className="cs-muted">이미지를 불러올 수 없습니다.</span>}
        {block.caption && <figcaption>{inline(block.caption)}</figcaption>}
      </figure>;
    }
    return <figure key={index} className="rich-document-media" style={mediaStyle(block)}>
      <a href={richMediaUrl(block)} target="_blank" rel="noopener noreferrer">미디어 열기</a>
    </figure>;
  });
}

export function RichDocumentView({ document, imageUrls = {}, className = "rich-document" }: {
  document: unknown;
  imageUrls?: Readonly<Record<string, string>>;
  className?: string;
}) {
  const parsed = richDocumentSchema.parse(document);
  return <div className={className}>{blocks(parsed.blocks, imageUrls)}</div>;
}
