/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCatalog, getCuratedModels, resolveModel } = require('../src/modelCatalog.cjs');

function createRuntime(models) {
	return {
		getModels: provider => models.filter(model => model.provider === provider),
		getModel: (provider, id) => models.find(model => model.provider === provider && model.id === id)
	};
}

test('curates preferred models in product order', () => {
	const runtime = createRuntime([
		{ provider: 'deepseek', id: 'deepseek-flash', name: 'Flash', contextWindow: 1000, reasoning: true },
		{ provider: 'deepseek', id: 'deepseek-v4-pro', name: 'Pro', contextWindow: 1000, reasoning: true }
	]);
	assert.deepEqual(getCuratedModels(runtime, 'deepseek').map(model => model.id), ['deepseek-v4-pro', 'deepseek-flash']);
});

test('falls back to the first provider model when the saved model disappears', () => {
	const runtime = createRuntime([
		{ provider: 'deepseek', id: 'deepseek-flash', name: 'Flash', contextWindow: 1000, reasoning: true }
	]);
	assert.equal(resolveModel(runtime, 'deepseek', 'missing').id, 'deepseek-flash');
});

test('keeps custom provider visible before it is configured', () => {
	const runtime = createRuntime([]);
	const catalog = buildCatalog(runtime);
	assert.deepEqual(catalog, [{ id: 'custom', label: 'Custom', models: [] }]);
});
