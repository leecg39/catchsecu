import { richDocumentSchema, type RichBlock, type RichDocumentV1, type RichImage } from "@/contracts/rich-content";

function visitBlocks(blocks: RichBlock[], nodeId: string, update: (image: RichImage) => RichImage | null): { blocks: RichBlock[]; found: boolean } {
  let found = false;
  const result: RichBlock[] = [];
  for (const block of blocks) {
    if (block.type === "image" && block.nodeId === nodeId) {
      found = true;
      const next = update(structuredClone(block));
      if (next) result.push(next);
      continue;
    }
    if (block.type === "quote") {
      const nested = visitBlocks(block.children, nodeId, update); found ||= nested.found;
      result.push({ ...block, children: nested.blocks });
      continue;
    }
    if (block.type === "list") {
      const items = block.items.map(item => {
        const nested = visitBlocks(item, nodeId, update); found ||= nested.found;
        return nested.blocks.length ? nested.blocks : [{ type: "paragraph" as const, children: [] }];
      });
      result.push({ ...block, items });
      continue;
    }
    if (block.type === "table") {
      result.push({ ...block, rows: block.rows.map(row => row.map(cell => {
        const nested = visitBlocks(cell.children, nodeId, update); found ||= nested.found;
        return { ...cell, children: nested.blocks };
      })) });
      continue;
    }
    result.push(block);
  }
  return { blocks: result, found };
}

export function findRichImage(document: RichDocumentV1, nodeId: string): RichImage | undefined {
  let match: RichImage | undefined;
  visitBlocks(richDocumentSchema.parse(document).blocks, nodeId, image => {
    match = structuredClone(image); return image;
  });
  return match;
}

export function updateRichImage(document: RichDocumentV1, nodeId: string, update: (image: RichImage) => RichImage | null): RichDocumentV1 {
  const parsed = richDocumentSchema.parse(document), result = visitBlocks(parsed.blocks, nodeId, update);
  if (!result.found) throw new Error("편집할 본문 이미지를 찾을 수 없습니다.");
  return richDocumentSchema.parse({ schemaVersion: 1, blocks: result.blocks });
}

export function insertRichBlock(document: RichDocumentV1, block: RichBlock, afterIndex?: number): RichDocumentV1 {
  const parsed = richDocumentSchema.parse(document), blocks = [...parsed.blocks];
  const index = afterIndex === undefined ? blocks.length : Math.max(0, Math.min(blocks.length, afterIndex + 1));
  blocks.splice(index, 0, structuredClone(block));
  return richDocumentSchema.parse({ schemaVersion: 1, blocks });
}
