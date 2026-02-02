import { URI } from '../../../../base/common/uri.js';

export type SenweaverDirectoryItem = {
	uri: URI;
	name: string;
	isSymbolicLink: boolean;
	children: SenweaverDirectoryItem[] | null;
	isDirectory: boolean;
	isGitIgnoredDirectory: false | { numChildren: number }; // if directory is gitignored, we ignore children
}
