/* src/lib/server/config.test.ts */

import assert from 'node:assert/strict';
import { test } from 'node:test';

const tokenVariables = ['GITHUB_TOKEN', 'READ_GITHUB_TOKEN', 'MAINTAINER_GITHUB_TOKEN'];

test('GitHub token configuration supports split credentials and legacy deployments', async () => {
	const previous = tokenVariables.map((name) => process.env[name]);
	const cases = [
		{
			values: ['legacy-fixture', undefined, undefined],
			reader: 'legacy-fixture',
			maintainer: 'legacy-fixture'
		},
		{
			values: ['legacy-fixture', 'reader-fixture', 'maintainer-fixture'],
			reader: 'reader-fixture',
			maintainer: 'maintainer-fixture'
		},
		{
			values: [undefined, undefined, 'maintainer-fixture'],
			reader: 'maintainer-fixture',
			maintainer: 'maintainer-fixture'
		},
		{
			values: [undefined, 'reader-fixture', undefined],
			reader: 'reader-fixture',
			maintainer: ''
		}
	];

	try {
		for (const [index, fixture] of cases.entries()) {
			for (const [position, name] of tokenVariables.entries()) {
				const value = fixture.values[position];

				if (value === undefined) {
					delete process.env[name];
				} else {
					process.env[name] = value;
				}
			}

			// A fresh module instance gives each fixture its own cached configuration.
			const moduleUrl = new URL(`./config.ts?token-fixture=${index}`, import.meta.url);
			const { getConfig } = await import(moduleUrl.href);
			const config = getConfig();

			assert.equal(config.readGithubToken, fixture.reader);
			assert.equal(config.maintainerGithubToken, fixture.maintainer);
		}
	} finally {
		for (const [index, name] of tokenVariables.entries()) {
			const value = previous[index];

			if (value === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
	}
});
