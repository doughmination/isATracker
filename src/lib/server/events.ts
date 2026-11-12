/* src/lib/server/events.ts
 * MIT — (c) Doughmination System®
 */

import { EventEmitter } from 'node:events';

// findingCreated: a new pending finding needs a notification
// findingChanged: an existing finding changed and its notification needs a refresh
export type FindingEvent = 'findingCreated' | 'findingChanged';

const emitter = new EventEmitter();

export function emitFindingEvent(event: FindingEvent, findingId: number): void {
	emitter.emit(event, findingId);
}

export function onFindingEvent(event: FindingEvent, listener: (findingId: number) => void): void {
	emitter.on(event, listener);
}

export function removeFindingListeners(): void {
	emitter.removeAllListeners();
}
