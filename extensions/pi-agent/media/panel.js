/* finesse · register=product · shell=canvas-dominant-ide+agent-rail · palette=theme-native+teal-signal · SOUL=6 SPECTACLE=2 DENSITY=8 */
/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const vscode = acquireVsCodeApi();
const elements = {
	timeline: document.getElementById('timeline'),
	welcome: document.getElementById('welcome'),
	welcomeTitle: document.getElementById('welcomeTitle'),
	welcomeDescription: document.getElementById('welcomeDescription'),
	suggestions: document.getElementById('suggestions'),
	workspaceName: document.getElementById('workspaceName'),
	notice: document.getElementById('notice'),
	promptInput: document.getElementById('promptInput'),
	providerSelect: document.getElementById('providerSelect'),
	modelSelect: document.getElementById('modelSelect'),
	newSessionButton: document.getElementById('newSessionButton'),
	keyButton: document.getElementById('keyButton'),
	stopButton: document.getElementById('stopButton'),
	sendButton: document.getElementById('sendButton'),
	runStatus: document.getElementById('runStatus'),
	modelLabel: document.getElementById('modelLabel')
};

const state = {
	strings: {},
	catalog: [],
	provider: 'deepseek',
	model: 'deepseek-v4-pro',
	running: false,
	currentAssistant: undefined,
	currentAssistantMarkdown: '',
	currentProcess: undefined,
	toolElements: new Map()
};

elements.newSessionButton.addEventListener('click', () => vscode.postMessage({ type: 'newSession' }));
elements.keyButton.addEventListener('click', () => vscode.postMessage({ type: 'setApiKey', provider: state.provider }));
elements.stopButton.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
elements.sendButton.addEventListener('click', sendPrompt);

elements.providerSelect.addEventListener('change', () => {
	state.provider = elements.providerSelect.value;
	const provider = state.catalog.find(item => item.id === state.provider);
	state.model = provider?.models[0]?.id ?? '';
	renderModelSelect();
	selectModel();
});

elements.modelSelect.addEventListener('change', () => {
	state.model = elements.modelSelect.value;
	selectModel();
});

elements.promptInput.addEventListener('input', () => {
	elements.promptInput.style.height = 'auto';
	elements.promptInput.style.height = `${Math.min(elements.promptInput.scrollHeight, 180)}px`;
});

elements.promptInput.addEventListener('keydown', event => {
	if (event.key === 'Enter' && !event.shiftKey) {
		event.preventDefault();
		sendPrompt();
	}
});

window.addEventListener('message', event => handleHostMessage(event.data));

function handleHostMessage(message) {
	switch (message.type) {
		case 'bootstrap':
			state.strings = message.strings;
			state.catalog = message.catalog;
			state.provider = message.provider;
			state.model = message.model;
			elements.workspaceName.textContent = message.workspaceName;
			applyStrings();
			renderProviderSelect();
			renderModelSelect();
			setCredentialNotice(message.hasApiKey);
			break;
		case 'credentialChanged':
			setCredentialNotice(message.configured);
			break;
		case 'credentialRequired':
			showNotice(state.strings.credentialRequired, false);
			break;
		case 'userMessage':
			startRun(message.text);
			break;
		case 'assistantMessage':
			showAssistantMessage(message);
			break;
		case 'toolStart':
			addToolStep(message);
			break;
		case 'toolEnd':
			finishToolStep(message);
			break;
		case 'approvalRequested':
			addApprovalCard(message);
			break;
		case 'approvalResolved':
			resolveApprovalCard(message);
			break;
		case 'retry':
			showNotice(`${message.message} (${message.attempt}/${message.maxAttempts})`, false);
			break;
		case 'runState':
			setRunState(message.state);
			break;
		case 'modelChanged':
			elements.modelLabel.textContent = message.model.name;
			break;
		case 'sessionCleared':
			clearSession();
			break;
		case 'error':
			showNotice(message.message, true);
			setRunState('idle');
			break;
	}
}

function applyStrings() {
	elements.welcomeTitle.textContent = state.strings.welcomeTitle;
	elements.welcomeDescription.textContent = state.strings.welcomeDescription;
	elements.promptInput.placeholder = state.strings.promptPlaceholder;
	elements.newSessionButton.title = state.strings.newSession;
	elements.newSessionButton.setAttribute('aria-label', state.strings.newSession);
	elements.providerSelect.setAttribute('aria-label', state.strings.provider);
	elements.modelSelect.setAttribute('aria-label', state.strings.model);
	elements.keyButton.textContent = state.strings.setKey;
	elements.stopButton.textContent = state.strings.stop;
	elements.sendButton.textContent = state.strings.send;
	elements.runStatus.textContent = state.strings.idle;
	elements.suggestions.replaceChildren(...state.strings.suggestions.map(text => {
		const button = document.createElement('button');
		button.className = 'suggestion';
		button.type = 'button';
		button.textContent = text;
		button.addEventListener('click', () => {
			elements.promptInput.value = text;
			sendPrompt();
		});
		return button;
	}));
}

function renderProviderSelect() {
	elements.providerSelect.replaceChildren(...state.catalog.map(provider => {
		const option = document.createElement('option');
		option.value = provider.id;
		option.textContent = provider.label;
		option.selected = provider.id === state.provider;
		return option;
	}));
}

function renderModelSelect() {
	const provider = state.catalog.find(item => item.id === state.provider);
	const models = provider?.models ?? [];
	if (!models.some(model => model.id === state.model)) {
		state.model = models[0]?.id ?? '';
	}
	elements.modelSelect.replaceChildren(...models.map(model => {
		const option = document.createElement('option');
		option.value = model.id;
		option.textContent = model.name;
		option.selected = model.id === state.model;
		return option;
	}));
	elements.modelLabel.textContent = models.find(model => model.id === state.model)?.name ?? state.model;
	elements.modelSelect.disabled = models.length === 0;
}

function selectModel() {
	if (!state.model) {
		return;
	}
	vscode.postMessage({ type: 'selectModel', provider: state.provider, model: state.model });
}

function sendPrompt() {
	const prompt = elements.promptInput.value.trim();
	if (!prompt || state.running) {
		return;
	}
	elements.promptInput.value = '';
	elements.promptInput.style.height = 'auto';
	vscode.postMessage({ type: 'sendPrompt', prompt });
}

function startRun(text) {
	elements.welcome.classList.add('hidden');
	elements.timeline.classList.remove('hidden');
	const divider = document.createElement('div');
	divider.className = 'session-divider';
	divider.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	elements.timeline.append(divider);

	const request = document.createElement('div');
	request.className = 'request-card';
	request.textContent = text;
	elements.timeline.append(request);

	const section = document.createElement('section');
	section.className = 'run-section running';
	const dot = document.createElement('span');
	dot.className = 'run-dot';
	dot.setAttribute('aria-hidden', 'true');
	const processGroup = document.createElement('details');
	processGroup.className = 'process-group running';
	processGroup.hidden = true;
	const processSummary = document.createElement('summary');
	const disclosure = document.createElement('span');
	disclosure.className = 'process-disclosure';
	disclosure.textContent = '›';
	disclosure.setAttribute('aria-hidden', 'true');
	const processTitle = document.createElement('span');
	processTitle.className = 'process-title';
	processTitle.textContent = state.strings.activity;
	const processMeta = document.createElement('span');
	processMeta.className = 'process-meta';
	const processList = document.createElement('div');
	processList.className = 'process-list';
	processSummary.append(disclosure, processTitle, processMeta);
	processGroup.append(processSummary, processList);
	const assistant = document.createElement('div');
	assistant.className = 'assistant-block';
	section.append(dot, processGroup, assistant);
	elements.timeline.append(section);
	state.currentAssistant = assistant;
	state.currentAssistantMarkdown = '';
	state.currentRunSection = section;
	state.currentProcess = {
		details: processGroup,
		meta: processMeta,
		list: processList,
		count: 0,
		failures: 0,
		state: 'running'
	};
	state.toolElements.clear();
	updateProcessSummary();
	setRunState('running');
	scrollToBottom();
}

function showAssistantMessage(message) {
	if (!state.currentAssistant) {
		return;
	}
	if (!message.isFinal) {
		state.currentAssistantMarkdown = '';
		state.currentAssistant.replaceChildren();
		return;
	}
	state.currentAssistantMarkdown = message.text;
	flushAssistantRender();
}

function flushAssistantRender() {
	if (!state.currentAssistant) {
		return;
	}
	renderMarkdown(state.currentAssistant, state.currentAssistantMarkdown);
	scrollToBottom();
}

function addToolStep(message) {
	if (!state.currentProcess) {
		return;
	}
	state.currentProcess.count++;
	state.currentProcess.details.hidden = false;
	const details = document.createElement('details');
	details.className = 'tool-step';
	const summary = document.createElement('summary');
	const name = document.createElement('span');
	name.className = 'tool-name';
	name.textContent = toolLabel(message.name, message.input);
	const status = document.createElement('span');
	status.className = 'tool-state';
	status.textContent = state.strings.running;
	const payload = document.createElement('pre');
	payload.className = 'tool-payload';
	payload.textContent = `${state.strings.toolInput}\n${formatPayload(message.input)}`;
	summary.append(name, status);
	details.append(summary, payload);
	state.currentProcess.list.append(details);
	state.toolElements.set(message.id, { details, status, payload });
	updateProcessSummary();
	scrollToBottom();
}

function finishToolStep(message) {
	const item = state.toolElements.get(message.id);
	if (!item) {
		return;
	}
	const duration = Number.isFinite(message.durationMs) ? `${(message.durationMs / 1000).toFixed(2)}s` : state.strings.idle;
	item.status.textContent = message.isError ? `${state.strings.error} · ${duration}` : duration;
	item.details.classList.toggle('error', message.isError);
	item.details.open = message.isError;
	if (message.isError && state.currentProcess) {
		state.currentProcess.failures++;
		state.currentProcess.details.classList.add('has-errors');
		state.currentProcess.details.open = true;
	}
	item.payload.textContent += `\n\n${state.strings.toolOutput}\n${message.result}`;
	updateProcessSummary();
	scrollToBottom();
}

function addApprovalCard(message) {
	if (!state.currentRunSection) {
		return;
	}
	const card = document.createElement('section');
	card.className = 'approval-card';
	card.dataset.approvalId = message.id;
	const title = document.createElement('h2');
	title.textContent = state.strings.approvalTitle;
	const description = document.createElement('p');
	description.textContent = toolLabel(message.toolName, message.input);
	const payload = document.createElement('pre');
	payload.textContent = formatPayload(message.input);
	const actions = document.createElement('div');
	actions.className = 'approval-actions';
	const approve = createApprovalButton(state.strings.approve, 'primary', true);
	const reject = createApprovalButton(state.strings.reject, 'secondary', false);
	actions.append(approve, reject);
	card.append(title, description, payload, actions);
	state.currentRunSection.insertBefore(card, state.currentAssistant);
	scrollToBottom();
}

function createApprovalButton(label, className, approved) {
	const button = document.createElement('button');
	button.className = `approval-action ${className}`;
	button.type = 'button';
	button.textContent = label;
	button.addEventListener('click', event => {
		const card = event.currentTarget.closest('.approval-card');
		vscode.postMessage({ type: 'approval', id: card.dataset.approvalId, approved });
		for (const action of card.querySelectorAll('button')) {
			action.disabled = true;
		}
	});
	return button;
}

function resolveApprovalCard(message) {
	const card = elements.timeline.querySelector(`[data-approval-id="${CSS.escape(message.id)}"]`);
	if (!card) {
		return;
	}
	card.querySelector('h2').textContent = message.approved ? state.strings.approve : state.strings.reject;
	card.classList.add('resolved');
	card.querySelector('pre')?.remove();
	card.querySelector('.approval-actions')?.remove();
	if (state.currentProcess) {
		state.currentProcess.count++;
		state.currentProcess.details.hidden = false;
		state.currentProcess.list.append(card);
		updateProcessSummary();
	}
}

function setRunState(runState) {
	state.running = runState === 'running';
	elements.runStatus.textContent = runState === 'running' ? state.strings.running : runState === 'stopped' ? state.strings.stopped : state.strings.idle;
	elements.stopButton.disabled = !state.running;
	elements.sendButton.disabled = state.running;
	elements.providerSelect.disabled = state.running;
	elements.modelSelect.disabled = state.running;
	if (!state.running && state.currentRunSection) {
		flushAssistantRender();
		state.currentRunSection.classList.remove('running');
		if (state.currentProcess) {
			state.currentProcess.state = runState === 'stopped' ? 'stopped' : 'completed';
			state.currentProcess.details.classList.remove('running');
			state.currentProcess.details.classList.toggle('completed', runState !== 'stopped' && state.currentProcess.failures === 0);
			state.currentProcess.details.classList.toggle('stopped', runState === 'stopped');
			updateProcessSummary();
		}
	}
}

function updateProcessSummary() {
	const process = state.currentProcess;
	if (!process) {
		return;
	}
	const stepLabel = process.count === 1 ? state.strings.step : state.strings.steps;
	let status = state.strings.running;
	if (process.failures > 0) {
		status = state.strings.needsAttention;
	} else if (process.state === 'completed') {
		status = state.strings.completed;
	} else if (process.state === 'stopped') {
		status = state.strings.stopped;
	}
	process.meta.textContent = `${process.count} ${stepLabel} · ${status}`;
}

function setCredentialNotice(configured) {
	if (configured) {
		elements.notice.classList.add('hidden');
		return;
	}
	showNotice(state.strings.credentialRequired, false);
}

function showNotice(message, isError) {
	elements.notice.textContent = message;
	elements.notice.classList.remove('hidden');
	elements.notice.classList.toggle('error', isError);
}

function clearSession() {
	elements.timeline.replaceChildren();
	elements.timeline.classList.add('hidden');
	elements.welcome.classList.remove('hidden');
	state.currentAssistant = undefined;
	state.currentAssistantMarkdown = '';
	state.currentRunSection = undefined;
	state.currentProcess = undefined;
	state.toolElements.clear();
	setRunState('idle');
}

function toolLabel(name, input) {
	const target = input?.path ?? input?.file_path ?? input?.command ?? input?.pattern ?? '';
	return target ? `${name} · ${String(target).slice(0, 120)}` : name;
}

function formatPayload(payload) {
	try {
		return JSON.stringify(payload, null, 2);
	} catch {
		return String(payload);
	}
}

function renderMarkdown(container, markdown) {
	const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
	const fragment = document.createDocumentFragment();
	let index = 0;

	while (index < lines.length) {
		const line = lines[index];
		if (!line.trim()) {
			index++;
			continue;
		}

		const fence = line.match(/^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)?.*$/);
		if (fence) {
			const marker = fence[1][0];
			const minimumLength = fence[1].length;
			const codeLines = [];
			index++;
			while (index < lines.length && !new RegExp(`^\\s{0,3}${marker}{${minimumLength},}\\s*$`).test(lines[index])) {
				codeLines.push(lines[index]);
				index++;
			}
			if (index < lines.length) {
				index++;
			}
			const pre = document.createElement('pre');
			const code = document.createElement('code');
			if (fence[2]) {
				code.dataset.language = fence[2];
			}
			code.textContent = codeLines.join('\n');
			pre.append(code);
			fragment.append(pre);
			continue;
		}

		const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
		if (heading) {
			const element = document.createElement(`h${heading[1].length}`);
			appendInline(element, heading[2]);
			fragment.append(element);
			index++;
			continue;
		}

		if (/^\s{0,3}((\*|-|_)\s*){3,}$/.test(line)) {
			fragment.append(document.createElement('hr'));
			index++;
			continue;
		}

		if (isTableStart(lines, index)) {
			const headerCells = splitTableRow(lines[index]);
			index += 2;
			const rows = [];
			while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
				rows.push(splitTableRow(lines[index]));
				index++;
			}
			fragment.append(createTable(headerCells, rows));
			continue;
		}

		const listMatch = matchListItem(line);
		if (listMatch) {
			const list = document.createElement(listMatch.ordered ? 'ol' : 'ul');
			while (index < lines.length) {
				const item = matchListItem(lines[index]);
				if (!item || item.ordered !== listMatch.ordered) {
					break;
				}
				const listItem = document.createElement('li');
				appendInline(listItem, item.text);
				list.append(listItem);
				index++;
			}
			fragment.append(list);
			continue;
		}

		if (/^\s{0,3}>/.test(line)) {
			const quote = document.createElement('blockquote');
			const paragraph = document.createElement('p');
			let first = true;
			while (index < lines.length && /^\s{0,3}>/.test(lines[index])) {
				if (!first) {
					paragraph.append(document.createElement('br'));
				}
				appendInline(paragraph, lines[index].replace(/^\s{0,3}>\s?/, ''));
				first = false;
				index++;
			}
			quote.append(paragraph);
			fragment.append(quote);
			continue;
		}

		const paragraph = document.createElement('p');
		let first = true;
		while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
			if (!first) {
				paragraph.append(document.createElement('br'));
			}
			appendInline(paragraph, lines[index]);
			first = false;
			index++;
		}
		fragment.append(paragraph);
	}

	container.replaceChildren(fragment);
}

function isBlockStart(lines, index) {
	const line = lines[index];
	return /^\s{0,3}(`{3,}|~{3,})/.test(line)
		|| /^\s{0,3}#{1,6}\s+/.test(line)
		|| /^\s{0,3}>/.test(line)
		|| /^\s{0,3}((\*|-|_)\s*){3,}$/.test(line)
		|| Boolean(matchListItem(line))
		|| isTableStart(lines, index);
}

function matchListItem(line) {
	const unordered = line.match(/^\s{0,3}[-+*]\s+(.+)$/);
	if (unordered) {
		return { ordered: false, text: unordered[1] };
	}
	const ordered = line.match(/^\s{0,3}\d+[.)]\s+(.+)$/);
	return ordered ? { ordered: true, text: ordered[1] } : undefined;
}

function isTableStart(lines, index) {
	if (index + 1 >= lines.length || !lines[index].includes('|')) {
		return false;
	}
	const divider = splitTableRow(lines[index + 1]);
	return divider.length > 0 && divider.every(cell => /^:?-{3,}:?$/.test(cell));
}

function splitTableRow(line) {
	let value = line.trim();
	if (value.startsWith('|')) {
		value = value.slice(1);
	}
	if (value.endsWith('|') && !value.endsWith('\\|')) {
		value = value.slice(0, -1);
	}
	const cells = [];
	let cell = '';
	let escaped = false;
	for (const character of value) {
		if (escaped) {
			cell += character;
			escaped = false;
		} else if (character === '\\') {
			escaped = true;
		} else if (character === '|') {
			cells.push(cell.trim());
			cell = '';
		} else {
			cell += character;
		}
	}
	if (escaped) {
		cell += '\\';
	}
	cells.push(cell.trim());
	return cells;
}

function createTable(headerCells, rows) {
	const wrapper = document.createElement('div');
	wrapper.className = 'markdown-table-wrap';
	const table = document.createElement('table');
	const head = document.createElement('thead');
	const headRow = document.createElement('tr');
	for (const cell of headerCells) {
		const heading = document.createElement('th');
		appendInline(heading, cell);
		headRow.append(heading);
	}
	head.append(headRow);
	table.append(head);
	if (rows.length) {
		const body = document.createElement('tbody');
		for (const row of rows) {
			const tableRow = document.createElement('tr');
			for (let index = 0; index < headerCells.length; index++) {
				const cell = document.createElement('td');
				appendInline(cell, row[index] ?? '');
				tableRow.append(cell);
			}
			body.append(tableRow);
		}
		table.append(body);
	}
	wrapper.append(table);
	return wrapper;
}

function appendInline(parent, text) {
	const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\[[^\]\n]+\]\([^\s)]+\)|\*[^*\n]+\*|_[^_\n]+_)/g;
	let cursor = 0;
	let match;
	while ((match = pattern.exec(text))) {
		parent.append(document.createTextNode(text.slice(cursor, match.index)));
		const token = match[0];
		if (token.startsWith('`')) {
			const code = document.createElement('code');
			code.textContent = token.slice(1, -1);
			parent.append(code);
		} else if (token.startsWith('**') || token.startsWith('__')) {
			const strong = document.createElement('strong');
			appendInline(strong, token.slice(2, -2));
			parent.append(strong);
		} else if (token.startsWith('~~')) {
			const strike = document.createElement('s');
			appendInline(strike, token.slice(2, -2));
			parent.append(strike);
		} else if (token.startsWith('[')) {
			appendLink(parent, token);
		} else {
			const emphasis = document.createElement('em');
			appendInline(emphasis, token.slice(1, -1));
			parent.append(emphasis);
		}
		cursor = match.index + token.length;
	}
	parent.append(document.createTextNode(text.slice(cursor)));
}

function appendLink(parent, token) {
	const match = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
	if (!match) {
		parent.append(document.createTextNode(token));
		return;
	}
	let url;
	try {
		url = new URL(match[2]);
	} catch {
		parent.append(document.createTextNode(match[1]));
		return;
	}
	if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) {
		parent.append(document.createTextNode(match[1]));
		return;
	}
	const link = document.createElement('a');
	link.href = url.href;
	link.target = '_blank';
	link.rel = 'noreferrer noopener';
	appendInline(link, match[1]);
	parent.append(link);
}

function scrollToBottom() {
	queueMicrotask(() => {
		elements.timeline.scrollTop = elements.timeline.scrollHeight;
	});
}

vscode.postMessage({ type: 'ready' });
