/* finesse · register=product · shell=canvas-dominant-ide+agent-rail · palette=theme-native+teal-signal · SOUL=6 SPECTACLE=2 DENSITY=8 */
/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const vscode = require('vscode');
const { PiRuntime } = require('./piRuntime.cjs');

class PiAgentViewProvider {
	static viewType = 'piAgent.chat';

	constructor(context) {
		this.context = context;
		this.view = undefined;
		this.runtime = new PiRuntime(context, () => this.readConfiguration(), event => this.postMessage(event));
	}

	resolveWebviewView(webviewView) {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
		};
		webviewView.webview.html = this.getHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage(message => this.handleMessage(message), undefined, this.context.subscriptions);
		webviewView.onDidDispose(() => {
			this.view = undefined;
		});
	}

	async handleMessage(message) {
		try {
			switch (message.type) {
				case 'ready':
					await this.sendBootstrap();
					break;
				case 'sendPrompt':
					await this.sendPrompt(message.prompt);
					break;
				case 'stop':
					await this.runtime.abort();
					break;
				case 'newSession':
					await this.runtime.newSession();
					await this.sendBootstrap();
					break;
				case 'setApiKey':
					await this.promptForApiKey(message.provider);
					break;
				case 'selectModel':
					await this.selectModel(message.provider, message.model);
					break;
				case 'approval':
					this.runtime.resolveApproval(message.id, Boolean(message.approved));
					break;
				case 'openFile':
					await this.openFile(message.path);
					break;
			}
		} catch (error) {
			this.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}
	}

	async sendBootstrap() {
		const bootstrap = await this.runtime.getBootstrapData();
		this.postMessage({
			type: 'bootstrap',
			...bootstrap,
			workspaceName: vscode.workspace.name ?? vscode.l10n.t('No Folder Open'),
			strings: getStrings()
		});
	}

	async sendPrompt(rawPrompt) {
		const prompt = String(rawPrompt ?? '').trim();
		if (!prompt) {
			return;
		}

		const configuration = this.readConfiguration();
		if (!await this.runtime.hasApiKey(configuration.provider)) {
			this.postMessage({ type: 'credentialRequired', provider: configuration.provider });
			await this.promptForApiKey(configuration.provider);
			if (!await this.runtime.hasApiKey(configuration.provider)) {
				return;
			}
		}

		this.postMessage({ type: 'userMessage', text: prompt });
		await this.runtime.prompt(withEditorContext(prompt));
	}

	async selectModel(provider, model) {
		const configuration = vscode.workspace.getConfiguration('piAgent');
		await configuration.update('provider', provider, vscode.ConfigurationTarget.Global);
		await configuration.update('model', model, vscode.ConfigurationTarget.Global);
		await this.runtime.switchModel(provider, model);
		await this.sendBootstrap();
	}

	async promptForApiKey(providerId) {
		const apiKey = await vscode.window.showInputBox({
			password: true,
			ignoreFocusOut: true,
			title: vscode.l10n.t('Set {0} API Key', providerId),
			prompt: vscode.l10n.t('The key is stored in the editor secret store and is never written to settings.'),
			placeHolder: 'sk-…'
		});
		if (!apiKey) {
			return;
		}
		await this.runtime.setApiKey(providerId, apiKey.trim());
		await this.sendBootstrap();
	}

	async openFile(filePath) {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder || !filePath) {
			return;
		}
		const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(workspaceFolder.uri, filePath));
		await vscode.window.showTextDocument(document, { preview: false });
	}

	readConfiguration() {
		const configuration = vscode.workspace.getConfiguration('piAgent');
		return {
			provider: configuration.get('provider', 'deepseek'),
			model: configuration.get('model', 'deepseek-v4-pro'),
			baseUrl: configuration.get('baseUrl', ''),
			requireApproval: configuration.get('requireApproval', true),
			cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd()
		};
	}

	postMessage(message) {
		void this.view?.webview.postMessage(message);
	}

	async focus() {
		await vscode.commands.executeCommand('workbench.view.extension.piAgent');
	}

	async dispose() {
		await this.runtime.dispose();
	}

	getHtml(webview) {
		const nonce = getNonce();
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panel.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'panel.js'));
		const iconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'agent-coding-icon.png'));
		return `<!DOCTYPE html>
<html lang="${escapeHtml(vscode.env.language)}">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<link rel="stylesheet" href="${styleUri}">
	<title>Agent coding</title>
</head>
<body>
	<div id="app" class="app" aria-live="polite">
		<header class="agent-header">
			<div class="identity">
				<img class="identity-mark" src="${iconUri}" alt="">
				<div><strong>Agent coding</strong><span id="workspaceName"></span></div>
			</div>
			<button id="newSessionButton" class="icon-button" type="button" title="New Session" aria-label="New Session">＋</button>
		</header>
		<div id="notice" class="notice hidden" role="status"></div>
		<main id="timeline" class="timeline hidden"></main>
		<section id="welcome" class="welcome">
			<img class="welcome-mark" src="${iconUri}" alt="">
			<h1 id="welcomeTitle"></h1>
			<p id="welcomeDescription"></p>
			<div id="suggestions" class="suggestions"></div>
		</section>
		<footer class="composer-shell">
			<div id="receipt" class="receipt"><span id="runStatus"></span><span id="modelLabel"></span></div>
			<div class="composer">
				<textarea id="promptInput" rows="1"></textarea>
				<div class="composer-actions">
					<div class="model-controls">
						<select id="providerSelect" aria-label="Provider"></select>
						<select id="modelSelect" aria-label="Model"></select>
					</div>
					<div class="run-controls">
						<button id="keyButton" class="quiet-button" type="button"></button>
						<button id="stopButton" class="stop-button" type="button" disabled></button>
						<button id="sendButton" class="send-button" type="button"></button>
					</div>
				</div>
			</div>
		</footer>
	</div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function withEditorContext(prompt) {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		return prompt;
	}

	const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
	const relativePath = workspaceFolder ? vscode.workspace.asRelativePath(editor.document.uri, false) : editor.document.uri.fsPath;
	const selection = editor.selection.isEmpty ? '' : editor.document.getText(editor.selection).slice(0, 12000);
	const context = [`Active file: ${relativePath}`];
	if (selection) {
		context.push(`Selected code:\n${selection}`);
	}
	return `<ide_context>\n${context.join('\n\n')}\n</ide_context>\n\n${prompt}`;
}

async function createAgentProduct() {
	const projectName = await vscode.window.showInputBox({
		title: vscode.l10n.t('Create an Agent product'),
		prompt: vscode.l10n.t('Name your new Agent product.'),
		placeHolder: vscode.l10n.t('For example: Customer service assistant'),
		ignoreFocusOut: true,
		validateInput: validateProjectName
	});
	if (!projectName) {
		return;
	}

	const parentSelection = await vscode.window.showOpenDialog({
		title: vscode.l10n.t('Choose where to create the project'),
		openLabel: vscode.l10n.t('Create here'),
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false
	});
	if (!parentSelection?.[0]) {
		return;
	}

	const trimmedName = projectName.trim();
	const projectUri = vscode.Uri.joinPath(parentSelection[0], trimmedName);
	if (await resourceExists(projectUri)) {
		void vscode.window.showErrorMessage(vscode.l10n.t('A folder named "{0}" already exists. Choose another project name.', trimmedName));
		return;
	}

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: vscode.l10n.t('Creating {0}', trimmedName),
		cancellable: false
	}, async () => {
		await vscode.workspace.fs.createDirectory(projectUri);
		await writeProjectStarter(projectUri, trimmedName);
	});

	await vscode.commands.executeCommand('vscode.openFolder', projectUri, false);
}

async function writeProjectStarter(projectUri, projectName) {
	const readme = `# ${projectName}\n\n这是一个由 Agent coding 创建的 Agent 产品项目。\n`;
	await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(projectUri, 'README.md'), Buffer.from(readme, 'utf8'));
}

function validateProjectName(value) {
	const projectName = String(value ?? '').trim();
	if (!projectName) {
		return vscode.l10n.t('Enter a project name.');
	}
	if (projectName === '.' || projectName === '..' || /[\\/:*?"<>|]/.test(projectName)) {
		return vscode.l10n.t('The project name contains characters that cannot be used in a folder name.');
	}
	return undefined;
}

async function resourceExists(uri) {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch (error) {
		if (isFileNotFound(error)) {
			return false;
		}
		throw error;
	}
}

function isFileNotFound(error) {
	return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

function getStrings() {
	return {
		welcomeTitle: vscode.l10n.t('What do you want to build?'),
		welcomeDescription: vscode.l10n.t('Agent coding can inspect the project, edit files, and run commands. You stay in control of every change.'),
		promptPlaceholder: vscode.l10n.t('Plan, build, or ask about this project'),
		newSession: vscode.l10n.t('New Session'),
		setKey: vscode.l10n.t('API Key'),
		stop: vscode.l10n.t('Stop'),
		send: vscode.l10n.t('Send'),
		idle: vscode.l10n.t('Ready'),
		running: vscode.l10n.t('Running'),
		stopped: vscode.l10n.t('Stopped'),
		activity: vscode.l10n.t('Activity'),
		step: vscode.l10n.t('step'),
		steps: vscode.l10n.t('steps'),
		completed: vscode.l10n.t('Complete'),
		needsAttention: vscode.l10n.t('Needs attention'),
		approvalTitle: vscode.l10n.t('Approval Required'),
		approve: vscode.l10n.t('Approve and Continue'),
		reject: vscode.l10n.t('Reject'),
		toolInput: vscode.l10n.t('Input'),
		toolOutput: vscode.l10n.t('Output'),
		error: vscode.l10n.t('Error'),
		provider: vscode.l10n.t('Provider'),
		model: vscode.l10n.t('Model'),
		credentialRequired: vscode.l10n.t('Add an API key before starting this model.'),
		suggestions: [
			vscode.l10n.t('Explain this repository'),
			vscode.l10n.t('Find the most important unfinished work'),
			vscode.l10n.t('Review the current file')
		]
	};
}

function getNonce() {
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let nonce = '';
	for (let index = 0; index < 32; index++) {
		nonce += characters.charAt(Math.floor(Math.random() * characters.length));
	}
	return nonce;
}

function escapeHtml(value) {
	return value.replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

module.exports = { PiAgentViewProvider, createAgentProduct };
