export type AiStatus = {
  enabled: boolean;
  provider: string;
  model: string;
  mode: "analysis";
  message: string;
};
export type AiConversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};
export type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: { id: string; title: string }[];
  createdAt: number;
};
export type AiTurn = {
  id: string;
  conversationId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  error: string;
};
export type AiDetail = AiConversation & {
  messages: AiMessage[];
  activeTurn: AiTurn | null;
};
export type AiPending = {
  conversationId: string;
  requestId: string;
  message: string;
  contextRecordIds: string[];
};
