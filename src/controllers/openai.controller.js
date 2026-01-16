/**
 * OpenAI Controller
 * Handles OpenAI-compatible API requests and adapts them to the internal Anthropic format
 */

import { logger } from "../utils/logger.js";
import { sendMessage } from "../cloudcode/index.js";

/**
 * Convert OpenAI message format to Anthropic message format
 * @param {Array} messages - OpenAI messages
 * @returns {Array} Anthropic messages
 */
function convertOpenAIMessagesToAnthropic(messages) {
  return messages.map((msg) => {
    // Basic text content
    if (typeof msg.content === "string") {
      return {
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content,
      };
    }

    // Array content (multimodal) - simplified for now
    if (Array.isArray(msg.content)) {
      return {
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content,
      };
    }

    return msg;
  });
}

/**
 * Convert Anthropic response to OpenAI Chat Completion format
 * @param {Object} anthropicResponse - Anthropic response
 * @param {String} model - Model ID
 * @returns {Object} OpenAI response
 */
function convertAnthropicToOpenAIResponse(anthropicResponse, model) {
  const timestamp = Math.floor(Date.now() / 1000);

  // Extract content
  let content = "";
  if (Array.isArray(anthropicResponse.content)) {
    content = anthropicResponse.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
  }

  return {
    id: anthropicResponse.id || `chatcmpl-${timestamp}`,
    object: "chat.completion",
    created: timestamp,
    model: model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content,
        },
        logprobs: null,
        finish_reason: anthropicResponse.stop_reason || "stop",
      },
    ],
    usage: {
      prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
      completion_tokens: anthropicResponse.usage?.output_tokens || 0,
      total_tokens:
        (anthropicResponse.usage?.input_tokens || 0) +
        (anthropicResponse.usage?.output_tokens || 0),
    },
  };
}

export const createOpenAIController = (context) => {
  const { accountManager } = context;

  return {
    /**
     * Handle chat completions
     * POST /v1/chat/completions
     */
    async chatCompletions(req, res) {
      try {
        const {
          model,
          messages,
          stream,
          max_tokens,
          temperature,
          top_p,
          frequency_penalty,
          presence_penalty,
        } = req.body;

        if (!messages || !Array.isArray(messages)) {
          return res.status(400).json({
            error: {
              message: "messages is required and must be an array",
              type: "invalid_request_error",
            },
          });
        }

        // Convert messages to Anthropic format
        const anthropicMessages = convertOpenAIMessagesToAnthropic(messages);

        // Construct request for internal handler
        const request = {
          model: model || "claude-3-5-sonnet-20241022",
          messages: anthropicMessages,
          max_tokens: max_tokens || 4096,
          stream: stream || false,
          temperature,
          top_p,
        };

        // Reuse existing Cloud Code logic
        // Note: We currently only support non-streaming for simplification
        // If stream=true, we might need to adapt the SSE stream
        if (stream) {
          // TODO: Implement streaming support
          return res.status(400).json({
            error: {
              message: "Streaming is not yet supported for this endpoint",
              type: "invalid_request_error",
            },
          });
        }

        const response = await sendMessage(request, accountManager);
        const openAIResponse = convertAnthropicToOpenAIResponse(
          response,
          model
        );

        res.json(openAIResponse);
      } catch (error) {
        logger.error("[OpenAI] Error handling chat completion:", error);
        res.status(500).json({
          error: {
            message: error.message || "Internal server error",
            type: "server_error",
          },
        });
      }
    },
  };
};
