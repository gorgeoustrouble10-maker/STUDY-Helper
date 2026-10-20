// mock-llm.mjs 的类型声明：仅暴露测试所需接口。
export declare function startMockLlm(port?: number): {
    server: { close: () => void };
    ready: Promise<number>;
};
