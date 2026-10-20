/**
 * 示范内容填充脚本（贴合 seed.ts 的学生/数字花园场景）。
 *
 * 用法：
 *   npx tsx scripts/demo.ts          # 填充（幂等，可重复运行）
 *   npx tsx scripts/demo.ts --clean  # 清除全部示范记录（软删除进回收站），并还原被填充的字段占位
 *
 * 约定：
 * - 全部通过 src/lib/store.ts 的业务函数写入，不直接操作业务表；
 * - 每条新记录打「示范」标签，并在 Setting 表记录 demo:<key> 幂等键；
 * - 对课程/项目/领域的字段更新只填空值或「待填写」占位，原始值存入 demo:fill:<key> 便于还原；
 * - 个人资料只替换以「待填写」开头的键，email/avatar/links 等个人信息不动。
 */
import { db } from '../src/lib/db';
import { createRecord, updateRecord, publish, withdraw, snapshotReview, saveProfile, getProfile, getRecord } from '../src/lib/store';
import { seed } from './seed';
import type { Kind } from '../src/lib/types';

const TAG = '示范';
let created = 0;
let restored = 0;

const day = (offset: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
};
const monthDay = (dayOfMonth: number) => {
    const now = new Date();
    const d = Math.min(dayOfMonth, now.getDate());
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

async function ensureSetting(key: string, value: string) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
async function readSetting(key: string) {
    const row = await db.setting.findUnique({ where: { key } });
    return row?.value;
}

/** 幂等创建：已存在则直接返回 recordId。 */
async function demo(key: string, kind: Kind, title: string, fields: Record<string, unknown> = {}, body = '', links: { toId: string; relation: string }[] = [], status?: string, tags: string[] = []) {
    const saved = await readSetting(`demo:${key}`);
    if (saved) {
        const row = await db.record.findUnique({ where: { id: saved } });
        if (row) {
            return { id: row.id, fresh: false };
        }
    }
    const record = await createRecord({ kind, title, body, fields, links, status, tags: [TAG, ...tags] });
    await ensureSetting(`demo:${key}`, record.id);
    created++;
    return { id: record.id, fresh: true };
}

/** 只填空值/待填写占位的字段更新，原始值记录到 demo:fill:<key> 便于 --clean 还原。 */
async function demoFill(key: string, recordId: string, patch: Record<string, unknown>) {
    const saved = await readSetting(`demo:fill:${key}`);
    if (saved)
        return;
    const old = await getRecord(recordId);
    const originals: Record<string, unknown> = {};
    const filled: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
        const current = old.fields[k];
        const isEmpty = current === undefined || current === null || current === '' || current === false || (typeof current === 'string' && (current.startsWith('待填写') || current === '待整理' || current === '明确当前阶段成果'));
        if (!isEmpty)
            continue;
        originals[k] = current ?? null;
        filled[k] = v;
    }
    if (!Object.keys(filled).length)
        return;
    await updateRecord(recordId, {
        kind: old.kind,
        title: old.title,
        body: old.body,
        fields: { ...old.fields, ...filled },
        tags: old.tags,
        links: old.links.map(l => ({ toId: l.toId, relation: l.relation })),
        version: old.version
    });
    await ensureSetting(`demo:fill:${key}`, JSON.stringify({ recordId, originals }));
    restored++;
}

async function main() {
    console.log('先确保基础种子存在…');
    await seed();
    console.log('开始填充示范内容…');

    /* ── 个人资料 ─────────────────────────────────────────── */
    const profile = await getProfile();
    const profilePatch: Record<string, string> = {};
    const profileDemo: Record<string, string> = {
        introduction: '计算机专业大四学生，正在做毕业设计、找实习，业余维护这个数字花园。相信「先记录，再整理」：把课堂实验、项目过程和日常观察留成文字，让想法可以慢慢生长。',
        values: '诚实记录过程，包括卡住和失败的部分；先完成，再完美；公开前想清楚对读者有没有用。',
        skills: 'C/C++、TypeScript 与 React、Node.js；正在补数据结构与软件架构的功课；喜欢把学到的东西写成能跑的小工具。',
        interests: '数字花园与个人知识管理、教育类小软件、前端工程化、AI 助手如何帮助普通人整理信息。',
        boundaries: '期末周与毕业设计冲刺期更新会变慢；不接受与课程作业直接相关的代写类合作。',
        timeline: '2023 年开始写课程笔记；2025 年用博客发布第一篇长文；2026 年把博客改造成「公开花园 + 私密工作台」的双层结构，并持续迭代至今。',
        now: '正在准备毕业设计开题，同时给个人博客接入 AI 助手；本周在补数据结构的实验报告。',
        cooperation: '欢迎交流：数字花园实践、课程实验方法、React 与 Node 项目经验；也接受教育类小工具的合作试用。'
    };
    for (const [k, v] of Object.entries(profileDemo))
        if (!profile[k] || profile[k].startsWith('待填写'))
            profilePatch[k] = v;
    if (Object.keys(profilePatch).length) {
        await saveProfile({ ...profile, ...profilePatch });
        console.log(`个人资料已补充 ${Object.keys(profilePatch).length} 个字段（个人信息键保持原样）。`);
    }

    /* ── 领域关注点 ───────────────────────────────────────── */
    const domainIds: Record<string, string> = {};
    for (const [title, focus] of [
        ['身体', '每周至少跑步两次，23:30 前上床。'],
        ['精神', '睡前 20 分钟纸质书替代刷手机。'],
        ['学习', '数据结构实验不掉队，毕设开题前读完 3 篇综述。'],
        ['工作', '实习与毕设并行：实习重积累，毕设重交付。'],
        ['社会关系', '每两周主动联系一位老同学或导师。'],
        ['财务', '记满一个月流水，找出可以砍掉的三笔固定支出。'],
        ['收纳', '实验室工位每周五清一次，宿舍以桌面为界。'],
        ['自媒体', '博客每周更一篇，不追热点只写消化过的东西。'],
        ['写作', '把「卡片笔记写作法」用到公开稿流程里。']
    ]) {
        const saved = await readSetting(`seed:domain:${title}`);
        if (!saved)
            continue;
        domainIds[title] = saved;
        await demoFill(`domain:${title}`, saved, { focus });
    }

    /* ── 课程 ─────────────────────────────────────────────── */
    const courseIds: Record<string, string> = {};
    const courseFills: Record<string, { semester: string; chapters: string; criteria: string }> = {
        '数据结构与算法': {
            semester: '2026 秋季学期',
            chapters: '线性表 → 栈与队列 → 串与数组 → 树与二叉树 → 图 → 查找 → 排序；当前进行到树与二叉树。',
            criteria: '5 次实验全部通过在线评测，期末大作业为课程设计（自选题目，需答辩）；实验报告需包含复杂度分析。'
        },
        'C 语言程序设计与实验': {
            semester: '2026 秋季学期',
            chapters: '指针与内存模型 → 结构体与联合 → 文件 IO → 模块化与 Makefile；当前进行到文件 IO。',
            criteria: '每周一次上机实验（当堂验收），期末综测 = 实验 40% + 期末机试 60%。'
        },
        '人工智能导论': {
            semester: '2026 秋季学期',
            chapters: '搜索与启发式 → 知识表示 → 机器学习基础 → 神经网络入门 → 大模型应用；当前进行到机器学习基础。',
            criteria: '两次小作业（搜索与分类器）+ 期末读书报告；鼓励用课程知识改造自己的项目。'
        },
        '物联网技术与实验': {
            semester: '2026 秋季学期',
            chapters: '传感器与采集 → 短距离通信 → MQTT 与云平台 → 综合实验；当前进行到 MQTT。',
            criteria: '3 人一组完成一个端到端小系统（采集 → 上云 → 可视化），期末现场演示。'
        },
        '智能终端与移动应用开发': {
            semester: '2026 秋季学期',
            chapters: 'Kotlin 基础 → Jetpack Compose → 网络与存储 → 发布流程；当前进行到网络与存储。',
            criteria: '个人 App 一次迭代验收 + 期末作品；要求至少使用一个系统传感器。'
        },
        '软件架构与应用开发': {
            semester: '2026 秋季学期',
            chapters: '分层与模块化 → 设计模式 → 前后端分离 → 微服务概览；当前进行到设计模式。',
            criteria: '小组项目按迭代交付（3 个迭代），每次迭代交可运行版本与架构说明。'
        },
        '大数据可视化技术': {
            semester: '2026 秋季学期',
            chapters: '可视化感知基础 → 图表语法 → 交互设计 → 大屏综合案例；当前进行到图表语法。',
            criteria: '两份个人可视化作品 + 期末小组大屏；评分关注「图表选型的理由」。'
        }
    };
    for (const [title, fill] of Object.entries(courseFills)) {
        const id = await readSetting(`seed:course:${title}`);
        if (!id)
            continue;
        courseIds[title] = id;
        await demoFill(`course:${title}`, id, fill);
    }

    /* ── 项目 ─────────────────────────────────────────────── */
    const projectIds: Record<string, string> = {};
    const projectFills: Record<string, Record<string, unknown>> = {
        '个人博客': {
            stage: '公开试运行',
            outcome: '公开花园 + 私密工作台双层结构已上线：发布/撤回、版本冲突保护、附件与证据快照、AI 助手（提议确认制）均可用。',
            criteria: '连续 4 周每周更新一篇公开内容；备份与恢复演练通过；自己每天真的在用它记录。',
            nextStep: '把「AI 助手接入记」整理成公开稿；补一次完整的恢复演练。',
            milestones: '9 月完成双层架构改造 → 10 月公开试运行 → 11 月 AI 助手与复盘流程融合 → 学期末输出一篇完整实践总结。',
            decisions: '私密记录与公开内容分开存储，公开永远由自己手动发布——换来的是「敢往工作台里写任何东西」。',
            weeklyCommitment: true
        },
        '毕业设计': {
            stage: '选题与开题',
            outcome: '备选方向收敛到「面向个人的 AI 记忆辅助」，完成 2 篇综述的精读笔记。',
            criteria: '开题报告通过；有一个能跑通最小闭环的原型；实验有可对比的基线。',
            nextStep: '本周内约导师确认选题；列出新需要精读的论文清单。',
            milestones: '10 月定题 → 11 月最小原型 → 12 月中期检查 → 次年 3 月实验与论文。',
            decisions: '放弃「纯 Web 应用」类选题，选择与自己真实需求相关的方向，动机更足。'
        },
        'JellyStudy': {
            stage: '核心功能打磨',
            outcome: '学习打卡与统计核心链路可用，注册用户 20+（同学内测）。',
            criteria: '崩溃率 < 1%；周留存 ≥ 30%；应用商店可提审。',
            nextStep: '修复反馈最多的两个问题：打卡提醒不准、统计页加载慢。',
            milestones: '8 月完成 MVP → 10 月内测 → 11 月提审。',
            decisions: '砍掉社交功能专注单机体验——团队只有自己，功能越少越容易维护。'
        },
        '简历系统': {
            stage: '等待反馈，暂缓',
            outcome: 'Markdown 简历 → PDF 的渲染与版本管理已可用。',
            criteria: '导出 PDF 排版稳定；支持至少 3 套模板。',
            nextStep: '等实习投递的反馈回来，再决定是否继续投入。',
            milestones: '已完成渲染核心；后续视需要加模板。'
        },
        '幼小衔接教育游戏': {
            stage: '原型验证',
            outcome: '识字关卡原型可在平板上运行，家人群里 3 个孩子试玩过。',
            criteria: '孩子独立玩满 10 分钟不求助；家长愿意第二天再打开。',
            nextStep: '把「错误重试不惩罚」的机制做进计分逻辑。',
            milestones: '10 月原型 → 11 月规则迭代 → 学期末给亲属孩子做一轮正式试用。'
        }
    };
    for (const [title, fill] of Object.entries(projectFills)) {
        const id = await readSetting(`seed:project:${title}`) || (title === '毕业设计' ? await readSetting('seed:graduation') : undefined);
        if (!id)
            continue;
        projectIds[title] = id;
        await demoFill(`project:${title}`, id, fill);
    }
    const graduationId = await readSetting('seed:graduation');
    if (graduationId)
        projectIds['毕业设计'] = graduationId;

    /* ── 笔记 ─────────────────────────────────────────────── */
    const noteIds: Record<string, string> = {};
    const notes: [string, string, string, [string, string][], string[]][] = [
        ['整理：实验报告的复用模板', '每次写实验报告都在重新发明结构。待整理：把「目的 / 方案 / 关键代码 / 复杂度 / 踩坑」固定成模板，实验四的报告应该可以直接套。', '', [], []],
        ['灵感：给博客加一个「现在正在听」小模块', '通勤时听播客的时间很长，可以做一个只展示「最近一周在听什么」的小卡片，数据手动维护，不接第三方 API。', '', [], []],
        ['链表与指针：我卡住的三天', '卡点不是链表本身，而是**指针的指向图没有画对**。\n\n## 三个后来救了我的习惯\n\n1. 每次改指针前先画 before/after 两张图；\n2. 把 `node->next` 读作「node 里存的那个地址」，而不是「node 的下一个」；\n3. 边界从空表和一个元素开始测。\n\n> 指针只是地址，画图比背口诀有用。\n\n剩下的疑问：双向链表的删除为什么书上要先判 `p->prior`，我自己的写法为什么不安全？', '', [['数据结构与算法', 'chapter']], ['算法', 'C']],
        ['React Server Components 到底解决了什么', '一句话：**把「取数据」的往返从浏览器搬回服务器**，组件树的一部分只在服务端渲染，客户端包体更小。\n\n- 服务端组件：可以直接 `await` 数据、访问数据库，不能有状态；\n- 客户端组件：交互与状态，通过 `use client` 声明；\n- 我的理解：它不是「服务端渲染」的替代，而是把组件依赖图按需拆分。\n\n待验证：把这个博客的一个列表页改造成 RSC，对比首屏体积。', '', [['个人博客', 'source']], ['前端']],
        ['MQTT 与 IoT 通信笔记', '发布/订阅模型，Broker 居中转发。\n\n- QoS 0 最多一次、1 至少一次、2 恰好一次；传感器上报用 1 就够；\n- 遗嘱消息（LWT）：设备掉线时 Broker 代发，适合做掉线告警；\n- 主题设计：`campus/{组号}/{设备类型}/{数据名}`，层级清晰才好通配订阅。\n\n实验课的坑：EMQX 免费版对连接数有限制，全组共用一个 Broker 要注意 client id 不能重复。', '', [['物联网技术与实验', 'chapter']], ['IoT']],
        ['费曼技巧第一次完整实践', '把「CAP 定理」讲给室友（非计算机专业）听，第一遍就卡壳了。\n\n过程：讲 → 卡在「一致性到底指什么」→ 回去重读 → 用「群公告」打比方重讲 → 室友能复述了。\n\n结论：**卡壳的地方就是理解的地基缺口**。以后每章挑一个概念讲一遍，录音回听。', '', [['学习', 'related']], ['方法']],
        ['毕业设计选题备选清单', '方向 A：个人知识库的 AI 摘要与检索（和博客项目天然衔接，数据现成）；\n方向 B：面向儿童的识字练习游戏化（和幼小衔接项目呼应）；\n方向 C：课堂实验报告的自动评审。\n\n倾向 A：数据、动机、前期积累都最足，风险是「检索增强」做烂了像演示 Demo，要有可对比的评测。', '', [['毕业设计', 'related']], ['毕设']],
        ['AI 导论：神经网络速记', '- 感知机 → 多层感知机，激活函数引入非线性；\n- 反向传播 = 链式法则 + 梯度下降；\n- 过拟合的两个直觉：参数太多记住了噪声、训练集太小；\n- 实验里最有效的正则化居然是「早停」。\n\n联想到自己的项目：AI 助手的「提议—确认」机制，本质上就是把模型输出限制在人类可审查的边界里。', '', [['人工智能导论', 'chapter']], ['AI']],
        ['C 语言常见坑清单（实验课血泪）', '- `scanf("%d", x)` 忘写 `&`，编译能过运行必炸；\n- 数组越界在 OJ 上可能是「未定义行为」而不是报错；\n- `char *s = "abc"` 不可写，`char s[] = "abc"` 才可写；\n- 结构体传参传值拷贝，大结构体用指针。\n\n每条都是一次 0 分换来的，期末机试前重读一遍。', '', [['C 语言程序设计与实验', 'chapter']], ['C']],
        ['移动开发实验：从 XML 布局到 Compose 的观察', '同一个「课程表」界面：XML 版 180 行 + 两个 Adapter；Compose 版 90 行，状态驱动。\n\n最大心智转变：不再「找到控件再改」，而是「描述状态长什么样」。代价是重组性能需要额外留心，列表 key 不稳定会整页刷新。', '', [['智能终端与移动应用开发', 'chapter']], ['移动端']]
    ];
    for (let i = 0; i < notes.length; i++) {
        const [title, body, , linksSpec, tags] = notes[i];
        const status = i < 2 ? 'INBOX' : 'ACTIVE';
        const links = linksSpec.map(([toKey, relation]) => ({ toId: (toKey === '学习' ? domainIds['学习'] : courseIds[toKey] || projectIds[toKey])!, relation }));
        const r = await demo(`note:${i}`, 'NOTE', title, {}, body, links, status, tags);
        noteIds[title] = r.id;
    }

    /* ── 行动 ─────────────────────────────────────────────── */
    const actionIds: Record<string, string> = {};
    const a1 = await demo('action:lab-report', 'ACTION', '完成数据结构第 5 次实验报告', {
        plannedAt: day(0), dueAt: day(0), priority: 1, important: true, todayFocus: true
    }, '树与二叉树的实验：建树、四种遍历、求深度。报告需要复杂度分析小节。', [{ toId: courseIds['数据结构与算法'], relation: 'assignment' }], 'TODO', ['课程']);
    actionIds['实验报告'] = a1.id;
    await demo('action:queue-code', 'ACTION', '实现循环队列与测试用例', { parentId: a1.id, priority: 1 }, '牺牲一个存储单元区分队空队满；边界：空队、满队、假溢出。', [], 'DONE', ['课程']);
    await demo('action:report-section', 'ACTION', '写实验报告：复杂度分析小节', { parentId: a1.id, plannedAt: day(0), priority: 2 }, '先画 n-log-n 的实测曲线，再对照理论推导。', [], 'TODO', ['课程']);
    const a2 = await demo('action:thesis-outline', 'ACTION', '准备毕业设计开题报告提纲', { plannedAt: day(3), dueAt: day(5), priority: 1, important: true, todayFocus: true }, '按「问题定义 → 相关工作 → 技术路线 → 评测方案」组织，先写一页纸版本给导师看。', [{ toId: projectIds['毕业设计'], relation: 'related' }], 'TODO', ['毕设']);
    actionIds['开题提纲'] = a2.id;
    actionIds['blog-weekly'] = (await demo('action:blog-weekly', 'ACTION', '周更博客：AI 助手接入记', { dueAt: day(2), priority: 2 }, '素材已有：提议确认机制、流式中断、幂等。整理成公开稿草稿。', [{ toId: projectIds['个人博客'], relation: 'related' }], 'TODO', ['写作'])).id;
    await demo('action:jelly-feedback', 'ACTION', '回复 JellyStudy 用户反馈', { plannedAt: day(1), repeat: 'WEEKLY', priority: 3 }, '每周一集中处理一次，不做即时响应。', [], 'TODO', ['项目']);
    await demo('action:advisor-reply', 'ACTION', '预约导师讨论毕设方向', { dueAt: day(-2), priority: 1, important: true, blocker: '等导师回复邮件，已说明选题倾向与两篇综述笔记。', }, '', [{ toId: projectIds['毕业设计'], relation: 'related' }], 'WAITING', ['毕设']);
    await demo('action:card-reissue', 'ACTION', '补办校园卡', { priority: 3, blocker: '需要身份证复印件，复印件在宿舍抽屉，周末才能弄。' }, '', [], 'BLOCKED');
    actionIds['error-notes'] = (await demo('action:error-notes', 'ACTION', '整理上周错题本', { dueAt: day(-1), priority: 2 }, '只整理「错因」列，题干拍照归档即可。', [{ toId: courseIds['数据结构与算法'], relation: 'related' }], 'TODO')).id;
    await demo('action:running', 'ACTION', '跑步 3 公里', { plannedAt: day(0), repeat: 'WEEKLY', priority: 3 }, '操场 4 圈，配速不重要，完成就行。', [{ toId: domainIds['身体'], relation: 'related' }], 'DONE');
    await demo('action:reading-ch4', 'ACTION', '阅读《卡片笔记写作法》第 4 章', { plannedAt: day(-1), priority: 2 }, '重点：永久笔记与文献笔记的区别。', [], 'DONE');
    await demo('action:gh-actions', 'ACTION', '配置博客自动部署', { dueAt: day(-3), priority: 2 }, 'push 后自动构建发布，省去手动步骤。', [{ toId: projectIds['个人博客'], relation: 'related' }], 'DONE');

    /* ── 资源 ─────────────────────────────────────────────── */
    await demo('resource:card-notes-book', 'RESOURCE', '《卡片笔记写作法》', {
        resourceType: '书', author: '申克·阿伦斯',
        assessment: '摘录：「不写，就无法思考。」评价：把卢曼的卡片盒讲得很透，前 3 章方法密度高，后面略啰嗦。局限：例子偏学术写作，工程类笔记要自己迁移。'
    }, '用自己的话重写卡片是关键动作，抄书没有用。相关性靠链接而不是文件夹分类。', [], 'READING', ['方法']);
    await demo('resource:react-book', 'RESOURCE', '《React 学习手册（第 2 版）》', {
        resourceType: '书', author: 'Alex Banks & Eve Porcello',
        assessment: '摘录：组件即函数，UI 是状态的投影。评价：Hooks 章节讲得比官方文档细。局限：出版较早，不含 RSC，需配合官方新文档。'
    }, '第 6 章的 useEffect 清理函数示例直接解决了我博客里一个内存泄漏。', [], 'DONE', ['前端']);
    await demo('resource:mdn', 'RESOURCE', 'MDN Web Docs', {
        resourceType: '网站', url: 'https://developer.mozilla.org/zh-CN/',
        assessment: '评价：Web 标准的第一查询入口，中文质量稳定。局限：偏 API 手册，缺少「什么时候该用」的工程视角。'
    }, '', [], 'ACTIVE', ['前端']);
    await demo('resource:flomo', 'RESOURCE', 'flomo 浮墨笔记', {
        resourceType: 'App', url: 'https://flomoapp.com',
        assessment: '评价：卡片式速记，标签体系轻量，适合收件箱阶段。局限：长文组织弱，我把「沉淀后的笔记」搬进花园，flomo 只做出草稿箱。'
    }, '', [], 'ACTIVE', ['工具']);
    await demo('resource:cs61b', 'RESOURCE', 'UCB CS61B 课程主页', {
        resourceType: '课程资料', url: 'https://cs61b-2.fa24-cs61bperimental.link/——占位，正式地址见课程群',
        assessment: '评价：数据结构的实验设计极好，自动评测反馈快。局限：全英文，作业量大，只挑了链表与树两部分跟做。'
    }, '', [], 'READING', ['算法']);

    /* ── 人物与物品 ───────────────────────────────────────── */
    const personAdvisor = await demo('person:advisor', 'PERSON', '王老师（毕设导师）', { entityType: '人物', organization: '计算机学院', contact: '学院邮箱（见课表页）', followUpAt: day(4), experiences: '大三下进组旁听组会；选题讨论过两次，倾向应用型课题。' }, '', [{ toId: domainIds['社会关系'], relation: 'related' }], undefined, ['导师']);
    await demo('person:partner', 'PERSON', '李同学（课程实验搭档）', { entityType: '人物', organization: '同班', contact: '微信', experiences: '物联网实验同组；他负责硬件采集，我负责上云与可视化。' }, '', [], undefined, ['伙伴']);
    await demo('person:club', 'PERSON', '校编程社团', { entityType: '组织', organization: '校科协', experiences: '每周四晚算法小课堂；在那儿第一次讲「链表与指针」分享。' }, '', [], undefined, ['社群']);
    await demo('item:laptop', 'ITEM', '笔记本电脑', { location: '宿舍书桌', quantity: 1, maintenanceAt: day(20) }, '风扇声音变大时清灰；毕业设计主力机，数据每周随博客一起备份。', [], 'ACTIVE');
    await demo('item:monitor', 'ITEM', '外接显示器', { location: '实验室工位', quantity: 1 }, '', [], 'ACTIVE');
    await demo('item:kindle', 'ITEM', 'Kindle', { location: '宿舍床头抽屉', quantity: 1, maintenanceAt: day(60) }, '充电一次用一个月；睡前阅读专用，不放学习资料。', [], 'ACTIVE');

    /* ── 账户 / 收支 / 预算 ───────────────────────────────── */
    const campus = await demo('account:campus', 'ACCOUNT', '校园卡', { openingCents: 12000 }, '', [], 'ACTIVE');
    const alipay = await demo('account:alipay', 'ACCOUNT', '支付宝', { openingCents: 35600 }, '', [], 'ACTIVE');
    const tx = (key: string, title: string, account: string, amountCents: number, direction: 'OUT' | 'IN', category: string, occurredAt: string) =>
        demo(`tx:${key}`, 'TRANSACTION', title, { accountId: account === '校园卡' ? campus.id : alipay.id, amountCents, direction, category, occurredAt }, '', [], 'ACTIVE');
    await tx('b1', '食堂早餐', '校园卡', 600, 'OUT', '餐饮', monthDay(16));
    await tx('b2', '食堂午餐', '校园卡', 1500, 'OUT', '餐饮', monthDay(15));
    await tx('b3', '食堂晚餐', '校园卡', 1400, 'OUT', '餐饮', monthDay(14));
    await tx('b4', '超市水果', '校园卡', 2300, 'OUT', '餐饮', monthDay(13));
    await tx('b5', '奶茶', '支付宝', 1500, 'OUT', '餐饮', monthDay(11));
    await tx('b6', '打印实验资料', '校园卡', 800, 'OUT', '学习', monthDay(9));
    await tx('b7', '《卡片笔记写作法》', '支付宝', 4500, 'OUT', '学习', monthDay(12));
    await tx('b8', '云服务器月费', '支付宝', 990, 'OUT', '数码', monthDay(5));
    await tx('b9', '地铁', '支付宝', 400, 'OUT', '交通', monthDay(16));
    await tx('b10', '公交', '支付宝', 200, 'OUT', '交通', monthDay(10));
    await tx('b11', '电影票', '支付宝', 3600, 'OUT', '娱乐', monthDay(6));
    await tx('b12', '洗漱用品', '支付宝', 2800, 'OUT', '日用', monthDay(4));
    await tx('i1', '实习兼职工资（10 月上旬）', '支付宝', 200000, 'IN', '实习', monthDay(10));
    await tx('i2', '三等奖学金', '支付宝', 300000, 'IN', '奖学金', monthDay(8));
    for (const [category, limitCents] of [['餐饮', 80000], ['学习', 30000], ['数码', 20000], ['交通', 10000]])
        await demo(`budget:${category}`, 'BUDGET', `预算 · ${category}（${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}）`, { category, period: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, limitCents }, '', [], 'ACTIVE');

    /* ── 问题 ─────────────────────────────────────────────── */
    await demo('issue:sleep', 'ISSUE', '睡前刷手机导致晚睡', {
        observation: '连续一周记录：0 点前入睡只有 1 天，睡前都在床上刷短视频。',
        impact: '早上第一节课犯困，实验课效率明显下降。',
        hypothesis: '手机放在床头，且没有替代的睡前仪式。'
    }, '', [{ toId: domainIds['精神'], relation: 'related' }], 'TRYING');
    await demo('issue:review-efficiency', 'ISSUE', '复习时看了很多但记不住', {
        observation: '期中前通读两遍教材，合上书能复述的不到三成。',
        impact: '复习时间花了，考试还是靠考前突击。',
        hypothesis: '「重读」是被动输入，缺少提取练习。',
        experiment: '改成「先做题 → 错了再翻书」的顺序，并用费曼技巧每章讲一个概念。',
        checkAt: day(14),
        result: ''
    }, '', [{ toId: domainIds['学习'], relation: 'related' }], 'OBSERVING');
    await demo('issue:inbox-stuck', 'ISSUE', '收件箱笔记堆积不整理', {
        observation: '收件箱最多积到 14 条，很多当场想清楚的东西过期就忘了语境。',
        impact: '记了等于没记，整理成本越拖越高。',
        hypothesis: '「整理」的定义太模糊，缺少一个 5 分钟内能完成的最小动作。',
        result: '实验：每天只要求「给 1 条笔记加标签并链接去处」。两周后收件箱稳定在 5 条以内，问题解除。'
    }, '', [{ toId: domainIds['写作'], relation: 'related' }], 'RESOLVED');
    await demo('issue:procrastination', 'ISSUE', '大任务总拖到截止前一天', {
        observation: '实验报告、开题材料都在截止前 24 小时内完成。',
        impact: '质量靠运气，没有时间复查；熬夜影响第二天。',
        hypothesis: '任务太大没有入口，启动成本高。'
    }, '', [{ toId: domainIds['学习'], relation: 'related' }], 'CLARIFY');

    /* ── 复盘（含证据快照） ──────────────────────────────── */
    const r1 = await demo('review:week42', 'REVIEW', '周复盘 · 第 42 周', {
        scope: '周复盘',
        expected: '完成数据结构实验与报告初稿；博客周更一篇；跑步两次。',
        actual: '实验代码完成并通过评测；报告只写了方案小节；博客未更；跑步 1 次。',
        adjustment: '继续：实验节奏。改变：报告拆成两个 25 分钟的子任务排进当天；周更文章改为「先写 200 字开头」降低启动成本。'
    }, '', [
        { toId: actionIds['实验报告'], relation: 'evidence' },
        { toId: actionIds['开题提纲'], relation: 'evidence' },
        { toId: noteIds['链表与指针：我卡住的三天'], relation: 'evidence' }
    ], 'ACTIVE');
    if (r1.fresh)
        await snapshotReview(r1.id, 1);
    const r2 = await demo('review:blog-project', 'REVIEW', '项目复盘 · 个人博客公开试运行两周', {
        scope: '项目复盘',
        expected: '公开 4 篇、每周一篇；邀请 3 位朋友试用并反馈。',
        actual: '公开 3 篇（AI 接入记难产）；2 位朋友给了反馈：花园页「整理程度」标签让人愿意读半成品。',
        adjustment: '继续：花园页持续整理的定位。改变：长文先出花园版再升级成文章。暂停：暂不做评论系统，观察一个月。'
    }, '', [
        { toId: projectIds['个人博客'], relation: 'evidence' },
        { toId: actionIds['blog-weekly'], relation: 'evidence' }
    ], 'ACTIVE');
    if (r2.fresh)
        await snapshotReview(r2.id, 1);
    const r3 = await demo('review:course-ds', 'REVIEW', '课程总结 · 数据结构与算法前半程', {
        scope: '课程总结',
        expected: '前四章测验 90+，实验全部一次通过。',
        actual: '测验 85，实验三次通过一次返工；「画指针图」的习惯是在返工后才建立的。',
        adjustment: '继续：画图与边界优先。改变：每周把本章内容讲给室友一次（费曼）。'
    }, '', [
        { toId: courseIds['数据结构与算法'], relation: 'evidence' },
        { toId: noteIds['链表与指针：我卡住的三天'], relation: 'evidence' },
        { toId: actionIds['error-notes'], relation: 'evidence' }
    ], 'DONE');
    if (r3.fresh)
        await snapshotReview(r3.id, 1);
    const r4 = await demo('review:week41', 'REVIEW', '周复盘 · 第 41 周', {
        scope: '周复盘',
        expected: '把收件箱清到 5 条以内；完成一次恢复演练。',
        actual: '收件箱降到 4 条；恢复演练做完并写了操作卡。',
        adjustment: '继续：每日一条的整理节奏。'
    }, '', [{ toId: domainIds['写作'], relation: 'evidence' }], 'DONE');
    if (r4.fresh)
        await snapshotReview(r4.id, 1);
    const r5 = await demo('review:daily-ai', 'REVIEW', '日复盘 · 第一次让 AI 助手整理收件箱', {
        scope: '日复盘',
        expected: '用分析模式让助手给收件箱笔记打标签建议，全程人来确认。',
        actual: '助手 4 条提议我确认 3 条、拒绝 1 条；拒绝的那条它把「灵感」误标成「课程」。',
        adjustment: '继续：分析模式用于批量整理。注意：涉及个人判断的标签仍要逐条看。'
    }, '', [{ toId: noteIds['灵感：给博客加一个「现在正在听」小模块'], relation: 'evidence' }], 'DONE');
    if (r5.fresh)
        await snapshotReview(r5.id, 1);

    /* ── 渠道稿件 ─────────────────────────────────────────── */
    await demo('channel:zhihu', 'CHANNEL', '《课程实验怎么记才真的有用》同步知乎', { channel: '知乎', url: 'https://zhuanlan.zhihu.com', publishedAt: day(0) }, '公开花园首发后第二天同步，末尾附原文链接。', [], 'PUBLISHED');
    await demo('channel:xhs', 'CHANNEL', '幼小衔接游戏试玩片段发小红书', { channel: '小红书', url: 'https://www.xiaohongshu.com', publishedAt: day(3) }, '等原型第二版录屏后再发。', [], 'DRAFT');

    /* ── 公开稿 ───────────────────────────────────────────── */
    const pub = async (key: string, publicationType: string, slug: string, title: string, summary: string, body: string, extra: Record<string, unknown> = {}, tags: string[] = []) => {
        const r = await demo(`pub:${key}`, 'PUBLICATION', title, { publicationType, slug, summary, ...extra }, body, [], undefined, tags);
        const row = await db.record.findUniqueOrThrow({ where: { id: r.id } });
        const prior = await db.publishedVersion.count({ where: { publicationId: r.id } });
        if (!prior)
            await publish(r.id, row.version);
        return r;
    };

    await pub('why-garden', 'article', 'why-digital-garden', '为什么我把博客造成了数字花园',
        '从「只发完成品」到「公开整理过程」：一次改版背后的动机、结构和取舍。',
        `## 博客的死气沉沉\n\n我的第一版博客很标准：首页、文章列表、关于页。它的问题不是难看，而是**沉默**——只有写完一篇「够格」的文章才配出现在上面。结果是半年三篇，每篇都憋得要命。\n\n直到我读到「数字花园」这个说法：公开的笔记可以是一部**进行中的作品**，允许不成熟，鼓励持续修剪。\n\n## 现在的结构\n\n我把网站分成两层：\n\n- **公开花园**：文章、作品、推荐，还有一块特殊的「成长花园」——展示尚在整理中的主题，每篇都标着整理程度；\n- **私密工作台**：课堂笔记、行动、复盘、财务，所有粗糙的过程都在这里发生。\n\n两层之间有一条单向通道：工作台里的素材可以被整理成公开稿，由我手动决定何时发布。\n\n> 隐私不是把门焊死，而是让每个想法在合适的时机、以合适的完成度被看见。\n\n## 一个月后的变化\n\n最大的变化是**发布频率反而上来了**。因为花园里的半成品也算「已发布」，完成品的压力小了；而读者的反馈常常发生在半成品阶段，正好来得及改。\n\n第二个变化是我开始复盘自己的记录习惯——这部分留到下一篇文章。`,
        { featured: true, maturity: '阶段总结' }, ['数字花园', '元笔记']);

    await pub('course-lab', 'article', 'how-to-take-lab-notes', '课程实验怎么记才真的有用',
        '七个学期的实验课踩坑后，我把实验记录拆成了五段结构，报告和复盘都变快了。',
        `## 实验课记录的三个常见坑\n\n1. **只贴代码**。两周后自己都看不懂当时为什么这么写；\n2. **只有结果没有岔路**。真正值钱的是「试过 A 不行，因为 X，换成了 B」；\n3. **报告和笔记分离**。写报告时重新回忆一遍，纯浪费。\n\n## 我现在用的五段结构\n\n\`\`\`text\n1. 目的 —— 一句话，这条实验在回答什么问题\n2. 方案 —— 关键决策与备选项（为什么不选另一个）\n3. 关键代码 —— 只贴核心，附一句「这里在干什么」\n4. 复杂度 / 数据 —— 实测量化，有图最好\n5. 踩坑 —— 每条坑对应一条「下次怎么办」\n\`\`\`\n\n> 坑的记录比成功的记录更值得写，因为考试和工程里回来找的都是它们。\n\n## 和复盘连起来\n\n每次期中我把本学期的实验记录按「坑」归类复盘一次，会发现同一类坑反复出现——比如我连着三个学期在「边界条件」上翻车。识别出这种模式，比多做三道题有用。\n\n这套结构我已经固化到了工作台的笔记模板里，你可以在这座花园的「成长笔记」里看到活生生的例子。`,
        { maturity: '阶段总结' }, ['方法', '课程']);

    await pub('two-weeks-workbench', 'article', 'two-weeks-private-workbench', '用两周搭出一个私密工作台',
        '不是产品测评，是一份建造日志：一个只属于自己「敢写任何东西」的地方是怎么长出来的。',
        `## 起点：一条不敢发的朋友圈\n\n有些想法介于「发出去太琐碎」和「不记下来可惜」之间。它们需要一个不必顾及任何读者的容器。\n\n## 两周里做了什么\n\n- **第 1-3 天**：确定双层结构。公开与私密物理隔离，私密层有独立的登录与来源校验；\n- **第 4-7 天**：记录骨架。笔记、行动、复盘三件套先行，先让「记」成立；\n- **第 8-10 天**：并发保护。两个窗口同时编辑，后保存的会收到冲突提示并保留输入——数据是我自己的，宁可多一次点击也不能丢字；\n- **第 11-14 天**：断网与恢复演练。自动保存失败时输入必须原地保留。\n\n## 几个反直觉的决定\n\n**不做协同编辑**。用户只有我一个，多人光标是伪需求。\n\n**发布永远是手动动作**。哪怕将来 AI 帮我起草，最后一道发布按钮也只属于我。\n\n> 工具的边界就是信任的边界。工作台里写下的每一句吐槽，都以「永远不会公开」为前提。\n\n## 下一步\n\n接入 AI 助手时我给自己立了三条规矩：它只能提议、不能拍板；它碰不到发布按钮；每一次它的动作都留下可查的账。这些规矩的实现细节，等我再攒两周素材来写。`,
        { maturity: '持续整理' }, ['建造日志', '元笔记']);

    await pub('work-garden', 'work', 'garden-workbench', '个人数字花园工作台',
        '一个双层结构的个人站点：公开花园负责生长，私密工作台负责沉淀。本站本身。',
        `## 这是什么\n\n你正在浏览的这座花园，以及它背后那个带登录的工作台，是我为「记录 → 整理 → 公开」这条链路做的完整工具。\n\n## 技术构成\n\n- Next.js + React 的应用骨架，SQLite 单文件存储，部署简单到只有一个数据目录；\n- 私密侧覆盖笔记、行动、复盘、课程、项目、财务等十五类记录，彼此可以用关系连接；\n- 公开侧分文章、作品、花园笔记、推荐四类内容，支持草稿、更新与撤回全生命周期。\n\n## 我最在意的三个细节\n\n1. **并发保护**：两个窗口同时编辑同一条记录，后保存者会得到冲突提示并保留自己的输入；\n2. **证据快照**：复盘可以保存关联记录的「当时样子」，之后素材怎么改都不影响结论的可信度；\n3. **AI 边界**：助手只能提议，所有确认由我完成，所有操作可审计。`,
        { role: '独立完成：需求、设计、开发、部署与持续迭代', limitations: '单用户设计，没有考虑多人协作；部署文档面向本机与单域名场景。', featured: true, maturity: '阶段总结' }, ['全栈', '数字花园']);

    await pub('work-kindergarten', 'work', 'kindergarten-game-demo', '幼小衔接识字游戏 Demo',
        '给家里孩子的识字练习做的游戏化原型：错误不惩罚，重试即学习。',
        `## 设计初衰\n\n家里有个即将上小学的小朋友，市面上的识字 App 要么广告密布，要么把「答错」做得像惩罚。我想验证一件事：**把挫败感从循环里拿掉，孩子愿不愿意自己一直玩下去。**\n\n## 玩法\n\n- 每关 6 个字，配图与语音；\n- 选错不扣分，卡片会「害羞地」晃一晃，可以无限次再选；\n- 连续答对触发小动画庆祝，进度条只涨不跌。\n\n## 目前状态\n\n平板端原型可玩，家人群 3 个孩子试玩过，最长的独立玩了 12 分钟。下一步把「错误重试不惩罚」写进计分逻辑的细节里。`,
        { role: '游戏设计、图形与交互实现；音效素材来自免费素材库', limitations: '字库仅覆盖大班常用字前 80 个，语音为合成音，平翘舌音偶尔不准。', maturity: '持续整理' }, ['教育', '独立开发']);

    await pub('garden-feynman', 'garden', 'feynman-in-practice', '费曼技巧实践碎片',
        '把「讲给别人听」变成日常动作的记录：卡壳的地方，就是理解的地基缺口。',
        `## 起点\n\n一直知道费曼技巧，但从未真正把它变成日常。这一页从九月开始，记录每一次「讲给室友听」的实验。\n\n## 已有的碎片\n\n- **CAP 定理**：第一遍卡在「一致性」，用「群公告」比方重讲后室友能复述；\n- **指针**：发现画 before/after 图比任何口诀都管用，于是把它发展成了固定的讲解道具；\n- **MQTT QoS**：室友问「为什么不能都用 QoS 2」，逼我去查了握手开销，讲清楚了一个我原本含糊的点。\n\n## 正在进行的实验\n\n每周挑一个概念录音讲一遍，回听时记录卡壳时刻。初步发现：**我卡壳的位置高度集中在「定义的边界情况」**，这说明我平时的理解停在典型例子上。\n\n（这个页面会持续更新，最近一次整理见发布日期。）`,
        { maturity: '持续整理', featured: true }, ['方法', '学习']);

    await pub('garden-thesis', 'garden', 'thesis-topic-wandering', '毕业设计选题摇摆记录',
        '从「做个 App」到「AI 记忆辅助」：把选题过程中的摇摆公开留下来，等半年后回看。',
        `## 摇摆轨迹\n\n- **9 月**：想做个「课程实验报告自动评审」，被自己问倒——评审标准本身就是未解问题；\n- **9 月底**：转向「儿童识字游戏化」，家里正好有试玩用户；但缺理论支撑，容易被质疑「只是个玩具」；\n- **10 月**：回到「面向个人的 AI 记忆辅助」。数据我有（这座花园）、动机我有（我自己要用）、评测可以拿「检索命中率 + 用户确认率」做基线。\n\n## 目前倾向\n\n方向 A。风险记录：检索增强类课题做浅了像 Demo，必须设计可对比的实验。\n\n## 悬而未决\n\n- 评测集从哪来？自己的笔记会不会样本太小；\n- 隐私边界：评测数据要不要脱敏。\n\n（选题没定稿，先公开。定稿后这里会留一条「后续」。）`,
        { maturity: '初步记录' }, ['毕设']);

    await pub('garden-slow', 'garden', 'slow-is-fast-algorithms', '慢就是快：算法学习手记',
        '追进度追到崩盘之后，我把「每周讲懂一个结构」当成唯一指标，反而走顺了。',
        `## 崩盘实录\n\n九月给自己定过计划：两周刷完树。结果链表的指针题还在返工，树的遍历靠背代码，周测打回原形。\n\n## 换了个指标\n\n现在唯一指标：**每周把一个结构讲给别人听，讲到对方能复述**。速度慢了一半，但十月的两次测验是这学期第一次没靠突击。\n\n## 慢在哪，快在哪\n\n- 慢：新结构上手晚一至两周；\n- 快：复习时间少了——第一次学懂的东西不需要第二次重学。\n\n> 学过 ≠ 学懂。复述是最便宜的检测器。\n\n（手记会随进度继续更新。）`,
        { maturity: '阶段总结' }, ['算法', '学习']);

    await pub('rec-card-notes', 'recommendation', 'book-card-notes-method', '推荐《卡片笔记写作法》',
        '如果你「读了很多书却写不出东西」，这本书提供了一套被验证过的替代方案：不靠意志力，靠流程。',
        `## 为什么留下它\n\n它把卢曼的卡片盒方法讲成了可执行的流程：文献笔记用自己的话重写、永久笔记每天限量、主题靠链接生长而不是靠文件夹归类。\n\n## 适合谁\n\n- 写论文、写长文的人：直接可用；\n- 工程师：迁移后适合做「决策日志」——每条卡片记录一个决策与理由；\n- 不适合：想要「21 天速成」的人，它给的是慢功夫。\n\n## 局限\n\n例子偏学术场景；对中文写作者，卡片软件选型部分需要自行替换。\n\n## 我的用法\n\n读到的每条值得留的话，都要求自己写一句「这让我想到什么」再入库——这条规则来自本书，也是这座花园能长起来的原因之一。`,
        { recommendationType: '书', audience: '想开始积累个人知识库的学生与写作者', limitations: '翻译腔偏重，前两章可以快读', maturity: '阶段总结' }, ['阅读', '方法']);

    await pub('rec-flomo', 'recommendation', 'app-flomo-capture', '推荐 flomo：只当草稿箱用',
        '一个克制到只有卡片和标签的速记工具。我用它接住碎片，沉淀后再搬进自己的花园。',
        `## 为什么留下它\n\n够快、够轻：打开到能输入只要一秒，这条体验让「随手记」真的发生了。它不试图成为你的第二大脑，只做捕获，反而是它最好的设计。\n\n## 适合谁\n\n- 有「想法转瞬即逝」困扰的人；\n- 已经有知识库、但缺少**入口**的人——把它放在体系最前端。\n\n## 局限\n\n长文组织弱、导出格式有限。所以我的分工很明确：flomo 只做收件箱，每周整理一次进花园，不沉淀私有资产在单一工具里。\n\n## 一个小技巧\n\n给 flomo 里每条卡片打上「来源标签」（书/课/对话），周整理时按来源批量处理，比按时间翻高效得多。`,
        { recommendationType: 'App', audience: '需要轻量捕获入口的笔记用户', limitations: '免费版有条数限制；深度组织能力有限', maturity: '持续整理' }, ['工具']);

    /* 草稿态展示（不发布） */
    await demo('pub:draft-ai', 'PUBLICATION', 'AI 助手接入记：先让助手提议，人来决定', {
        publicationType: 'article', slug: 'ai-assistant-proposal-first',
        summary: '给工作台接入 AI 助手时，我立的三条规矩与它们的实现。',
        maturity: '初步记录'
    }, `## 三条规矩\n\n1. 助手只能提议，不能拍板；\n2. 发布、删除、导入这些动作没有给 AI 的入口；\n3. 它做的每一步都有账可查。\n\n## 目前状态\n\n草稿。等再攒两周真实使用案例（包括失败案例）再公开。`,
        [], 'DRAFT', ['AI', '写作']);

    /* 更新态展示：发布后改稿 → 「有更新草稿」 */
    const ch = await pub('writing-flow', 'article', 'my-writing-flow', '我的写作流程：从收集到发布',
        '一条「捕获 → 整理 → 公开」的流水线，以及每个环节的 minimum viable 动作。',
        `## 三个环节\n\n- **捕获**：一分钟内能记完，不整理；\n- **整理**：每天只处理一条，加标签、链接去处；\n- **公开**：每周一篇，先出花园版再升级成文章。\n\n> 流程的目标不是高效，是**不断流**。\n\n## 工具分工\n\n速记交给 flomo，沉淀与发布都在自己的花园里完成。`,
        { maturity: '持续整理' }, ['写作', '元笔记']);
    {
        const rec = await getRecord(ch.id);
        if (!rec.body.includes('新增：卡住时怎么办')) {
            await updateRecord(ch.id, {
                kind: rec.kind,
                title: rec.title, body: `${rec.body}\n\n## 新增：卡住时怎么办（待发布部分）\n\n写不出「整理」那一节的时候，我现在的做法是把标准降到「只加一个标签」。先让球滚起来。`,
                fields: rec.fields, tags: rec.tags, links: rec.links.map(l => ({ toId: l.toId, relation: l.relation })), version: rec.version
            });
            console.log('《我的写作流程》已发布并生成更新草稿（状态：有更新草稿）。');
        }
    }

    /* ── 撤回旧「示例 ·」公开稿 ───────────────────────────── */
    for (const key of ['welcome-article', 'sample-work', 'sample-garden', 'sample-recommendation']) {
        const id = await readSetting(`seed:${key}`);
        if (!id)
            continue;
        const row = await db.record.findUnique({ where: { id } });
        if (!row || row.status === 'WITHDRAWN' || row.deletedAt)
            continue;
        await withdraw(id, row.version);
        console.log(`已撤回旧示例：《${row.title}》`);
    }

    console.log(`\n完成：新建 ${created} 条示范记录，字段占位填充 ${restored} 处。`);
    console.log('所有新记录带「示范」标签；运行 npx tsx scripts/demo.ts --clean 可整体清除。');
}

/** 清除：软删除全部示范记录（含公开稿，publicList 会自动排除），还原被填充的占位字段，删除幂等键。 */
async function clean() {
    const settings = await db.setting.findMany({ where: { key: { startsWith: 'demo:' } } });
    let removed = 0;
    for (const s of settings) {
        if (s.key.startsWith('demo:fill:')) {
            const { recordId, originals } = JSON.parse(s.value) as { recordId: string; originals: Record<string, unknown> };
            try {
                const rec = await getRecord(recordId);
                const restore: Record<string, unknown> = { ...rec.fields };
                for (const [k, v] of Object.entries(originals))
                    restore[k] = v ?? (k === 'weeklyCommitment' ? false : '待填写');
                await updateRecord(recordId, { kind: rec.kind, title: rec.title, body: rec.body, fields: restore, tags: rec.tags, links: rec.links.map(l => ({ toId: l.toId, relation: l.relation })), version: rec.version });
            }
            catch { /* 记录可能已被删除 */ }
            await db.setting.delete({ where: { key: s.key } });
            continue;
        }
        const row = await db.record.findUnique({ where: { id: s.value } });
        if (row && !row.deletedAt) {
            await db.record.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
            removed++;
        }
        await db.setting.delete({ where: { key: s.key } });
    }
    console.log(`已将 ${removed} 条示范记录移入回收站，占位字段已还原，幂等键已删除。回收站中的示范记录可自行彻底删除或恢复。`);
}

if (process.argv.includes('--clean'))
    clean().finally(() => db.$disconnect());
else
    main().finally(() => db.$disconnect());
