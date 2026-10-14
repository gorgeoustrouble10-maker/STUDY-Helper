import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV4 } from '@ai-sdk/provider';

export type AiConfig = {
    provider: 'deepseek' | 'openai-compatible' | 'ollama';
    model: string;
    baseURL?: string;
    apiKey?: string;
};

const DEFAULT_BASE_URL: Record<AiConfig['provider'], string | undefined> = {
    deepseek: 'https://api.deepseek.com',
    'openai-compatible': undefined,
    ollama: 'http://127.0.0.1:11434/v1',
};

// 从环境读取模型配置。未启用或配置不完整时返回 null，AI 功能整体关闭（原工作台不受影响）。
export function readAiConfig(): AiConfig | null {
    if (String(process.env.AI_ENABLED ?? '').toLowerCase() !== 'true')
        return null;
    const provider = String(process.env.AI_PROVIDER || 'deepseek') as AiConfig['provider'];
    if (!['deepseek', 'openai-compatible', 'ollama'].includes(provider))
        return null;
    const model = process.env.AI_MODEL?.trim();
    if (!model)
        return null;
    const baseURL = process.env.AI_BASE_URL?.trim() || DEFAULT_BASE_URL[provider];
    const apiKey = process.env.AI_API_KEY?.trim();
    // 云端提供商必须有密钥；本机 Ollama 可以没有。
    if (provider !== 'ollama' && !apiKey)
        return null;
    if (!baseURL)
        return null;
    return { provider, model, baseURL, apiKey };
}

// 构造模型实例。DeepSeek 显式关闭思考模式（首版），其余走 OpenAI 兼容协议。
export function resolveModel(config: AiConfig): LanguageModelV4 {
    if (config.provider === 'deepseek') {
        const deepseek = createDeepSeek({ apiKey: config.apiKey ?? '', baseURL: config.baseURL });
        return deepseek.chat(config.model);
    }
    const provider = createOpenAICompatible({ name: config.provider, baseURL: config.baseURL!, apiKey: config.apiKey ?? '' });
    return provider.chatModel(config.model);
}

// DeepSeek 首版关闭思考模式；传入 streamText 的 providerOptions。
export function providerOptionsFor(config: AiConfig) {
    return config.provider === 'deepseek' ? { deepseek: { thinking: { type: 'disabled' } } } : undefined;
}
