/**
 * Response Converter
 * Converts Google Generative AI responses to Anthropic Messages API format
 */

import crypto from 'crypto';
import { MIN_SIGNATURE_LENGTH, getModelFamily } from '../constants.js';
import { cacheSignature, cacheThinkingSignature } from './signature-cache.js';
import { logger } from '../utils/logger.js';

/**
 * Convert Google Generative AI response to Anthropic Messages API format
 *
 * @param {Object} googleResponse - Google format response (the inner response object)
 * @param {string} model - The model name used
 * @returns {Object} Anthropic format response
 */
export function convertGoogleToAnthropic(googleResponse, model) {
    // Handle the response wrapper
    const response = googleResponse.response || googleResponse;

    const candidates = response.candidates || [];

    // Log when multiple candidates are present (we only use the first)
    if (candidates.length > 1) {
        logger.debug(`[ResponseConverter] Multiple candidates received (${candidates.length}), using first`);
    }

    const firstCandidate = candidates[0] || {};

    // Handle safety-blocked responses
    const finishReason = firstCandidate.finishReason;
    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
        const safetyRatings = firstCandidate.safetyRatings || [];
        const blockedCategories = safetyRatings
            .filter(r => r.blocked)
            .map(r => r.category?.replace('HARM_CATEGORY_', '') || 'UNKNOWN')
            .join(', ');

        logger.warn(`[ResponseConverter] Content blocked by safety filter: ${blockedCategories || finishReason}`);

        const usageMetadata = response.usageMetadata || {};
        const promptTokens = usageMetadata.promptTokenCount || 0;
        const cachedTokens = usageMetadata.cachedContentTokenCount || 0;

        return {
            id: `msg_${crypto.randomBytes(16).toString('hex')}`,
            type: 'message',
            role: 'assistant',
            content: [{
                type: 'text',
                text: `[Content blocked by safety filter: ${blockedCategories || finishReason}]`
            }],
            model: model,
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: {
                input_tokens: promptTokens - cachedTokens,
                output_tokens: 0,
                cache_read_input_tokens: cachedTokens,
                cache_creation_input_tokens: 0
            }
        };
    }

    const content = firstCandidate.content || {};
    const parts = content.parts || [];

    // Convert parts to Anthropic content blocks
    const anthropicContent = [];
    let hasToolCalls = false;

    for (const part of parts) {
        if (part.text !== undefined) {
            // Handle thinking blocks
            if (part.thought === true) {
                const signature = part.thoughtSignature || '';

                // Check if this is a redacted thinking block
                // Redacted blocks typically have no text content but have a signature
                if (part.redacted === true || (!part.text && signature)) {
                    anthropicContent.push({
                        type: 'redacted_thinking',
                        data: signature  // Anthropic uses 'data' field for redacted content
                    });
                    continue;
                }

                // Cache thinking signature with model family for cross-model compatibility
                if (signature && signature.length >= MIN_SIGNATURE_LENGTH) {
                    const modelFamily = getModelFamily(model);
                    cacheThinkingSignature(signature, modelFamily);
                }

                // Include thinking blocks in the response for Claude Code
                anthropicContent.push({
                    type: 'thinking',
                    thinking: part.text,
                    signature: signature
                });
            } else {
                anthropicContent.push({
                    type: 'text',
                    text: part.text
                });
            }
        } else if (part.functionCall) {
            // Convert functionCall to tool_use
            // Use the id from the response if available, otherwise generate one
            const toolId = part.functionCall.id || `toolu_${crypto.randomBytes(12).toString('hex')}`;
            const toolUseBlock = {
                type: 'tool_use',
                id: toolId,
                name: part.functionCall.name,
                input: part.functionCall.args || {}
            };

            // For Gemini 3+, include thoughtSignature from the part level
            if (part.thoughtSignature && part.thoughtSignature.length >= MIN_SIGNATURE_LENGTH) {
                toolUseBlock.thoughtSignature = part.thoughtSignature;
                // Cache for future requests (Claude Code may strip this field)
                cacheSignature(toolId, part.thoughtSignature);
            }

            anthropicContent.push(toolUseBlock);
            hasToolCalls = true;
        } else if (part.inlineData) {
            // Handle inline image/document content from Google format
            anthropicContent.push({
                type: 'image',
                source: {
                    type: 'base64',
                    media_type: part.inlineData.mimeType,
                    data: part.inlineData.data
                }
            });
        } else if (part.fileData) {
            // Handle URL-referenced files from Google format
            // Determine the appropriate Anthropic type based on MIME type
            const mimeType = part.fileData.mimeType || 'application/octet-stream';
            const isImage = mimeType.startsWith('image/');
            const isPdf = mimeType === 'application/pdf';

            anthropicContent.push({
                type: isImage ? 'image' : (isPdf ? 'document' : 'document'),
                source: {
                    type: 'url',
                    media_type: mimeType,
                    url: part.fileData.fileUri
                }
            });
        }
    }

    // Determine stop reason (finishReason already extracted above)
    let stopReason = 'end_turn';
    if (finishReason === 'STOP') {
        stopReason = 'end_turn';
    } else if (finishReason === 'MAX_TOKENS') {
        stopReason = 'max_tokens';
    } else if (finishReason === 'TOOL_USE' || hasToolCalls) {
        stopReason = 'tool_use';
    }

    // Extract usage metadata
    // Note: Antigravity's promptTokenCount is the TOTAL (includes cached),
    // but Anthropic's input_tokens excludes cached. We subtract to match.
    const usageMetadata = response.usageMetadata || {};
    const promptTokens = usageMetadata.promptTokenCount || 0;
    const cachedTokens = usageMetadata.cachedContentTokenCount || 0;

    const result = {
        id: `msg_${crypto.randomBytes(16).toString('hex')}`,
        type: 'message',
        role: 'assistant',
        content: anthropicContent.length > 0 ? anthropicContent : [{ type: 'text', text: '' }],
        model: model,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
            input_tokens: promptTokens - cachedTokens,
            output_tokens: usageMetadata.candidatesTokenCount || 0,
            cache_read_input_tokens: cachedTokens,
            cache_creation_input_tokens: 0
        }
    };

    // Include grounding metadata if present (non-standard extension for citations)
    const groundingMetadata = firstCandidate.groundingMetadata;
    if (groundingMetadata) {
        const citations = groundingMetadata.webSearchQueries || [];
        const groundingChunks = groundingMetadata.groundingChunks || [];

        if (citations.length > 0 || groundingChunks.length > 0) {
            result._groundingMetadata = {
                searchQueries: citations,
                groundingChunks: groundingChunks.map(chunk => ({
                    uri: chunk.web?.uri || chunk.retrievedContext?.uri,
                    title: chunk.web?.title || chunk.retrievedContext?.title
                })).filter(c => c.uri)
            };
            logger.debug(`[ResponseConverter] Included grounding metadata: ${citations.length} queries, ${groundingChunks.length} chunks`);
        }
    }

    return result;
}
