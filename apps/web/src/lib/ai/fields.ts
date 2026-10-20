import { z } from 'zod';
import { definitions, type Kind } from '../types';
import { AppError } from '../store';

// AI 不可写字段：派生值或需要所有者亲自决定的展示/附件配置。
const writableExclusions: Partial<Record<Kind, string[]>> = {
    PUBLICATION: ['featured', 'selectedAssets'],
};

export function aiWritableFields(kind: Kind): string[] {
    return definitions[kind].fields.map(f => f.key).filter(key => !(writableExclusions[kind] ?? []).includes(key));
}

// checkbox 中仅这两个字段允许清空（对应数据库可空列）；其余复选/数值字段只能替换，不能置空。
const clearableCheckboxes = ['important', 'urgent'];

// AI 部分修改补丁：未出现的键保持原值；fields 值为 null 表示明确清空（仅限允许的类型）。
export const recordPatch = z.object({
    recordId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1, '标题不能为空').max(200).optional(),
    body: z.string().max(500000).optional(),
    status: z.string().optional(),
    fields: z.record(z.string(), z.unknown()).optional(),
    tags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    links: z.array(z.object({ toId: z.string().min(1), relation: z.string().min(1).max(60) })).max(100).optional(),
});
export type RecordPatch = z.infer<typeof recordPatch>;

// 把部分修改合并为 updateRecord 需要的完整输入。合并以服务器读到的现值为基础，
// 模型补丁只覆盖显式出现的键，确保"只改一个字段不损伤其他内容"。
export function buildFullUpdate(kind: Kind, existing: {
    title: string;
    body: string;
    status: string;
    fields: Record<string, unknown>;
    tags: string[];
    links: { toId: string; relation: string }[];
}, patch: RecordPatch) {
    const writable = new Set(aiWritableFields(kind));
    const fields: Record<string, unknown> = { ...existing.fields };
    if (patch.fields) {
        for (const [key, value] of Object.entries(patch.fields)) {
            if (!writable.has(key))
                throw new AppError(400, `字段 ${key} 不允许 AI 修改`);
            if (value === null) {
                const def = definitions[kind].fields.find(f => f.key === key);
                if (!def)
                    throw new AppError(400, `字段 ${key} 不存在`);
                if (def.type === 'checkbox' && clearableCheckboxes.includes(key))
                    fields[key] = null;
                else if (def.type === 'date' || def.type === 'record')
                    fields[key] = null;
                else if (!def.type || def.type === 'text' || def.type === 'textarea')
                    fields[key] = '';
                else
                    throw new AppError(400, `${def.label}不能清空，请提供有效值`);
                continue;
            }
            fields[key] = value;
        }
    }
    if (patch.status !== undefined && !definitions[kind].statuses.includes(patch.status))
        throw new AppError(400, '状态不适用于这类记录');
    return {
        kind,
        title: patch.title ?? existing.title,
        body: patch.body ?? existing.body,
        status: patch.status,
        version: patch.expectedVersion,
        fields,
        tags: patch.tags ?? existing.tags,
        links: patch.links ?? existing.links.map(l => ({ toId: l.toId, relation: l.relation })),
    };
}

// 供工具描述与提示词使用：告诉模型每类记录可写哪些字段及类型。
export function describeFieldsForModel(kind: Kind): string {
    const lines = definitions[kind].fields.map(f => {
        const writable = !aiWritableFields(kind).includes(f.key) ? '（只读）' : '';
        const type = f.type ? `${f.type}${f.options ? `:${f.options.join('/')}` : ''}` : '文本';
        return `- ${f.key}（${f.label}，${type}）${writable}`;
    });
    return lines.join('\n') || '（无附加字段）';
}
