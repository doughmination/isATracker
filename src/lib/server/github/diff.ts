/* src/lib/server/github/diff.ts
 * MIT — (c) Doughmination System®
 */

const hunkHeader = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// Line numbers on the new side of a patch that GitHub accepts review comments on
export function getCommentableLines(patch: string | undefined): Set<number> {
	const commentableLines = new Set<number>();

	if (!patch) {
		return commentableLines;
	}

	let newLineNumber = 0;

	for (const patchLine of patch.split('\n')) {
		const header = hunkHeader.exec(patchLine);

		if (header) {
			newLineNumber = Number(header[1]);
			continue;
		}

		if (newLineNumber === 0 || patchLine.startsWith('-') || patchLine.startsWith('\\')) {
			continue;
		}

		// Added lines and unchanged context lines both exist on the new side
		commentableLines.add(newLineNumber);
		newLineNumber += 1;
	}

	return commentableLines;
}
