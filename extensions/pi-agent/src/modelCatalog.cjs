/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const PROVIDERS = Object.freeze([
	{ id: 'deepseek', label: 'DeepSeek' },
	{ id: 'openai', label: 'OpenAI' },
	{ id: 'anthropic', label: 'Anthropic' },
	{ id: 'google', label: 'Google Gemini' },
	{ id: 'openrouter', label: 'OpenRouter' },
	{ id: 'custom', label: 'Custom' }
]);

const CURATED_MODEL_IDS = Object.freeze({
	deepseek: ['deepseek-v4-pro', 'deepseek-flash'],
	openai: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.4'],
	anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'],
	google: ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-2.5-pro'],
	openrouter: [
		'anthropic/claude-opus-4.7',
		'anthropic/claude-sonnet-4.6',
		'openai/gpt-6.1-sol',
		'google/gemini-3.1-pro-preview',
		'deepseek/deepseek-v4-pro'
	]
});

function getProviderLabel(providerId) {
	return PROVIDERS.find(provider => provider.id === providerId)?.label ?? providerId;
}

function toModelOption(model) {
	return {
		provider: model.provider,
		id: model.id,
		name: model.name ?? model.id,
		reasoning: Boolean(model.reasoning),
		contextWindow: Number(model.contextWindow ?? 0)
	};
}

function getCuratedModels(modelRuntime, providerId) {
	const allModels = modelRuntime.getModels(providerId);
	const byId = new Map(allModels.map(model => [model.id, model]));
	const preferredIds = CURATED_MODEL_IDS[providerId] ?? [];
	const curated = preferredIds.map(id => byId.get(id)).filter(Boolean);

	if (curated.length > 0) {
		return curated.map(toModelOption);
	}

	return allModels.slice(0, 8).map(toModelOption);
}

function buildCatalog(modelRuntime, customModelId) {
	return PROVIDERS.map(provider => {
		if (provider.id === 'custom') {
			const custom = customModelId ? modelRuntime.getModel('custom', customModelId) : undefined;
			return { ...provider, models: custom ? [toModelOption(custom)] : [] };
		}

		return { ...provider, models: getCuratedModels(modelRuntime, provider.id) };
	}).filter(provider => provider.models.length > 0 || provider.id === 'custom');
}

function resolveModel(modelRuntime, providerId, modelId) {
	const exact = modelRuntime.getModel(providerId, modelId);
	if (exact) {
		return exact;
	}

	const fallback = getCuratedModels(modelRuntime, providerId)[0];
	return fallback ? modelRuntime.getModel(providerId, fallback.id) : undefined;
}

module.exports = {
	PROVIDERS,
	buildCatalog,
	getCuratedModels,
	getProviderLabel,
	resolveModel
};
