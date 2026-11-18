import { readFileSync } from 'node:fs';

const MODEL_BLOCK = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
const FIELD_LINE = /^\s*(\w+)\s+(\w+)(\[\])?\??(\s|$)/;
const TABLE_MAP = /^\s*@@map\(\s*"([^"]+)"\s*\)/m;

export const SCHEMA_URL = new URL('../../../../prisma/schema.prisma', import.meta.url);

function modelBlocks(text) {
  return [...text.matchAll(MODEL_BLOCK)].map(([, name, body]) => ({ name, body }));
}

function relationFields(body, modelNames) {
  const relations = new Map();
  for (const line of body.split('\n')) {
    const match = FIELD_LINE.exec(line);
    if (!match) continue;
    const [, field, type] = match;
    if (modelNames.has(type)) relations.set(field, type);
  }
  return relations;
}

export function parsePrismaSchema(text) {
  const blocks = modelBlocks(text);
  const modelNames = new Set(blocks.map((block) => block.name));
  const models = new Map();
  for (const { name, body } of blocks) {
    models.set(name, {
      table: TABLE_MAP.exec(body)?.[1] ?? name,
      relations: relationFields(body, modelNames),
    });
  }
  return models;
}

export function loadPrismaSchema(url = SCHEMA_URL) {
  return parsePrismaSchema(readFileSync(url, 'utf8'));
}
