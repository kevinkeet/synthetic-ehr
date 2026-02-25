/**
 * Claude API Service
 * Handles communication with the Anthropic Claude API
 */

const ClaudeAPI = {
    apiKey: null,
    model: 'claude-sonnet-4-6-20250627',
    maxTokens: 1024,

    /**
     * Set the API key
     */
    setApiKey(key) {
        this.apiKey = key;
    },

    /**
     * Check if API is configured
     */
    isConfigured() {
        return !!this.apiKey;
    },

    /**
     * Send a message to Claude and get a response
     * @param {string} systemPrompt - The system prompt for context
     * @param {Array} messages - Array of message objects {role: 'user'|'assistant', content: string}
     * @returns {Promise<Object>} - The API response
     */
    async sendMessage(systemPrompt, messages) {
        if (!this.apiKey) {
            throw new Error('API key not configured. Please add your Anthropic API key in settings.');
        }

        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: this.model,
                    max_tokens: this.maxTokens,
                    system: systemPrompt,
                    messages: messages
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.error?.message || `HTTP error ${response.status}`;
                throw new Error(errorMessage);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('Claude API Error:', error);
            throw error;
        }
    },

    /**
     * Send a message and get just the text content
     * @param {string} systemPrompt - The system prompt
     * @param {Array} messages - Array of messages
     * @returns {Promise<string>} - The text response
     */
    async chat(systemPrompt, messages) {
        const response = await this.sendMessage(systemPrompt, messages);

        if (response.content && response.content.length > 0) {
            return response.content[0].text;
        }

        throw new Error('Invalid response format from API');
    },

    /**
     * Stream a message response (for longer responses)
     * Note: Streaming requires server-side implementation in most browsers
     * This is a simplified version that waits for the full response
     * @param {string} systemPrompt - The system prompt
     * @param {Array} messages - Array of messages
     * @param {Function} onChunk - Callback for each chunk of text
     * @returns {Promise<string>} - The full text response
     */
    async chatStream(systemPrompt, messages, onChunk) {
        // For simplicity, we'll use non-streaming and simulate chunks
        // True streaming would require a proxy server due to browser limitations
        const fullResponse = await this.chat(systemPrompt, messages);

        // Simulate streaming by chunking the response
        const words = fullResponse.split(' ');
        let accumulated = '';

        for (let i = 0; i < words.length; i++) {
            accumulated += (i > 0 ? ' ' : '') + words[i];
            if (onChunk) {
                onChunk(accumulated);
            }
            // Small delay to simulate streaming
            await new Promise(resolve => setTimeout(resolve, 20));
        }

        return fullResponse;
    },

    /**
     * Set the model to use
     */
    setModel(model) {
        this.model = model;
    },

    /**
     * Set max tokens for responses
     */
    setMaxTokens(tokens) {
        this.maxTokens = tokens;
    }
};

window.ClaudeAPI = ClaudeAPI;
