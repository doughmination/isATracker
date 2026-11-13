/* src/lib/server/network.test.ts
 * MIT — (c) Doughmination System®
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { waitForNetwork } from './network.ts';

describe('waitForNetwork', () => {
	test('returns at once when the network answers', async () => {
		let probeCount = 0;

		const ready = await waitForNetwork({
			isCancelled: () => false,
			delaysSeconds: [0.001],
			probe: async () => {
				probeCount += 1;
			}
		});

		assert.equal(ready, true);
		assert.equal(probeCount, 1);
	});

	test('keeps trying until the network answers', async () => {
		let probeCount = 0;

		const ready = await waitForNetwork({
			isCancelled: () => false,
			delaysSeconds: [0.001, 0.002],
			probe: async () => {
				probeCount += 1;

				if (probeCount < 5) {
					throw new Error('fetch failed');
				}
			}
		});

		assert.equal(ready, true);
		assert.equal(probeCount, 5);
	});

	test('gives up quietly when cancelled', async () => {
		let probeCount = 0;

		const ready = await waitForNetwork({
			isCancelled: () => probeCount >= 2,
			delaysSeconds: [0.001],
			probe: async () => {
				probeCount += 1;

				throw new Error('fetch failed');
			}
		});

		assert.equal(ready, false);
		assert.equal(probeCount, 2);
	});
});
