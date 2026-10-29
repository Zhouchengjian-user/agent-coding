/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const vscode = require('vscode');
const { PiAgentViewProvider } = require('./webviewProvider.cjs');

function activate(context) {
	const provider = new PiAgentViewProvider(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(PiAgentViewProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: true }
		}),
		vscode.commands.registerCommand('piAgent.focus', () => provider.focus()),
		vscode.commands.registerCommand('piAgent.setApiKey', async () => {
			await provider.promptForApiKey(provider.readConfiguration().provider);
		}),
		vscode.commands.registerCommand('piAgent.newSession', () => provider.runtime.newSession()),
		vscode.commands.registerCommand('piAgent.stop', () => provider.runtime.abort()),
		{ dispose: () => void provider.dispose() }
	);

	void openOnFirstLaunch(context, provider);
}

async function openOnFirstLaunch(context, provider) {
	const onboardingKey = 'piAgent.firstLaunchOpened';
	if (context.globalState.get(onboardingKey)) {
		return;
	}

	await context.globalState.update(onboardingKey, true);
	await provider.focus();
}

function deactivate() { }

module.exports = { activate, deactivate };
