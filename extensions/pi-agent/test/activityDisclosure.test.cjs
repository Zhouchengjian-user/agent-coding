/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extensionRoot = path.join(__dirname, '..');

test('activity stays collapsed before the assistant answer', () => {
	const panel = fs.readFileSync(path.join(extensionRoot, 'media', 'panel.js'), 'utf8');
	assert.match(panel, /processGroup\.hidden = true/);
	assert.match(panel, /section\.append\(dot, processGroup, assistant\)/);
	assert.match(panel, /state\.currentProcess\.list\.append\(details\)/);
});

test('only a final assistant message is rendered as the answer', () => {
	const panel = fs.readFileSync(path.join(extensionRoot, 'media', 'panel.js'), 'utf8');
	const runtime = fs.readFileSync(path.join(extensionRoot, 'src', 'piRuntime.cjs'), 'utf8');
	assert.match(panel, /if \(!message\.isFinal\)/);
	assert.match(runtime, /isFinal: !content\.some\(item => item\.type === 'toolCall'\)/);
	assert.doesNotMatch(runtime, /type: 'assistantDelta'/);
});

test('activity disclosure preview covers every component state', () => {
	const preview = fs.readFileSync(path.join(extensionRoot, 'media', 'activity-disclosure.preview.html'), 'utf8');
	for (const state of ['default', 'hover', 'focus-visible', 'active', 'disabled', 'loading', 'error', 'success']) {
		assert.match(preview, new RegExp(`>${state}<`));
	}
});
