// OpenAI 兼容的模拟模型服务。通过用户消息中的 [scenario:xxx] 指令选择脚本化行为，
// 用于协议与端到端测试，绝不访问真实模型。也可独立启动：node scripts/mock-llm.mjs [port]
import http from 'node:http';

const chunk = (delta, extra = {}) => `data: ${JSON.stringify({ id: 'mock-1', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: 'mock-model', choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`;
const finishChunk = (reason) => chunk({}, { choices: [{ index: 0, delta: {}, finish_reason: reason }] });
const DONE = 'data: [DONE]\n\n';

function textRound(res, text) {
    res.write(chunk({ role: 'assistant', content: '' }));
    // 中文按 2-3 个字符分片，模拟真实分片
    const pieces = text.match(/.{1,3}/gs) ?? [];
    for (const piece of pieces)
        res.write(chunk({ content: piece }));
    res.write(finishChunk('stop'));
    res.write(DONE);
    res.end();
}

function toolCallRound(res, calls) {
    res.write(chunk({ role: 'assistant', content: null }));
    calls.forEach((call, index) => {
        res.write(chunk({ tool_calls: [{ index, id: `call-${index + 1}`, type: 'function', function: { name: call.name, arguments: '' } }] }));
        // 参数拆成多个分片，模拟流式参数
        const args = JSON.stringify(call.arguments);
        const pieces = args.match(/.{1,8}/gs) ?? [];
        for (const piece of pieces)
            res.write(chunk({ tool_calls: [{ index, function: { arguments: piece } }] }));
    });
    res.write(finishChunk('tool_calls'));
    res.write(DONE);
    res.end();
}

function reasoningRound(res, text) {
    res.write(chunk({ role: 'assistant', content: null, reasoning_content: '思考：用户需要什么' }));
    res.write(chunk({ reasoning_content: '继续思考，然后作答。' }));
    textRound(res, text);
}

const scenarios = {
    default(res, hasToolResults) {
        textRound(res, hasToolResults ? '已经完成，你可以继续提问。' : '你好，我是你的工作台助手。');
    },
    'tool-create'(res, hasToolResults) {
        if (hasToolResults)
            return textRound(res, '已创建记录，标题为「模拟记录」。');
        toolCallRound(res, [{ name: 'create_record', arguments: { kind: 'NOTE', title: '模拟记录', body: '来自模拟模型' } }]);
    },
    'tool-create-work'(res, hasToolResults) {
        if (hasToolResults)
            return textRound(res, '已在工作模式创建记录。');
        toolCallRound(res, [{ name: 'create_record', arguments: { kind: 'NOTE', title: '工作模式记录', body: '直接保存' } }]);
    },
    'tool-propose'(res, hasToolResults) {
        if (hasToolResults)
            return textRound(res, '已创建修改提议，等待你确认。');
        toolCallRound(res, [{ name: 'propose_record_change', arguments: { recordId: 'TARGET_ID', expectedVersion: 1, body: '提议的新正文' } }]);
    },
    'multi-tool'(res, hasToolResults) {
        if (hasToolResults)
            return textRound(res, '两条记录都已创建。');
        toolCallRound(res, [
            { name: 'create_record', arguments: { kind: 'NOTE', title: '并行一' } },
            { name: 'create_record', arguments: { kind: 'NOTE', title: '并行二' } },
        ]);
    },
    'bad-json'(res) {
        // 流级失败：HTTP 500 + 损坏响应体。SDK 重试耗尽后运行必须收敛为 FAILED。
    },
    'bad-tool-args'(res) {
        // 工具级失败：合法 SSE 帧内携带被截断的工具参数 JSON。绝不产生部分写入。
        res.write(chunk({ role: 'assistant', content: null }));
        res.write(chunk({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'create_record', arguments: '{"kind":"NOTE","title":"坏JSON' } }] }));
        res.write(finishChunk('tool_calls'));
        res.write(DONE);
        res.end();
    },
    'stream-break'(res) {
        res.write(chunk({ role: 'assistant', content: '写到一半' }));
        res.destroy();
    },
    reasoning(res, hasToolResults) {
        if (hasToolResults)
            return textRound(res, '思考完成。');
        reasoningRound(res, '已处理你的请求。');
    },
};

export function startMockLlm(port = 0) {
    const server = http.createServer((req, res) => {
        if (!(req.url ?? '').includes('/chat/completions')) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'not found' } }));
            return;
        }
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                const lastUser = [...(payload.messages ?? [])].reverse().find(m => m.role === 'user');
                const content = lastUser?.content;
                const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
                const scenario = /\[scenario:([a-z-]+)\]/.exec(text)?.[1] ?? 'default';
                const hasToolResults = (payload.messages ?? []).some(m => m.role === 'tool');
                if (scenario === 'bad-json') {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end('{{ 不是合法的JSON响应');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
                (scenarios[scenario] ?? scenarios.default)(res, hasToolResults, payload);
            }
            catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'bad request' } }));
            }
        });
    });
    const ready = new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
    return { server, ready };
}

if (process.argv[1] && process.argv[1].endsWith('mock-llm.mjs')) {
    const port = Number(process.argv[2]) || 4510;
    startMockLlm(port);
    console.log(`mock-llm listening on http://127.0.0.1:${port}/v1/chat/completions`);
}
