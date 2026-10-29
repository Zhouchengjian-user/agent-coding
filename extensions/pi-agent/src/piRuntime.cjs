/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { buildCatalog, resolveModel } = require('./modelCatalog.cjs');

const READ_ONLY_TOOLS = new Set(['read', 'grep', 'find', 'ls']);

class PiRuntime {
	constructor(context, getConfiguration, onEvent) {
		this.context = context;
		this.getConfiguration = getConfiguration;
		this.onEvent = onEvent;
		this.modelRuntime = undefined;
		this.session = undefined;
		this.unsubscribe = undefined;
		this.pendingApprovals = new Map();
		this.approvalCounter = 0;
		this.customProviderSignature = undefined;
	}

	async initialize() {
		if (this.modelRuntime) {
			return;
		}

		this.sdk = await import('@earendil-works/pi-coding-agent');
		const storageDirectory = this.context.globalStorageUri.fsPath;
		await fs.mkdir(storageDirectory, { recursive: true });
		this.modelRuntime = await this.sdk.ModelRuntime.create({
			authPath: path.join(storageDirectory, 'auth.json'),
			modelsPath: path.join(storageDirectory, 'models.json')
		});

		this.configureCustomProvider();
		await this.restoreRuntimeKeys();
	}

	configureCustomProvider() {
		const configuration = this.getConfiguration();
		const signature = `${configuration.baseUrl}\n${configuration.model}`;
		if (signature === this.customProviderSignature) {
			return;
		}
		if (this.modelRuntime.getProvider('custom')) {
			this.modelRuntime.unregisterProvider('custom');
		}
		this.customProviderSignature = signature;
		if (!configuration.baseUrl || !configuration.model) {
			return;
		}

		this.modelRuntime.registerProvider('custom', {
			name: 'Custom',
			baseUrl: configuration.baseUrl,
			api: 'openai-completions',
			models: [{
				type: 'chat',
				id: configuration.model,
				name: configuration.model,
				reasoning: true,
				input: ['text', 'image'],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16384
			}]
		});
	}

	async restoreRuntimeKeys() {
		for (const provider of ['deepseek', 'openai', 'anthropic', 'google', 'openrouter', 'custom']) {
			const key = await this.context.secrets.get(`piAgent.apiKey.${provider}`);
			if (key) {
				await this.modelRuntime.setRuntimeApiKey(provider, key);
			}
		}
	}

	async getBootstrapData() {
		await this.initialize();
		this.configureCustomProvider();
		const configuration = this.getConfiguration();
		return {
			catalog: buildCatalog(this.modelRuntime, configuration.provider === 'custom' ? configuration.model : undefined),
			provider: configuration.provider,
			model: configuration.model,
			hasApiKey: await this.hasApiKey(configuration.provider)
		};
	}

	async hasApiKey(providerId) {
		await this.initialize();
		return Boolean(await this.context.secrets.get(`piAgent.apiKey.${providerId}`)) || this.modelRuntime.hasConfiguredAuth(providerId);
	}

	async setApiKey(providerId, apiKey) {
		await this.initialize();
		await this.context.secrets.store(`piAgent.apiKey.${providerId}`, apiKey);
		await this.modelRuntime.setRuntimeApiKey(providerId, apiKey);
		this.onEvent({ type: 'credentialChanged', provider: providerId, configured: true });
	}

	async createSession() {
		await this.initialize();
		this.configureCustomProvider();
		await this.disposeSession();

		const configuration = this.getConfiguration();
		const workspaceDirectory = configuration.cwd;
		const model = resolveModel(this.modelRuntime, configuration.provider, configuration.model);
		if (!model) {
			throw new Error(`Model not found: ${configuration.provider}/${configuration.model}`);
		}

		const resourceLoader = new this.sdk.DefaultResourceLoader({
			cwd: workspaceDirectory,
			agentDir: this.context.globalStorageUri.fsPath,
			systemPromptOverride: basePrompt => `${basePrompt}\n\nYou are embedded in a desktop code editor. Keep updates concise. Use read-only tools freely. Before mutating files or running shell commands, expect an explicit user approval gate. Prefer small, reviewable edits.`,
			extensionFactories: [pi => {
				pi.on('tool_call', async event => {
					if (!this.getConfiguration().requireApproval || READ_ONLY_TOOLS.has(event.toolName)) {
						return undefined;
					}

					const approved = await this.requestApproval(event.toolName, event.input);
					if (!approved) {
						return { block: true, reason: `${event.toolName} was rejected by the user` };
					}
					return undefined;
				});
			}]
		});
		await resourceLoader.reload();

		const result = await this.sdk.createAgentSession({
			cwd: workspaceDirectory,
			model,
			thinkingLevel: model.reasoning ? 'medium' : 'off',
			modelRuntime: this.modelRuntime,
			resourceLoader,
			sessionManager: this.sdk.SessionManager.inMemory(),
			tools: ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write']
		});
		this.session = result.session;
		this.unsubscribe = this.session.subscribe(event => this.handleSessionEvent(event));
		this.onEvent({ type: 'sessionCreated', model: { provider: model.provider, id: model.id, name: model.name } });
	}

	async prompt(prompt) {
		if (!this.session) {
			await this.createSession();
		}

		this.onEvent({ type: 'runState', state: 'running' });
		try {
			await this.session.prompt(prompt);
		} catch (error) {
			this.onEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) });
			throw error;
		}
	}

	async switchModel(providerId, modelId) {
		await this.initialize();
		this.configureCustomProvider();
		const model = resolveModel(this.modelRuntime, providerId, modelId);
		if (!model) {
			throw new Error(`Model not found: ${providerId}/${modelId}`);
		}
		if (this.session) {
			await this.session.setModel(model);
		}
		this.onEvent({ type: 'modelChanged', model: { provider: model.provider, id: model.id, name: model.name } });
	}

	requestApproval(toolName, input) {
		const id = `approval-${++this.approvalCounter}`;
		this.onEvent({ type: 'approvalRequested', id, toolName, input });
		return new Promise(resolve => {
			this.pendingApprovals.set(id, resolve);
		});
	}

	resolveApproval(id, approved) {
		const resolve = this.pendingApprovals.get(id);
		if (!resolve) {
			return;
		}
		this.pendingApprovals.delete(id);
		resolve(approved);
		this.onEvent({ type: 'approvalResolved', id, approved });
	}

	async abort() {
		for (const [id, resolve] of this.pendingApprovals) {
			resolve(false);
			this.onEvent({ type: 'approvalResolved', id, approved: false });
		}
		this.pendingApprovals.clear();
		if (this.session) {
			await this.session.abort();
		}
		this.onEvent({ type: 'runState', state: 'stopped' });
	}

	handleSessionEvent(event) {
		switch (event.type) {
			case 'message_end':
				if (event.message.role === 'assistant') {
					const content = Array.isArray(event.message.content) ? event.message.content : [];
					this.onEvent({
						type: 'assistantMessage',
						text: content.filter(item => item.type === 'text').map(item => item.text).join(''),
						isFinal: !content.some(item => item.type === 'toolCall')
					});
				}
				break;
			case 'tool_execution_start':
				this.onEvent({ type: 'toolStart', id: event.toolCallId, name: event.toolName, input: event.args });
				break;
			case 'tool_execution_end':
				this.onEvent({
					type: 'toolEnd',
					id: event.toolCallId,
					name: event.toolName,
					result: summarizeResult(event.result),
					isError: event.isError,
					durationMs: event.durationMs
				});
				break;
			case 'auto_retry_start':
				this.onEvent({ type: 'retry', attempt: event.attempt, maxAttempts: event.maxAttempts, message: event.errorMessage });
				break;
			case 'agent_settled':
				this.onEvent({ type: 'runState', state: event.aborted ? 'stopped' : 'idle' });
				break;
		}
	}

	async newSession() {
		await this.disposeSession();
		this.onEvent({ type: 'sessionCleared' });
	}

	async disposeSession() {
		if (this.unsubscribe) {
			this.unsubscribe();
			this.unsubscribe = undefined;
		}
		if (this.session) {
			this.session.dispose();
			this.session = undefined;
		}
	}

	async dispose() {
		await this.abort();
		await this.disposeSession();
	}
}

function summarizeResult(result) {
	if (typeof result === 'string') {
		return result.slice(0, 4000);
	}
	try {
		return JSON.stringify(result, null, 2).slice(0, 4000);
	} catch {
		return String(result).slice(0, 4000);
	}
}

module.exports = { PiRuntime, READ_ONLY_TOOLS };
