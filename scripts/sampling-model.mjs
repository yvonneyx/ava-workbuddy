// shortcut: text-only, non-streaming probe; extend the bridge before using streaming or tool-using strategies.
export function samplingModel(request) {
  return {
    specificationVersion: 'v3', provider: 'workbuddy-sampling', modelId: 'host-selected', supportedUrls: {},
    async doGenerate(options) {
      if (options.abortSignal?.aborted) throw new Error('Sampling request aborted.');
      if (options.tools?.length) throw new Error('The minimal probe supports text generation only.');
      const system = [];
      const messages = [];
      for (const message of options.prompt) {
        if (message.role === 'system') { system.push(message.content); continue; }
        if (!['user', 'assistant'].includes(message.role) || message.content.some(part => part.type !== 'text')) {
          throw new Error('The minimal probe accepts text-only user and assistant messages.');
        }
        messages.push({ role: message.role, content: { type: 'text', text: message.content.map(part => part.text).join('\n') } });
      }
      const response = await request({ messages, ...(system.length ? { systemPrompt: system.join('\n\n') } : {}),
        includeContext: 'none', maxTokens: Math.min(options.maxOutputTokens ?? 4096, 4096),
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }) });
      const parts = Array.isArray(response.content) ? response.content : [response.content];
      if (parts.some(part => part.type !== 'text')) throw new Error('Host returned non-text Sampling content.');
      return {
        content: parts.map(part => ({ type: 'text', text: part.text })),
        finishReason: { unified: response.stopReason === 'maxTokens' ? 'length' : 'stop', raw: response.stopReason },
        usage: { inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: undefined, text: undefined, reasoning: undefined } },
        response: { modelId: response.model }, warnings: [],
      };
    },
    async doStream() { throw new Error('Streaming is outside the minimal Sampling probe.'); },
  };
}
