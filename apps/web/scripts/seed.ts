import { db } from '../src/lib/db';
import { createRecord, publish, defaultProfile } from '../src/lib/store';
import type { Kind } from '../src/lib/types';
async function ensure(key: string, kind: Kind, title: string, fields: Record<string, unknown> = {}, body = '', links: {
    toId: string;
    relation: string;
}[] = [], status?: string) {
    const saved = await db.setting.findUnique({ where: { key: `seed:${key}` } });
    if (saved) {
        const row = await db.record.findUnique({ where: { id: saved.value } });
        if (row)
            return row.id;
    }
    const record = await createRecord({ kind, title, body, fields, links, status });
    await db.setting.upsert({ where: { key: `seed:${key}` }, create: { key: `seed:${key}`, value: record.id }, update: { value: record.id } });
    return record.id;
}
export async function seed() {
    await db.setting.upsert({ where: { key: 'profile' }, create: { key: 'profile', value: JSON.stringify(defaultProfile) }, update: {} });
    const domainIds: Record<string, string> = {};
    for (const [title, group] of [['身体', '个人成长'], ['精神', '个人成长'], ['学习', '个人成长'], ['工作', '个人成长'], ['社会关系', '个人成长'], ['财务', '生活与复盘'], ['收纳', '生活与复盘'], ['自媒体', '生活与复盘'], ['写作', '生活与复盘']])
        domainIds[title] = await ensure(`domain:${title}`, 'DOMAIN', title, { group, focus: '待填写：这个领域当前值得关注的事情。' });
    const courses = ['数据结构与算法', 'C 语言程序设计与实验', '人工智能导论', '物联网技术与实验', '智能终端与移动应用开发', '软件架构与应用开发', '大数据可视化技术'];
    for (const title of courses)
        await ensure(`course:${title}`, 'COURSE', title, {}, '', [{ toId: domainIds['学习'], relation: 'related' }]);
    for (const title of ['幼小衔接教育游戏', '个人博客', '简历系统', 'JellyStudy'])
        await ensure(`project:${title}`, 'PROJECT', title, { stage: '待整理', outcome: '待填写', criteria: '待填写', nextStep: '明确当前阶段成果' }, '', [{ toId: domainIds['工作'], relation: 'related' }]);
    await ensure('graduation', 'PROJECT', '毕业设计', { stage: '待整理' }, '', [{ toId: domainIds['学习'], relation: 'related' }]);
    await ensure('career', 'NOTE', '毕业实习与简历', {}, '职业发展专题：在这里关联实习、求职准备、简历版本与具体行动。', [{ toId: domainIds['学习'], relation: 'related' }], 'ACTIVE');
    await ensure('welcome', 'NOTE', '示例 · 从一段记录开始', {}, '这是示例记录，可以编辑或移入回收站。\n\n先记录，再整理：\n\n- 把它关联到一个领域或项目。\n- 建立一个可以执行的行动。\n- 用复盘留下反馈。\n- 将适合分享的部分整理成公开稿。', [], 'INBOX');
    const examples = [{ key: 'welcome-article', title: '示例 · 给思考留一个生长的地方', type: 'article', tag: '记录', body: '## 从一个小小的观察开始\n\n这是网站的示例文章，并非作者的真实经历或观点。它展示文章、主题和阅读排版的效果，可以在工作台编辑或撤回。\n\n一段观察、一条资料、一件做过的事，都可以成为记录的起点。\n\n## 留下过程，也留下来源\n\n使用引用、列表和代码表达你的理解。\n\n> 把值得留下的内容整理成自己的语言。\n\n## 在实践中更新\n\n内部素材与公开稿分别保存。新的理解可以成为更新草稿，再由你决定何时公开。' }, { key: 'sample-work', title: '示例 · 个人数字花园', type: 'work', tag: '创作', body: '## 背景与目标\n\n这是作品案例的示例结构，内容需要由作者填写。\n\n## 我的贡献\n\n待填写：角色、关键方案与取舍。\n\n## 成果与局限\n\n待填写：可核对的成果、证据和后续方向。' }, { key: 'sample-garden', title: '示例 · 学习如何留下理解', type: 'garden', tag: '学习', body: '## 一个持续更新的主题\n\n这是成长花园的示例笔记，展示尚在整理的内容如何公开。\n\n把资料来源、具体问题和自己的解释连接起来，之后可以继续补充。' }, { key: 'sample-recommendation', title: '示例 · 推荐也需要理由', type: 'recommendation', tag: '收藏', body: '## 为什么留下它\n\n这是推荐模板的示例，不代表作者已经使用或认可某个产品。\n\n## 适合谁\n\n填写适用场景、亲身体验与局限，帮助读者作出判断。' }];
    for (const example of examples) {
        const id = await ensure(example.key, 'PUBLICATION', example.title, { publicationType: example.type, slug: example.key, summary: '示例内容 · 可在工作台编辑、替换或撤回。', featured: true, maturity: '持续整理' }, example.body);
        const saved = await db.record.findUniqueOrThrow({ where: { id } });
        const prior = await db.publishedVersion.count({ where: { publicationId: id } });
        if (!prior) {
            const tag = await db.tag.upsert({ where: { name: example.tag }, create: { name: example.tag }, update: {} });
            await db.recordTag.upsert({ where: { recordId_tagId: { recordId: id, tagId: tag.id } }, create: { recordId: id, tagId: tag.id }, update: {} });
            await publish(id, saved.version);
        }
    }
    console.log('初始领域、课程、项目和标识清楚的示例内容已准备。已有记录保持原样。');
}
if (process.argv[1]?.endsWith('seed.ts'))
    seed().finally(() => db.$disconnect());
