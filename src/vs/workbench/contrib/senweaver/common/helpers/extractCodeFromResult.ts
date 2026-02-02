/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { DIVIDER, FINAL, ORIGINAL } from '../prompt/prompts.js'
export class SurroundingsRemover {
	readonly originalS: string
	i: number
	j: number

	// string is s[i...j]

	constructor(s: string) {
		this.originalS = s
		this.i = 0
		this.j = s.length - 1
	}
	value() {
		return this.originalS.substring(this.i, this.j + 1)
	}

	// returns whether it removed the whole prefix
	removePrefix = (prefix: string): boolean => {
		let offset = 0
		// console.log('prefix', prefix, Math.min(this.j, prefix.length - 1))
		while (this.i <= this.j && offset <= prefix.length - 1) {
			if (this.originalS.charAt(this.i) !== prefix.charAt(offset))
				break
			offset += 1
			this.i += 1
		}
		return offset === prefix.length
	}

	// // removes suffix from right to left
	removeSuffix = (suffix: string): boolean => {
		// e.g. suffix = <PRE/>, the string is <PRE>hi<P
		const s = this.value()
		// for every possible prefix of `suffix`, check if string ends with it
		for (let len = Math.min(s.length, suffix.length); len >= 1; len -= 1) {
			if (s.endsWith(suffix.substring(0, len))) { // the end of the string equals a prefix
				this.j -= len
				return len === suffix.length
			}
		}
		return false
	}
	// removeSuffix = (suffix: string): boolean => {
	// 	let offset = 0

	// 	while (this.j >= Math.max(this.i, 0)) {
	// 		if (this.originalS.charAt(this.j) !== suffix.charAt(suffix.length - 1 - offset))
	// 			break
	// 		offset += 1
	// 		this.j -= 1
	// 	}
	// 	return offset === suffix.length
	// }

	// either removes all or nothing
	removeFromStartUntilFullMatch = (until: string, alsoRemoveUntilStr: boolean) => {
		const index = this.originalS.indexOf(until, this.i)

		if (index === -1) {
			// this.i = this.j + 1
			return false
		}
		// console.log('index', index, until.length)

		if (alsoRemoveUntilStr)
			this.i = index + until.length
		else
			this.i = index

		return true
	}


	removeCodeBlock = () => {
		// Match either:
		// 1. ```language\n<code>\n```\n?
		// 2. ```<code>\n```\n?

		const pm = this
		const foundCodeBlock = pm.removePrefix('```')
		if (!foundCodeBlock) return false

		pm.removeFromStartUntilFullMatch('\n', true) // language

		const j = pm.j
		let foundCodeBlockEnd = pm.removeSuffix('```')

		if (pm.j === j) foundCodeBlockEnd = pm.removeSuffix('```\n') // if no change, try again with \n after ```

		if (!foundCodeBlockEnd) return false

		pm.removeSuffix('\n') // remove the newline before ```
		return true
	}


	deltaInfo = (recentlyAddedTextLen: number) => {
		// aaaaaatextaaaaaa{recentlyAdded}
		//                  ^   i    j    len
		//                  |
		//            recentyAddedIdx
		const recentlyAddedIdx = this.originalS.length - recentlyAddedTextLen
		const actualDelta = this.originalS.substring(Math.max(this.i, recentlyAddedIdx), this.j + 1)
		const ignoredSuffix = this.originalS.substring(Math.max(this.j + 1, recentlyAddedIdx), Infinity)
		return [actualDelta, ignoredSuffix] as const
	}



}



export const extractCodeFromRegular = ({ text, recentlyAddedTextLen }: { text: string, recentlyAddedTextLen: number }): [string, string, string] => {

	const pm = new SurroundingsRemover(text)

	pm.removeCodeBlock()

	const s = pm.value()
	const [delta, ignoredSuffix] = pm.deltaInfo(recentlyAddedTextLen)

	return [s, delta, ignoredSuffix]
}





// Ollama has its own FIM, we should not use this if we use that
export const extractCodeFromFIM = ({ text, recentlyAddedTextLen, midTag, }: { text: string, recentlyAddedTextLen: number, midTag: string }): [string, string, string] => {

	/* ------------- summary of the regex -------------
		[optional ` | `` | ```]
		(match optional_language_name)
		[optional strings here]
		[required <MID> tag]
		(match the stuff between mid tags)
		[optional <MID/> tag]
		[optional ` | `` | ```]
	*/

	const pm = new SurroundingsRemover(text)

	pm.removeCodeBlock()

	const foundMid = pm.removePrefix(`<${midTag}>`)

	if (foundMid) {
		pm.removeSuffix(`\n`) // sometimes outputs \n
		pm.removeSuffix(`</${midTag}>`)
	}
	const s = pm.value()
	const [delta, ignoredSuffix] = pm.deltaInfo(recentlyAddedTextLen)

	return [s, delta, ignoredSuffix]
}



export type ExtractedSearchReplaceBlock = {
	state: 'writingOriginal' | 'writingFinal' | 'done',
	orig: string,
	final: string,
}


// JS substring swaps indices, so "ab".substr(1,0) will NOT be '', it will be 'a'!
const voidSubstr = (str: string, start: number, end: number) => end < start ? '' : str.substring(start, end)

export const endsWithAnyPrefixOf = (str: string, anyPrefix: string) => {
	// for each prefix
	for (let i = anyPrefix.length; i >= 1; i--) { // i >= 1 because must not be empty string
		const prefix = anyPrefix.slice(0, i)
		if (str.endsWith(prefix)) return prefix
	}
	return null
}

// guarantees if you keep adding text, array length will strictly grow and state will progress without going back
export const extractSearchReplaceBlocks = (str: string) => {

	const blocks: ExtractedSearchReplaceBlock[] = []

	let i = 0 // search i and beyond
	while (true) {
		// 1. Find ORIGINAL marker
		const origMarkerStart = str.indexOf(ORIGINAL, i)
		if (origMarkerStart === -1) { return blocks }

		// Check validity of ORIGINAL marker line (should be followed by optional whitespace then newline)
		const newlineAfterOrig = str.indexOf('\n', origMarkerStart)
		if (newlineAfterOrig === -1) return blocks // incomplete stream

		const lineAfterOrig = str.substring(origMarkerStart + ORIGINAL.length, newlineAfterOrig)
		if (lineAfterOrig.trim() !== '') {
			// This might be "<<<<<<< ORIGINAL text" which is invalid, or just a false positive.
			// Advance and try again
			i = origMarkerStart + 1
			continue
		}

		const origStart = newlineAfterOrig + 1
		i = origStart
		// wrote <<<< ORIGINAL\n

		// 2. Find DIVIDER marker
		// It should appear as "\n======="
		const dividerMarkerStart = str.indexOf('\n' + DIVIDER, i)
		if (dividerMarkerStart === -1) {
			// Check if we are currently writing the original block or the divider
			// If the string ends with a partial divider, we are 'writingOriginal'
			// (Logic simplified: just assume writingOriginal if no divider found yet)
			const writingDIVIDERlen = endsWithAnyPrefixOf(str, '\n' + DIVIDER)?.length ?? 0
			blocks.push({
				orig: voidSubstr(str, origStart, str.length - writingDIVIDERlen),
				final: '',
				state: 'writingOriginal'
			})
			return blocks
		}

		// Check validity of DIVIDER marker line
		const newlineAfterDivider = str.indexOf('\n', dividerMarkerStart + 1) // +1 to skip the first \n
		if (newlineAfterDivider === -1) {
			// We found "\n=======" but no newline after. Maybe streaming is right here.
			// Treat as writingOriginal until we confirm the newline
			blocks.push({
				orig: voidSubstr(str, origStart, dividerMarkerStart), // up to \n
				final: '',
				state: 'writingOriginal'
			})
			return blocks
		}

		const lineAfterDivider = str.substring(dividerMarkerStart + 1 + DIVIDER.length, newlineAfterDivider)
		if (lineAfterDivider.trim() !== '') {
			// Invalid divider line? Treat as part of content maybe?
			// But typically we assume it's the divider.
			// If strict, we would skip. But let's be permissive and assume it is the divider, just ignore the garbage.
		}

		const origStrDone = voidSubstr(str, origStart, dividerMarkerStart) // content before \n=======
		const dividerStart = newlineAfterDivider + 1
		i = dividerStart
		// wrote \n=====\n

		// 3. Find FINAL marker
		// It could be "\n>>>>>>> UPDATED" (normal) or just ">>>>>>> UPDATED" (if file ends?) or at start of file?
		// Usually "\n" + FINAL.
		// Let's look for FINAL first.
		const finalMarkerStartRaw = str.indexOf(FINAL, i)
		if (finalMarkerStartRaw === -1) {
			const writingFINALlen = endsWithAnyPrefixOf(str, '\n' + FINAL)?.length ?? endsWithAnyPrefixOf(str, FINAL)?.length ?? 0
			blocks.push({
				orig: origStrDone,
				final: voidSubstr(str, dividerStart, str.length - writingFINALlen),
				state: 'writingFinal'
			})
			return blocks
		}

		// Check if it's preceeded by \n (recommended)
		let finalMarkerStart = finalMarkerStartRaw
		let isPreceededByNewline = false
		if (finalMarkerStartRaw > 0 && str[finalMarkerStartRaw - 1] === '\n') {
			finalMarkerStart = finalMarkerStartRaw - 1 // include the \n
			isPreceededByNewline = true
		}

		// Verify it matches our expected flow (it should be after dividerStart)
		if (finalMarkerStart < i) {
			// This shouldn't happen with indexOf(..., i), but logic check:
			// If we found FINAL before current pos, something is wrong or we found a loose FINAL.
			// Advance i
			i = finalMarkerStartRaw + 1
			continue
		}

		// We found it.
		const finalStrDone = voidSubstr(str, dividerStart, isPreceededByNewline ? finalMarkerStart : finalMarkerStartRaw)

		// Where does the marker end?
		// It might not have a newline after it if EOF
		let newlineAfterFinal = str.indexOf('\n', finalMarkerStartRaw + FINAL.length)
		if (newlineAfterFinal === -1) newlineAfterFinal = str.length

		const finalStart = newlineAfterFinal + 1 // continue search after this line
		i = finalStart
		// wrote >>>>> FINAL

		blocks.push({
			orig: origStrDone,
			final: finalStrDone,
			state: 'done'
		})
	}
}















// const tests: [string, { shape: Partial<ExtractedSearchReplaceBlock>[] }][] = [[
// 	`\
// \`\`\`
// <<<<<<< ORIGINA`, { shape: [] }
// ], [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL`, { shape: [], }
// ], [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A`, { shape: [{ state: 'writingOriginal', orig: 'A' }], }
// ], [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B`, { shape: [{ state: 'writingOriginal', orig: 'A\nB' }], }
// ], [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// `, { shape: [{ state: 'writingOriginal', orig: 'A\nB' }], }
// ], [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// ===`, { shape: [{ state: 'writingOriginal', orig: 'A\nB' }], }
// ], [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// ======`, { shape: [{ state: 'writingOriginal', orig: 'A\nB' }], }
// ], [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// =======`, { shape: [{ state: 'writingOriginal', orig: 'A\nB' }], }
// ], [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// =======
// `, { shape: [{ state: 'writingFinal', orig: 'A\nB', final: '' }], }
// ], [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// =======
// >>>>>>> UPDAT`, { shape: [{ state: 'writingFinal', orig: 'A\nB', final: '' }], }
// ], [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// =======
// >>>>>>> UPDATED`, { shape: [{ state: 'done', orig: 'A\nB', final: '' }], }
// ], [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// =======
// >>>>>>> UPDATED
// \`\`\``, { shape: [{ state: 'done', orig: 'A\nB', final: '' }], }
// ],


// // alternatively
// [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// =======
// X`, { shape: [{ state: 'writingFinal', orig: 'A\nB', final: 'X' }], }
// ],
// [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// =======
// X
// Y`, { shape: [{ state: 'writingFinal', orig: 'A\nB', final: 'X\nY' }], }
// ],
// [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// =======
// X
// Y
// `, { shape: [{ state: 'writingFinal', orig: 'A\nB', final: 'X\nY' }], }
// ],
// [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// =======
// X
// Y
// >>>>>>> UPDAT`, { shape: [{ state: 'writingFinal', orig: 'A\nB', final: 'X\nY' }], }
// ], [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// =======
// X
// Y
// >>>>>>> UPDATED`, { shape: [{ state: 'done', orig: 'A\nB', final: 'X\nY' }], }
// ], [
// 	`\
// \`\`\`
// <<<<<<< ORIGINAL
// A
// B
// =======
// X
// Y
// >>>>>>> UPDATED
// \`\`\``, { shape: [{ state: 'done', orig: 'A\nB', final: 'X\nY' }], }
// ]]




// function runTests() {


// 	let passedTests = 0;
// 	let failedTests = 0;

// 	for (let i = 0; i < tests.length; i++) {
// 		const [input, expected] = tests[i];
// 		const result = extractSearchReplaceBlocks(input);

// 		// Compare result with expected shape
// 		let passed = true;
// 		if (result.length !== expected.shape.length) {
// 			passed = false;
// 		} else {
// 			for (let j = 0; j < result.length; j++) { // block
// 				const expectedItem = expected.shape[j];
// 				const resultItem = result[j];

// 				if ((expectedItem.state !== undefined) && (expectedItem.state !== resultItem.state) ||
// 					(expectedItem.orig !== undefined) && (expectedItem.orig !== resultItem.orig) ||
// 					(expectedItem.final !== undefined) && (expectedItem.final !== resultItem.final)) {
// 					passed = false;
// 					break;
// 				}
// 			}
// 		}

// 		if (passed) {
// 			passedTests++;
// 			console.log(`Test ${i + 1} passed`);
// 		} else {
// 			failedTests++;
// 			console.log(`Test ${i + 1} failed`);
// 			console.log('Input:', input)
// 			console.log(`Expected:`, expected.shape);
// 			console.log(`Got:`, result);
// 		}
// 	}

// 	console.log(`Total: ${tests.length}, Passed: ${passedTests}, Failed: ${failedTests}`);
// 	return failedTests === 0;
// }



// runTests()


