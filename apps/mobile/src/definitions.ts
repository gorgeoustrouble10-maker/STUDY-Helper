export type Kind =
  | "DOMAIN"
  | "COURSE"
  | "PROJECT"
  | "ACTION"
  | "ISSUE"
  | "NOTE"
  | "RESOURCE"
  | "REVIEW"
  | "PERSON"
  | "ITEM"
  | "ACCOUNT"
  | "TRANSACTION"
  | "BUDGET"
  | "CHANNEL"
  | "PUBLICATION";
export type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "textarea"
    | "date"
    | "number"
    | "select"
    | "checkbox"
    | "money"
    | "account"
    | "record";
  options?: string[];
};
export const definitions: Record<
  Kind,
  {
    label: string;
    fields: Field[];
    statuses: string[];
  }
> = {
  DOMAIN: {
    label: "领域",
    statuses: ["ACTIVE"],
    fields: [
      {
        key: "group",
        label: "分组",
        type: "select",
        options: ["个人成长", "生活与复盘"],
      },
      { key: "focus", label: "当前关注点", type: "textarea" },
    ],
  },
  COURSE: {
    label: "课程",
    statuses: ["ACTIVE", "DONE"],
    fields: [
      { key: "semester", label: "学期" },
      { key: "chapters", label: "章节与主题", type: "textarea" },
      { key: "criteria", label: "实验 / 作业与完成要求", type: "textarea" },
    ],
  },
  PROJECT: {
    label: "项目",
    statuses: ["ACTIVE", "WAITING", "DONE"],
    fields: [
      { key: "outcome", label: "阶段成果", type: "textarea" },
      { key: "criteria", label: "完成条件", type: "textarea" },
      { key: "stage", label: "当前阶段" },
      { key: "nextStep", label: "下一步" },
      { key: "milestones", label: "里程碑与交付物", type: "textarea" },
      { key: "decisions", label: "重要决定与理由", type: "textarea" },
      { key: "weeklyCommitment", label: "本周承诺", type: "checkbox" },
    ],
  },
  ACTION: {
    label: "行动",
    statuses: ["TODO", "DOING", "WAITING", "BLOCKED", "DONE"],
    fields: [
      { key: "plannedAt", label: "计划时间", type: "date" },
      { key: "dueAt", label: "真实截止时间", type: "date" },
      { key: "remindAt", label: "提醒时间", type: "date" },
      { key: "priority", label: "优先级（1最高）", type: "number" },
      { key: "important", label: "重要", type: "checkbox" },
      { key: "urgent", label: "紧急", type: "checkbox" },
      { key: "blocker", label: "阻塞 / 等待原因", type: "textarea" },
      {
        key: "repeat",
        label: "重复频率",
        type: "select",
        options: ["NONE", "DAILY", "WEEKLY", "MONTHLY"],
      },
      { key: "parentId", label: "父行动", type: "record" },
      { key: "todayFocus", label: "今日重点", type: "checkbox" },
    ],
  },
  ISSUE: {
    label: "问题",
    statuses: [
      "CLARIFY",
      "READY",
      "TRYING",
      "OBSERVING",
      "RELIEVED",
      "RESOLVED",
      "DEFERRED",
      "ACCEPTED",
    ],
    fields: [
      { key: "observation", label: "事实观察", type: "textarea" },
      { key: "impact", label: "影响", type: "textarea" },
      { key: "hypothesis", label: "可能原因（假设）", type: "textarea" },
      { key: "experiment", label: "准备尝试的改变", type: "textarea" },
      { key: "checkAt", label: "下次检查时间", type: "date" },
      { key: "result", label: "证据与结果", type: "textarea" },
    ],
  },
  NOTE: { label: "笔记", statuses: ["INBOX", "ACTIVE", "DONE"], fields: [] },
  RESOURCE: {
    label: "资源",
    statuses: ["ACTIVE", "READING", "DONE"],
    fields: [
      { key: "url", label: "来源地址" },
      { key: "author", label: "作者" },
      {
        key: "resourceType",
        label: "类型",
        type: "select",
        options: ["网站", "App", "书", "人物", "课程资料", "其他"],
      },
      { key: "assessment", label: "摘录、评价与局限", type: "textarea" },
    ],
  },
  REVIEW: {
    label: "复盘",
    statuses: ["ACTIVE", "DONE"],
    fields: [
      {
        key: "scope",
        label: "复盘范围",
        type: "select",
        options: ["日复盘", "周复盘", "项目复盘", "课程总结"],
      },
      { key: "expected", label: "原本承诺 / 预期", type: "textarea" },
      { key: "actual", label: "实际结果与证据", type: "textarea" },
      { key: "adjustment", label: "继续 / 改变 / 暂停", type: "textarea" },
    ],
  },
  PERSON: {
    label: "人物与组织",
    statuses: ["ACTIVE"],
    fields: [
      {
        key: "entityType",
        label: "类型",
        type: "select",
        options: ["人物", "组织"],
      },
      { key: "organization", label: "组织 / 社群" },
      { key: "contact", label: "联系方式" },
      { key: "experiences", label: "共同经历", type: "textarea" },
      { key: "followUpAt", label: "下次联系", type: "date" },
    ],
  },
  ITEM: {
    label: "物品",
    statuses: ["ACTIVE"],
    fields: [
      { key: "location", label: "存放位置" },
      { key: "quantity", label: "数量", type: "number" },
      { key: "maintenanceAt", label: "维护时间", type: "date" },
    ],
  },
  ACCOUNT: {
    label: "账户",
    statuses: ["ACTIVE"],
    fields: [{ key: "openingCents", label: "期初余额（元）", type: "money" }],
  },
  TRANSACTION: {
    label: "收支",
    statuses: ["ACTIVE"],
    fields: [
      { key: "accountId", label: "账户", type: "account" },
      { key: "amountCents", label: "金额（元）", type: "money" },
      {
        key: "direction",
        label: "收支类型",
        type: "select",
        options: ["OUT", "IN"],
      },
      { key: "category", label: "分类" },
      { key: "occurredAt", label: "发生时间", type: "date" },
    ],
  },
  BUDGET: {
    label: "预算",
    statuses: ["ACTIVE"],
    fields: [
      { key: "category", label: "分类" },
      { key: "period", label: "预算月份（YYYY-MM）" },
      { key: "limitCents", label: "预算金额（元）", type: "money" },
    ],
  },
  CHANNEL: {
    label: "渠道稿件",
    statuses: ["DRAFT", "PUBLISHED"],
    fields: [
      { key: "channel", label: "发布渠道" },
      { key: "url", label: "外部链接" },
      { key: "publishedAt", label: "发布时间", type: "date" },
    ],
  },
  PUBLICATION: {
    label: "公开稿",
    statuses: ["DRAFT", "PUBLISHED", "CHANGED", "WITHDRAWN"],
    fields: [
      {
        key: "publicationType",
        label: "内容类型",
        type: "select",
        options: ["article", "work", "garden", "recommendation"],
      },
      { key: "slug", label: "稳定链接标识" },
      { key: "summary", label: "摘要", type: "textarea" },
      {
        key: "recommendationType",
        label: "推荐类型",
        type: "select",
        options: ["网站", "App", "书", "明星", "榜样人物"],
      },
      { key: "audience", label: "适合谁 / 使用场景" },
      { key: "role", label: "我的角色" },
      { key: "limitations", label: "局限", type: "textarea" },
      {
        key: "maturity",
        label: "整理程度",
        type: "select",
        options: ["初步记录", "持续整理", "阶段总结"],
      },
      { key: "featured", label: "首页精选", type: "checkbox" },
    ],
  },
};
export const statusLabels: Record<string, string> = {
  ACTIVE: "进行中",
  TODO: "待开始",
  DOING: "进行中",
  WAITING: "等待",
  BLOCKED: "受阻",
  DONE: "已完成",
  INBOX: "待整理",
  CLARIFY: "待澄清",
  READY: "准备尝试",
  TRYING: "尝试中",
  OBSERVING: "等待观察",
  RELIEVED: "已经缓解",
  RESOLVED: "已解决",
  DEFERRED: "暂不处理",
  ACCEPTED: "接受现状",
  READING: "阅读中",
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  CHANGED: "有更新草稿",
  WITHDRAWN: "已撤回",
  NONE: "不重复",
  DAILY: "每日",
  WEEKLY: "每周",
  MONTHLY: "每月",
  OUT: "支出",
  IN: "收入",
  article: "文章",
  work: "作品",
  garden: "成长花园",
  recommendation: "推荐",
};
export type GardenRecord = {
  id: string;
  kind: Kind;
  title: string;
  body: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  fields: Record<string, unknown>;
  tags: string[];
  links: {
    id: string;
    toId: string;
    title: string;
    kind: Kind;
    relation: string;
  }[];
  backlinks: {
    id: string;
    fromId: string;
    title: string;
    kind: Kind;
    relation: string;
  }[];
  attachments: {
    id: string;
    name: string;
    mime: string;
    size: number;
  }[];
  revisions?: {
    id: string;
    createdAt: string;
  }[];
  publishedVersions?: {
    id: string;
    createdAt: string;
  }[];
};
export type PublicContent = {
  id: string;
  title: string;
  body: string;
  slug: string;
  type: string;
  summary: string;
  tags: string[];
  details: Record<string, unknown>;
  publishedAt: string;
  assets: {
    id: string;
    name: string;
    mime: string;
    url: string;
  }[];
};
export const formatDate = (v: unknown) =>
  v
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "short",
        day: "numeric",
      }).format(new Date(String(v)))
    : "未安排";
