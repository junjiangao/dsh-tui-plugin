import { createRequire } from "node:module";
import { spawn } from "child_process";
import { readdirSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import * as fs$1 from "node:fs";
import * as os from "node:os";
import { homedir as homedir$1 } from "node:os";
import * as path$1 from "node:path";
import { isAbsolute, join as join$1, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { execFile, execSync } from "node:child_process";
import { EventEmitter } from "events";
import { fileURLToPath } from "node:url";
import { LlmError, createUserMessage, errorChain } from "@deepseek-ai/dsh-llm";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { SessionId, isReplacementSurfaceEvent } from "@deepseek-ai/dsh-session";
import { foldSessionTitle } from "@deepseek-ai/dsh-session-title";
import { formatSessionReferenceMention, parseSessionReferenceText } from "@deepseek-ai/dsh-session-reference";
import z from "@deepseek-ai/schemastery";
import { lstat, readdir, stat } from "node:fs/promises";
import { isCompactCheckpointSource } from "@deepseek-ai/dsh-compaction";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";
import { UserQuestionError } from "@deepseek-ai/dsh-user-questions";
import { resolveSessionPreset } from "@deepseek-ai/dsh-agent-presets";
import { Service } from "@deepseek-ai/cordis";

//#region \0rolldown/runtime.js
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/fuzzy.js
/**
* Fuzzy matching utilities.
* Matches if all query characters appear in order (not necessarily consecutive).
* Lower score = better match.
*/
function fuzzyMatch(query, text) {
	const queryLower = query.toLowerCase();
	const textLower = text.toLowerCase();
	const matchQuery = (normalizedQuery) => {
		if (normalizedQuery.length === 0) return {
			matches: true,
			score: 0
		};
		if (normalizedQuery.length > textLower.length) return {
			matches: false,
			score: 0
		};
		let queryIndex = 0;
		let score = 0;
		let lastMatchIndex = -1;
		let consecutiveMatches = 0;
		for (let i = 0; i < textLower.length && queryIndex < normalizedQuery.length; i++) if (textLower[i] === normalizedQuery[queryIndex]) {
			const isWordBoundary = i === 0 || /[\s\-_./:]/.test(textLower[i - 1]);
			if (lastMatchIndex === i - 1) {
				consecutiveMatches++;
				score -= consecutiveMatches * 5;
			} else {
				consecutiveMatches = 0;
				if (lastMatchIndex >= 0) score += (i - lastMatchIndex - 1) * 2;
			}
			if (isWordBoundary) score -= 10;
			score += i * .1;
			lastMatchIndex = i;
			queryIndex++;
		}
		if (queryIndex < normalizedQuery.length) return {
			matches: false,
			score: 0
		};
		if (normalizedQuery === textLower) score -= 100;
		return {
			matches: true,
			score
		};
	};
	const primaryMatch = matchQuery(queryLower);
	if (primaryMatch.matches) return primaryMatch;
	const alphaNumericMatch = queryLower.match(/^(?<letters>[a-z]+)(?<digits>[0-9]+)$/);
	const numericAlphaMatch = queryLower.match(/^(?<digits>[0-9]+)(?<letters>[a-z]+)$/);
	const swappedQuery = alphaNumericMatch ? `${alphaNumericMatch.groups?.digits ?? ""}${alphaNumericMatch.groups?.letters ?? ""}` : numericAlphaMatch ? `${numericAlphaMatch.groups?.letters ?? ""}${numericAlphaMatch.groups?.digits ?? ""}` : "";
	if (!swappedQuery) return primaryMatch;
	const swappedMatch = matchQuery(swappedQuery);
	if (!swappedMatch.matches) return primaryMatch;
	return {
		matches: true,
		score: swappedMatch.score + 5
	};
}
/**
* Filter and sort items by fuzzy match quality (best matches first).
* Supports whitespace- and slash-separated tokens: all tokens must match.
*/
function fuzzyFilter(items, query, getText) {
	if (!query.trim()) return items;
	const tokens = query.trim().split(/[\s/]+/).filter((t) => t.length > 0);
	if (tokens.length === 0) return items;
	const results = [];
	for (const item of items) {
		const text = getText(item);
		let totalScore = 0;
		let allMatch = true;
		for (const token of tokens) {
			const match = fuzzyMatch(token, text);
			if (match.matches) totalScore += match.score;
			else {
				allMatch = false;
				break;
			}
		}
		if (allMatch) results.push({
			item,
			totalScore
		});
	}
	results.sort((a, b) => a.totalScore - b.totalScore);
	return results.map((r) => r.item);
}

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/autocomplete.js
const PATH_DELIMITERS = /* @__PURE__ */ new Set([
	" ",
	"	",
	"\"",
	"'",
	"="
]);
function toDisplayPath(value) {
	return value.replace(/\\/g, "/");
}
function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function buildFdPathQuery(query) {
	const normalized = toDisplayPath(query);
	if (!normalized.includes("/")) return normalized;
	const hasTrailingSeparator = normalized.endsWith("/");
	const trimmed = normalized.replace(/^\/+|\/+$/g, "");
	if (!trimmed) return normalized;
	const separatorPattern = "[\\\\/]";
	const segments = trimmed.split("/").filter(Boolean).map((segment) => escapeRegex(segment));
	if (segments.length === 0) return normalized;
	let pattern = segments.join(separatorPattern);
	if (hasTrailingSeparator) pattern += separatorPattern;
	return pattern;
}
function findLastDelimiter(text) {
	for (let i = text.length - 1; i >= 0; i -= 1) if (PATH_DELIMITERS.has(text[i] ?? "")) return i;
	return -1;
}
function findUnclosedQuoteStart(text) {
	let inQuotes = false;
	let quoteStart = -1;
	for (let i = 0; i < text.length; i += 1) if (text[i] === "\"") {
		inQuotes = !inQuotes;
		if (inQuotes) quoteStart = i;
	}
	return inQuotes ? quoteStart : null;
}
function isTokenStart(text, index) {
	return index === 0 || PATH_DELIMITERS.has(text[index - 1] ?? "");
}
function extractQuotedPrefix(text) {
	const quoteStart = findUnclosedQuoteStart(text);
	if (quoteStart === null) return null;
	if (quoteStart > 0 && text[quoteStart - 1] === "@") {
		if (!isTokenStart(text, quoteStart - 1)) return null;
		return text.slice(quoteStart - 1);
	}
	if (!isTokenStart(text, quoteStart)) return null;
	return text.slice(quoteStart);
}
function parsePathPrefix(prefix) {
	if (prefix.startsWith("@\"")) return {
		rawPrefix: prefix.slice(2),
		isAtPrefix: true,
		isQuotedPrefix: true
	};
	if (prefix.startsWith("\"")) return {
		rawPrefix: prefix.slice(1),
		isAtPrefix: false,
		isQuotedPrefix: true
	};
	if (prefix.startsWith("@")) return {
		rawPrefix: prefix.slice(1),
		isAtPrefix: true,
		isQuotedPrefix: false
	};
	return {
		rawPrefix: prefix,
		isAtPrefix: false,
		isQuotedPrefix: false
	};
}
function buildCompletionValue(path, options) {
	const needsQuotes = options.isQuotedPrefix || path.includes(" ");
	const prefix = options.isAtPrefix ? "@" : "";
	if (!needsQuotes) return `${prefix}${path}`;
	return `${`${prefix}"`}${path}"`;
}
async function walkDirectoryWithFd(baseDir, fdPath, query, maxResults, signal) {
	const args = [
		"--base-directory",
		baseDir,
		"--max-results",
		String(maxResults),
		"--type",
		"f",
		"--type",
		"d",
		"--follow",
		"--hidden",
		"--exclude",
		".git",
		"--exclude",
		".git/*",
		"--exclude",
		".git/**"
	];
	if (toDisplayPath(query).includes("/")) args.push("--full-path");
	if (query) args.push(buildFdPathQuery(query));
	return await new Promise((resolve) => {
		if (signal.aborted) {
			resolve([]);
			return;
		}
		const child = spawn(fdPath, args, { stdio: [
			"ignore",
			"pipe",
			"pipe"
		] });
		let stdout = "";
		let resolved = false;
		const finish = (results) => {
			if (resolved) return;
			resolved = true;
			signal.removeEventListener("abort", onAbort);
			resolve(results);
		};
		const onAbort = () => {
			if (child.exitCode === null) child.kill("SIGKILL");
		};
		signal.addEventListener("abort", onAbort, { once: true });
		child.stdout.setEncoding("utf-8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.on("error", () => {
			finish([]);
		});
		child.on("close", (code) => {
			if (signal.aborted || code !== 0 || !stdout) {
				finish([]);
				return;
			}
			const lines = stdout.trim().split("\n").filter(Boolean);
			const results = [];
			for (const line of lines) {
				const displayLine = toDisplayPath(line);
				const hasTrailingSeparator = displayLine.endsWith("/");
				const normalizedPath = hasTrailingSeparator ? displayLine.slice(0, -1) : displayLine;
				if (normalizedPath === ".git" || normalizedPath.startsWith(".git/") || normalizedPath.includes("/.git/")) continue;
				results.push({
					path: displayLine,
					isDirectory: hasTrailingSeparator
				});
			}
			finish(results);
		});
	});
}
var CombinedAutocompleteProvider = class {
	commands;
	basePath;
	fdPath;
	constructor(commands = [], basePath, fdPath = null) {
		this.commands = commands;
		this.basePath = basePath;
		this.fdPath = fdPath;
	}
	async getSuggestions(lines, cursorLine, cursorCol, options) {
		const textBeforeCursor = (lines[cursorLine] || "").slice(0, cursorCol);
		const atPrefix = this.extractAtPrefix(textBeforeCursor);
		if (atPrefix) {
			const { rawPrefix, isQuotedPrefix } = parsePathPrefix(atPrefix);
			const suggestions = await this.getFuzzyFileSuggestions(rawPrefix, {
				isQuotedPrefix,
				signal: options.signal
			});
			if (suggestions.length === 0) return null;
			return {
				items: suggestions,
				prefix: atPrefix
			};
		}
		if (!options.force && textBeforeCursor.startsWith("/")) {
			const spaceIndex = textBeforeCursor.indexOf(" ");
			if (spaceIndex === -1) {
				const prefix = textBeforeCursor.slice(1);
				const commandItems = this.commands.map((cmd) => {
					const name = "name" in cmd ? cmd.name : cmd.value;
					const hint = "argumentHint" in cmd && cmd.argumentHint ? cmd.argumentHint : void 0;
					const desc = cmd.description ?? "";
					return {
						name,
						label: name,
						description: (hint ? desc ? `${hint} — ${desc}` : hint : desc) || void 0
					};
				});
				const filtered = fuzzyFilter(commandItems, prefix, (item) => item.name).map((item) => ({
					value: item.name,
					label: item.label,
					...item.description && { description: item.description }
				}));
				if (filtered.length === 0) return null;
				return {
					items: filtered,
					prefix: textBeforeCursor
				};
			}
			const commandName = textBeforeCursor.slice(1, spaceIndex);
			const argumentText = textBeforeCursor.slice(spaceIndex + 1);
			const command = this.commands.find((cmd) => {
				return ("name" in cmd ? cmd.name : cmd.value) === commandName;
			});
			if (!command || !("getArgumentCompletions" in command) || !command.getArgumentCompletions) return null;
			const argumentSuggestions = await command.getArgumentCompletions(argumentText);
			if (!Array.isArray(argumentSuggestions) || argumentSuggestions.length === 0) return null;
			return {
				items: argumentSuggestions,
				prefix: argumentText
			};
		}
		const pathMatch = this.extractPathPrefix(textBeforeCursor, options.force ?? false);
		if (pathMatch === null) return null;
		const suggestions = this.getFileSuggestions(pathMatch);
		if (suggestions.length === 0) return null;
		return {
			items: suggestions,
			prefix: pathMatch
		};
	}
	applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
		const currentLine = lines[cursorLine] || "";
		const beforePrefix = currentLine.slice(0, cursorCol - prefix.length);
		const afterCursor = currentLine.slice(cursorCol);
		const isQuotedPrefix = prefix.startsWith("\"") || prefix.startsWith("@\"");
		const hasLeadingQuoteAfterCursor = afterCursor.startsWith("\"");
		const hasTrailingQuoteInItem = item.value.endsWith("\"");
		const adjustedAfterCursor = isQuotedPrefix && hasTrailingQuoteInItem && hasLeadingQuoteAfterCursor ? afterCursor.slice(1) : afterCursor;
		if (prefix.startsWith("/") && beforePrefix.trim() === "" && !prefix.slice(1).includes("/")) {
			const newLine = `${beforePrefix}/${item.value} ${adjustedAfterCursor}`;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;
			return {
				lines: newLines,
				cursorLine,
				cursorCol: beforePrefix.length + item.value.length + 2
			};
		}
		if (prefix.startsWith("@")) {
			const isDirectory = item.label.endsWith("/");
			const suffix = isDirectory ? "" : " ";
			const newLine = `${beforePrefix + item.value}${suffix}${adjustedAfterCursor}`;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;
			const hasTrailingQuote = item.value.endsWith("\"");
			const cursorOffset = isDirectory && hasTrailingQuote ? item.value.length - 1 : item.value.length;
			return {
				lines: newLines,
				cursorLine,
				cursorCol: beforePrefix.length + cursorOffset + suffix.length
			};
		}
		const textBeforeCursor = currentLine.slice(0, cursorCol);
		if (textBeforeCursor.includes("/") && textBeforeCursor.includes(" ")) {
			const newLine = beforePrefix + item.value + adjustedAfterCursor;
			const newLines = [...lines];
			newLines[cursorLine] = newLine;
			const isDirectory = item.label.endsWith("/");
			const hasTrailingQuote = item.value.endsWith("\"");
			const cursorOffset = isDirectory && hasTrailingQuote ? item.value.length - 1 : item.value.length;
			return {
				lines: newLines,
				cursorLine,
				cursorCol: beforePrefix.length + cursorOffset
			};
		}
		const newLine = beforePrefix + item.value + adjustedAfterCursor;
		const newLines = [...lines];
		newLines[cursorLine] = newLine;
		const isDirectory = item.label.endsWith("/");
		const hasTrailingQuote = item.value.endsWith("\"");
		const cursorOffset = isDirectory && hasTrailingQuote ? item.value.length - 1 : item.value.length;
		return {
			lines: newLines,
			cursorLine,
			cursorCol: beforePrefix.length + cursorOffset
		};
	}
	extractAtPrefix(text) {
		const quotedPrefix = extractQuotedPrefix(text);
		if (quotedPrefix?.startsWith("@\"")) return quotedPrefix;
		const lastDelimiterIndex = findLastDelimiter(text);
		const tokenStart = lastDelimiterIndex === -1 ? 0 : lastDelimiterIndex + 1;
		if (text[tokenStart] === "@") return text.slice(tokenStart);
		return null;
	}
	extractPathPrefix(text, forceExtract = false) {
		const quotedPrefix = extractQuotedPrefix(text);
		if (quotedPrefix) return quotedPrefix;
		const lastDelimiterIndex = findLastDelimiter(text);
		const pathPrefix = lastDelimiterIndex === -1 ? text : text.slice(lastDelimiterIndex + 1);
		if (forceExtract) return pathPrefix;
		if (pathPrefix.includes("/") || pathPrefix.startsWith(".") || pathPrefix.startsWith("~/")) return pathPrefix;
		if (pathPrefix === "" && text.endsWith(" ")) return pathPrefix;
		return null;
	}
	expandHomePath(path) {
		if (path.startsWith("~/")) {
			const expandedPath = join(homedir(), path.slice(2));
			return path.endsWith("/") && !expandedPath.endsWith("/") ? `${expandedPath}/` : expandedPath;
		} else if (path === "~") return homedir();
		return path;
	}
	resolveScopedFuzzyQuery(rawQuery) {
		const normalizedQuery = toDisplayPath(rawQuery);
		const slashIndex = normalizedQuery.lastIndexOf("/");
		if (slashIndex === -1) return null;
		const displayBase = normalizedQuery.slice(0, slashIndex + 1);
		const query = normalizedQuery.slice(slashIndex + 1);
		let baseDir;
		if (displayBase.startsWith("~/")) baseDir = this.expandHomePath(displayBase);
		else if (displayBase.startsWith("/")) baseDir = displayBase;
		else baseDir = join(this.basePath, displayBase);
		try {
			if (!statSync(baseDir).isDirectory()) return null;
		} catch {
			return null;
		}
		return {
			baseDir,
			query,
			displayBase
		};
	}
	scopedPathForDisplay(displayBase, relativePath) {
		const normalizedRelativePath = toDisplayPath(relativePath);
		if (displayBase === "/") return `/${normalizedRelativePath}`;
		return `${toDisplayPath(displayBase)}${normalizedRelativePath}`;
	}
	getFileSuggestions(prefix) {
		try {
			let searchDir;
			let searchPrefix;
			const { rawPrefix, isAtPrefix, isQuotedPrefix } = parsePathPrefix(prefix);
			let expandedPrefix = rawPrefix;
			if (expandedPrefix.startsWith("~")) expandedPrefix = this.expandHomePath(expandedPrefix);
			if (rawPrefix === "" || rawPrefix === "./" || rawPrefix === "../" || rawPrefix === "~" || rawPrefix === "~/" || rawPrefix === "/" || isAtPrefix && rawPrefix === "") {
				if (rawPrefix.startsWith("~") || expandedPrefix.startsWith("/")) searchDir = expandedPrefix;
				else searchDir = join(this.basePath, expandedPrefix);
				searchPrefix = "";
			} else if (rawPrefix.endsWith("/")) {
				if (rawPrefix.startsWith("~") || expandedPrefix.startsWith("/")) searchDir = expandedPrefix;
				else searchDir = join(this.basePath, expandedPrefix);
				searchPrefix = "";
			} else {
				const dir = dirname(expandedPrefix);
				const file = basename(expandedPrefix);
				if (rawPrefix.startsWith("~") || expandedPrefix.startsWith("/")) searchDir = dir;
				else searchDir = join(this.basePath, dir);
				searchPrefix = file;
			}
			const entries = readdirSync(searchDir, { withFileTypes: true });
			const suggestions = [];
			for (const entry of entries) {
				if (!entry.name.toLowerCase().startsWith(searchPrefix.toLowerCase())) continue;
				let isDirectory = entry.isDirectory();
				if (!isDirectory && entry.isSymbolicLink()) try {
					const fullPath = join(searchDir, entry.name);
					isDirectory = statSync(fullPath).isDirectory();
				} catch {}
				let relativePath;
				const name = entry.name;
				const displayPrefix = rawPrefix;
				if (displayPrefix.endsWith("/")) relativePath = displayPrefix + name;
				else if (displayPrefix.includes("/") || displayPrefix.includes("\\")) {
					if (displayPrefix.startsWith("~/")) {
						const homeRelativeDir = displayPrefix.slice(2);
						const dir = dirname(homeRelativeDir);
						relativePath = `~/${dir === "." ? name : join(dir, name)}`;
					} else if (displayPrefix.startsWith("/")) {
						const dir = dirname(displayPrefix);
						if (dir === "/") relativePath = `/${name}`;
						else relativePath = `${dir}/${name}`;
					} else {
						relativePath = join(dirname(displayPrefix), name);
						if (displayPrefix.startsWith("./") && !relativePath.startsWith("./")) relativePath = `./${relativePath}`;
					}
				} else if (displayPrefix.startsWith("~")) relativePath = `~/${name}`;
				else relativePath = name;
				relativePath = toDisplayPath(relativePath);
				const value = buildCompletionValue(isDirectory ? `${relativePath}/` : relativePath, {
					isDirectory,
					isAtPrefix,
					isQuotedPrefix
				});
				suggestions.push({
					value,
					label: name + (isDirectory ? "/" : "")
				});
			}
			suggestions.sort((a, b) => {
				const aIsDir = a.value.endsWith("/");
				const bIsDir = b.value.endsWith("/");
				if (aIsDir && !bIsDir) return -1;
				if (!aIsDir && bIsDir) return 1;
				return a.label.localeCompare(b.label);
			});
			return suggestions;
		} catch (_e) {
			return [];
		}
	}
	scoreEntry(filePath, query, isDirectory) {
		const lowerFileName = basename(filePath).toLowerCase();
		const lowerQuery = query.toLowerCase();
		let score = 0;
		if (lowerFileName === lowerQuery) score = 100;
		else if (lowerFileName.startsWith(lowerQuery)) score = 80;
		else if (lowerFileName.includes(lowerQuery)) score = 50;
		else if (filePath.toLowerCase().includes(lowerQuery)) score = 30;
		if (isDirectory && score > 0) score += 10;
		return score;
	}
	async getFuzzyFileSuggestions(query, options) {
		if (!this.fdPath || options.signal.aborted) return [];
		try {
			const scopedQuery = this.resolveScopedFuzzyQuery(query);
			const fdBaseDir = scopedQuery?.baseDir ?? this.basePath;
			const fdQuery = scopedQuery?.query ?? query;
			const entries = await walkDirectoryWithFd(fdBaseDir, this.fdPath, fdQuery, 100, options.signal);
			if (options.signal.aborted) return [];
			const scoredEntries = entries.map((entry) => ({
				...entry,
				score: fdQuery ? this.scoreEntry(entry.path, fdQuery, entry.isDirectory) : 1
			})).filter((entry) => entry.score > 0);
			scoredEntries.sort((a, b) => b.score - a.score);
			const topEntries = scoredEntries.slice(0, 20);
			const suggestions = [];
			for (const { path: entryPath, isDirectory } of topEntries) {
				const pathWithoutSlash = isDirectory ? entryPath.slice(0, -1) : entryPath;
				const displayPath = scopedQuery ? this.scopedPathForDisplay(scopedQuery.displayBase, pathWithoutSlash) : pathWithoutSlash;
				const entryName = basename(pathWithoutSlash);
				const value = buildCompletionValue(isDirectory ? `${displayPath}/` : displayPath, {
					isDirectory,
					isAtPrefix: true,
					isQuotedPrefix: options.isQuotedPrefix
				});
				suggestions.push({
					value,
					label: entryName + (isDirectory ? "/" : ""),
					description: displayPath
				});
			}
			return suggestions;
		} catch {
			return [];
		}
	}
	shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
		const textBeforeCursor = (lines[cursorLine] || "").slice(0, cursorCol);
		if (textBeforeCursor.trim().startsWith("/") && !textBeforeCursor.trim().includes(" ")) return false;
		return true;
	}
};

//#endregion
//#region node_modules/.pnpm/get-east-asian-width@1.6.0/node_modules/get-east-asian-width/lookup-data.js
const ambiguousMaximumCodePoint = 1114109;
const ambiguousRanges = [
	161,
	161,
	164,
	164,
	167,
	168,
	170,
	170,
	173,
	174,
	176,
	180,
	182,
	186,
	188,
	191,
	198,
	198,
	208,
	208,
	215,
	216,
	222,
	225,
	230,
	230,
	232,
	234,
	236,
	237,
	240,
	240,
	242,
	243,
	247,
	250,
	252,
	252,
	254,
	254,
	257,
	257,
	273,
	273,
	275,
	275,
	283,
	283,
	294,
	295,
	299,
	299,
	305,
	307,
	312,
	312,
	319,
	322,
	324,
	324,
	328,
	331,
	333,
	333,
	338,
	339,
	358,
	359,
	363,
	363,
	462,
	462,
	464,
	464,
	466,
	466,
	468,
	468,
	470,
	470,
	472,
	472,
	474,
	474,
	476,
	476,
	593,
	593,
	609,
	609,
	708,
	708,
	711,
	711,
	713,
	715,
	717,
	717,
	720,
	720,
	728,
	731,
	733,
	733,
	735,
	735,
	768,
	879,
	913,
	929,
	931,
	937,
	945,
	961,
	963,
	969,
	1025,
	1025,
	1040,
	1103,
	1105,
	1105,
	8208,
	8208,
	8211,
	8214,
	8216,
	8217,
	8220,
	8221,
	8224,
	8226,
	8228,
	8231,
	8240,
	8240,
	8242,
	8243,
	8245,
	8245,
	8251,
	8251,
	8254,
	8254,
	8308,
	8308,
	8319,
	8319,
	8321,
	8324,
	8364,
	8364,
	8451,
	8451,
	8453,
	8453,
	8457,
	8457,
	8467,
	8467,
	8470,
	8470,
	8481,
	8482,
	8486,
	8486,
	8491,
	8491,
	8531,
	8532,
	8539,
	8542,
	8544,
	8555,
	8560,
	8569,
	8585,
	8585,
	8592,
	8601,
	8632,
	8633,
	8658,
	8658,
	8660,
	8660,
	8679,
	8679,
	8704,
	8704,
	8706,
	8707,
	8711,
	8712,
	8715,
	8715,
	8719,
	8719,
	8721,
	8721,
	8725,
	8725,
	8730,
	8730,
	8733,
	8736,
	8739,
	8739,
	8741,
	8741,
	8743,
	8748,
	8750,
	8750,
	8756,
	8759,
	8764,
	8765,
	8776,
	8776,
	8780,
	8780,
	8786,
	8786,
	8800,
	8801,
	8804,
	8807,
	8810,
	8811,
	8814,
	8815,
	8834,
	8835,
	8838,
	8839,
	8853,
	8853,
	8857,
	8857,
	8869,
	8869,
	8895,
	8895,
	8978,
	8978,
	9312,
	9449,
	9451,
	9547,
	9552,
	9587,
	9600,
	9615,
	9618,
	9621,
	9632,
	9633,
	9635,
	9641,
	9650,
	9651,
	9654,
	9655,
	9660,
	9661,
	9664,
	9665,
	9670,
	9672,
	9675,
	9675,
	9678,
	9681,
	9698,
	9701,
	9711,
	9711,
	9733,
	9734,
	9737,
	9737,
	9742,
	9743,
	9756,
	9756,
	9758,
	9758,
	9792,
	9792,
	9794,
	9794,
	9824,
	9825,
	9827,
	9829,
	9831,
	9834,
	9836,
	9837,
	9839,
	9839,
	9886,
	9887,
	9919,
	9919,
	9926,
	9933,
	9935,
	9939,
	9941,
	9953,
	9955,
	9955,
	9960,
	9961,
	9963,
	9969,
	9972,
	9972,
	9974,
	9977,
	9979,
	9980,
	9982,
	9983,
	10045,
	10045,
	10102,
	10111,
	11094,
	11097,
	12872,
	12879,
	57344,
	63743,
	65024,
	65039,
	65533,
	65533,
	127232,
	127242,
	127248,
	127277,
	127280,
	127337,
	127344,
	127373,
	127375,
	127376,
	127387,
	127404,
	917760,
	917999,
	983040,
	1048573,
	1048576,
	1114109
];
const fullwidthMinimalCodePoint = 12288;
const fullwidthMaximumCodePoint = 65510;
const fullwidthRanges = [
	12288,
	12288,
	65281,
	65376,
	65504,
	65510
];
const wideMinimalCodePoint = 4352;
const wideMaximumCodePoint = 262141;
const wideRanges = [
	4352,
	4447,
	8986,
	8987,
	9001,
	9002,
	9193,
	9196,
	9200,
	9200,
	9203,
	9203,
	9725,
	9726,
	9748,
	9749,
	9776,
	9783,
	9800,
	9811,
	9855,
	9855,
	9866,
	9871,
	9875,
	9875,
	9889,
	9889,
	9898,
	9899,
	9917,
	9918,
	9924,
	9925,
	9934,
	9934,
	9940,
	9940,
	9962,
	9962,
	9970,
	9971,
	9973,
	9973,
	9978,
	9978,
	9981,
	9981,
	9989,
	9989,
	9994,
	9995,
	10024,
	10024,
	10060,
	10060,
	10062,
	10062,
	10067,
	10069,
	10071,
	10071,
	10133,
	10135,
	10160,
	10160,
	10175,
	10175,
	11035,
	11036,
	11088,
	11088,
	11093,
	11093,
	11904,
	11929,
	11931,
	12019,
	12032,
	12245,
	12272,
	12287,
	12289,
	12350,
	12353,
	12438,
	12441,
	12543,
	12549,
	12591,
	12593,
	12686,
	12688,
	12773,
	12783,
	12830,
	12832,
	12871,
	12880,
	42124,
	42128,
	42182,
	43360,
	43388,
	44032,
	55203,
	63744,
	64255,
	65040,
	65049,
	65072,
	65106,
	65108,
	65126,
	65128,
	65131,
	94176,
	94180,
	94192,
	94198,
	94208,
	101589,
	101631,
	101662,
	101760,
	101874,
	110576,
	110579,
	110581,
	110587,
	110589,
	110590,
	110592,
	110882,
	110898,
	110898,
	110928,
	110930,
	110933,
	110933,
	110948,
	110951,
	110960,
	111355,
	119552,
	119638,
	119648,
	119670,
	126980,
	126980,
	127183,
	127183,
	127374,
	127374,
	127377,
	127386,
	127488,
	127490,
	127504,
	127547,
	127552,
	127560,
	127568,
	127569,
	127584,
	127589,
	127744,
	127776,
	127789,
	127797,
	127799,
	127868,
	127870,
	127891,
	127904,
	127946,
	127951,
	127955,
	127968,
	127984,
	127988,
	127988,
	127992,
	128062,
	128064,
	128064,
	128066,
	128252,
	128255,
	128317,
	128331,
	128334,
	128336,
	128359,
	128378,
	128378,
	128405,
	128406,
	128420,
	128420,
	128507,
	128591,
	128640,
	128709,
	128716,
	128716,
	128720,
	128722,
	128725,
	128728,
	128732,
	128735,
	128747,
	128748,
	128756,
	128764,
	128992,
	129003,
	129008,
	129008,
	129292,
	129338,
	129340,
	129349,
	129351,
	129535,
	129648,
	129660,
	129664,
	129674,
	129678,
	129734,
	129736,
	129736,
	129741,
	129756,
	129759,
	129770,
	129775,
	129784,
	131072,
	196605,
	196608,
	262141
];

//#endregion
//#region node_modules/.pnpm/get-east-asian-width@1.6.0/node_modules/get-east-asian-width/utilities.js
/**
Binary search on a sorted flat array of [start, end] pairs.

@param {number[]} ranges - Flat array of inclusive [start, end] range pairs, e.g. [0, 5, 10, 20].
@param {number} codePoint - The value to search for.
@returns {boolean} Whether the value falls within any of the ranges.
*/
const isInRange = (ranges, codePoint) => {
	let low = 0;
	let high = Math.floor(ranges.length / 2) - 1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		const i = mid * 2;
		if (codePoint < ranges[i]) high = mid - 1;
		else if (codePoint > ranges[i + 1]) low = mid + 1;
		else return true;
	}
	return false;
};

//#endregion
//#region node_modules/.pnpm/get-east-asian-width@1.6.0/node_modules/get-east-asian-width/lookup.js
const commonCjkCodePoint = 19968;
const [wideFastPathStart, wideFastPathEnd] = /* #__PURE__ */ findWideFastPathRange(wideRanges);
function findWideFastPathRange(ranges) {
	let fastPathStart = ranges[0];
	let fastPathEnd = ranges[1];
	for (let index = 0; index < ranges.length; index += 2) {
		const start = ranges[index];
		const end = ranges[index + 1];
		if (commonCjkCodePoint >= start && commonCjkCodePoint <= end) return [start, end];
		if (end - start > fastPathEnd - fastPathStart) {
			fastPathStart = start;
			fastPathEnd = end;
		}
	}
	return [fastPathStart, fastPathEnd];
}
const isAmbiguous = (codePoint) => {
	if (codePoint < 161 || codePoint > 1114109) return false;
	return isInRange(ambiguousRanges, codePoint);
};
const isFullWidth = (codePoint) => {
	if (codePoint < 12288 || codePoint > 65510) return false;
	return isInRange(fullwidthRanges, codePoint);
};
const isWide = (codePoint) => {
	if (codePoint >= wideFastPathStart && codePoint <= wideFastPathEnd) return true;
	if (codePoint < 4352 || codePoint > 262141) return false;
	return isInRange(wideRanges, codePoint);
};

//#endregion
//#region node_modules/.pnpm/get-east-asian-width@1.6.0/node_modules/get-east-asian-width/index.js
function validate(codePoint) {
	if (!Number.isSafeInteger(codePoint)) throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
}
function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
	validate(codePoint);
	if (isFullWidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) return 2;
	return 1;
}

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/utils.js
const graphemeSegmenter$1 = new Intl.Segmenter(void 0, { granularity: "grapheme" });
const wordSegmenter$2 = new Intl.Segmenter(void 0, { granularity: "word" });
/**
* Get the shared grapheme segmenter instance.
*/
function getGraphemeSegmenter() {
	return graphemeSegmenter$1;
}
/**
* Get the shared word segmenter instance.
*/
function getWordSegmenter() {
	return wordSegmenter$2;
}
/**
* Check if a grapheme cluster (after segmentation) could possibly be an RGI emoji.
* This is a fast heuristic to avoid the expensive rgiEmojiRegex test.
* The tested Unicode blocks are deliberately broad to account for future
* Unicode additions.
*/
function couldBeEmoji(segment) {
	const cp = segment.codePointAt(0);
	return cp >= 126976 && cp <= 130047 || cp >= 8960 && cp <= 9215 || cp >= 9728 && cp <= 10175 || cp >= 11088 && cp <= 11093 || segment.includes("️") || segment.length > 2;
}
const zeroWidthRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/v;
const leadingNonPrintingRegex = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/v;
const rgiEmojiRegex = /^\p{RGI_Emoji}$/v;
const WIDTH_CACHE_SIZE = 512;
const widthCache = /* @__PURE__ */ new Map();
const cjkBreakRegex = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;
function isPrintableAscii(str) {
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code < 32 || code > 126) return false;
	}
	return true;
}
function truncateFragmentToWidth(text, maxWidth) {
	if (maxWidth <= 0 || text.length === 0) return {
		text: "",
		width: 0
	};
	if (isPrintableAscii(text)) {
		const clipped = text.slice(0, maxWidth);
		return {
			text: clipped,
			width: clipped.length
		};
	}
	const hasAnsi = text.includes("\x1B");
	const hasTabs = text.includes("	");
	if (!hasAnsi && !hasTabs) {
		let result = "";
		let width = 0;
		for (const { segment } of graphemeSegmenter$1.segment(text)) {
			const w = graphemeWidth(segment);
			if (width + w > maxWidth) break;
			result += segment;
			width += w;
		}
		return {
			text: result,
			width
		};
	}
	let result = "";
	let width = 0;
	let i = 0;
	let pendingAnsi = "";
	while (i < text.length) {
		const ansi = extractAnsiCode(text, i);
		if (ansi) {
			pendingAnsi += ansi.code;
			i += ansi.length;
			continue;
		}
		if (text[i] === "	") {
			if (width + 3 > maxWidth) break;
			if (pendingAnsi) {
				result += pendingAnsi;
				pendingAnsi = "";
			}
			result += "	";
			width += 3;
			i++;
			continue;
		}
		let end = i;
		while (end < text.length && text[end] !== "	") {
			if (extractAnsiCode(text, end)) break;
			end++;
		}
		for (const { segment } of graphemeSegmenter$1.segment(text.slice(i, end))) {
			const w = graphemeWidth(segment);
			if (width + w > maxWidth) return {
				text: result,
				width
			};
			if (pendingAnsi) {
				result += pendingAnsi;
				pendingAnsi = "";
			}
			result += segment;
			width += w;
		}
		i = end;
	}
	return {
		text: result,
		width
	};
}
function finalizeTruncatedResult(prefix, prefixWidth, ellipsis, ellipsisWidth, maxWidth, pad) {
	const reset = "\x1B[0m";
	const visibleWidth = prefixWidth + ellipsisWidth;
	let result;
	if (ellipsis.length > 0) result = `${prefix}${reset}${ellipsis}${reset}`;
	else result = `${prefix}${reset}`;
	return pad ? result + " ".repeat(Math.max(0, maxWidth - visibleWidth)) : result;
}
/**
* Calculate the terminal width of a single grapheme cluster.
* Based on code from the string-width library, but includes a possible-emoji
* check to avoid running the RGI_Emoji regex unnecessarily.
*/
function graphemeWidth(segment) {
	if (segment === "	") return 3;
	if (zeroWidthRegex.test(segment)) return 0;
	if (couldBeEmoji(segment) && rgiEmojiRegex.test(segment)) return 2;
	const cp = segment.replace(leadingNonPrintingRegex, "").codePointAt(0);
	if (cp === void 0) return 0;
	if (cp >= 127462 && cp <= 127487) return 2;
	let width = eastAsianWidth(cp);
	if (segment.length > 1) for (const char of segment.slice(1)) {
		const c = char.codePointAt(0);
		if (c >= 65280 && c <= 65519) width += eastAsianWidth(c);
		else if (c === 3635 || c === 3763) width += 1;
	}
	return width;
}
/**
* Calculate the visible width of a string in terminal columns.
*/
function visibleWidth(str) {
	if (str.length === 0) return 0;
	if (isPrintableAscii(str)) return str.length;
	const cached = widthCache.get(str);
	if (cached !== void 0) return cached;
	let clean = str;
	if (str.includes("	")) clean = clean.replace(/\t/g, "   ");
	if (clean.includes("\x1B")) {
		let stripped = "";
		let i = 0;
		while (i < clean.length) {
			const ansi = extractAnsiCode(clean, i);
			if (ansi) {
				i += ansi.length;
				continue;
			}
			stripped += clean[i];
			i++;
		}
		clean = stripped;
	}
	let width = 0;
	for (const { segment } of graphemeSegmenter$1.segment(clean)) width += graphemeWidth(segment);
	if (widthCache.size >= WIDTH_CACHE_SIZE) {
		const firstKey = widthCache.keys().next().value;
		if (firstKey !== void 0) widthCache.delete(firstKey);
	}
	widthCache.set(str, width);
	return width;
}
/**
* Normalize text for terminal output without changing logical editor content.
* Some terminals render precomposed Thai/Lao AM vowels inconsistently during
* differential repaint. Their compatibility decompositions have the same cell
* width but avoid stale-cell artifacts in terminal renderers.
*/
const THAI_LAO_AM_REGEX = /[\u0e33\u0eb3]/;
const THAI_LAO_AM_GLOBAL_REGEX = /[\u0e33\u0eb3]/g;
function normalizeTerminalOutput(str) {
	if (!THAI_LAO_AM_REGEX.test(str)) return str;
	return str.replace(THAI_LAO_AM_GLOBAL_REGEX, (char) => char === "ำ" ? "ํา" : "ໍາ");
}
/**
* Extract ANSI escape sequences from a string at the given position.
*/
function extractAnsiCode(str, pos) {
	if (pos >= str.length || str[pos] !== "\x1B") return null;
	const next = str[pos + 1];
	if (next === "[") {
		let j = pos + 2;
		while (j < str.length && !/[mGKHJ]/.test(str[j])) j++;
		if (j < str.length) return {
			code: str.substring(pos, j + 1),
			length: j + 1 - pos
		};
		return null;
	}
	if (next === "]") {
		let j = pos + 2;
		while (j < str.length) {
			if (str[j] === "\x07") return {
				code: str.substring(pos, j + 1),
				length: j + 1 - pos
			};
			if (str[j] === "\x1B" && str[j + 1] === "\\") return {
				code: str.substring(pos, j + 2),
				length: j + 2 - pos
			};
			j++;
		}
		return null;
	}
	if (next === "_") {
		let j = pos + 2;
		while (j < str.length) {
			if (str[j] === "\x07") return {
				code: str.substring(pos, j + 1),
				length: j + 1 - pos
			};
			if (str[j] === "\x1B" && str[j + 1] === "\\") return {
				code: str.substring(pos, j + 2),
				length: j + 2 - pos
			};
			j++;
		}
		return null;
	}
	return null;
}
function parseOsc8Hyperlink(ansiCode) {
	if (!ansiCode.startsWith("\x1B]8;")) return;
	const terminator = ansiCode.endsWith("\x07") ? "\x07" : "\x1B\\";
	const body = ansiCode.slice(4, terminator === "\x07" ? -1 : -2);
	const separatorIndex = body.indexOf(";");
	if (separatorIndex === -1) return;
	const params = body.slice(0, separatorIndex);
	const url = body.slice(separatorIndex + 1);
	if (!url) return null;
	return {
		params,
		url,
		terminator
	};
}
function formatOsc8Hyperlink(hyperlink) {
	return `\x1b]8;${hyperlink.params};${hyperlink.url}${hyperlink.terminator}`;
}
function formatOsc8Close(terminator) {
	return `\x1b]8;;${terminator}`;
}
/**
* Track active ANSI SGR codes to preserve styling across line breaks.
*/
var AnsiCodeTracker = class {
	bold = false;
	dim = false;
	italic = false;
	underline = false;
	blink = false;
	inverse = false;
	hidden = false;
	strikethrough = false;
	fgColor = null;
	bgColor = null;
	activeHyperlink = null;
	process(ansiCode) {
		const hyperlink = parseOsc8Hyperlink(ansiCode);
		if (hyperlink !== void 0) {
			this.activeHyperlink = hyperlink;
			return;
		}
		if (!ansiCode.endsWith("m")) return;
		const match = ansiCode.match(/\x1b\[([\d;]*)m/);
		if (!match) return;
		const params = match[1];
		if (params === "" || params === "0") {
			this.reset();
			return;
		}
		const parts = params.split(";");
		let i = 0;
		while (i < parts.length) {
			const code = Number.parseInt(parts[i], 10);
			if (code === 38 || code === 48) {
				if (parts[i + 1] === "5" && parts[i + 2] !== void 0) {
					const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]}`;
					if (code === 38) this.fgColor = colorCode;
					else this.bgColor = colorCode;
					i += 3;
					continue;
				} else if (parts[i + 1] === "2" && parts[i + 4] !== void 0) {
					const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]};${parts[i + 3]};${parts[i + 4]}`;
					if (code === 38) this.fgColor = colorCode;
					else this.bgColor = colorCode;
					i += 5;
					continue;
				}
			}
			switch (code) {
				case 0:
					this.reset();
					break;
				case 1:
					this.bold = true;
					break;
				case 2:
					this.dim = true;
					break;
				case 3:
					this.italic = true;
					break;
				case 4:
					this.underline = true;
					break;
				case 5:
					this.blink = true;
					break;
				case 7:
					this.inverse = true;
					break;
				case 8:
					this.hidden = true;
					break;
				case 9:
					this.strikethrough = true;
					break;
				case 21:
					this.bold = false;
					break;
				case 22:
					this.bold = false;
					this.dim = false;
					break;
				case 23:
					this.italic = false;
					break;
				case 24:
					this.underline = false;
					break;
				case 25:
					this.blink = false;
					break;
				case 27:
					this.inverse = false;
					break;
				case 28:
					this.hidden = false;
					break;
				case 29:
					this.strikethrough = false;
					break;
				case 39:
					this.fgColor = null;
					break;
				case 49:
					this.bgColor = null;
					break;
				default: if (code >= 30 && code <= 37 || code >= 90 && code <= 97) this.fgColor = String(code);
				else if (code >= 40 && code <= 47 || code >= 100 && code <= 107) this.bgColor = String(code);
			}
			i++;
		}
	}
	reset() {
		this.bold = false;
		this.dim = false;
		this.italic = false;
		this.underline = false;
		this.blink = false;
		this.inverse = false;
		this.hidden = false;
		this.strikethrough = false;
		this.fgColor = null;
		this.bgColor = null;
	}
	/** Clear all state for reuse. */
	clear() {
		this.reset();
		this.activeHyperlink = null;
	}
	getActiveCodes() {
		const codes = [];
		if (this.bold) codes.push("1");
		if (this.dim) codes.push("2");
		if (this.italic) codes.push("3");
		if (this.underline) codes.push("4");
		if (this.blink) codes.push("5");
		if (this.inverse) codes.push("7");
		if (this.hidden) codes.push("8");
		if (this.strikethrough) codes.push("9");
		if (this.fgColor) codes.push(this.fgColor);
		if (this.bgColor) codes.push(this.bgColor);
		let result = codes.length > 0 ? `\x1b[${codes.join(";")}m` : "";
		if (this.activeHyperlink) result += formatOsc8Hyperlink(this.activeHyperlink);
		return result;
	}
	hasActiveCodes() {
		return this.bold || this.dim || this.italic || this.underline || this.blink || this.inverse || this.hidden || this.strikethrough || this.fgColor !== null || this.bgColor !== null || this.activeHyperlink !== null;
	}
	/**
	* Get reset codes for attributes that need to be turned off at line end.
	* Underline must be closed to prevent bleeding into padding.
	* Active OSC 8 hyperlinks must be closed and re-opened on the next line.
	* Returns empty string if no attributes need closing.
	*/
	getLineEndReset() {
		let result = "";
		if (this.underline) result += "\x1B[24m";
		if (this.activeHyperlink) result += formatOsc8Close(this.activeHyperlink.terminator);
		return result;
	}
};
function updateTrackerFromText(text, tracker) {
	let i = 0;
	while (i < text.length) {
		const ansiResult = extractAnsiCode(text, i);
		if (ansiResult) {
			tracker.process(ansiResult.code);
			i += ansiResult.length;
		} else i++;
	}
}
/**
* Split text into words while keeping ANSI codes attached.
*/
function splitIntoTokensWithAnsi(text) {
	const tokens = [];
	let current = "";
	let pendingAnsi = "";
	let currentKind = null;
	let i = 0;
	const flushCurrent = () => {
		if (!current) return;
		tokens.push(current);
		current = "";
		currentKind = null;
	};
	while (i < text.length) {
		const ansiResult = extractAnsiCode(text, i);
		if (ansiResult) {
			pendingAnsi += ansiResult.code;
			i += ansiResult.length;
			continue;
		}
		let end = i;
		while (end < text.length && !extractAnsiCode(text, end)) end++;
		for (const { segment } of graphemeSegmenter$1.segment(text.slice(i, end))) {
			const segmentIsSpace = segment === " ";
			if (!segmentIsSpace && cjkBreakRegex.test(segment)) {
				flushCurrent();
				const token = pendingAnsi + segment;
				pendingAnsi = "";
				tokens.push(token);
				continue;
			}
			const segmentKind = segmentIsSpace ? "space" : "word";
			if (current && currentKind !== segmentKind) flushCurrent();
			if (pendingAnsi) {
				current += pendingAnsi;
				pendingAnsi = "";
			}
			currentKind = segmentKind;
			current += segment;
		}
		i = end;
	}
	if (pendingAnsi) {
		if (current) current += pendingAnsi;
		else if (tokens.length > 0) tokens[tokens.length - 1] += pendingAnsi;
		else current = pendingAnsi;
	}
	if (current) tokens.push(current);
	return tokens;
}
/**
* Wrap text with ANSI codes preserved.
*
* ONLY does word wrapping - NO padding, NO background colors.
* Returns lines where each line is <= width visible chars.
* Active ANSI codes are preserved across line breaks.
*
* @param text - Text to wrap (may contain ANSI codes and newlines)
* @param width - Maximum visible width per line
* @returns Array of wrapped lines (NOT padded to width)
*/
function wrapTextWithAnsi(text, width) {
	if (!text) return [""];
	const inputLines = text.split("\n");
	const result = [];
	const tracker = new AnsiCodeTracker();
	for (const inputLine of inputLines) {
		const wrappedLines = wrapSingleLine((result.length > 0 ? tracker.getActiveCodes() : "") + inputLine, width);
		for (const wrappedLine of wrappedLines) result.push(wrappedLine);
		updateTrackerFromText(inputLine, tracker);
	}
	return result.length > 0 ? result : [""];
}
function wrapSingleLine(line, width) {
	if (!line) return [""];
	if (visibleWidth(line) <= width) return [line];
	const wrapped = [];
	const tracker = new AnsiCodeTracker();
	const tokens = splitIntoTokensWithAnsi(line);
	let currentLine = "";
	let currentVisibleLength = 0;
	for (const token of tokens) {
		const tokenVisibleLength = visibleWidth(token);
		const isWhitespace = token.trim() === "";
		if (tokenVisibleLength > width && !isWhitespace) {
			if (currentLine) {
				const lineEndReset = tracker.getLineEndReset();
				if (lineEndReset) currentLine += lineEndReset;
				wrapped.push(currentLine);
				currentLine = "";
				currentVisibleLength = 0;
			}
			const broken = breakLongWord(token, width, tracker);
			for (let i = 0; i < broken.length - 1; i++) wrapped.push(broken[i]);
			currentLine = broken[broken.length - 1];
			currentVisibleLength = visibleWidth(currentLine);
			continue;
		}
		if (currentVisibleLength + tokenVisibleLength > width && currentVisibleLength > 0) {
			let lineToWrap = currentLine.trimEnd();
			const lineEndReset = tracker.getLineEndReset();
			if (lineEndReset) lineToWrap += lineEndReset;
			wrapped.push(lineToWrap);
			if (isWhitespace) {
				currentLine = tracker.getActiveCodes();
				currentVisibleLength = 0;
			} else {
				currentLine = tracker.getActiveCodes() + token;
				currentVisibleLength = tokenVisibleLength;
			}
		} else {
			currentLine += token;
			currentVisibleLength += tokenVisibleLength;
		}
		updateTrackerFromText(token, tracker);
	}
	if (currentLine) wrapped.push(currentLine);
	return wrapped.length > 0 ? wrapped.map((line) => line.trimEnd()) : [""];
}
const PUNCTUATION_REGEX = /[(){}[\]<>.,;:'"!?+\-=*/\\|&%^$#@~`]/;
/**
* Check if a character is whitespace.
*/
function isWhitespaceChar(char) {
	return /\s/.test(char);
}
function breakLongWord(word, width, tracker) {
	const lines = [];
	let currentLine = tracker.getActiveCodes();
	let currentWidth = 0;
	let i = 0;
	const segments = [];
	while (i < word.length) {
		const ansiResult = extractAnsiCode(word, i);
		if (ansiResult) {
			segments.push({
				type: "ansi",
				value: ansiResult.code
			});
			i += ansiResult.length;
		} else {
			let end = i;
			while (end < word.length) {
				if (extractAnsiCode(word, end)) break;
				end++;
			}
			const textPortion = word.slice(i, end);
			for (const seg of graphemeSegmenter$1.segment(textPortion)) segments.push({
				type: "grapheme",
				value: seg.segment
			});
			i = end;
		}
	}
	for (const seg of segments) {
		if (seg.type === "ansi") {
			currentLine += seg.value;
			tracker.process(seg.value);
			continue;
		}
		const grapheme = seg.value;
		if (!grapheme) continue;
		const graphemeWidth = visibleWidth(grapheme);
		if (currentWidth + graphemeWidth > width) {
			const lineEndReset = tracker.getLineEndReset();
			if (lineEndReset) currentLine += lineEndReset;
			lines.push(currentLine);
			currentLine = tracker.getActiveCodes();
			currentWidth = 0;
		}
		currentLine += grapheme;
		currentWidth += graphemeWidth;
	}
	if (currentLine) lines.push(currentLine);
	return lines.length > 0 ? lines : [""];
}
/**
* Apply background color to a line, padding to full width.
*
* @param line - Line of text (may contain ANSI codes)
* @param width - Total width to pad to
* @param bgFn - Background color function
* @returns Line with background applied and padded to width
*/
function applyBackgroundToLine(line, width, bgFn) {
	const visibleLen = visibleWidth(line);
	const paddingNeeded = Math.max(0, width - visibleLen);
	return bgFn(line + " ".repeat(paddingNeeded));
}
/**
* Truncate text to fit within a maximum visible width, adding ellipsis if needed.
* Optionally pad with spaces to reach exactly maxWidth.
* Properly handles ANSI escape codes (they don't count toward width).
*
* @param text - Text to truncate (may contain ANSI codes)
* @param maxWidth - Maximum visible width
* @param ellipsis - Ellipsis string to append when truncating (default: "...")
* @param pad - If true, pad result with spaces to exactly maxWidth (default: false)
* @returns Truncated text, optionally padded to exactly maxWidth
*/
function truncateToWidth(text, maxWidth, ellipsis = "...", pad = false) {
	if (maxWidth <= 0) return "";
	if (text.length === 0) return pad ? " ".repeat(maxWidth) : "";
	const ellipsisWidth = visibleWidth(ellipsis);
	if (ellipsisWidth >= maxWidth) {
		const textWidth = visibleWidth(text);
		if (textWidth <= maxWidth) return pad ? text + " ".repeat(maxWidth - textWidth) : text;
		const clippedEllipsis = truncateFragmentToWidth(ellipsis, maxWidth);
		if (clippedEllipsis.width === 0) return pad ? " ".repeat(maxWidth) : "";
		return finalizeTruncatedResult("", 0, clippedEllipsis.text, clippedEllipsis.width, maxWidth, pad);
	}
	if (isPrintableAscii(text)) {
		if (text.length <= maxWidth) return pad ? text + " ".repeat(maxWidth - text.length) : text;
		const targetWidth = maxWidth - ellipsisWidth;
		return finalizeTruncatedResult(text.slice(0, targetWidth), targetWidth, ellipsis, ellipsisWidth, maxWidth, pad);
	}
	const targetWidth = maxWidth - ellipsisWidth;
	let result = "";
	let pendingAnsi = "";
	let visibleSoFar = 0;
	let keptWidth = 0;
	let keepContiguousPrefix = true;
	let overflowed = false;
	let exhaustedInput = false;
	const hasAnsi = text.includes("\x1B");
	const hasTabs = text.includes("	");
	if (!hasAnsi && !hasTabs) {
		for (const { segment } of graphemeSegmenter$1.segment(text)) {
			const width = graphemeWidth(segment);
			if (keepContiguousPrefix && keptWidth + width <= targetWidth) {
				result += segment;
				keptWidth += width;
			} else keepContiguousPrefix = false;
			visibleSoFar += width;
			if (visibleSoFar > maxWidth) {
				overflowed = true;
				break;
			}
		}
		exhaustedInput = !overflowed;
	} else {
		let i = 0;
		while (i < text.length) {
			const ansi = extractAnsiCode(text, i);
			if (ansi) {
				pendingAnsi += ansi.code;
				i += ansi.length;
				continue;
			}
			if (text[i] === "	") {
				if (keepContiguousPrefix && keptWidth + 3 <= targetWidth) {
					if (pendingAnsi) {
						result += pendingAnsi;
						pendingAnsi = "";
					}
					result += "	";
					keptWidth += 3;
				} else {
					keepContiguousPrefix = false;
					pendingAnsi = "";
				}
				visibleSoFar += 3;
				if (visibleSoFar > maxWidth) {
					overflowed = true;
					break;
				}
				i++;
				continue;
			}
			let end = i;
			while (end < text.length && text[end] !== "	") {
				if (extractAnsiCode(text, end)) break;
				end++;
			}
			for (const { segment } of graphemeSegmenter$1.segment(text.slice(i, end))) {
				const width = graphemeWidth(segment);
				if (keepContiguousPrefix && keptWidth + width <= targetWidth) {
					if (pendingAnsi) {
						result += pendingAnsi;
						pendingAnsi = "";
					}
					result += segment;
					keptWidth += width;
				} else {
					keepContiguousPrefix = false;
					pendingAnsi = "";
				}
				visibleSoFar += width;
				if (visibleSoFar > maxWidth) {
					overflowed = true;
					break;
				}
			}
			if (overflowed) break;
			i = end;
		}
		exhaustedInput = i >= text.length;
	}
	if (!overflowed && exhaustedInput) return pad ? text + " ".repeat(Math.max(0, maxWidth - visibleSoFar)) : text;
	return finalizeTruncatedResult(result, keptWidth, ellipsis, ellipsisWidth, maxWidth, pad);
}
/**
* Extract a range of visible columns from a line. Handles ANSI codes and wide chars.
* @param strict - If true, exclude wide chars at boundary that would extend past the range
*/
function sliceByColumn(line, startCol, length, strict = false) {
	return sliceWithWidth(line, startCol, length, strict).text;
}
/** Like sliceByColumn but also returns the actual visible width of the result. */
function sliceWithWidth(line, startCol, length, strict = false) {
	if (length <= 0) return {
		text: "",
		width: 0
	};
	const endCol = startCol + length;
	let result = "", resultWidth = 0, currentCol = 0, i = 0, pendingAnsi = "";
	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi) {
			if (currentCol >= startCol && currentCol < endCol) result += ansi.code;
			else if (currentCol < startCol) pendingAnsi += ansi.code;
			i += ansi.length;
			continue;
		}
		let textEnd = i;
		while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;
		for (const { segment } of graphemeSegmenter$1.segment(line.slice(i, textEnd))) {
			const w = graphemeWidth(segment);
			const inRange = currentCol >= startCol && currentCol < endCol;
			const fits = !strict || currentCol + w <= endCol;
			if (inRange && fits) {
				if (pendingAnsi) {
					result += pendingAnsi;
					pendingAnsi = "";
				}
				result += segment;
				resultWidth += w;
			}
			currentCol += w;
			if (currentCol >= endCol) break;
		}
		i = textEnd;
		if (currentCol >= endCol) break;
	}
	return {
		text: result,
		width: resultWidth
	};
}
const pooledStyleTracker = new AnsiCodeTracker();
/**
* Extract "before" and "after" segments from a line in a single pass.
* Used for overlay compositing where we need content before and after the overlay region.
* Preserves styling from before the overlay that should affect content after it.
*/
function extractSegments(line, beforeEnd, afterStart, afterLen, strictAfter = false) {
	let before = "", beforeWidth = 0, after = "", afterWidth = 0;
	let currentCol = 0, i = 0;
	let pendingAnsiBefore = "";
	let afterStarted = false;
	const afterEnd = afterStart + afterLen;
	pooledStyleTracker.clear();
	while (i < line.length) {
		const ansi = extractAnsiCode(line, i);
		if (ansi) {
			pooledStyleTracker.process(ansi.code);
			if (currentCol < beforeEnd) pendingAnsiBefore += ansi.code;
			else if (currentCol >= afterStart && currentCol < afterEnd && afterStarted) after += ansi.code;
			i += ansi.length;
			continue;
		}
		let textEnd = i;
		while (textEnd < line.length && !extractAnsiCode(line, textEnd)) textEnd++;
		for (const { segment } of graphemeSegmenter$1.segment(line.slice(i, textEnd))) {
			const w = graphemeWidth(segment);
			if (currentCol < beforeEnd && currentCol + w <= beforeEnd) {
				if (pendingAnsiBefore) {
					before += pendingAnsiBefore;
					pendingAnsiBefore = "";
				}
				before += segment;
				beforeWidth += w;
			} else if (currentCol >= afterStart && currentCol < afterEnd) {
				if (!strictAfter || currentCol + w <= afterEnd) {
					if (!afterStarted) {
						after += pooledStyleTracker.getActiveCodes();
						afterStarted = true;
					}
					after += segment;
					afterWidth += w;
				}
			}
			currentCol += w;
			if (afterLen <= 0 ? currentCol >= beforeEnd : currentCol >= afterEnd) break;
		}
		i = textEnd;
		if (afterLen <= 0 ? currentCol >= beforeEnd : currentCol >= afterEnd) break;
	}
	return {
		before,
		beforeWidth,
		after,
		afterWidth
	};
}

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/keys.js
/**
* Keyboard input handling for terminal applications.
*
* Supports both legacy terminal sequences and Kitty keyboard protocol.
* See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/
* Reference: https://github.com/sst/opentui/blob/7da92b4088aebfe27b9f691c04163a48821e49fd/packages/core/src/lib/parse.keypress.ts
*
* Symbol keys are also supported, however some ctrl+symbol combos
* overlap with ASCII codes, e.g. ctrl+[ = ESC.
* See: https://sw.kovidgoyal.net/kitty/keyboard-protocol/#legacy-ctrl-mapping-of-ascii-keys
* Those can still be * used for ctrl+shift combos
*
* API:
* - matchesKey(data, keyId) - Check if input matches a key identifier
* - parseKey(data) - Parse input and return the key identifier
* - Key - Helper object for creating typed key identifiers
* - setKittyProtocolActive(active) - Set global Kitty protocol state
* - isKittyProtocolActive() - Query global Kitty protocol state
*/
let _kittyProtocolActive = false;
/**
* Set the global Kitty keyboard protocol state.
* Called by ProcessTerminal after detecting protocol support.
*/
function setKittyProtocolActive(active) {
	_kittyProtocolActive = active;
}
/**
* Helper object for creating typed key identifiers with autocomplete.
*
* Usage:
* - Key.escape, Key.enter, Key.tab, etc. for special keys
* - Key.backtick, Key.comma, Key.period, etc. for symbol keys
* - Key.ctrl("c"), Key.alt("x"), Key.super("k") for single modifiers
* - Key.ctrlShift("p"), Key.ctrlAlt("x"), Key.ctrlSuper("k") for combined modifiers
*/
const Key = {
	escape: "escape",
	esc: "esc",
	enter: "enter",
	return: "return",
	tab: "tab",
	space: "space",
	backspace: "backspace",
	delete: "delete",
	insert: "insert",
	clear: "clear",
	home: "home",
	end: "end",
	pageUp: "pageUp",
	pageDown: "pageDown",
	up: "up",
	down: "down",
	left: "left",
	right: "right",
	f1: "f1",
	f2: "f2",
	f3: "f3",
	f4: "f4",
	f5: "f5",
	f6: "f6",
	f7: "f7",
	f8: "f8",
	f9: "f9",
	f10: "f10",
	f11: "f11",
	f12: "f12",
	backtick: "`",
	hyphen: "-",
	equals: "=",
	leftbracket: "[",
	rightbracket: "]",
	backslash: "\\",
	semicolon: ";",
	quote: "'",
	comma: ",",
	period: ".",
	slash: "/",
	exclamation: "!",
	at: "@",
	hash: "#",
	dollar: "$",
	percent: "%",
	caret: "^",
	ampersand: "&",
	asterisk: "*",
	leftparen: "(",
	rightparen: ")",
	underscore: "_",
	plus: "+",
	pipe: "|",
	tilde: "~",
	leftbrace: "{",
	rightbrace: "}",
	colon: ":",
	lessthan: "<",
	greaterthan: ">",
	question: "?",
	ctrl: (key) => `ctrl+${key}`,
	shift: (key) => `shift+${key}`,
	alt: (key) => `alt+${key}`,
	super: (key) => `super+${key}`,
	ctrlShift: (key) => `ctrl+shift+${key}`,
	shiftCtrl: (key) => `shift+ctrl+${key}`,
	ctrlAlt: (key) => `ctrl+alt+${key}`,
	altCtrl: (key) => `alt+ctrl+${key}`,
	shiftAlt: (key) => `shift+alt+${key}`,
	altShift: (key) => `alt+shift+${key}`,
	ctrlSuper: (key) => `ctrl+super+${key}`,
	superCtrl: (key) => `super+ctrl+${key}`,
	shiftSuper: (key) => `shift+super+${key}`,
	superShift: (key) => `super+shift+${key}`,
	altSuper: (key) => `alt+super+${key}`,
	superAlt: (key) => `super+alt+${key}`,
	ctrlShiftAlt: (key) => `ctrl+shift+alt+${key}`,
	ctrlShiftSuper: (key) => `ctrl+shift+super+${key}`
};
const SYMBOL_KEYS = /* @__PURE__ */ new Set([
	"`",
	"-",
	"=",
	"[",
	"]",
	"\\",
	";",
	"'",
	",",
	".",
	"/",
	"!",
	"@",
	"#",
	"$",
	"%",
	"^",
	"&",
	"*",
	"(",
	")",
	"_",
	"+",
	"|",
	"~",
	"{",
	"}",
	":",
	"<",
	">",
	"?"
]);
const MODIFIERS = {
	shift: 1,
	alt: 2,
	ctrl: 4,
	super: 8
};
const LOCK_MASK = 192;
const CODEPOINTS = {
	escape: 27,
	tab: 9,
	enter: 13,
	space: 32,
	backspace: 127,
	kpEnter: 57414
};
const ARROW_CODEPOINTS = {
	up: -1,
	down: -2,
	right: -3,
	left: -4
};
const FUNCTIONAL_CODEPOINTS = {
	delete: -10,
	insert: -11,
	pageUp: -12,
	pageDown: -13,
	home: -14,
	end: -15
};
const KITTY_FUNCTIONAL_KEY_EQUIVALENTS = /* @__PURE__ */ new Map([
	[57399, 48],
	[57400, 49],
	[57401, 50],
	[57402, 51],
	[57403, 52],
	[57404, 53],
	[57405, 54],
	[57406, 55],
	[57407, 56],
	[57408, 57],
	[57409, 46],
	[57410, 47],
	[57411, 42],
	[57412, 45],
	[57413, 43],
	[57415, 61],
	[57416, 44],
	[57417, ARROW_CODEPOINTS.left],
	[57418, ARROW_CODEPOINTS.right],
	[57419, ARROW_CODEPOINTS.up],
	[57420, ARROW_CODEPOINTS.down],
	[57421, FUNCTIONAL_CODEPOINTS.pageUp],
	[57422, FUNCTIONAL_CODEPOINTS.pageDown],
	[57423, FUNCTIONAL_CODEPOINTS.home],
	[57424, FUNCTIONAL_CODEPOINTS.end],
	[57425, FUNCTIONAL_CODEPOINTS.insert],
	[57426, FUNCTIONAL_CODEPOINTS.delete]
]);
function normalizeKittyFunctionalCodepoint(codepoint) {
	return KITTY_FUNCTIONAL_KEY_EQUIVALENTS.get(codepoint) ?? codepoint;
}
function normalizeShiftedLetterIdentityCodepoint(codepoint, modifier) {
	if ((modifier & -193 & MODIFIERS.shift) !== 0 && codepoint >= 65 && codepoint <= 90) return codepoint + 32;
	return codepoint;
}
const LEGACY_KEY_SEQUENCES = {
	up: ["\x1B[A", "\x1BOA"],
	down: ["\x1B[B", "\x1BOB"],
	right: ["\x1B[C", "\x1BOC"],
	left: ["\x1B[D", "\x1BOD"],
	home: [
		"\x1B[H",
		"\x1BOH",
		"\x1B[1~",
		"\x1B[7~"
	],
	end: [
		"\x1B[F",
		"\x1BOF",
		"\x1B[4~",
		"\x1B[8~"
	],
	insert: ["\x1B[2~"],
	delete: ["\x1B[3~"],
	pageUp: ["\x1B[5~", "\x1B[[5~"],
	pageDown: ["\x1B[6~", "\x1B[[6~"],
	clear: ["\x1B[E", "\x1BOE"],
	f1: [
		"\x1BOP",
		"\x1B[11~",
		"\x1B[[A"
	],
	f2: [
		"\x1BOQ",
		"\x1B[12~",
		"\x1B[[B"
	],
	f3: [
		"\x1BOR",
		"\x1B[13~",
		"\x1B[[C"
	],
	f4: [
		"\x1BOS",
		"\x1B[14~",
		"\x1B[[D"
	],
	f5: ["\x1B[15~", "\x1B[[E"],
	f6: ["\x1B[17~"],
	f7: ["\x1B[18~"],
	f8: ["\x1B[19~"],
	f9: ["\x1B[20~"],
	f10: ["\x1B[21~"],
	f11: ["\x1B[23~"],
	f12: ["\x1B[24~"]
};
const LEGACY_SHIFT_SEQUENCES = {
	up: ["\x1B[a"],
	down: ["\x1B[b"],
	right: ["\x1B[c"],
	left: ["\x1B[d"],
	clear: ["\x1B[e"],
	insert: ["\x1B[2$"],
	delete: ["\x1B[3$"],
	pageUp: ["\x1B[5$"],
	pageDown: ["\x1B[6$"],
	home: ["\x1B[7$"],
	end: ["\x1B[8$"]
};
const LEGACY_CTRL_SEQUENCES = {
	up: ["\x1BOa"],
	down: ["\x1BOb"],
	right: ["\x1BOc"],
	left: ["\x1BOd"],
	clear: ["\x1BOe"],
	insert: ["\x1B[2^"],
	delete: ["\x1B[3^"],
	pageUp: ["\x1B[5^"],
	pageDown: ["\x1B[6^"],
	home: ["\x1B[7^"],
	end: ["\x1B[8^"]
};
const matchesLegacySequence = (data, sequences) => sequences.includes(data);
const matchesLegacyModifierSequence = (data, key, modifier) => {
	if (modifier === MODIFIERS.shift) return matchesLegacySequence(data, LEGACY_SHIFT_SEQUENCES[key]);
	if (modifier === MODIFIERS.ctrl) return matchesLegacySequence(data, LEGACY_CTRL_SEQUENCES[key]);
	return false;
};
/**
* Check if the last parsed key event was a key release.
* Only meaningful when Kitty keyboard protocol with flag 2 is active.
*/
function isKeyRelease(data) {
	if (data.includes("\x1B[200~")) return false;
	if (data.includes(":3u") || data.includes(":3~") || data.includes(":3A") || data.includes(":3B") || data.includes(":3C") || data.includes(":3D") || data.includes(":3H") || data.includes(":3F")) return true;
	return false;
}
function parseEventType(eventTypeStr) {
	if (!eventTypeStr) return "press";
	const eventType = parseInt(eventTypeStr, 10);
	if (eventType === 2) return "repeat";
	if (eventType === 3) return "release";
	return "press";
}
function parseKittySequence(data) {
	const csiUMatch = data.match(/^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/);
	if (csiUMatch) {
		const codepoint = parseInt(csiUMatch[1], 10);
		const shiftedKey = csiUMatch[2] && csiUMatch[2].length > 0 ? parseInt(csiUMatch[2], 10) : void 0;
		const baseLayoutKey = csiUMatch[3] ? parseInt(csiUMatch[3], 10) : void 0;
		const modValue = csiUMatch[4] ? parseInt(csiUMatch[4], 10) : 1;
		const eventType = parseEventType(csiUMatch[5]);
		return {
			codepoint,
			shiftedKey,
			baseLayoutKey,
			modifier: modValue - 1,
			eventType
		};
	}
	const arrowMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([ABCD])$/);
	if (arrowMatch) {
		const modValue = parseInt(arrowMatch[1], 10);
		const eventType = parseEventType(arrowMatch[2]);
		return {
			codepoint: {
				A: -1,
				B: -2,
				C: -3,
				D: -4
			}[arrowMatch[3]],
			modifier: modValue - 1,
			eventType
		};
	}
	const funcMatch = data.match(/^\x1b\[(\d+)(?:;(\d+))?(?::(\d+))?~$/);
	if (funcMatch) {
		const keyNum = parseInt(funcMatch[1], 10);
		const modValue = funcMatch[2] ? parseInt(funcMatch[2], 10) : 1;
		const eventType = parseEventType(funcMatch[3]);
		const codepoint = {
			2: FUNCTIONAL_CODEPOINTS.insert,
			3: FUNCTIONAL_CODEPOINTS.delete,
			5: FUNCTIONAL_CODEPOINTS.pageUp,
			6: FUNCTIONAL_CODEPOINTS.pageDown,
			7: FUNCTIONAL_CODEPOINTS.home,
			8: FUNCTIONAL_CODEPOINTS.end
		}[keyNum];
		if (codepoint !== void 0) return {
			codepoint,
			modifier: modValue - 1,
			eventType
		};
	}
	const homeEndMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([HF])$/);
	if (homeEndMatch) {
		const modValue = parseInt(homeEndMatch[1], 10);
		const eventType = parseEventType(homeEndMatch[2]);
		return {
			codepoint: homeEndMatch[3] === "H" ? FUNCTIONAL_CODEPOINTS.home : FUNCTIONAL_CODEPOINTS.end,
			modifier: modValue - 1,
			eventType
		};
	}
	return null;
}
function matchesKittySequence(data, expectedCodepoint, expectedModifier) {
	const parsed = parseKittySequence(data);
	if (!parsed) return false;
	if ((parsed.modifier & -193) !== (expectedModifier & -193)) return false;
	const normalizedCodepoint = normalizeShiftedLetterIdentityCodepoint(normalizeKittyFunctionalCodepoint(parsed.codepoint), parsed.modifier);
	if (normalizedCodepoint === normalizeShiftedLetterIdentityCodepoint(normalizeKittyFunctionalCodepoint(expectedCodepoint), expectedModifier)) return true;
	if (parsed.baseLayoutKey !== void 0 && parsed.baseLayoutKey === expectedCodepoint) {
		const cp = normalizedCodepoint;
		const isLatinLetter = cp >= 97 && cp <= 122;
		const isKnownSymbol = SYMBOL_KEYS.has(String.fromCharCode(cp));
		if (!isLatinLetter && !isKnownSymbol) return true;
	}
	return false;
}
function parseModifyOtherKeysSequence(data) {
	const match = data.match(/^\x1b\[27;(\d+);(\d+)~$/);
	if (!match) return null;
	const modValue = parseInt(match[1], 10);
	return {
		codepoint: parseInt(match[2], 10),
		modifier: modValue - 1
	};
}
/**
* Match xterm modifyOtherKeys format: CSI 27 ; modifiers ; keycode ~
* This is used by terminals when Kitty protocol is not enabled.
* Modifier values are 1-indexed: 2=shift, 3=alt, 5=ctrl, etc.
*/
function matchesModifyOtherKeys(data, expectedKeycode, expectedModifier) {
	const parsed = parseModifyOtherKeysSequence(data);
	if (!parsed) return false;
	return parsed.codepoint === expectedKeycode && parsed.modifier === expectedModifier;
}
function isWindowsTerminalSession() {
	return Boolean(process.env.WT_SESSION) && !process.env.SSH_CONNECTION && !process.env.SSH_CLIENT && !process.env.SSH_TTY;
}
/**
* Raw 0x08 (BS) is ambiguous in legacy terminals.
*
* - Windows Terminal uses it for Ctrl+Backspace.
* - Some legacy terminals and tmux setups send it for plain Backspace.
*
* Prefer explicit Kitty / CSI-u / modifyOtherKeys sequences whenever they are
* available. Fall back to a Windows Terminal heuristic only for raw BS bytes.
*/
function matchesRawBackspace(data, expectedModifier) {
	if (data === "") return expectedModifier === 0;
	if (data !== "\b") return false;
	return isWindowsTerminalSession() ? expectedModifier === MODIFIERS.ctrl : expectedModifier === 0;
}
/**
* Get the control character for a key.
* Uses the universal formula: code & 0x1f (mask to lower 5 bits)
*
* Works for:
* - Letters a-z → 1-26
* - Symbols [\]_ → 27, 28, 29, 31
* - Also maps - to same as _ (same physical key on US keyboards)
*/
function rawCtrlChar(key) {
	const char = key.toLowerCase();
	const code = char.charCodeAt(0);
	if (code >= 97 && code <= 122 || char === "[" || char === "\\" || char === "]" || char === "_") return String.fromCharCode(code & 31);
	if (char === "-") return String.fromCharCode(31);
	return null;
}
function isDigitKey(key) {
	return key >= "0" && key <= "9";
}
function matchesPrintableModifyOtherKeys(data, expectedKeycode, expectedModifier) {
	if (expectedModifier === 0) return false;
	const parsed = parseModifyOtherKeysSequence(data);
	if (!parsed || parsed.modifier !== expectedModifier) return false;
	return normalizeShiftedLetterIdentityCodepoint(parsed.codepoint, parsed.modifier) === normalizeShiftedLetterIdentityCodepoint(expectedKeycode, expectedModifier);
}
function parseKeyId(keyId) {
	const parts = keyId.toLowerCase().split("+");
	const key = parts[parts.length - 1];
	if (!key) return null;
	return {
		key,
		ctrl: parts.includes("ctrl"),
		shift: parts.includes("shift"),
		alt: parts.includes("alt"),
		super: parts.includes("super")
	};
}
/**
* Match input data against a key identifier string.
*
* Supported key identifiers:
* - Single keys: "escape", "tab", "enter", "backspace", "delete", "home", "end", "space"
* - Arrow keys: "up", "down", "left", "right"
* - Ctrl combinations: "ctrl+c", "ctrl+z", etc.
* - Shift combinations: "shift+tab", "shift+enter"
* - Alt combinations: "alt+enter", "alt+backspace"
* - Super combinations: "super+k", "super+enter"
* - Combined modifiers: "shift+ctrl+p", "ctrl+alt+x", "ctrl+super+k"
*
* Use the Key helper for autocomplete: Key.ctrl("c"), Key.escape, Key.ctrlShift("p"), Key.super("k")
*
* @param data - Raw input data from terminal
* @param keyId - Key identifier (e.g., "ctrl+c", "escape", Key.ctrl("c"))
*/
function matchesKey(data, keyId) {
	const parsed = parseKeyId(keyId);
	if (!parsed) return false;
	const { key, ctrl, shift, alt, super: superModifier } = parsed;
	let modifier = 0;
	if (shift) modifier |= MODIFIERS.shift;
	if (alt) modifier |= MODIFIERS.alt;
	if (ctrl) modifier |= MODIFIERS.ctrl;
	if (superModifier) modifier |= MODIFIERS.super;
	switch (key) {
		case "escape":
		case "esc":
			if (modifier !== 0) return false;
			return data === "\x1B" || matchesKittySequence(data, CODEPOINTS.escape, 0) || matchesModifyOtherKeys(data, CODEPOINTS.escape, 0);
		case "space":
			if (!_kittyProtocolActive) {
				if (modifier === MODIFIERS.ctrl && data === "\0") return true;
				if (modifier === MODIFIERS.alt && data === "\x1B ") return true;
			}
			if (modifier === 0) return data === " " || matchesKittySequence(data, CODEPOINTS.space, 0) || matchesModifyOtherKeys(data, CODEPOINTS.space, 0);
			return matchesKittySequence(data, CODEPOINTS.space, modifier) || matchesModifyOtherKeys(data, CODEPOINTS.space, modifier);
		case "tab":
			if (modifier === MODIFIERS.shift) return data === "\x1B[Z" || matchesKittySequence(data, CODEPOINTS.tab, MODIFIERS.shift) || matchesModifyOtherKeys(data, CODEPOINTS.tab, MODIFIERS.shift);
			if (modifier === 0) return data === "	" || matchesKittySequence(data, CODEPOINTS.tab, 0);
			return matchesKittySequence(data, CODEPOINTS.tab, modifier) || matchesModifyOtherKeys(data, CODEPOINTS.tab, modifier);
		case "enter":
		case "return":
			if (modifier === MODIFIERS.shift) {
				if (matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.shift) || matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.shift)) return true;
				if (matchesModifyOtherKeys(data, CODEPOINTS.enter, MODIFIERS.shift)) return true;
				if (_kittyProtocolActive) return data === "\x1B\r" || data === "\n";
				return false;
			}
			if (modifier === MODIFIERS.alt) {
				if (matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.alt) || matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.alt)) return true;
				if (matchesModifyOtherKeys(data, CODEPOINTS.enter, MODIFIERS.alt)) return true;
				if (!_kittyProtocolActive) return data === "\x1B\r";
				return false;
			}
			if (modifier === 0) return data === "\r" || !_kittyProtocolActive && data === "\n" || data === "\x1BOM" || matchesKittySequence(data, CODEPOINTS.enter, 0) || matchesKittySequence(data, CODEPOINTS.kpEnter, 0);
			return matchesKittySequence(data, CODEPOINTS.enter, modifier) || matchesKittySequence(data, CODEPOINTS.kpEnter, modifier) || matchesModifyOtherKeys(data, CODEPOINTS.enter, modifier);
		case "backspace":
			if (modifier === MODIFIERS.alt) {
				if (data === "\x1B" || data === "\x1B\b") return true;
				return matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.alt) || matchesModifyOtherKeys(data, CODEPOINTS.backspace, MODIFIERS.alt);
			}
			if (modifier === MODIFIERS.ctrl) {
				if (matchesRawBackspace(data, MODIFIERS.ctrl)) return true;
				return matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.ctrl) || matchesModifyOtherKeys(data, CODEPOINTS.backspace, MODIFIERS.ctrl);
			}
			if (modifier === 0) return matchesRawBackspace(data, 0) || matchesKittySequence(data, CODEPOINTS.backspace, 0) || matchesModifyOtherKeys(data, CODEPOINTS.backspace, 0);
			return matchesKittySequence(data, CODEPOINTS.backspace, modifier) || matchesModifyOtherKeys(data, CODEPOINTS.backspace, modifier);
		case "insert":
			if (modifier === 0) return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.insert) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.insert, 0);
			if (matchesLegacyModifierSequence(data, "insert", modifier)) return true;
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.insert, modifier);
		case "delete":
			if (modifier === 0) return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.delete) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.delete, 0);
			if (matchesLegacyModifierSequence(data, "delete", modifier)) return true;
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.delete, modifier);
		case "clear":
			if (modifier === 0) return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.clear);
			return matchesLegacyModifierSequence(data, "clear", modifier);
		case "home":
			if (modifier === 0) return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.home) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.home, 0);
			if (matchesLegacyModifierSequence(data, "home", modifier)) return true;
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.home, modifier);
		case "end":
			if (modifier === 0) return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.end) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.end, 0);
			if (matchesLegacyModifierSequence(data, "end", modifier)) return true;
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.end, modifier);
		case "pageup":
			if (modifier === 0) return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.pageUp) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageUp, 0);
			if (matchesLegacyModifierSequence(data, "pageUp", modifier)) return true;
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageUp, modifier);
		case "pagedown":
			if (modifier === 0) return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.pageDown) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageDown, 0);
			if (matchesLegacyModifierSequence(data, "pageDown", modifier)) return true;
			return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageDown, modifier);
		case "up":
			if (modifier === MODIFIERS.alt) return data === "\x1Bp" || matchesKittySequence(data, ARROW_CODEPOINTS.up, MODIFIERS.alt);
			if (modifier === 0) return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.up) || matchesKittySequence(data, ARROW_CODEPOINTS.up, 0);
			if (matchesLegacyModifierSequence(data, "up", modifier)) return true;
			return matchesKittySequence(data, ARROW_CODEPOINTS.up, modifier);
		case "down":
			if (modifier === MODIFIERS.alt) return data === "\x1Bn" || matchesKittySequence(data, ARROW_CODEPOINTS.down, MODIFIERS.alt);
			if (modifier === 0) return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.down) || matchesKittySequence(data, ARROW_CODEPOINTS.down, 0);
			if (matchesLegacyModifierSequence(data, "down", modifier)) return true;
			return matchesKittySequence(data, ARROW_CODEPOINTS.down, modifier);
		case "left":
			if (modifier === MODIFIERS.alt) return data === "\x1B[1;3D" || !_kittyProtocolActive && data === "\x1BB" || data === "\x1Bb" || matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.alt);
			if (modifier === MODIFIERS.ctrl) return data === "\x1B[1;5D" || matchesLegacyModifierSequence(data, "left", MODIFIERS.ctrl) || matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.ctrl);
			if (modifier === 0) return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.left) || matchesKittySequence(data, ARROW_CODEPOINTS.left, 0);
			if (matchesLegacyModifierSequence(data, "left", modifier)) return true;
			return matchesKittySequence(data, ARROW_CODEPOINTS.left, modifier);
		case "right":
			if (modifier === MODIFIERS.alt) return data === "\x1B[1;3C" || !_kittyProtocolActive && data === "\x1BF" || data === "\x1Bf" || matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.alt);
			if (modifier === MODIFIERS.ctrl) return data === "\x1B[1;5C" || matchesLegacyModifierSequence(data, "right", MODIFIERS.ctrl) || matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.ctrl);
			if (modifier === 0) return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.right) || matchesKittySequence(data, ARROW_CODEPOINTS.right, 0);
			if (matchesLegacyModifierSequence(data, "right", modifier)) return true;
			return matchesKittySequence(data, ARROW_CODEPOINTS.right, modifier);
		case "f1":
		case "f2":
		case "f3":
		case "f4":
		case "f5":
		case "f6":
		case "f7":
		case "f8":
		case "f9":
		case "f10":
		case "f11":
		case "f12":
			if (modifier !== 0) return false;
			return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES[key]);
	}
	if (key.length === 1 && (key >= "a" && key <= "z" || isDigitKey(key) || SYMBOL_KEYS.has(key))) {
		const codepoint = key.charCodeAt(0);
		const rawCtrl = rawCtrlChar(key);
		const isLetter = key >= "a" && key <= "z";
		const isDigit = isDigitKey(key);
		if (modifier === MODIFIERS.ctrl + MODIFIERS.alt && !_kittyProtocolActive && rawCtrl) {
			if (data === `\x1b${rawCtrl}`) return true;
		}
		if (modifier === MODIFIERS.alt && !_kittyProtocolActive && (isLetter || isDigit || SYMBOL_KEYS.has(key))) {
			if (data === `\x1b${key}`) return true;
		}
		if (modifier === MODIFIERS.ctrl) {
			if (rawCtrl && data === rawCtrl) return true;
			return matchesKittySequence(data, codepoint, MODIFIERS.ctrl) || matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.ctrl);
		}
		if (modifier === MODIFIERS.shift + MODIFIERS.ctrl) return matchesKittySequence(data, codepoint, MODIFIERS.shift + MODIFIERS.ctrl) || matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.shift + MODIFIERS.ctrl);
		if (modifier === MODIFIERS.shift) {
			if (isLetter && data === key.toUpperCase()) return true;
			return matchesKittySequence(data, codepoint, MODIFIERS.shift) || matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.shift);
		}
		if (modifier !== 0) return matchesKittySequence(data, codepoint, modifier) || matchesPrintableModifyOtherKeys(data, codepoint, modifier);
		return data === key || matchesKittySequence(data, codepoint, 0);
	}
	return false;
}
const KITTY_CSI_U_REGEX = /^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/;
const KITTY_PRINTABLE_ALLOWED_MODIFIERS = MODIFIERS.shift | LOCK_MASK;
/**
* Decode a Kitty CSI-u sequence into a printable character, if applicable.
*
* When Kitty keyboard protocol flag 1 (disambiguate) is active, terminals send
* CSI-u sequences for all keys, including plain printable characters. This
* function extracts the printable character from such sequences.
*
* Only accepts plain or Shift-modified keys. Rejects Ctrl, Alt, and unsupported
* modifier combinations (those are handled by keybinding matching instead).
* Prefers the shifted keycode when Shift is held and a shifted key is reported.
*
* @param data - Raw input data from terminal
* @returns The printable character, or undefined if not a printable CSI-u sequence
*/
function decodeKittyPrintable(data) {
	const match = data.match(KITTY_CSI_U_REGEX);
	if (!match) return void 0;
	const codepoint = Number.parseInt(match[1] ?? "", 10);
	if (!Number.isFinite(codepoint)) return void 0;
	const shiftedKey = match[2] && match[2].length > 0 ? Number.parseInt(match[2], 10) : void 0;
	const modValue = match[4] ? Number.parseInt(match[4], 10) : 1;
	const modifier = Number.isFinite(modValue) ? modValue - 1 : 0;
	if ((modifier & ~KITTY_PRINTABLE_ALLOWED_MODIFIERS) !== 0) return void 0;
	if (modifier & (MODIFIERS.alt | MODIFIERS.ctrl)) return void 0;
	let effectiveCodepoint = codepoint;
	if (modifier & MODIFIERS.shift && typeof shiftedKey === "number") effectiveCodepoint = shiftedKey;
	effectiveCodepoint = normalizeKittyFunctionalCodepoint(effectiveCodepoint);
	if (!Number.isFinite(effectiveCodepoint) || effectiveCodepoint < 32) return void 0;
	try {
		return String.fromCodePoint(effectiveCodepoint);
	} catch {
		return;
	}
}
function decodeModifyOtherKeysPrintable(data) {
	const parsed = parseModifyOtherKeysSequence(data);
	if (!parsed) return void 0;
	if ((parsed.modifier & -193 & ~MODIFIERS.shift) !== 0) return void 0;
	if (!Number.isFinite(parsed.codepoint) || parsed.codepoint < 32) return void 0;
	try {
		return String.fromCodePoint(parsed.codepoint);
	} catch {
		return;
	}
}
function decodePrintableKey(data) {
	return decodeKittyPrintable(data) ?? decodeModifyOtherKeysPrintable(data);
}

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/keybindings.js
const TUI_KEYBINDINGS = {
	"tui.editor.cursorUp": {
		defaultKeys: "up",
		description: "Move cursor up"
	},
	"tui.editor.cursorDown": {
		defaultKeys: "down",
		description: "Move cursor down"
	},
	"tui.editor.cursorLeft": {
		defaultKeys: ["left", "ctrl+b"],
		description: "Move cursor left"
	},
	"tui.editor.cursorRight": {
		defaultKeys: ["right", "ctrl+f"],
		description: "Move cursor right"
	},
	"tui.editor.cursorWordLeft": {
		defaultKeys: [
			"alt+left",
			"ctrl+left",
			"alt+b"
		],
		description: "Move cursor word left"
	},
	"tui.editor.cursorWordRight": {
		defaultKeys: [
			"alt+right",
			"ctrl+right",
			"alt+f"
		],
		description: "Move cursor word right"
	},
	"tui.editor.cursorLineStart": {
		defaultKeys: ["home", "ctrl+a"],
		description: "Move to line start"
	},
	"tui.editor.cursorLineEnd": {
		defaultKeys: ["end", "ctrl+e"],
		description: "Move to line end"
	},
	"tui.editor.jumpForward": {
		defaultKeys: "ctrl+]",
		description: "Jump forward to character"
	},
	"tui.editor.jumpBackward": {
		defaultKeys: "ctrl+alt+]",
		description: "Jump backward to character"
	},
	"tui.editor.pageUp": {
		defaultKeys: "pageUp",
		description: "Page up"
	},
	"tui.editor.pageDown": {
		defaultKeys: "pageDown",
		description: "Page down"
	},
	"tui.editor.deleteCharBackward": {
		defaultKeys: "backspace",
		description: "Delete character backward"
	},
	"tui.editor.deleteCharForward": {
		defaultKeys: ["delete", "ctrl+d"],
		description: "Delete character forward"
	},
	"tui.editor.deleteWordBackward": {
		defaultKeys: ["ctrl+w", "alt+backspace"],
		description: "Delete word backward"
	},
	"tui.editor.deleteWordForward": {
		defaultKeys: ["alt+d", "alt+delete"],
		description: "Delete word forward"
	},
	"tui.editor.deleteToLineStart": {
		defaultKeys: "ctrl+u",
		description: "Delete to line start"
	},
	"tui.editor.deleteToLineEnd": {
		defaultKeys: "ctrl+k",
		description: "Delete to line end"
	},
	"tui.editor.yank": {
		defaultKeys: "ctrl+y",
		description: "Yank"
	},
	"tui.editor.yankPop": {
		defaultKeys: "alt+y",
		description: "Yank pop"
	},
	"tui.editor.undo": {
		defaultKeys: "ctrl+-",
		description: "Undo"
	},
	"tui.input.newLine": {
		defaultKeys: ["shift+enter", "ctrl+j"],
		description: "Insert newline"
	},
	"tui.input.submit": {
		defaultKeys: "enter",
		description: "Submit input"
	},
	"tui.input.tab": {
		defaultKeys: "tab",
		description: "Tab / autocomplete"
	},
	"tui.input.copy": {
		defaultKeys: "ctrl+c",
		description: "Copy selection"
	},
	"tui.select.up": {
		defaultKeys: "up",
		description: "Move selection up"
	},
	"tui.select.down": {
		defaultKeys: "down",
		description: "Move selection down"
	},
	"tui.select.pageUp": {
		defaultKeys: "pageUp",
		description: "Selection page up"
	},
	"tui.select.pageDown": {
		defaultKeys: "pageDown",
		description: "Selection page down"
	},
	"tui.select.confirm": {
		defaultKeys: "enter",
		description: "Confirm selection"
	},
	"tui.select.cancel": {
		defaultKeys: ["escape", "ctrl+c"],
		description: "Cancel selection"
	}
};
function normalizeKeys(keys) {
	if (keys === void 0) return [];
	const keyList = Array.isArray(keys) ? keys : [keys];
	const seen = /* @__PURE__ */ new Set();
	const result = [];
	for (const key of keyList) if (!seen.has(key)) {
		seen.add(key);
		result.push(key);
	}
	return result;
}
var KeybindingsManager = class {
	definitions;
	userBindings;
	keysById = /* @__PURE__ */ new Map();
	conflicts = [];
	constructor(definitions, userBindings = {}) {
		this.definitions = definitions;
		this.userBindings = userBindings;
		this.rebuild();
	}
	rebuild() {
		this.keysById.clear();
		this.conflicts = [];
		const userClaims = /* @__PURE__ */ new Map();
		for (const [keybinding, keys] of Object.entries(this.userBindings)) {
			if (!(keybinding in this.definitions)) continue;
			for (const key of normalizeKeys(keys)) {
				const claimants = userClaims.get(key) ?? /* @__PURE__ */ new Set();
				claimants.add(keybinding);
				userClaims.set(key, claimants);
			}
		}
		for (const [key, keybindings] of userClaims) if (keybindings.size > 1) this.conflicts.push({
			key,
			keybindings: [...keybindings]
		});
		for (const [id, definition] of Object.entries(this.definitions)) {
			const userKeys = this.userBindings[id];
			const keys = userKeys === void 0 ? normalizeKeys(definition.defaultKeys) : normalizeKeys(userKeys);
			this.keysById.set(id, keys);
		}
	}
	matches(data, keybinding) {
		const keys = this.keysById.get(keybinding) ?? [];
		for (const key of keys) if (matchesKey(data, key)) return true;
		return false;
	}
	getKeys(keybinding) {
		return [...this.keysById.get(keybinding) ?? []];
	}
	getDefinition(keybinding) {
		return this.definitions[keybinding];
	}
	getConflicts() {
		return this.conflicts.map((conflict) => ({
			...conflict,
			keybindings: [...conflict.keybindings]
		}));
	}
	setUserBindings(userBindings) {
		this.userBindings = userBindings;
		this.rebuild();
	}
	getUserBindings() {
		return { ...this.userBindings };
	}
	getResolvedBindings() {
		const resolved = {};
		for (const id of Object.keys(this.definitions)) {
			const keys = this.keysById.get(id) ?? [];
			resolved[id] = keys.length === 1 ? keys[0] : [...keys];
		}
		return resolved;
	}
};
let globalKeybindings = null;
function getKeybindings() {
	if (!globalKeybindings) globalKeybindings = new KeybindingsManager(TUI_KEYBINDINGS);
	return globalKeybindings;
}

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/components/text.js
/**
* Text component - displays multi-line text with word wrapping
*/
var Text = class {
	text;
	paddingX;
	paddingY;
	customBgFn;
	cachedText;
	cachedWidth;
	cachedLines;
	constructor(text = "", paddingX = 1, paddingY = 1, customBgFn) {
		this.text = text;
		this.paddingX = paddingX;
		this.paddingY = paddingY;
		this.customBgFn = customBgFn;
	}
	setText(text) {
		this.text = text;
		this.cachedText = void 0;
		this.cachedWidth = void 0;
		this.cachedLines = void 0;
	}
	setCustomBgFn(customBgFn) {
		this.customBgFn = customBgFn;
		this.cachedText = void 0;
		this.cachedWidth = void 0;
		this.cachedLines = void 0;
	}
	invalidate() {
		this.cachedText = void 0;
		this.cachedWidth = void 0;
		this.cachedLines = void 0;
	}
	render(width) {
		if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width) return this.cachedLines;
		if (!this.text || this.text.trim() === "") {
			const result = [];
			this.cachedText = this.text;
			this.cachedWidth = width;
			this.cachedLines = result;
			return result;
		}
		const normalizedText = this.text.replace(/\t/g, "   ");
		const contentWidth = Math.max(1, width - this.paddingX * 2);
		const wrappedLines = wrapTextWithAnsi(normalizedText, contentWidth);
		const leftMargin = " ".repeat(this.paddingX);
		const rightMargin = " ".repeat(this.paddingX);
		const contentLines = [];
		for (const line of wrappedLines) {
			const lineWithMargins = leftMargin + line + rightMargin;
			if (this.customBgFn) contentLines.push(applyBackgroundToLine(lineWithMargins, width, this.customBgFn));
			else {
				const visibleLen = visibleWidth(lineWithMargins);
				const paddingNeeded = Math.max(0, width - visibleLen);
				contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
			}
		}
		const emptyLine = " ".repeat(width);
		const emptyLines = [];
		for (let i = 0; i < this.paddingY; i++) {
			const line = this.customBgFn ? applyBackgroundToLine(emptyLine, width, this.customBgFn) : emptyLine;
			emptyLines.push(line);
		}
		const result = [
			...emptyLines,
			...contentLines,
			...emptyLines
		];
		this.cachedText = this.text;
		this.cachedWidth = width;
		this.cachedLines = result;
		return result.length > 0 ? result : [""];
	}
};

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/kill-ring.js
/**
* Ring buffer for Emacs-style kill/yank operations.
*
* Tracks killed (deleted) text entries. Consecutive kills can accumulate
* into a single entry. Supports yank (paste most recent) and yank-pop
* (cycle through older entries).
*/
var KillRing = class {
	ring = [];
	/**
	* Add text to the kill ring.
	*
	* @param text - The killed text to add
	* @param opts - Push options
	* @param opts.prepend - If accumulating, prepend (backward deletion) or append (forward deletion)
	* @param opts.accumulate - Merge with the most recent entry instead of creating a new one
	*/
	push(text, opts) {
		if (!text) return;
		if (opts.accumulate && this.ring.length > 0) {
			const last = this.ring.pop();
			this.ring.push(opts.prepend ? text + last : last + text);
		} else this.ring.push(text);
	}
	/** Get most recent entry without modifying the ring. */
	peek() {
		return this.ring.length > 0 ? this.ring[this.ring.length - 1] : void 0;
	}
	/** Move last entry to front (for yank-pop cycling). */
	rotate() {
		if (this.ring.length > 1) {
			const last = this.ring.pop();
			this.ring.unshift(last);
		}
	}
	get length() {
		return this.ring.length;
	}
};

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/terminal-colors.js
function hexToRgb(hex) {
	const normalized = hex.startsWith("#") ? hex.slice(1) : hex;
	return {
		r: parseInt(normalized.slice(0, 2), 16),
		g: parseInt(normalized.slice(2, 4), 16),
		b: parseInt(normalized.slice(4, 6), 16)
	};
}
function parseOscHexChannel(channel) {
	if (!/^[0-9a-f]+$/i.test(channel)) return;
	const max = 16 ** channel.length - 1;
	if (max <= 0) return;
	return Math.round(parseInt(channel, 16) / max * 255);
}
const OSC11_BACKGROUND_COLOR_RESPONSE_PATTERN = /^\x1b\]11;([^\x07\x1b]*)(?:\x07|\x1b\\)$/i;
const COLOR_SCHEME_REPORT_PATTERN = /^\x1b\[\?997;(1|2)n$/;
function isOsc11BackgroundColorResponse(data) {
	return OSC11_BACKGROUND_COLOR_RESPONSE_PATTERN.test(data);
}
function parseOsc11BackgroundColor(data) {
	const match = data.match(OSC11_BACKGROUND_COLOR_RESPONSE_PATTERN);
	if (!match) return;
	const value = match[1].trim();
	if (value.startsWith("#")) {
		const hex = value.slice(1);
		if (/^[0-9a-f]{6}$/i.test(hex)) return hexToRgb(value);
		if (/^[0-9a-f]{12}$/i.test(hex)) {
			const r = parseOscHexChannel(hex.slice(0, 4));
			const g = parseOscHexChannel(hex.slice(4, 8));
			const b = parseOscHexChannel(hex.slice(8, 12));
			return r !== void 0 && g !== void 0 && b !== void 0 ? {
				r,
				g,
				b
			} : void 0;
		}
		return;
	}
	const [red, green, blue] = value.replace(/^rgba?:/i, "").split("/");
	if (red === void 0 || green === void 0 || blue === void 0) return;
	const r = parseOscHexChannel(red);
	const g = parseOscHexChannel(green);
	const b = parseOscHexChannel(blue);
	return r !== void 0 && g !== void 0 && b !== void 0 ? {
		r,
		g,
		b
	} : void 0;
}
function parseTerminalColorSchemeReport(data) {
	const match = data.match(COLOR_SCHEME_REPORT_PATTERN);
	if (!match) return;
	return match[1] === "2" ? "light" : "dark";
}

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/terminal-image.js
let cachedCapabilities = null;
let cellDimensions = {
	widthPx: 9,
	heightPx: 18
};
function setCellDimensions(dims) {
	cellDimensions = dims;
}
/**
* Checks whether the attached tmux client forwards OSC 8 hyperlinks to the
* outer terminal. tmux only re-emits them when its `client_termfeatures` lists
* `hyperlinks`, and strips them otherwise. On any error fallbacks `false`.
*/
function probeTmuxHyperlinks() {
	try {
		return execSync("tmux display-message -p '#{client_termfeatures}'", {
			encoding: "utf8",
			timeout: 250,
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			]
		}).split(",").map((feature) => feature.trim()).includes("hyperlinks");
	} catch {
		return false;
	}
}
function detectCapabilities(tmuxForwardsHyperlink = probeTmuxHyperlinks) {
	const termProgram = process.env.TERM_PROGRAM?.toLowerCase() || "";
	const terminalEmulator = process.env.TERMINAL_EMULATOR?.toLowerCase() || "";
	const term = process.env.TERM?.toLowerCase() || "";
	const colorTerm = process.env.COLORTERM?.toLowerCase() || "";
	const hasTrueColorHint = colorTerm === "truecolor" || colorTerm === "24bit";
	if (process.env.TMUX || term.startsWith("tmux")) return {
		images: null,
		trueColor: hasTrueColorHint,
		hyperlinks: tmuxForwardsHyperlink()
	};
	if (term.startsWith("screen")) return {
		images: null,
		trueColor: hasTrueColorHint,
		hyperlinks: false
	};
	if (process.env.KITTY_WINDOW_ID || termProgram === "kitty") return {
		images: "kitty",
		trueColor: true,
		hyperlinks: true
	};
	if (termProgram === "ghostty" || term.includes("ghostty") || process.env.GHOSTTY_RESOURCES_DIR) return {
		images: "kitty",
		trueColor: true,
		hyperlinks: true
	};
	if (process.env.WEZTERM_PANE || termProgram === "wezterm") return {
		images: "kitty",
		trueColor: true,
		hyperlinks: true
	};
	if (termProgram === "warpterminal" || process.env.WARP_SESSION_ID || process.env.WARP_TERMINAL_SESSION_UUID) return {
		images: "kitty",
		trueColor: true,
		hyperlinks: true
	};
	if (process.env.ITERM_SESSION_ID || termProgram === "iterm.app") return {
		images: "iterm2",
		trueColor: true,
		hyperlinks: true
	};
	if (process.env.WT_SESSION) return {
		images: null,
		trueColor: true,
		hyperlinks: true
	};
	if (termProgram === "vscode") return {
		images: null,
		trueColor: true,
		hyperlinks: true
	};
	if (termProgram === "alacritty") return {
		images: null,
		trueColor: true,
		hyperlinks: true
	};
	if (terminalEmulator === "jetbrains-jediterm") return {
		images: null,
		trueColor: true,
		hyperlinks: false
	};
	return {
		images: null,
		trueColor: hasTrueColorHint,
		hyperlinks: false
	};
}
function getCapabilities() {
	if (!cachedCapabilities) cachedCapabilities = detectCapabilities();
	return cachedCapabilities;
}
const KITTY_PREFIX = "\x1B_G";
const ITERM2_PREFIX = "\x1B]1337;File=";
function isImageLine(line) {
	if (line.startsWith(KITTY_PREFIX) || line.startsWith(ITERM2_PREFIX)) return true;
	return line.includes(KITTY_PREFIX) || line.includes(ITERM2_PREFIX);
}
/**
* Delete a Kitty graphics image by ID.
* Uses uppercase 'I' to also free the image data.
*/
function deleteKittyImage(imageId) {
	return `\x1b_Ga=d,d=I,i=${imageId},q=2\x1b\\`;
}
/**
* Wrap text in an OSC 8 hyperlink sequence.
* The text is rendered as a clickable hyperlink in terminals that support OSC 8
* (Ghostty, Kitty, WezTerm, iTerm2, VSCode, and others).
* In terminals that do not support OSC 8, the escape sequences are ignored
* and only the plain text is displayed.
*
* @param text - The visible text to display
* @param url - The URL to link to
*/
function hyperlink(text, url) {
	return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/tui.js
/**
* Minimal TUI implementation with differential rendering
*/
const KITTY_SEQUENCE_PREFIX = "\x1B_G";
function parseKittyImageHeader(line) {
	const sequenceStart = line.indexOf(KITTY_SEQUENCE_PREFIX);
	if (sequenceStart === -1) return void 0;
	const paramsStart = sequenceStart + 3;
	const paramsEnd = line.indexOf(";", paramsStart);
	if (paramsEnd === -1) return void 0;
	const ids = [];
	let rows = 1;
	const params = line.slice(paramsStart, paramsEnd);
	for (const param of params.split(",")) {
		const [key, value] = param.split("=", 2);
		if (value === void 0) continue;
		const numberValue = Number(value);
		if (!Number.isInteger(numberValue) || numberValue <= 0 || numberValue > 4294967295) continue;
		if (key === "i") ids.push(numberValue);
		else if (key === "r") rows = numberValue;
	}
	return {
		ids,
		rows
	};
}
function extractKittyImageIds(line) {
	return parseKittyImageHeader(line)?.ids ?? [];
}
function extractKittyImageRows(line) {
	return parseKittyImageHeader(line)?.rows ?? 1;
}
/** Type guard to check if a component implements Focusable */
function isFocusable(component) {
	return component !== null && "focused" in component;
}
/**
* Cursor position marker - APC (Application Program Command) sequence.
* This is a zero-width escape sequence that terminals ignore.
* Components emit this at the cursor position when focused.
* TUI finds and strips this marker, then positions the hardware cursor there.
*/
const CURSOR_MARKER = "\x1B_pi:c\x07";
/** Parse a SizeValue into absolute value given a reference size */
function parseSizeValue(value, referenceSize) {
	if (value === void 0) return void 0;
	if (typeof value === "number") return value;
	const match = value.match(/^(\d+(?:\.\d+)?)%$/);
	if (match) return Math.floor(referenceSize * parseFloat(match[1]) / 100);
}
function isTermuxSession() {
	return Boolean(process.env.TERMUX_VERSION);
}
/**
* Container - a component that contains other components
*/
var Container = class {
	children = [];
	addChild(component) {
		this.children.push(component);
	}
	removeChild(component) {
		const index = this.children.indexOf(component);
		if (index !== -1) this.children.splice(index, 1);
	}
	clear() {
		this.children = [];
	}
	invalidate() {
		for (const child of this.children) child.invalidate?.();
	}
	render(width) {
		const lines = [];
		for (const child of this.children) {
			const childLines = child.render(width);
			for (const line of childLines) lines.push(line);
		}
		return lines;
	}
};
/**
* TUI - Main class for managing terminal UI with differential rendering
*/
var TUI = class TUI extends Container {
	terminal;
	previousLines = [];
	previousKittyImageIds = /* @__PURE__ */ new Set();
	previousWidth = 0;
	previousHeight = 0;
	focusedComponent = null;
	inputListeners = /* @__PURE__ */ new Set();
	/** Global callback for debug key (Shift+Ctrl+D). Called before input is forwarded to focused component. */
	onDebug;
	renderRequested = false;
	renderTimer;
	lastRenderAt = 0;
	static MIN_RENDER_INTERVAL_MS = 16;
	cursorRow = 0;
	hardwareCursorRow = 0;
	showHardwareCursor = process.env.PI_HARDWARE_CURSOR === "1";
	clearOnShrink = process.env.PI_CLEAR_ON_SHRINK === "1";
	maxLinesRendered = 0;
	previousViewportTop = 0;
	fullRedrawCount = 0;
	stopped = false;
	pendingOsc11BackgroundReplies = 0;
	pendingOsc11BackgroundQueries = [];
	terminalColorSchemeListeners = /* @__PURE__ */ new Set();
	terminalColorSchemeNotificationsEnabled = false;
	focusOrderCounter = 0;
	overlayStack = [];
	overlayFocusRestore = { status: "inactive" };
	constructor(terminal, showHardwareCursor) {
		super();
		this.terminal = terminal;
		if (showHardwareCursor !== void 0) this.showHardwareCursor = showHardwareCursor;
	}
	get fullRedraws() {
		return this.fullRedrawCount;
	}
	getShowHardwareCursor() {
		return this.showHardwareCursor;
	}
	setShowHardwareCursor(enabled) {
		if (this.showHardwareCursor === enabled) return;
		this.showHardwareCursor = enabled;
		if (!enabled) this.terminal.hideCursor();
		this.requestRender();
	}
	getClearOnShrink() {
		return this.clearOnShrink;
	}
	/**
	* Set whether to trigger full re-render when content shrinks.
	* When true (default), empty rows are cleared when content shrinks.
	* When false, empty rows remain (reduces redraws on slower terminals).
	*/
	setClearOnShrink(enabled) {
		this.clearOnShrink = enabled;
	}
	setFocus(component) {
		this.setFocusInternal({
			component,
			overlayFocusRestore: "clear"
		});
	}
	setFocusInternal({ component, overlayFocusRestore }) {
		const previousFocus = this.focusedComponent;
		let nextFocus = component;
		const previousFocusedOverlay = previousFocus ? this.overlayStack.find((entry) => entry.component === previousFocus && this.isOverlayVisible(entry)) : void 0;
		const nextFocusIsOverlay = nextFocus ? this.overlayStack.some((entry) => entry.component === nextFocus) : false;
		const restoreState = this.getVisibleOverlayFocusRestore();
		if (nextFocus && !nextFocusIsOverlay) {
			if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) {
				if (restoreState.resume.status === "focus-target" || !this.isComponentMounted(restoreState.blockedBy)) nextFocus = this.resolveBlockedOverlayFocusResume(restoreState);
				else this.overlayFocusRestore = {
					status: "blocked",
					overlay: restoreState.overlay,
					blockedBy: nextFocus,
					resume: restoreState.resume
				};
			} else if (previousFocusedOverlay && restoreState.status !== "inactive" && restoreState.overlay === previousFocusedOverlay && !this.isOverlayFocusAncestor(previousFocusedOverlay, nextFocus)) this.overlayFocusRestore = {
				status: "blocked",
				overlay: previousFocusedOverlay,
				blockedBy: nextFocus,
				resume: { status: "restore-overlay" }
			};
		} else if (nextFocus === null) {
			if (restoreState.status === "blocked" && restoreState.blockedBy === previousFocus) nextFocus = this.resolveBlockedOverlayFocusResume(restoreState);
			else if (overlayFocusRestore === "clear") this.clearOverlayFocusRestore();
		}
		if (isFocusable(this.focusedComponent)) this.focusedComponent.focused = false;
		this.focusedComponent = nextFocus;
		if (isFocusable(nextFocus)) nextFocus.focused = true;
		const focusedOverlay = nextFocus ? this.overlayStack.find((entry) => entry.component === nextFocus && this.isOverlayVisible(entry)) : void 0;
		if (focusedOverlay) this.overlayFocusRestore = {
			status: "eligible",
			overlay: focusedOverlay
		};
	}
	clearOverlayFocusRestore() {
		this.overlayFocusRestore = { status: "inactive" };
	}
	clearOverlayFocusRestoreFor(overlay) {
		if (this.overlayFocusRestore.status !== "inactive" && this.overlayFocusRestore.overlay === overlay) this.clearOverlayFocusRestore();
	}
	resolveBlockedOverlayFocusResume(restoreState) {
		if (restoreState.resume.status === "restore-overlay") return restoreState.overlay.component;
		this.clearOverlayFocusRestore();
		return restoreState.resume.target;
	}
	getVisibleOverlayFocusRestore() {
		const restoreState = this.overlayFocusRestore;
		if (restoreState.status === "inactive") return restoreState;
		if (!this.overlayStack.includes(restoreState.overlay) || !this.isOverlayVisible(restoreState.overlay)) return { status: "inactive" };
		return restoreState;
	}
	isOverlayFocusAncestor(entry, component) {
		const visited = /* @__PURE__ */ new Set();
		let current = entry.preFocus;
		while (current && !visited.has(current)) {
			visited.add(current);
			if (current === component) return true;
			current = this.overlayStack.find((overlay) => overlay.component === current)?.preFocus ?? null;
		}
		return false;
	}
	retargetOverlayPreFocus(removed) {
		for (const overlay of this.overlayStack) if (overlay !== removed && overlay.preFocus === removed.component) overlay.preFocus = removed.preFocus;
	}
	isComponentMounted(component) {
		return this.children.some((child) => this.containsComponent(child, component));
	}
	containsComponent(root, target) {
		if (root === target) return true;
		if (!(root instanceof Container)) return false;
		return root.children.some((child) => this.containsComponent(child, target));
	}
	/**
	* Show an overlay component with configurable positioning and sizing.
	* Returns a handle to control the overlay's visibility.
	*/
	showOverlay(component, options) {
		const entry = {
			component,
			...options === void 0 ? {} : { options },
			preFocus: this.focusedComponent,
			hidden: false,
			focusOrder: ++this.focusOrderCounter
		};
		this.overlayStack.push(entry);
		if (!options?.nonCapturing && this.isOverlayVisible(entry)) this.setFocus(component);
		this.terminal.hideCursor();
		this.requestRender();
		return {
			hide: () => {
				const index = this.overlayStack.indexOf(entry);
				if (index !== -1) {
					this.clearOverlayFocusRestoreFor(entry);
					this.retargetOverlayPreFocus(entry);
					this.overlayStack.splice(index, 1);
					if (this.focusedComponent === component) {
						const topVisible = this.getTopmostVisibleOverlay();
						this.setFocus(topVisible?.component ?? entry.preFocus);
					}
					if (this.overlayStack.length === 0) this.terminal.hideCursor();
					this.requestRender();
				}
			},
			setHidden: (hidden) => {
				if (entry.hidden === hidden) return;
				entry.hidden = hidden;
				if (hidden) {
					this.clearOverlayFocusRestoreFor(entry);
					if (this.focusedComponent === component) {
						const topVisible = this.getTopmostVisibleOverlay();
						this.setFocus(topVisible?.component ?? entry.preFocus);
					}
				} else if (!options?.nonCapturing && this.isOverlayVisible(entry)) {
					entry.focusOrder = ++this.focusOrderCounter;
					this.setFocus(component);
				}
				this.requestRender();
			},
			isHidden: () => entry.hidden,
			focus: () => {
				if (!this.overlayStack.includes(entry) || !this.isOverlayVisible(entry)) return;
				entry.focusOrder = ++this.focusOrderCounter;
				this.setFocus(component);
				this.requestRender();
			},
			unfocus: (unfocusOptions) => {
				const isFocused = this.focusedComponent === component;
				const restoreState = this.overlayFocusRestore;
				const hasPendingRestore = restoreState.status !== "inactive" && restoreState.overlay === entry;
				if (!isFocused && !hasPendingRestore) return;
				if (restoreState.status === "blocked" && restoreState.overlay === entry && this.focusedComponent === restoreState.blockedBy) {
					if (unfocusOptions) this.overlayFocusRestore = {
						status: "blocked",
						overlay: entry,
						blockedBy: restoreState.blockedBy,
						resume: {
							status: "focus-target",
							target: unfocusOptions.target
						}
					};
					else this.clearOverlayFocusRestore();
					this.requestRender();
					return;
				}
				this.clearOverlayFocusRestoreFor(entry);
				if (isFocused || unfocusOptions) {
					const topVisible = this.getTopmostVisibleOverlay();
					const fallbackTarget = topVisible && topVisible !== entry ? topVisible.component : entry.preFocus;
					this.setFocus(unfocusOptions ? unfocusOptions.target : fallbackTarget);
				}
				this.requestRender();
			},
			isFocused: () => this.focusedComponent === component
		};
	}
	/** Hide the topmost overlay and restore previous focus. */
	hideOverlay() {
		const overlay = this.overlayStack[this.overlayStack.length - 1];
		if (!overlay) return;
		this.clearOverlayFocusRestoreFor(overlay);
		this.retargetOverlayPreFocus(overlay);
		this.overlayStack.pop();
		if (this.focusedComponent === overlay.component) {
			const topVisible = this.getTopmostVisibleOverlay();
			this.setFocus(topVisible?.component ?? overlay.preFocus);
		}
		if (this.overlayStack.length === 0) this.terminal.hideCursor();
		this.requestRender();
	}
	/** Check if there are any visible overlays */
	hasOverlay() {
		return this.overlayStack.some((o) => this.isOverlayVisible(o));
	}
	/** Check if an overlay entry is currently visible */
	isOverlayVisible(entry) {
		if (entry.hidden) return false;
		if (entry.options?.visible) return entry.options.visible(this.terminal.columns, this.terminal.rows);
		return true;
	}
	/** Find the visual-frontmost visible capturing overlay, if any */
	getTopmostVisibleOverlay() {
		let topmost;
		for (const overlay of this.overlayStack) {
			if (overlay.options?.nonCapturing || !this.isOverlayVisible(overlay)) continue;
			if (!topmost || overlay.focusOrder > topmost.focusOrder) topmost = overlay;
		}
		return topmost;
	}
	invalidate() {
		super.invalidate();
		for (const overlay of this.overlayStack) overlay.component.invalidate?.();
	}
	start() {
		this.stopped = false;
		this.terminal.start((data) => this.handleInput(data), () => this.requestRender());
		this.terminal.hideCursor();
		if (this.terminalColorSchemeNotificationsEnabled) this.terminal.write("\x1B[?2031h");
		this.queryCellSize();
		this.requestRender();
	}
	addInputListener(listener) {
		this.inputListeners.add(listener);
		return () => {
			this.inputListeners.delete(listener);
		};
	}
	removeInputListener(listener) {
		this.inputListeners.delete(listener);
	}
	onTerminalColorSchemeChange(listener) {
		this.terminalColorSchemeListeners.add(listener);
		return () => {
			this.terminalColorSchemeListeners.delete(listener);
		};
	}
	setTerminalColorSchemeNotifications(enabled) {
		if (this.terminalColorSchemeNotificationsEnabled === enabled) return;
		this.terminalColorSchemeNotificationsEnabled = enabled;
		if (!this.stopped) this.terminal.write(enabled ? "\x1B[?2031h" : "\x1B[?2031l");
	}
	queryCellSize() {
		if (!getCapabilities().images) return;
		this.terminal.write("\x1B[16t");
	}
	stop() {
		this.stopped = true;
		if (this.renderTimer) {
			clearTimeout(this.renderTimer);
			this.renderTimer = void 0;
		}
		if (this.terminalColorSchemeNotificationsEnabled) this.terminal.write("\x1B[?2031l");
		if (this.previousLines.length > 0) {
			const lineDiff = this.previousLines.length - this.hardwareCursorRow;
			if (lineDiff > 0) this.terminal.write(`\x1b[${lineDiff}B`);
			else if (lineDiff < 0) this.terminal.write(`\x1b[${-lineDiff}A`);
			this.terminal.write("\r\n");
		}
		this.terminal.showCursor();
		this.terminal.stop();
	}
	requestRender(force = false) {
		if (force) {
			this.previousLines = [];
			this.previousWidth = -1;
			this.previousHeight = -1;
			this.cursorRow = 0;
			this.hardwareCursorRow = 0;
			this.maxLinesRendered = 0;
			this.previousViewportTop = 0;
			if (this.renderTimer) {
				clearTimeout(this.renderTimer);
				this.renderTimer = void 0;
			}
			this.renderRequested = true;
			process.nextTick(() => {
				if (this.stopped || !this.renderRequested) return;
				this.renderRequested = false;
				this.lastRenderAt = performance.now();
				this.doRender();
			});
			return;
		}
		if (this.renderRequested) return;
		this.renderRequested = true;
		process.nextTick(() => this.scheduleRender());
	}
	scheduleRender() {
		if (this.stopped || this.renderTimer || !this.renderRequested) return;
		const elapsed = performance.now() - this.lastRenderAt;
		const delay = Math.max(0, TUI.MIN_RENDER_INTERVAL_MS - elapsed);
		this.renderTimer = setTimeout(() => {
			this.renderTimer = void 0;
			if (this.stopped || !this.renderRequested) return;
			this.renderRequested = false;
			this.lastRenderAt = performance.now();
			this.doRender();
			if (this.renderRequested) this.scheduleRender();
		}, delay);
	}
	handleInput(data) {
		if (this.consumeOsc11BackgroundResponse(data)) return;
		if (this.consumeTerminalColorSchemeReport(data)) return;
		if (this.inputListeners.size > 0) {
			let current = data;
			for (const listener of this.inputListeners) {
				const result = listener(current);
				if (result?.consume) return;
				if (result?.data !== void 0) current = result.data;
			}
			if (current.length === 0) return;
			data = current;
		}
		if (this.consumeCellSizeResponse(data)) return;
		if (matchesKey(data, "shift+ctrl+d") && this.onDebug) {
			this.onDebug();
			return;
		}
		const focusedOverlay = this.overlayStack.find((o) => o.component === this.focusedComponent);
		if (focusedOverlay && !this.isOverlayVisible(focusedOverlay)) {
			const topVisible = this.getTopmostVisibleOverlay();
			if (topVisible) this.setFocus(topVisible.component);
			else this.setFocusInternal({
				component: focusedOverlay.preFocus,
				overlayFocusRestore: "preserve"
			});
		}
		if (!this.overlayStack.some((o) => o.component === this.focusedComponent)) {
			const restoreState = this.getVisibleOverlayFocusRestore();
			if (restoreState.status === "eligible") this.setFocus(restoreState.overlay.component);
			else if (restoreState.status === "blocked" && restoreState.blockedBy !== this.focusedComponent) {
				if (restoreState.resume.status === "restore-overlay") this.setFocus(restoreState.overlay.component);
				else {
					this.clearOverlayFocusRestore();
					this.setFocus(restoreState.resume.target);
				}
			}
		}
		if (this.focusedComponent?.handleInput) {
			if (isKeyRelease(data) && !this.focusedComponent.wantsKeyRelease) return;
			this.focusedComponent.handleInput(data);
			this.requestRender();
		}
	}
	consumeOsc11BackgroundResponse(data) {
		if (this.pendingOsc11BackgroundReplies <= 0) return false;
		if (!isOsc11BackgroundColorResponse(data)) return false;
		const rgb = parseOsc11BackgroundColor(data);
		this.pendingOsc11BackgroundReplies -= 1;
		const query = this.pendingOsc11BackgroundQueries.shift();
		if (query && !query.settled) {
			query.settled = true;
			if (query.timer) {
				clearTimeout(query.timer);
				query.timer = void 0;
			}
			query.resolve?.(rgb);
			query.resolve = void 0;
		}
		return true;
	}
	consumeTerminalColorSchemeReport(data) {
		const scheme = parseTerminalColorSchemeReport(data);
		if (!scheme) return false;
		for (const listener of this.terminalColorSchemeListeners) listener(scheme);
		return true;
	}
	consumeCellSizeResponse(data) {
		const match = data.match(/^\x1b\[6;(\d+);(\d+)t$/);
		if (!match) return false;
		const heightPx = parseInt(match[1], 10);
		const widthPx = parseInt(match[2], 10);
		if (heightPx <= 0 || widthPx <= 0) return true;
		setCellDimensions({
			widthPx,
			heightPx
		});
		this.invalidate();
		this.requestRender();
		return true;
	}
	/**
	* Resolve overlay layout from options.
	* Returns { width, row, col, maxHeight } for rendering.
	*/
	resolveOverlayLayout(options, overlayHeight, termWidth, termHeight) {
		const opt = options ?? {};
		const margin = typeof opt.margin === "number" ? {
			top: opt.margin,
			right: opt.margin,
			bottom: opt.margin,
			left: opt.margin
		} : opt.margin ?? {};
		const marginTop = Math.max(0, margin.top ?? 0);
		const marginRight = Math.max(0, margin.right ?? 0);
		const marginBottom = Math.max(0, margin.bottom ?? 0);
		const marginLeft = Math.max(0, margin.left ?? 0);
		const availWidth = Math.max(1, termWidth - marginLeft - marginRight);
		const availHeight = Math.max(1, termHeight - marginTop - marginBottom);
		let width = parseSizeValue(opt.width, termWidth) ?? Math.min(80, availWidth);
		if (opt.minWidth !== void 0) width = Math.max(width, opt.minWidth);
		width = Math.max(1, Math.min(width, availWidth));
		let maxHeight = parseSizeValue(opt.maxHeight, termHeight);
		if (maxHeight !== void 0) maxHeight = Math.max(1, Math.min(maxHeight, availHeight));
		const effectiveHeight = maxHeight !== void 0 ? Math.min(overlayHeight, maxHeight) : overlayHeight;
		let row;
		let col;
		if (opt.row !== void 0) {
			if (typeof opt.row === "string") {
				const match = opt.row.match(/^(\d+(?:\.\d+)?)%$/);
				if (match) {
					const maxRow = Math.max(0, availHeight - effectiveHeight);
					const percent = parseFloat(match[1]) / 100;
					row = marginTop + Math.floor(maxRow * percent);
				} else row = this.resolveAnchorRow("center", effectiveHeight, availHeight, marginTop);
			} else row = opt.row;
		} else {
			const anchor = opt.anchor ?? "center";
			row = this.resolveAnchorRow(anchor, effectiveHeight, availHeight, marginTop);
		}
		if (opt.col !== void 0) {
			if (typeof opt.col === "string") {
				const match = opt.col.match(/^(\d+(?:\.\d+)?)%$/);
				if (match) {
					const maxCol = Math.max(0, availWidth - width);
					const percent = parseFloat(match[1]) / 100;
					col = marginLeft + Math.floor(maxCol * percent);
				} else col = this.resolveAnchorCol("center", width, availWidth, marginLeft);
			} else col = opt.col;
		} else {
			const anchor = opt.anchor ?? "center";
			col = this.resolveAnchorCol(anchor, width, availWidth, marginLeft);
		}
		if (opt.offsetY !== void 0) row += opt.offsetY;
		if (opt.offsetX !== void 0) col += opt.offsetX;
		row = Math.max(marginTop, Math.min(row, termHeight - marginBottom - effectiveHeight));
		col = Math.max(marginLeft, Math.min(col, termWidth - marginRight - width));
		return {
			width,
			row,
			col,
			maxHeight
		};
	}
	resolveAnchorRow(anchor, height, availHeight, marginTop) {
		switch (anchor) {
			case "top-left":
			case "top-center":
			case "top-right": return marginTop;
			case "bottom-left":
			case "bottom-center":
			case "bottom-right": return marginTop + availHeight - height;
			case "left-center":
			case "center":
			case "right-center": return marginTop + Math.floor((availHeight - height) / 2);
		}
	}
	resolveAnchorCol(anchor, width, availWidth, marginLeft) {
		switch (anchor) {
			case "top-left":
			case "left-center":
			case "bottom-left": return marginLeft;
			case "top-right":
			case "right-center":
			case "bottom-right": return marginLeft + availWidth - width;
			case "top-center":
			case "center":
			case "bottom-center": return marginLeft + Math.floor((availWidth - width) / 2);
		}
	}
	/** Composite all overlays into content lines (sorted by focusOrder, higher = on top). */
	compositeOverlays(lines, termWidth, termHeight) {
		if (this.overlayStack.length === 0) return lines;
		const result = [...lines];
		const rendered = [];
		let minLinesNeeded = result.length;
		const visibleEntries = this.overlayStack.filter((e) => this.isOverlayVisible(e));
		visibleEntries.sort((a, b) => a.focusOrder - b.focusOrder);
		for (const entry of visibleEntries) {
			const { component, options } = entry;
			const { width, maxHeight } = this.resolveOverlayLayout(options, 0, termWidth, termHeight);
			let overlayLines = component.render(width);
			if (maxHeight !== void 0 && overlayLines.length > maxHeight) overlayLines = overlayLines.slice(0, maxHeight);
			const { row, col } = this.resolveOverlayLayout(options, overlayLines.length, termWidth, termHeight);
			rendered.push({
				overlayLines,
				row,
				col,
				w: width
			});
			minLinesNeeded = Math.max(minLinesNeeded, row + overlayLines.length);
		}
		const workingHeight = Math.max(result.length, termHeight, minLinesNeeded);
		while (result.length < workingHeight) result.push("");
		const viewportStart = Math.max(0, workingHeight - termHeight);
		for (const { overlayLines, row, col, w } of rendered) for (let i = 0; i < overlayLines.length; i++) {
			const idx = viewportStart + row + i;
			if (idx >= 0 && idx < result.length) {
				const truncatedOverlayLine = visibleWidth(overlayLines[i]) > w ? sliceByColumn(overlayLines[i], 0, w, true) : overlayLines[i];
				result[idx] = this.compositeLineAt(result[idx], truncatedOverlayLine, col, w, termWidth);
			}
		}
		return result;
	}
	static SEGMENT_RESET = "\x1B[0m\x1B]8;;\x07";
	applyLineResets(lines) {
		const reset = TUI.SEGMENT_RESET;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!isImageLine(line)) lines[i] = normalizeTerminalOutput(line) + reset;
		}
		return lines;
	}
	collectKittyImageIds(lines) {
		const ids = /* @__PURE__ */ new Set();
		for (const line of lines) for (const id of extractKittyImageIds(line)) ids.add(id);
		return ids;
	}
	deleteKittyImages(ids) {
		let buffer = "";
		for (const id of ids) buffer += deleteKittyImage(id);
		return buffer;
	}
	getKittyImageReservedRows(lines, index, maxIndex = lines.length - 1) {
		const rows = extractKittyImageRows(lines[index] ?? "");
		if (rows <= 1) return 1;
		const maxRows = Math.min(rows, maxIndex - index + 1, lines.length - index);
		let reservedRows = 1;
		while (reservedRows < maxRows) {
			const line = lines[index + reservedRows] ?? "";
			if (isImageLine(line) || visibleWidth(line) > 0) break;
			reservedRows++;
		}
		return reservedRows;
	}
	expandChangedRangeForKittyImages(firstChanged, lastChanged, newLines) {
		let expandedFirstChanged = firstChanged;
		let expandedLastChanged = lastChanged;
		const expandForLines = (lines) => {
			for (let i = 0; i < lines.length; i++) {
				if (extractKittyImageIds(lines[i]).length === 0) continue;
				const blockEnd = i + this.getKittyImageReservedRows(lines, i) - 1;
				if (i >= firstChanged || i <= lastChanged && blockEnd >= firstChanged) {
					expandedFirstChanged = Math.min(expandedFirstChanged, i);
					expandedLastChanged = Math.max(expandedLastChanged, blockEnd);
				}
			}
		};
		expandForLines(this.previousLines);
		expandForLines(newLines);
		return {
			firstChanged: expandedFirstChanged,
			lastChanged: expandedLastChanged
		};
	}
	deleteChangedKittyImages(firstChanged, lastChanged) {
		if (firstChanged < 0 || lastChanged < firstChanged) return "";
		const ids = /* @__PURE__ */ new Set();
		const maxLine = Math.min(lastChanged, this.previousLines.length - 1);
		for (let i = firstChanged; i <= maxLine; i++) for (const id of extractKittyImageIds(this.previousLines[i] ?? "")) ids.add(id);
		return this.deleteKittyImages(ids);
	}
	/** Splice overlay content into a base line at a specific column. Single-pass optimized. */
	compositeLineAt(baseLine, overlayLine, startCol, overlayWidth, totalWidth) {
		if (isImageLine(baseLine)) return baseLine;
		const afterStart = startCol + overlayWidth;
		const base = extractSegments(baseLine, startCol, afterStart, totalWidth - afterStart, true);
		const overlay = sliceWithWidth(overlayLine, 0, overlayWidth, true);
		const beforePad = Math.max(0, startCol - base.beforeWidth);
		const overlayPad = Math.max(0, overlayWidth - overlay.width);
		const actualBeforeWidth = Math.max(startCol, base.beforeWidth);
		const actualOverlayWidth = Math.max(overlayWidth, overlay.width);
		const afterTarget = Math.max(0, totalWidth - actualBeforeWidth - actualOverlayWidth);
		const afterPad = Math.max(0, afterTarget - base.afterWidth);
		const r = TUI.SEGMENT_RESET;
		const result = base.before + " ".repeat(beforePad) + r + overlay.text + " ".repeat(overlayPad) + r + base.after + " ".repeat(afterPad);
		if (visibleWidth(result) <= totalWidth) return result;
		return sliceByColumn(result, 0, totalWidth, true);
	}
	/**
	* Find and extract cursor position from rendered lines.
	* Searches for CURSOR_MARKER, calculates its position, and strips it from the output.
	* Only scans the bottom terminal height lines (visible viewport).
	* @param lines - Rendered lines to search
	* @param height - Terminal height (visible viewport size)
	* @returns Cursor position { row, col } or null if no marker found
	*/
	extractCursorPosition(lines, height) {
		const viewportTop = Math.max(0, lines.length - height);
		for (let row = lines.length - 1; row >= viewportTop; row--) {
			const line = lines[row];
			const markerIndex = line.indexOf(CURSOR_MARKER);
			if (markerIndex !== -1) {
				const beforeMarker = line.slice(0, markerIndex);
				const col = visibleWidth(beforeMarker);
				lines[row] = line.slice(0, markerIndex) + line.slice(markerIndex + 7);
				return {
					row,
					col
				};
			}
		}
		return null;
	}
	doRender() {
		if (this.stopped) return;
		const width = this.terminal.columns;
		const height = this.terminal.rows;
		const widthChanged = this.previousWidth !== 0 && this.previousWidth !== width;
		const heightChanged = this.previousHeight !== 0 && this.previousHeight !== height;
		const previousBufferLength = this.previousHeight > 0 ? this.previousViewportTop + this.previousHeight : height;
		let prevViewportTop = heightChanged ? Math.max(0, previousBufferLength - height) : this.previousViewportTop;
		let viewportTop = prevViewportTop;
		let hardwareCursorRow = this.hardwareCursorRow;
		const computeLineDiff = (targetRow) => {
			const currentScreenRow = hardwareCursorRow - prevViewportTop;
			return targetRow - viewportTop - currentScreenRow;
		};
		let newLines = this.render(width);
		if (this.overlayStack.length > 0) newLines = this.compositeOverlays(newLines, width, height);
		const cursorPos = this.extractCursorPosition(newLines, height);
		newLines = this.applyLineResets(newLines);
		const fullRender = (clear) => {
			this.fullRedrawCount += 1;
			let buffer = "\x1B[?2026h";
			if (clear) {
				buffer += this.deleteKittyImages(this.previousKittyImageIds);
				buffer += "\x1B[2J\x1B[H\x1B[3J";
			}
			for (let i = 0; i < newLines.length; i++) {
				if (i > 0) buffer += "\r\n";
				const line = newLines[i];
				const imageReservedRows = isImageLine(line) ? this.getKittyImageReservedRows(newLines, i) : 1;
				if (imageReservedRows > 1 && imageReservedRows <= height) {
					for (let row = 1; row < imageReservedRows; row++) buffer += "\r\n";
					buffer += `\x1b[${imageReservedRows - 1}A`;
					buffer += line;
					buffer += `\x1b[${imageReservedRows - 1}B`;
					i += imageReservedRows - 1;
					continue;
				}
				buffer += line;
			}
			buffer += "\x1B[?2026l";
			this.terminal.write(buffer);
			this.cursorRow = Math.max(0, newLines.length - 1);
			this.hardwareCursorRow = this.cursorRow;
			if (clear) this.maxLinesRendered = newLines.length;
			else this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
			const bufferLength = Math.max(height, newLines.length);
			this.previousViewportTop = Math.max(0, bufferLength - height);
			this.positionHardwareCursor(cursorPos, newLines.length);
			this.previousLines = newLines;
			this.previousKittyImageIds = this.collectKittyImageIds(newLines);
			this.previousWidth = width;
			this.previousHeight = height;
		};
		const debugRedraw = process.env.PI_DEBUG_REDRAW === "1";
		const logRedraw = (reason) => {
			if (!debugRedraw) return;
			const logPath = path$1.join(os.homedir(), ".pi", "agent", "pi-debug.log");
			const msg = `[${(/* @__PURE__ */ new Date()).toISOString()}] fullRender: ${reason} (prev=${this.previousLines.length}, new=${newLines.length}, height=${height})\n`;
			fs$1.appendFileSync(logPath, msg);
		};
		if (this.previousLines.length === 0 && !widthChanged && !heightChanged) {
			logRedraw("first render");
			fullRender(false);
			return;
		}
		if (widthChanged) {
			logRedraw(`terminal width changed (${this.previousWidth} -> ${width})`);
			fullRender(true);
			return;
		}
		if (heightChanged && !isTermuxSession()) {
			logRedraw(`terminal height changed (${this.previousHeight} -> ${height})`);
			fullRender(true);
			return;
		}
		if (this.clearOnShrink && newLines.length < this.maxLinesRendered && this.overlayStack.length === 0) {
			logRedraw(`clearOnShrink (maxLinesRendered=${this.maxLinesRendered})`);
			fullRender(true);
			return;
		}
		let firstChanged = -1;
		let lastChanged = -1;
		const maxLines = Math.max(newLines.length, this.previousLines.length);
		for (let i = 0; i < maxLines; i++) if ((i < this.previousLines.length ? this.previousLines[i] : "") !== (i < newLines.length ? newLines[i] : "")) {
			if (firstChanged === -1) firstChanged = i;
			lastChanged = i;
		}
		const appendedLines = newLines.length > this.previousLines.length;
		if (appendedLines) {
			if (firstChanged === -1) firstChanged = this.previousLines.length;
			lastChanged = newLines.length - 1;
		}
		if (firstChanged !== -1) {
			const expandedRange = this.expandChangedRangeForKittyImages(firstChanged, lastChanged, newLines);
			firstChanged = expandedRange.firstChanged;
			lastChanged = expandedRange.lastChanged;
		}
		const appendStart = appendedLines && firstChanged === this.previousLines.length && firstChanged > 0;
		if (firstChanged === -1) {
			this.positionHardwareCursor(cursorPos, newLines.length);
			this.previousViewportTop = prevViewportTop;
			this.previousHeight = height;
			return;
		}
		if (firstChanged >= newLines.length) {
			if (this.previousLines.length > newLines.length) {
				let buffer = "\x1B[?2026h";
				buffer += this.deleteChangedKittyImages(firstChanged, lastChanged);
				const targetRow = Math.max(0, newLines.length - 1);
				if (targetRow < prevViewportTop) {
					logRedraw(`deleted lines moved viewport up (${targetRow} < ${prevViewportTop})`);
					fullRender(true);
					return;
				}
				const lineDiff = computeLineDiff(targetRow);
				if (lineDiff > 0) buffer += `\x1b[${lineDiff}B`;
				else if (lineDiff < 0) buffer += `\x1b[${-lineDiff}A`;
				buffer += "\r";
				const extraLines = this.previousLines.length - newLines.length;
				if (extraLines > height) {
					logRedraw(`extraLines > height (${extraLines} > ${height})`);
					fullRender(true);
					return;
				}
				const clearStartOffset = newLines.length === 0 ? 0 : 1;
				if (extraLines > 0 && clearStartOffset > 0) buffer += `\x1b[${clearStartOffset}B`;
				for (let i = 0; i < extraLines; i++) {
					buffer += "\r\x1B[2K";
					if (i < extraLines - 1) buffer += "\x1B[1B";
				}
				const moveBack = Math.max(0, extraLines - 1 + clearStartOffset);
				if (moveBack > 0) buffer += `\x1b[${moveBack}A`;
				buffer += "\x1B[?2026l";
				this.terminal.write(buffer);
				this.cursorRow = targetRow;
				this.hardwareCursorRow = targetRow;
			}
			this.positionHardwareCursor(cursorPos, newLines.length);
			this.previousLines = newLines;
			this.previousKittyImageIds = this.collectKittyImageIds(newLines);
			this.previousWidth = width;
			this.previousHeight = height;
			this.previousViewportTop = prevViewportTop;
			return;
		}
		if (firstChanged < prevViewportTop) {
			logRedraw(`firstChanged < viewportTop (${firstChanged} < ${prevViewportTop})`);
			fullRender(true);
			return;
		}
		let buffer = "\x1B[?2026h";
		buffer += this.deleteChangedKittyImages(firstChanged, lastChanged);
		const prevViewportBottom = prevViewportTop + height - 1;
		const moveTargetRow = appendStart ? firstChanged - 1 : firstChanged;
		if (moveTargetRow > prevViewportBottom) {
			const currentScreenRow = Math.max(0, Math.min(height - 1, hardwareCursorRow - prevViewportTop));
			const moveToBottom = height - 1 - currentScreenRow;
			if (moveToBottom > 0) buffer += `\x1b[${moveToBottom}B`;
			const scroll = moveTargetRow - prevViewportBottom;
			buffer += "\r\n".repeat(scroll);
			prevViewportTop += scroll;
			viewportTop += scroll;
			hardwareCursorRow = moveTargetRow;
		}
		const lineDiff = computeLineDiff(moveTargetRow);
		if (lineDiff > 0) buffer += `\x1b[${lineDiff}B`;
		else if (lineDiff < 0) buffer += `\x1b[${-lineDiff}A`;
		buffer += appendStart ? "\r\n" : "\r";
		const renderEnd = Math.min(lastChanged, newLines.length - 1);
		for (let i = firstChanged; i <= renderEnd; i++) {
			if (i > firstChanged) buffer += "\r\n";
			const line = newLines[i];
			const isImage = isImageLine(line);
			const imageReservedRows = isImage ? this.getKittyImageReservedRows(newLines, i, renderEnd) : 1;
			if (imageReservedRows > 1) {
				const imageStartScreenRow = i - viewportTop;
				if (imageStartScreenRow < 0 || imageStartScreenRow + imageReservedRows > height) {
					logRedraw(`kitty image pre-clear would scroll (${imageStartScreenRow} + ${imageReservedRows} > ${height})`);
					fullRender(true);
					return;
				}
				buffer += "\x1B[2K";
				for (let row = 1; row < imageReservedRows; row++) buffer += "\r\n\x1B[2K";
				buffer += `\x1b[${imageReservedRows - 1}A`;
				buffer += line;
				buffer += `\x1b[${imageReservedRows - 1}B`;
				i += imageReservedRows - 1;
				continue;
			}
			buffer += "\x1B[2K";
			if (!isImage && visibleWidth(line) > width) {
				const crashLogPath = path$1.join(os.homedir(), ".pi", "agent", "pi-crash.log");
				const crashData = [
					`Crash at ${(/* @__PURE__ */ new Date()).toISOString()}`,
					`Terminal width: ${width}`,
					`Line ${i} visible width: ${visibleWidth(line)}`,
					"",
					"=== All rendered lines ===",
					...newLines.map((l, idx) => `[${idx}] (w=${visibleWidth(l)}) ${l}`),
					""
				].join("\n");
				fs$1.mkdirSync(path$1.dirname(crashLogPath), { recursive: true });
				fs$1.writeFileSync(crashLogPath, crashData);
				this.stop();
				const errorMsg = [
					`Rendered line ${i} exceeds terminal width (${visibleWidth(line)} > ${width}).`,
					"",
					"This is likely caused by a custom TUI component not truncating its output.",
					"Use visibleWidth() to measure and truncateToWidth() to truncate lines.",
					"",
					`Debug log written to: ${crashLogPath}`
				].join("\n");
				throw new Error(errorMsg);
			}
			buffer += line;
		}
		let finalCursorRow = renderEnd;
		if (this.previousLines.length > newLines.length) {
			if (renderEnd < newLines.length - 1) {
				const moveDown = newLines.length - 1 - renderEnd;
				buffer += `\x1b[${moveDown}B`;
				finalCursorRow = newLines.length - 1;
			}
			const extraLines = this.previousLines.length - newLines.length;
			for (let i = newLines.length; i < this.previousLines.length; i++) buffer += "\r\n\x1B[2K";
			buffer += `\x1b[${extraLines}A`;
		}
		buffer += "\x1B[?2026l";
		if (process.env.PI_TUI_DEBUG === "1") {
			const debugDir = "/tmp/tui";
			fs$1.mkdirSync(debugDir, { recursive: true });
			const debugPath = path$1.join(debugDir, `render-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
			const debugData = [
				`firstChanged: ${firstChanged}`,
				`viewportTop: ${viewportTop}`,
				`cursorRow: ${this.cursorRow}`,
				`height: ${height}`,
				`lineDiff: ${lineDiff}`,
				`hardwareCursorRow: ${hardwareCursorRow}`,
				`renderEnd: ${renderEnd}`,
				`finalCursorRow: ${finalCursorRow}`,
				`cursorPos: ${JSON.stringify(cursorPos)}`,
				`newLines.length: ${newLines.length}`,
				`previousLines.length: ${this.previousLines.length}`,
				"",
				"=== newLines ===",
				JSON.stringify(newLines, null, 2),
				"",
				"=== previousLines ===",
				JSON.stringify(this.previousLines, null, 2),
				"",
				"=== buffer ===",
				JSON.stringify(buffer)
			].join("\n");
			fs$1.writeFileSync(debugPath, debugData);
		}
		this.terminal.write(buffer);
		this.cursorRow = Math.max(0, newLines.length - 1);
		this.hardwareCursorRow = finalCursorRow;
		this.maxLinesRendered = Math.max(this.maxLinesRendered, newLines.length);
		this.previousViewportTop = Math.max(prevViewportTop, finalCursorRow - height + 1);
		this.positionHardwareCursor(cursorPos, newLines.length);
		this.previousLines = newLines;
		this.previousKittyImageIds = this.collectKittyImageIds(newLines);
		this.previousWidth = width;
		this.previousHeight = height;
	}
	/**
	* Position the hardware cursor for IME candidate window.
	* @param cursorPos The cursor position extracted from rendered output, or null
	* @param totalLines Total number of rendered lines
	*/
	positionHardwareCursor(cursorPos, totalLines) {
		if (!cursorPos || totalLines <= 0) {
			this.terminal.hideCursor();
			return;
		}
		const targetRow = Math.max(0, Math.min(cursorPos.row, totalLines - 1));
		const targetCol = Math.max(0, cursorPos.col);
		const rowDelta = targetRow - this.hardwareCursorRow;
		let buffer = "";
		if (rowDelta > 0) buffer += `\x1b[${rowDelta}B`;
		else if (rowDelta < 0) buffer += `\x1b[${-rowDelta}A`;
		buffer += `\x1b[${targetCol + 1}G`;
		if (buffer) this.terminal.write(buffer);
		this.hardwareCursorRow = targetRow;
		if (this.showHardwareCursor) this.terminal.showCursor();
		else this.terminal.hideCursor();
	}
	/**
	* Query the terminal's default background color with OSC 11 (`ESC ] 11 ; ? BEL`).
	* @param timeoutMs Query timeout in milliseconds.
	* @returns Promise containing the parsed RGB color, or undefined if it times out or fails to parse.
	*/
	queryTerminalBackgroundColor({ timeoutMs }) {
		return new Promise((resolve) => {
			const query = {
				settled: false,
				resolve,
				timer: void 0
			};
			query.timer = setTimeout(() => {
				if (query.settled) return;
				query.settled = true;
				query.timer = void 0;
				query.resolve?.(void 0);
				query.resolve = void 0;
			}, timeoutMs);
			this.pendingOsc11BackgroundQueries.push(query);
			this.pendingOsc11BackgroundReplies += 1;
			this.terminal.write("\x1B]11;?\x07");
		});
	}
	/**
	* Query the terminal's color-scheme preference with DSR (`CSI ? 996 n`).
	* Terminals that support the color palette notification protocol reply with
	* `CSI ? 997 ; 1 n` for dark or `CSI ? 997 ; 2 n` for light.
	*/
	queryTerminalColorScheme({ timeoutMs }) {
		return new Promise((resolve) => {
			let settled = false;
			let timer;
			let unsubscribe = () => {};
			const settle = (scheme) => {
				if (settled) return;
				settled = true;
				if (timer) {
					clearTimeout(timer);
					timer = void 0;
				}
				unsubscribe();
				resolve(scheme);
			};
			unsubscribe = this.onTerminalColorSchemeChange(settle);
			timer = setTimeout(() => settle(void 0), timeoutMs);
			this.terminal.write("\x1B[?996n");
		});
	}
};

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/undo-stack.js
/**
* Generic undo stack with clone-on-push semantics.
*
* Stores deep clones of state snapshots. Popped snapshots are returned
* directly (no re-cloning) since they are already detached.
*/
var UndoStack = class {
	stack = [];
	/** Push a deep clone of the given state onto the stack. */
	push(state) {
		this.stack.push(structuredClone(state));
	}
	/** Pop and return the most recent snapshot, or undefined if empty. */
	pop() {
		return this.stack.pop();
	}
	/** Remove all snapshots. */
	clear() {
		this.stack.length = 0;
	}
	get length() {
		return this.stack.length;
	}
};

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/word-navigation.js
const wordSegmenter$1 = getWordSegmenter();
/**
* Find the cursor position after moving one word backward from `cursor` in `text`.
* Skips trailing whitespace, then stops at the next word/punctuation boundary.
*
* Pure function - does not mutate any state.
*/
function findWordBackward(text, cursor, options) {
	if (cursor <= 0) return 0;
	const textBeforeCursor = text.slice(0, cursor);
	const segmentFn = options?.segment;
	const isAtomic = options?.isAtomicSegment;
	const segments = segmentFn ? [...segmentFn(textBeforeCursor)] : [...wordSegmenter$1.segment(textBeforeCursor)];
	let newCursor = cursor;
	while (segments.length > 0 && !isAtomic?.(segments[segments.length - 1]?.segment || "") && isWhitespaceChar(segments[segments.length - 1]?.segment || "")) newCursor -= segments.pop()?.segment.length || 0;
	if (segments.length === 0) return newCursor;
	const last = segments[segments.length - 1];
	if (isAtomic?.(last.segment)) newCursor -= last.segment.length;
	else if (last.isWordLike) {
		const segment = last.segment;
		const matches = [...segment.matchAll(new RegExp(PUNCTUATION_REGEX, "g"))];
		if (matches.length <= 0) newCursor -= segment.length;
		else {
			const lastMatch = matches[matches.length - 1];
			newCursor -= segment.length - (lastMatch.index + lastMatch[0].length);
		}
	} else while (segments.length > 0 && !isAtomic?.(segments[segments.length - 1]?.segment || "") && !segments[segments.length - 1]?.isWordLike && !isWhitespaceChar(segments[segments.length - 1]?.segment || "")) newCursor -= segments.pop()?.segment.length || 0;
	return newCursor;
}
/**
* Find the cursor position after moving one word forward from `cursor` in `text`.
* Skips leading whitespace, then stops at the next word/punctuation boundary.
*
* Pure function - does not mutate any state.
*/
function findWordForward(text, cursor, options) {
	if (cursor >= text.length) return text.length;
	const textAfterCursor = text.slice(cursor);
	const segmentFn = options?.segment;
	const isAtomic = options?.isAtomicSegment;
	const iterator = (segmentFn ? segmentFn(textAfterCursor) : wordSegmenter$1.segment(textAfterCursor))[Symbol.iterator]();
	let next = iterator.next();
	let newCursor = cursor;
	while (!next.done && !isAtomic?.(next.value.segment) && isWhitespaceChar(next.value.segment)) {
		newCursor += next.value.segment.length;
		next = iterator.next();
	}
	if (next.done) return newCursor;
	if (isAtomic?.(next.value.segment)) newCursor += next.value.segment.length;
	else if (next.value.isWordLike) newCursor += PUNCTUATION_REGEX.exec(next.value.segment)?.index ?? next.value.segment.length;
	else while (!next.done && !isAtomic?.(next.value.segment) && !next.value.isWordLike && !isWhitespaceChar(next.value.segment)) {
		newCursor += next.value.segment.length;
		next = iterator.next();
	}
	return newCursor;
}

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/components/select-list.js
const DEFAULT_PRIMARY_COLUMN_WIDTH = 32;
const PRIMARY_COLUMN_GAP = 2;
const MIN_DESCRIPTION_WIDTH = 10;
const normalizeToSingleLine = (text) => text.replace(/[\r\n]+/g, " ").trim();
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
var SelectList = class {
	items = [];
	filteredItems = [];
	selectedIndex = 0;
	maxVisible = 5;
	theme;
	layout;
	onSelect;
	onCancel;
	onSelectionChange;
	constructor(items, maxVisible, theme, layout = {}) {
		this.items = items;
		this.filteredItems = items;
		this.maxVisible = maxVisible;
		this.theme = theme;
		this.layout = layout;
	}
	setFilter(filter) {
		this.filteredItems = this.items.filter((item) => item.value.toLowerCase().startsWith(filter.toLowerCase()));
		this.selectedIndex = 0;
	}
	setSelectedIndex(index) {
		this.selectedIndex = Math.max(0, Math.min(index, this.filteredItems.length - 1));
	}
	invalidate() {}
	render(width) {
		const lines = [];
		if (this.filteredItems.length === 0) {
			lines.push(this.theme.noMatch("  No matching commands"));
			return lines;
		}
		const primaryColumnWidth = this.getPrimaryColumnWidth();
		const startIndex = Math.max(0, Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible));
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);
		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredItems[i];
			if (!item) continue;
			const isSelected = i === this.selectedIndex;
			const descriptionSingleLine = item.description ? normalizeToSingleLine(item.description) : void 0;
			lines.push(this.renderItem(item, isSelected, width, descriptionSingleLine, primaryColumnWidth));
		}
		if (startIndex > 0 || endIndex < this.filteredItems.length) {
			const scrollText = `  (${this.selectedIndex + 1}/${this.filteredItems.length})`;
			lines.push(this.theme.scrollInfo(truncateToWidth(scrollText, width - 2, "")));
		}
		return lines;
	}
	handleInput(keyData) {
		const kb = getKeybindings();
		if (kb.matches(keyData, "tui.select.up")) {
			this.selectedIndex = this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1;
			this.notifySelectionChange();
		} else if (kb.matches(keyData, "tui.select.down")) {
			this.selectedIndex = this.selectedIndex === this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1;
			this.notifySelectionChange();
		} else if (kb.matches(keyData, "tui.select.confirm")) {
			const selectedItem = this.filteredItems[this.selectedIndex];
			if (selectedItem && this.onSelect) this.onSelect(selectedItem);
		} else if (kb.matches(keyData, "tui.select.cancel")) {
			if (this.onCancel) this.onCancel();
		}
	}
	renderItem(item, isSelected, width, descriptionSingleLine, primaryColumnWidth) {
		const prefix = isSelected ? "→ " : "  ";
		const prefixWidth = visibleWidth(prefix);
		if (descriptionSingleLine && width > 40) {
			const effectivePrimaryColumnWidth = Math.max(1, Math.min(primaryColumnWidth, width - prefixWidth - 4));
			const maxPrimaryWidth = Math.max(1, effectivePrimaryColumnWidth - PRIMARY_COLUMN_GAP);
			const truncatedValue = this.truncatePrimary(item, isSelected, maxPrimaryWidth, effectivePrimaryColumnWidth);
			const truncatedValueWidth = visibleWidth(truncatedValue);
			const spacing = " ".repeat(Math.max(1, effectivePrimaryColumnWidth - truncatedValueWidth));
			const remainingWidth = width - (prefixWidth + truncatedValueWidth + spacing.length) - 2;
			if (remainingWidth > MIN_DESCRIPTION_WIDTH) {
				const truncatedDesc = truncateToWidth(descriptionSingleLine, remainingWidth, "");
				if (isSelected) return this.theme.selectedText(`${prefix}${truncatedValue}${spacing}${truncatedDesc}`);
				const descText = this.theme.description(spacing + truncatedDesc);
				return prefix + truncatedValue + descText;
			}
		}
		const maxWidth = width - prefixWidth - 2;
		const truncatedValue = this.truncatePrimary(item, isSelected, maxWidth, maxWidth);
		if (isSelected) return this.theme.selectedText(`${prefix}${truncatedValue}`);
		return prefix + truncatedValue;
	}
	getPrimaryColumnWidth() {
		const { min, max } = this.getPrimaryColumnBounds();
		const widestPrimary = this.filteredItems.reduce((widest, item) => {
			return Math.max(widest, visibleWidth(this.getDisplayValue(item)) + PRIMARY_COLUMN_GAP);
		}, 0);
		return clamp(widestPrimary, min, max);
	}
	getPrimaryColumnBounds() {
		const rawMin = this.layout.minPrimaryColumnWidth ?? this.layout.maxPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH;
		const rawMax = this.layout.maxPrimaryColumnWidth ?? this.layout.minPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH;
		return {
			min: Math.max(1, Math.min(rawMin, rawMax)),
			max: Math.max(1, Math.max(rawMin, rawMax))
		};
	}
	truncatePrimary(item, isSelected, maxWidth, columnWidth) {
		const displayValue = this.getDisplayValue(item);
		const truncatedValue = this.layout.truncatePrimary ? this.layout.truncatePrimary({
			text: displayValue,
			maxWidth,
			columnWidth,
			item,
			isSelected
		}) : truncateToWidth(displayValue, maxWidth, "");
		return truncateToWidth(truncatedValue, maxWidth, "");
	}
	getDisplayValue(item) {
		return item.label || item.value;
	}
	notifySelectionChange() {
		const selectedItem = this.filteredItems[this.selectedIndex];
		if (selectedItem && this.onSelectionChange) this.onSelectionChange(selectedItem);
	}
	getSelectedItem() {
		return this.filteredItems[this.selectedIndex] || null;
	}
};

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/components/editor.js
const graphemeSegmenter = getGraphemeSegmenter();
const wordSegmenter = getWordSegmenter();
/** Regex matching paste markers like `[paste #1 +123 lines]` or `[paste #2 1234 chars]`. */
const PASTE_MARKER_REGEX = /\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]/g;
/** Non-global version for single-segment testing. */
const PASTE_MARKER_SINGLE = /^\[paste #(\d+)( (\+\d+ lines|\d+ chars))?\]$/;
/** Check if a segment is a paste marker (i.e. was merged by segmentWithMarkers). */
function isPasteMarker(segment) {
	return segment.length >= 10 && PASTE_MARKER_SINGLE.test(segment);
}
/**
* A segmenter that wraps Intl.Segmenter and merges graphemes that fall
* within paste markers into single atomic segments.  This makes cursor
* movement, deletion, word-wrap, etc. treat paste markers as single units.
*
* Only markers whose numeric ID exists in `validIds` are merged.
*/
function segmentWithMarkers(text, baseSegmenter, validIds) {
	if (validIds.size === 0 || !text.includes("[paste #")) return baseSegmenter.segment(text);
	const markers = [];
	for (const m of text.matchAll(PASTE_MARKER_REGEX)) {
		const id = Number.parseInt(m[1], 10);
		if (!validIds.has(id)) continue;
		markers.push({
			start: m.index,
			end: m.index + m[0].length
		});
	}
	if (markers.length === 0) return baseSegmenter.segment(text);
	const baseSegments = baseSegmenter.segment(text);
	const result = [];
	let markerIdx = 0;
	for (const seg of baseSegments) {
		while (markerIdx < markers.length && markers[markerIdx].end <= seg.index) markerIdx++;
		const marker = markerIdx < markers.length ? markers[markerIdx] : null;
		if (marker && seg.index >= marker.start && seg.index < marker.end) {
			if (seg.index === marker.start) {
				const markerText = text.slice(marker.start, marker.end);
				result.push({
					segment: markerText,
					index: marker.start,
					input: text
				});
			}
		} else result.push(seg);
	}
	return result;
}
/**
* Split a line into word-wrapped chunks.
* Wraps at word boundaries when possible, falling back to character-level
* wrapping for words longer than the available width.
*
* @param line - The text line to wrap
* @param maxWidth - Maximum visible width per chunk
* @param preSegmented - Optional pre-segmented graphemes (e.g. with paste-marker awareness).
*                       When omitted the default Intl.Segmenter is used.
* @returns Array of chunks with text and position information
*/
function wordWrapLine(line, maxWidth, preSegmented, continuationWidth = maxWidth) {
	if (!line || maxWidth <= 0) return [{
		text: "",
		startIndex: 0,
		endIndex: 0
	}];
	if (visibleWidth(line) <= maxWidth) return [{
		text: line,
		startIndex: 0,
		endIndex: line.length
	}];
	const chunks = [];
	const segments = preSegmented ?? [...graphemeSegmenter.segment(line)];
	let currentWidth = 0;
	let currentMaxWidth = maxWidth;
	let chunkStart = 0;
	let wrapOppIndex = -1;
	let wrapOppWidth = 0;
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		const grapheme = seg.segment;
		const gWidth = visibleWidth(grapheme);
		const charIndex = seg.index;
		const isWs = !isPasteMarker(grapheme) && isWhitespaceChar(grapheme);
		if (currentWidth + gWidth > currentMaxWidth) {
			if (wrapOppIndex >= 0 && currentWidth - wrapOppWidth + gWidth <= continuationWidth) {
				chunks.push({
					text: line.slice(chunkStart, wrapOppIndex),
					startIndex: chunkStart,
					endIndex: wrapOppIndex
				});
				currentMaxWidth = continuationWidth;
				chunkStart = wrapOppIndex;
				currentWidth -= wrapOppWidth;
			} else if (chunkStart < charIndex) {
				chunks.push({
					text: line.slice(chunkStart, charIndex),
					startIndex: chunkStart,
					endIndex: charIndex
				});
				currentMaxWidth = continuationWidth;
				chunkStart = charIndex;
				currentWidth = 0;
			}
			wrapOppIndex = -1;
		}
		if (gWidth > currentMaxWidth) {
			if (segments.length === 1) {
				chunks.push({
					text: grapheme,
					startIndex: charIndex,
					endIndex: charIndex + grapheme.length
				});
				return chunks;
			}
			const subChunks = wordWrapLine(grapheme, currentMaxWidth, void 0, continuationWidth);
			for (let j = 0; j < subChunks.length - 1; j++) {
				const sc = subChunks[j];
				chunks.push({
					text: sc.text,
					startIndex: charIndex + sc.startIndex,
					endIndex: charIndex + sc.endIndex
				});
			}
			const last = subChunks[subChunks.length - 1];
			if (subChunks.length > 1) currentMaxWidth = continuationWidth;
			chunkStart = charIndex + last.startIndex;
			currentWidth = visibleWidth(last.text);
			wrapOppIndex = -1;
			continue;
		}
		currentWidth += gWidth;
		const next = segments[i + 1];
		if (isWs && next && (isPasteMarker(next.segment) || !isWhitespaceChar(next.segment))) {
			wrapOppIndex = next.index;
			wrapOppWidth = currentWidth;
		} else if (!isWs && next && !isWhitespaceChar(next.segment)) {
			const isCjk = !isPasteMarker(grapheme) && cjkBreakRegex.test(grapheme);
			const nextIsCjk = !isPasteMarker(next.segment) && cjkBreakRegex.test(next.segment);
			if (isCjk || nextIsCjk) {
				wrapOppIndex = next.index;
				wrapOppWidth = currentWidth;
			}
		}
	}
	chunks.push({
		text: line.slice(chunkStart),
		startIndex: chunkStart,
		endIndex: line.length
	});
	return chunks;
}
const SLASH_COMMAND_SELECT_LIST_LAYOUT = {
	minPrimaryColumnWidth: 12,
	maxPrimaryColumnWidth: 32
};
const ATTACHMENT_AUTOCOMPLETE_DEBOUNCE_MS = 20;
const DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS = ["@", "#"];
function escapeCharacterClass(value) {
	return value.replace(/[\\^$.*+?()[\]{}|-]/g, "\\$&");
}
function buildTriggerPattern(triggerCharacters) {
	return new RegExp(`(?:^|[\\s])[${triggerCharacters.map(escapeCharacterClass).join("")}][^\\s]*$`);
}
function buildDebouncePattern(triggerCharacters) {
	const escapedWithoutAt = triggerCharacters.filter((character) => character !== "@").map(escapeCharacterClass);
	return new RegExp(`(?:^|[ \\t])(?:@(?:"[^"]*|[^\\s]*)|[${escapedWithoutAt.join("")}][^\\s]*)$`);
}
var Editor = class {
	state = {
		lines: [""],
		cursorLine: 0,
		cursorCol: 0
	};
	/** Focusable interface - set by TUI when focus changes */
	focused = false;
	tui;
	theme;
	paddingX = 0;
	frame = "horizontal";
	prompt;
	promptWidth = 0;
	lastWidth = 80;
	lastContinuationWidth = 80;
	scrollOffset = 0;
	borderColor;
	autocompleteProvider;
	autocompleteTriggerCharacters = [...DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS];
	autocompleteTriggerPattern = buildTriggerPattern(this.autocompleteTriggerCharacters);
	autocompleteDebouncePattern = buildDebouncePattern(this.autocompleteTriggerCharacters);
	autocompleteList;
	autocompleteState = null;
	autocompletePrefix = "";
	autocompleteMaxVisible = 5;
	autocompleteAbort;
	autocompleteDebounceTimer;
	autocompleteRequestTask = Promise.resolve();
	autocompleteStartToken = 0;
	autocompleteRequestId = 0;
	pastes = /* @__PURE__ */ new Map();
	pasteCounter = 0;
	pasteBuffer = "";
	isInPaste = false;
	history = [];
	historyIndex = -1;
	historyDraft = null;
	killRing = new KillRing();
	lastAction = null;
	jumpMode = null;
	preferredVisualCol = null;
	snappedFromCursorCol = null;
	undoStack = new UndoStack();
	onSubmit;
	onChange;
	disableSubmit = false;
	constructor(tui, theme, options = {}) {
		this.tui = tui;
		this.theme = theme;
		this.borderColor = theme.borderColor;
		const paddingX = options.paddingX ?? 0;
		this.paddingX = Number.isFinite(paddingX) ? Math.max(0, Math.floor(paddingX)) : 0;
		this.frame = options.frame ?? "horizontal";
		this.prompt = options.prompt;
		if (this.prompt) {
			const firstWidth = visibleWidth(this.prompt.first);
			if (firstWidth !== visibleWidth(this.prompt.continuation)) throw new Error("Editor prompt prefixes must have equal visible widths");
			this.promptWidth = firstWidth;
		}
		const maxVisible = options.autocompleteMaxVisible ?? 5;
		this.autocompleteMaxVisible = Number.isFinite(maxVisible) ? Math.max(3, Math.min(20, Math.floor(maxVisible))) : 5;
	}
	setPrompt(prompt) {
		const firstWidth = visibleWidth(prompt.first);
		if (firstWidth !== visibleWidth(prompt.continuation)) throw new Error("Editor prompt prefixes must have equal visible widths");
		this.prompt = prompt;
		this.promptWidth = firstWidth;
		this.invalidate();
	}
	/** Set of currently valid paste IDs, for marker-aware segmentation. */
	validPasteIds() {
		return new Set(this.pastes.keys());
	}
	/** Segment text with paste-marker awareness, only merging markers with valid IDs. */
	segment(text, mode) {
		return segmentWithMarkers(text, mode === "word" ? wordSegmenter : graphemeSegmenter, this.validPasteIds());
	}
	getPaddingX() {
		return this.paddingX;
	}
	setPaddingX(padding) {
		const newPadding = Number.isFinite(padding) ? Math.max(0, Math.floor(padding)) : 0;
		if (this.paddingX !== newPadding) {
			this.paddingX = newPadding;
			this.tui.requestRender();
		}
	}
	getAutocompleteMaxVisible() {
		return this.autocompleteMaxVisible;
	}
	setAutocompleteMaxVisible(maxVisible) {
		const newMaxVisible = Number.isFinite(maxVisible) ? Math.max(3, Math.min(20, Math.floor(maxVisible))) : 5;
		if (this.autocompleteMaxVisible !== newMaxVisible) {
			this.autocompleteMaxVisible = newMaxVisible;
			this.tui.requestRender();
		}
	}
	setAutocompleteProvider(provider) {
		this.cancelAutocomplete();
		this.autocompleteProvider = provider;
		this.setAutocompleteTriggerCharacters(provider.triggerCharacters ?? []);
	}
	/**
	* Add a prompt to history for up/down arrow navigation.
	* Called after successful submission.
	*/
	addToHistory(text) {
		const trimmed = text.trim();
		if (!trimmed) return;
		if (this.history.length > 0 && this.history[0] === trimmed) return;
		this.history.unshift(trimmed);
		if (this.history.length > 100) this.history.pop();
	}
	isEditorEmpty() {
		return this.state.lines.length === 1 && this.state.lines[0] === "";
	}
	isOnFirstVisualLine() {
		const visualLines = this.buildVisualLineMap(this.lastWidth);
		return this.findCurrentVisualLine(visualLines) === 0;
	}
	isOnLastVisualLine() {
		const visualLines = this.buildVisualLineMap(this.lastWidth);
		return this.findCurrentVisualLine(visualLines) === visualLines.length - 1;
	}
	navigateHistory(direction) {
		this.lastAction = null;
		if (this.history.length === 0) return;
		const newIndex = this.historyIndex - direction;
		if (newIndex < -1 || newIndex >= this.history.length) return;
		if (this.historyIndex === -1 && newIndex >= 0) {
			this.pushUndoSnapshot();
			this.historyDraft = structuredClone(this.state);
		}
		this.historyIndex = newIndex;
		if (this.historyIndex === -1) {
			const draft = this.historyDraft;
			this.historyDraft = null;
			if (draft) {
				this.state = draft;
				this.preferredVisualCol = null;
				this.snappedFromCursorCol = null;
				this.scrollOffset = 0;
				if (this.onChange) this.onChange(this.getText());
			} else this.setTextInternal("");
		} else this.setTextInternal(this.history[this.historyIndex] || "", direction === -1 ? "start" : "end");
	}
	exitHistoryBrowsing() {
		this.historyIndex = -1;
		this.historyDraft = null;
	}
	/** Internal setText that doesn't reset history state - used by navigateHistory */
	setTextInternal(text, cursorPlacement = "end") {
		const lines = text.split("\n");
		this.state.lines = lines.length === 0 ? [""] : lines;
		this.state.cursorLine = cursorPlacement === "start" ? 0 : this.state.lines.length - 1;
		this.setCursorCol(cursorPlacement === "start" ? 0 : this.state.lines[this.state.cursorLine]?.length || 0);
		this.scrollOffset = 0;
		if (this.onChange) this.onChange(this.getText());
	}
	invalidate() {}
	render(width) {
		const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
		const paddingX = Math.min(this.paddingX, maxPadding);
		const contentWidth = Math.max(1, width - paddingX * 2);
		const inputWidth = Math.max(1, contentWidth - this.promptWidth);
		const layoutWidth = Math.max(1, inputWidth - (paddingX ? 0 : 1));
		const continuationLayoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));
		this.lastWidth = layoutWidth;
		this.lastContinuationWidth = continuationLayoutWidth;
		const horizontal = this.borderColor("─");
		const layoutLines = this.layoutText(layoutWidth, continuationLayoutWidth);
		const terminalRows = this.tui.terminal.rows;
		const maxVisibleLines = Math.max(5, Math.floor(terminalRows * .3));
		let cursorLineIndex = layoutLines.findIndex((line) => line.hasCursor);
		if (cursorLineIndex === -1) cursorLineIndex = 0;
		if (cursorLineIndex < this.scrollOffset) this.scrollOffset = cursorLineIndex;
		else if (cursorLineIndex >= this.scrollOffset + maxVisibleLines) this.scrollOffset = cursorLineIndex - maxVisibleLines + 1;
		const maxScrollOffset = Math.max(0, layoutLines.length - maxVisibleLines);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScrollOffset));
		const visibleLines = layoutLines.slice(this.scrollOffset, this.scrollOffset + maxVisibleLines);
		const result = [];
		const leftPadding = " ".repeat(paddingX);
		const rightPadding = leftPadding;
		if (this.scrollOffset > 0) {
			if (this.frame === "none") {
				const indicator = `${" ".repeat(this.promptWidth)}↑ ${this.scrollOffset} more`;
				result.push(`${leftPadding}${this.borderColor(indicator)}${" ".repeat(Math.max(0, contentWidth - visibleWidth(indicator)))}${rightPadding}`);
			} else {
				const indicator = `─── ↑ ${this.scrollOffset} more `;
				const remaining = width - visibleWidth(indicator);
				if (remaining >= 0) result.push(this.borderColor(indicator + "─".repeat(remaining)));
				else result.push(this.borderColor(truncateToWidth(indicator, width)));
			}
		} else if (this.frame === "horizontal") result.push(horizontal.repeat(width));
		const emitCursorMarker = this.focused;
		for (let visibleIndex = 0; visibleIndex < visibleLines.length; visibleIndex++) {
			const layoutLine = visibleLines[visibleIndex];
			if (!layoutLine) continue;
			const absoluteIndex = this.scrollOffset + visibleIndex;
			const prefix = this.prompt ? absoluteIndex === 0 ? this.prompt.first : layoutLine.isContinuation ? "" : this.prompt.continuation : "";
			const lineContentWidth = inputWidth + (layoutLine.isContinuation ? this.promptWidth : 0);
			let displayText = layoutLine.text;
			let lineVisibleWidth = visibleWidth(layoutLine.text);
			let cursorInPadding = false;
			if (layoutLine.hasCursor && layoutLine.cursorPos !== void 0) {
				const before = displayText.slice(0, layoutLine.cursorPos);
				const after = displayText.slice(layoutLine.cursorPos);
				const marker = emitCursorMarker ? CURSOR_MARKER : "";
				if (after.length > 0) {
					const firstGrapheme = [...this.segment(after, "grapheme")][0]?.segment || "";
					const restAfter = after.slice(firstGrapheme.length);
					const cursor = `\x1b[7m${firstGrapheme}\x1b[0m`;
					displayText = before + marker + cursor + restAfter;
				} else {
					displayText = before + marker + "\x1B[7m \x1B[0m";
					lineVisibleWidth = lineVisibleWidth + 1;
					if (lineVisibleWidth > lineContentWidth && paddingX > 0) cursorInPadding = true;
				}
			}
			const padding = " ".repeat(Math.max(0, lineContentWidth - lineVisibleWidth));
			const lineRightPadding = cursorInPadding ? rightPadding.slice(1) : rightPadding;
			result.push(`${leftPadding}${prefix}${displayText}${padding}${lineRightPadding}`);
		}
		const linesBelow = layoutLines.length - (this.scrollOffset + visibleLines.length);
		if (linesBelow > 0) {
			if (this.frame === "none") {
				const indicator = `${" ".repeat(this.promptWidth)}↓ ${linesBelow} more`;
				result.push(`${leftPadding}${this.borderColor(indicator)}${" ".repeat(Math.max(0, contentWidth - visibleWidth(indicator)))}${rightPadding}`);
			} else {
				const indicator = `─── ↓ ${linesBelow} more `;
				const remaining = width - visibleWidth(indicator);
				result.push(this.borderColor(indicator + "─".repeat(Math.max(0, remaining))));
			}
		} else if (this.frame === "horizontal") result.push(horizontal.repeat(width));
		if (this.autocompleteState && this.autocompleteList) {
			const autocompleteResult = this.autocompleteList.render(inputWidth);
			const autocompletePrefix = " ".repeat(this.promptWidth);
			for (const line of autocompleteResult) {
				const lineWidth = visibleWidth(line);
				const linePadding = " ".repeat(Math.max(0, inputWidth - lineWidth));
				result.push(`${leftPadding}${autocompletePrefix}${line}${linePadding}${rightPadding}`);
			}
		}
		return result;
	}
	handleInput(data) {
		const kb = getKeybindings();
		if (this.jumpMode !== null) {
			if (kb.matches(data, "tui.editor.jumpForward") || kb.matches(data, "tui.editor.jumpBackward")) {
				this.jumpMode = null;
				return;
			}
			const printable = decodePrintableKey(data) ?? (data.charCodeAt(0) >= 32 ? data : void 0);
			if (printable !== void 0) {
				const direction = this.jumpMode;
				this.jumpMode = null;
				this.jumpToChar(printable, direction);
				return;
			}
			this.jumpMode = null;
		}
		if (data.includes("\x1B[200~")) {
			this.isInPaste = true;
			this.pasteBuffer = "";
			data = data.replace("\x1B[200~", "");
		}
		if (this.isInPaste) {
			this.pasteBuffer += data;
			const endIndex = this.pasteBuffer.indexOf("\x1B[201~");
			if (endIndex !== -1) {
				const pasteContent = this.pasteBuffer.substring(0, endIndex);
				if (pasteContent.length > 0) this.handlePaste(pasteContent);
				this.isInPaste = false;
				const remaining = this.pasteBuffer.substring(endIndex + 6);
				this.pasteBuffer = "";
				if (remaining.length > 0) this.handleInput(remaining);
				return;
			}
			return;
		}
		if (kb.matches(data, "tui.input.copy")) return;
		if (kb.matches(data, "tui.editor.undo")) {
			this.undo();
			return;
		}
		if (this.autocompleteState && this.autocompleteList) {
			if (kb.matches(data, "tui.select.cancel")) {
				this.cancelAutocomplete();
				return;
			}
			if (kb.matches(data, "tui.select.up") || kb.matches(data, "tui.select.down")) {
				this.autocompleteList.handleInput(data);
				return;
			}
			if (kb.matches(data, "tui.input.tab")) {
				const selected = this.autocompleteList.getSelectedItem();
				if (selected && this.autocompleteProvider) {
					this.pushUndoSnapshot();
					this.lastAction = null;
					const result = this.autocompleteProvider.applyCompletion(this.state.lines, this.state.cursorLine, this.state.cursorCol, selected, this.autocompletePrefix);
					this.state.lines = result.lines;
					this.state.cursorLine = result.cursorLine;
					this.setCursorCol(result.cursorCol);
					this.cancelAutocomplete();
					if (this.onChange) this.onChange(this.getText());
				}
				return;
			}
			if (kb.matches(data, "tui.select.confirm")) {
				const selected = this.autocompleteList.getSelectedItem();
				if (selected && this.autocompleteProvider) {
					this.pushUndoSnapshot();
					this.lastAction = null;
					const result = this.autocompleteProvider.applyCompletion(this.state.lines, this.state.cursorLine, this.state.cursorCol, selected, this.autocompletePrefix);
					this.state.lines = result.lines;
					this.state.cursorLine = result.cursorLine;
					this.setCursorCol(result.cursorCol);
					if (this.autocompletePrefix.startsWith("/")) this.cancelAutocomplete();
					else {
						this.cancelAutocomplete();
						if (this.onChange) this.onChange(this.getText());
						return;
					}
				}
			}
		}
		if (kb.matches(data, "tui.input.tab") && !this.autocompleteState) {
			this.handleTabCompletion();
			return;
		}
		if (kb.matches(data, "tui.editor.deleteToLineEnd")) {
			this.deleteToEndOfLine();
			return;
		}
		if (kb.matches(data, "tui.editor.deleteToLineStart")) {
			this.deleteToStartOfLine();
			return;
		}
		if (kb.matches(data, "tui.editor.deleteWordBackward")) {
			this.deleteWordBackwards();
			return;
		}
		if (kb.matches(data, "tui.editor.deleteWordForward")) {
			this.deleteWordForward();
			return;
		}
		if (kb.matches(data, "tui.editor.deleteCharBackward") || matchesKey(data, "shift+backspace")) {
			this.handleBackspace();
			return;
		}
		if (kb.matches(data, "tui.editor.deleteCharForward") || matchesKey(data, "shift+delete")) {
			this.handleForwardDelete();
			return;
		}
		if (kb.matches(data, "tui.editor.yank")) {
			this.yank();
			return;
		}
		if (kb.matches(data, "tui.editor.yankPop")) {
			this.yankPop();
			return;
		}
		if (kb.matches(data, "tui.editor.cursorLineStart")) {
			this.moveToLineStart();
			return;
		}
		if (kb.matches(data, "tui.editor.cursorLineEnd")) {
			this.moveToLineEnd();
			return;
		}
		if (kb.matches(data, "tui.editor.cursorWordLeft")) {
			this.moveWordBackwards();
			return;
		}
		if (kb.matches(data, "tui.editor.cursorWordRight")) {
			this.moveWordForwards();
			return;
		}
		if (kb.matches(data, "tui.input.newLine") || data.charCodeAt(0) === 10 && data.length > 1 || data === "\x1B\r" || data === "\x1B[13;2~" || data.length > 1 && data.includes("\x1B") && data.includes("\r") || data === "\n" && data.length === 1) {
			if (this.shouldSubmitOnBackslashEnter(data, kb)) {
				this.handleBackspace();
				this.submitValue();
				return;
			}
			this.addNewLine();
			return;
		}
		if (kb.matches(data, "tui.input.submit")) {
			if (this.disableSubmit) return;
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			if (this.state.cursorCol > 0 && currentLine[this.state.cursorCol - 1] === "\\") {
				this.handleBackspace();
				this.addNewLine();
				return;
			}
			this.submitValue();
			return;
		}
		if (kb.matches(data, "tui.editor.cursorUp")) {
			if (this.isOnFirstVisualLine() && (this.isEditorEmpty() || this.historyIndex > -1 || this.state.cursorCol === 0)) this.navigateHistory(-1);
			else if (this.isOnFirstVisualLine()) this.moveToLineStart();
			else this.moveCursor(-1, 0);
			return;
		}
		if (kb.matches(data, "tui.editor.cursorDown")) {
			if (this.historyIndex > -1 && this.isOnLastVisualLine()) this.navigateHistory(1);
			else if (this.isOnLastVisualLine()) this.moveToLineEnd();
			else this.moveCursor(1, 0);
			return;
		}
		if (kb.matches(data, "tui.editor.cursorRight")) {
			this.moveCursor(0, 1);
			return;
		}
		if (kb.matches(data, "tui.editor.cursorLeft")) {
			this.moveCursor(0, -1);
			return;
		}
		if (kb.matches(data, "tui.editor.pageUp")) {
			this.pageScroll(-1);
			return;
		}
		if (kb.matches(data, "tui.editor.pageDown")) {
			this.pageScroll(1);
			return;
		}
		if (kb.matches(data, "tui.editor.jumpForward")) {
			this.jumpMode = "forward";
			return;
		}
		if (kb.matches(data, "tui.editor.jumpBackward")) {
			this.jumpMode = "backward";
			return;
		}
		if (matchesKey(data, "shift+space")) {
			this.insertCharacter(" ");
			return;
		}
		const printable = decodePrintableKey(data);
		if (printable !== void 0) {
			this.insertCharacter(printable);
			return;
		}
		if (data.charCodeAt(0) >= 32) this.insertCharacter(data);
	}
	layoutText(contentWidth, continuationWidth) {
		const layoutLines = [];
		if (this.state.lines.length === 0 || this.state.lines.length === 1 && this.state.lines[0] === "") {
			layoutLines.push({
				text: "",
				hasCursor: true,
				cursorPos: 0,
				isContinuation: false
			});
			return layoutLines;
		}
		for (let i = 0; i < this.state.lines.length; i++) {
			const line = this.state.lines[i] || "";
			const isCurrentLine = i === this.state.cursorLine;
			if (visibleWidth(line) <= contentWidth) {
				if (isCurrentLine) layoutLines.push({
					text: line,
					hasCursor: true,
					cursorPos: this.state.cursorCol,
					isContinuation: false
				});
				else layoutLines.push({
					text: line,
					hasCursor: false,
					isContinuation: false
				});
			} else {
				const chunks = wordWrapLine(line, contentWidth, [...this.segment(line, "grapheme")], continuationWidth);
				for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
					const chunk = chunks[chunkIndex];
					if (!chunk) continue;
					const cursorPos = this.state.cursorCol;
					const isLastChunk = chunkIndex === chunks.length - 1;
					let hasCursorInChunk = false;
					let adjustedCursorPos = 0;
					if (isCurrentLine) {
						if (isLastChunk) {
							hasCursorInChunk = cursorPos >= chunk.startIndex;
							adjustedCursorPos = cursorPos - chunk.startIndex;
						} else {
							hasCursorInChunk = cursorPos >= chunk.startIndex && cursorPos < chunk.endIndex;
							if (hasCursorInChunk) {
								adjustedCursorPos = cursorPos - chunk.startIndex;
								if (adjustedCursorPos > chunk.text.length) adjustedCursorPos = chunk.text.length;
							}
						}
					}
					if (hasCursorInChunk) layoutLines.push({
						text: chunk.text,
						hasCursor: true,
						cursorPos: adjustedCursorPos,
						isContinuation: chunkIndex > 0
					});
					else layoutLines.push({
						text: chunk.text,
						hasCursor: false,
						isContinuation: chunkIndex > 0
					});
				}
			}
		}
		return layoutLines;
	}
	getText() {
		return this.state.lines.join("\n");
	}
	expandPasteMarkers(text) {
		let result = text;
		for (const [pasteId, pasteContent] of this.pastes) {
			const markerRegex = new RegExp(`\\[paste #${pasteId}( (\\+\\d+ lines|\\d+ chars))?\\]`, "g");
			result = result.replace(markerRegex, () => pasteContent);
		}
		return result;
	}
	/**
	* Get text with paste markers expanded to their actual content.
	* Use this when you need the full content (e.g., for external editor).
	*/
	getExpandedText() {
		return this.expandPasteMarkers(this.state.lines.join("\n"));
	}
	getLines() {
		return [...this.state.lines];
	}
	getCursor() {
		return {
			line: this.state.cursorLine,
			col: this.state.cursorCol
		};
	}
	setText(text) {
		this.cancelAutocomplete();
		this.lastAction = null;
		this.exitHistoryBrowsing();
		this.pastes.clear();
		this.pasteCounter = 0;
		const normalized = this.normalizeText(text);
		if (this.getText() !== normalized) this.pushUndoSnapshot();
		this.setTextInternal(normalized);
	}
	/**
	* Insert text at the current cursor position.
	* Used for programmatic insertion (e.g., clipboard image markers).
	* This is atomic for undo - single undo restores entire pre-insert state.
	*/
	insertTextAtCursor(text) {
		if (!text) return;
		this.cancelAutocomplete();
		this.pushUndoSnapshot();
		this.lastAction = null;
		this.exitHistoryBrowsing();
		this.insertTextAtCursorInternal(text);
	}
	/**
	* Normalize text for editor storage:
	* - Normalize line endings (\r\n and \r -> \n)
	* - Expand tabs to 4 spaces
	*/
	normalizeText(text) {
		return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\t/g, "    ");
	}
	/**
	* Internal text insertion at cursor. Handles single and multi-line text.
	* Does not push undo snapshots or trigger autocomplete - caller is responsible.
	* Normalizes line endings and calls onChange once at the end.
	*/
	insertTextAtCursorInternal(text) {
		if (!text) return;
		const normalized = this.normalizeText(text);
		const insertedLines = normalized.split("\n");
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		const beforeCursor = currentLine.slice(0, this.state.cursorCol);
		const afterCursor = currentLine.slice(this.state.cursorCol);
		if (insertedLines.length === 1) {
			this.state.lines[this.state.cursorLine] = beforeCursor + normalized + afterCursor;
			this.setCursorCol(this.state.cursorCol + normalized.length);
		} else {
			this.state.lines = [
				...this.state.lines.slice(0, this.state.cursorLine),
				beforeCursor + insertedLines[0],
				...insertedLines.slice(1, -1),
				insertedLines[insertedLines.length - 1] + afterCursor,
				...this.state.lines.slice(this.state.cursorLine + 1)
			];
			this.state.cursorLine += insertedLines.length - 1;
			this.setCursorCol((insertedLines[insertedLines.length - 1] || "").length);
		}
		if (this.onChange) this.onChange(this.getText());
	}
	insertCharacter(char, skipUndoCoalescing) {
		this.exitHistoryBrowsing();
		if (!skipUndoCoalescing) {
			if (isWhitespaceChar(char) || this.lastAction !== "type-word") this.pushUndoSnapshot();
			this.lastAction = "type-word";
		}
		const line = this.state.lines[this.state.cursorLine] || "";
		const before = line.slice(0, this.state.cursorCol);
		const after = line.slice(this.state.cursorCol);
		this.state.lines[this.state.cursorLine] = before + char + after;
		this.setCursorCol(this.state.cursorCol + char.length);
		if (this.onChange) this.onChange(this.getText());
		if (!this.autocompleteState) {
			if (char === "/" && this.isAtStartOfMessage()) this.tryTriggerAutocomplete();
			else if (this.autocompleteTriggerCharacters.includes(char)) {
				const textBeforeCursor = (this.state.lines[this.state.cursorLine] || "").slice(0, this.state.cursorCol);
				const charBeforeSymbol = textBeforeCursor[textBeforeCursor.length - 2];
				if (textBeforeCursor.length === 1 || charBeforeSymbol === " " || charBeforeSymbol === "	") this.tryTriggerAutocomplete();
			} else if (/[a-zA-Z0-9.\-_]/.test(char)) {
				const textBeforeCursor = (this.state.lines[this.state.cursorLine] || "").slice(0, this.state.cursorCol);
				if (this.isInSlashCommandContext(textBeforeCursor)) this.tryTriggerAutocomplete();
				else if (this.autocompleteTriggerPattern.test(textBeforeCursor)) this.tryTriggerAutocomplete();
			}
		} else this.updateAutocomplete();
	}
	handlePaste(pastedText) {
		this.cancelAutocomplete();
		this.exitHistoryBrowsing();
		this.lastAction = null;
		this.pushUndoSnapshot();
		const decodedText = pastedText.replace(/\x1b\[(\d+);5u/g, (match, code) => {
			const cp = Number(code);
			if (cp >= 97 && cp <= 122) return String.fromCharCode(cp - 96);
			if (cp >= 65 && cp <= 90) return String.fromCharCode(cp - 64);
			return match;
		});
		let filteredText = this.normalizeText(decodedText).split("").filter((char) => char === "\n" || char.charCodeAt(0) >= 32).join("");
		if (/^[/~.]/.test(filteredText)) {
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const charBeforeCursor = this.state.cursorCol > 0 ? currentLine[this.state.cursorCol - 1] : "";
			if (charBeforeCursor && /\w/.test(charBeforeCursor)) filteredText = ` ${filteredText}`;
		}
		const pastedLines = filteredText.split("\n");
		const totalChars = filteredText.length;
		if (pastedLines.length > 10 || totalChars > 1e3) {
			this.pasteCounter++;
			const pasteId = this.pasteCounter;
			this.pastes.set(pasteId, filteredText);
			const marker = pastedLines.length > 10 ? `[paste #${pasteId} +${pastedLines.length} lines]` : `[paste #${pasteId} ${totalChars} chars]`;
			this.insertTextAtCursorInternal(marker);
			return;
		}
		if (pastedLines.length === 1) {
			this.insertTextAtCursorInternal(filteredText);
			return;
		}
		this.insertTextAtCursorInternal(filteredText);
	}
	addNewLine() {
		this.cancelAutocomplete();
		this.exitHistoryBrowsing();
		this.lastAction = null;
		this.pushUndoSnapshot();
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		const before = currentLine.slice(0, this.state.cursorCol);
		const after = currentLine.slice(this.state.cursorCol);
		this.state.lines[this.state.cursorLine] = before;
		this.state.lines.splice(this.state.cursorLine + 1, 0, after);
		this.state.cursorLine++;
		this.setCursorCol(0);
		if (this.onChange) this.onChange(this.getText());
	}
	shouldSubmitOnBackslashEnter(data, kb) {
		if (this.disableSubmit) return false;
		if (!matchesKey(data, "enter")) return false;
		const submitKeys = kb.getKeys("tui.input.submit");
		if (!(submitKeys.includes("shift+enter") || submitKeys.includes("shift+return"))) return false;
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		return this.state.cursorCol > 0 && currentLine[this.state.cursorCol - 1] === "\\";
	}
	submitValue() {
		this.cancelAutocomplete();
		const result = this.expandPasteMarkers(this.state.lines.join("\n")).trim();
		this.state = {
			lines: [""],
			cursorLine: 0,
			cursorCol: 0
		};
		this.pastes.clear();
		this.pasteCounter = 0;
		this.exitHistoryBrowsing();
		this.scrollOffset = 0;
		this.undoStack.clear();
		this.lastAction = null;
		if (this.onChange) this.onChange("");
		if (this.onSubmit) this.onSubmit(result);
	}
	handleBackspace() {
		this.exitHistoryBrowsing();
		this.lastAction = null;
		if (this.state.cursorCol > 0) {
			this.pushUndoSnapshot();
			let line = this.state.lines[this.state.cursorLine] || "";
			const beforeCursor = line.slice(0, this.state.cursorCol);
			const graphemes = [...this.segment(beforeCursor, "grapheme")];
			const lastGrapheme = graphemes[graphemes.length - 1];
			const graphemeLength = lastGrapheme ? lastGrapheme.segment.length : 1;
			const isPastedSegmented = PASTE_MARKER_SINGLE.exec(lastGrapheme.segment);
			if (isPastedSegmented) {
				const targetId = Number(isPastedSegmented[1]);
				this.pastes.delete(targetId);
				this.pasteCounter--;
				this.state.lines = this.state.lines.map((line) => line.replace(PASTE_MARKER_REGEX, (fullMatch, idGroup, suffixGroup) => {
					const x = Number(idGroup);
					if (x <= targetId) return fullMatch;
					const newText = `[paste #${x - 1}${suffixGroup}]`;
					this.pastes.set(x - 1, this.pastes.get(x) ?? newText);
					this.pastes.delete(x);
					return newText;
				}));
			}
			line = this.state.lines[this.state.cursorLine] || "";
			const before = line.slice(0, this.state.cursorCol - graphemeLength);
			const after = line.slice(this.state.cursorCol);
			this.state.lines[this.state.cursorLine] = before + after;
			this.setCursorCol(this.state.cursorCol - graphemeLength);
		} else if (this.state.cursorLine > 0) {
			this.pushUndoSnapshot();
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const previousLine = this.state.lines[this.state.cursorLine - 1] || "";
			this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
			this.state.lines.splice(this.state.cursorLine, 1);
			this.state.cursorLine--;
			this.setCursorCol(previousLine.length);
		}
		if (this.onChange) this.onChange(this.getText());
		if (this.autocompleteState) this.updateAutocomplete();
		else {
			const textBeforeCursor = (this.state.lines[this.state.cursorLine] || "").slice(0, this.state.cursorCol);
			if (this.isInSlashCommandContext(textBeforeCursor)) this.tryTriggerAutocomplete();
			else if (this.autocompleteTriggerPattern.test(textBeforeCursor)) this.tryTriggerAutocomplete();
		}
	}
	/**
	* Set cursor column and clear preferredVisualCol.
	* Use this for all non-vertical cursor movements to reset sticky column behavior.
	*/
	setCursorCol(col) {
		this.state.cursorCol = col;
		this.preferredVisualCol = null;
		this.snappedFromCursorCol = null;
	}
	/**
	* Move cursor to a target visual line, applying sticky column logic.
	* Shared by moveCursor() and pageScroll().
	*/
	moveToVisualLine(visualLines, currentVisualLine, targetVisualLine) {
		const currentVL = visualLines[currentVisualLine];
		const targetVL = visualLines[targetVisualLine];
		if (!(currentVL && targetVL)) return;
		let currentVisualCol;
		if (this.snappedFromCursorCol !== null) {
			const vlIndex = this.findVisualLineAt(visualLines, currentVL.logicalLine, this.snappedFromCursorCol);
			currentVisualCol = this.snappedFromCursorCol - visualLines[vlIndex].startCol;
		} else currentVisualCol = this.state.cursorCol - currentVL.startCol;
		const sourceMaxVisualCol = currentVisualLine === visualLines.length - 1 || visualLines[currentVisualLine + 1]?.logicalLine !== currentVL.logicalLine ? currentVL.length : Math.max(0, currentVL.length - 1);
		const targetMaxVisualCol = targetVisualLine === visualLines.length - 1 || visualLines[targetVisualLine + 1]?.logicalLine !== targetVL.logicalLine ? targetVL.length : Math.max(0, targetVL.length - 1);
		const moveToVisualCol = this.computeVerticalMoveColumn(currentVisualCol, sourceMaxVisualCol, targetMaxVisualCol);
		this.state.cursorLine = targetVL.logicalLine;
		const targetCol = targetVL.startCol + moveToVisualCol;
		const logicalLine = this.state.lines[targetVL.logicalLine] || "";
		this.state.cursorCol = Math.min(targetCol, logicalLine.length);
		const segments = [...this.segment(logicalLine, "grapheme")];
		for (const seg of segments) {
			if (seg.index > this.state.cursorCol) break;
			if (seg.segment.length <= 1) continue;
			if (this.state.cursorCol < seg.index + seg.segment.length) {
				if (seg.index < targetVL.startCol && targetVisualLine > currentVisualLine) {
					const segEnd = seg.index + seg.segment.length;
					let next = targetVisualLine + 1;
					while (next < visualLines.length && visualLines[next].logicalLine === targetVL.logicalLine && visualLines[next].startCol < segEnd) next++;
					if (next < visualLines.length) {
						this.moveToVisualLine(visualLines, currentVisualLine, next);
						return;
					}
				}
				this.snappedFromCursorCol = this.state.cursorCol;
				this.state.cursorCol = seg.index;
				return;
			}
		}
		this.snappedFromCursorCol = null;
	}
	/**
	* Compute the target visual column for vertical cursor movement.
	* Implements the sticky column decision table:
	*
	* | P | S | T | U | Scenario                                             | Set Preferred | Move To     |
	* |---|---|---|---| ---------------------------------------------------- |---------------|-------------|
	* | 0 | * | 0 | - | Start nav, target fits                               | null          | current     |
	* | 0 | * | 1 | - | Start nav, target shorter                            | current       | target end  |
	* | 1 | 0 | 0 | 0 | Clamped, target fits preferred                       | null          | preferred   |
	* | 1 | 0 | 0 | 1 | Clamped, target longer but still can't fit preferred | keep          | target end  |
	* | 1 | 0 | 1 | - | Clamped, target even shorter                         | keep          | target end  |
	* | 1 | 1 | 0 | - | Rewrapped, target fits current                       | null          | current     |
	* | 1 | 1 | 1 | - | Rewrapped, target shorter than current               | current       | target end  |
	*
	* Where:
	* - P = preferred col is set
	* - S = cursor in middle of source line (not clamped to end)
	* - T = target line shorter than current visual col
	* - U = target line shorter than preferred col
	*/
	computeVerticalMoveColumn(currentVisualCol, sourceMaxVisualCol, targetMaxVisualCol) {
		const hasPreferred = this.preferredVisualCol !== null;
		const cursorInMiddle = currentVisualCol < sourceMaxVisualCol;
		const targetTooShort = targetMaxVisualCol < currentVisualCol;
		if (!hasPreferred || cursorInMiddle) {
			if (targetTooShort) {
				this.preferredVisualCol = currentVisualCol;
				return targetMaxVisualCol;
			}
			this.preferredVisualCol = null;
			return currentVisualCol;
		}
		const targetCantFitPreferred = targetMaxVisualCol < this.preferredVisualCol;
		if (targetTooShort || targetCantFitPreferred) return targetMaxVisualCol;
		const result = this.preferredVisualCol;
		this.preferredVisualCol = null;
		return result;
	}
	moveToLineStart() {
		this.lastAction = null;
		this.setCursorCol(0);
	}
	moveToLineEnd() {
		this.lastAction = null;
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		this.setCursorCol(currentLine.length);
	}
	deleteToStartOfLine() {
		this.exitHistoryBrowsing();
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		if (this.state.cursorCol > 0) {
			this.pushUndoSnapshot();
			const deletedText = currentLine.slice(0, this.state.cursorCol);
			this.killRing.push(deletedText, {
				prepend: true,
				accumulate: this.lastAction === "kill"
			});
			this.lastAction = "kill";
			this.state.lines[this.state.cursorLine] = currentLine.slice(this.state.cursorCol);
			this.setCursorCol(0);
		} else if (this.state.cursorLine > 0) {
			this.pushUndoSnapshot();
			this.killRing.push("\n", {
				prepend: true,
				accumulate: this.lastAction === "kill"
			});
			this.lastAction = "kill";
			const previousLine = this.state.lines[this.state.cursorLine - 1] || "";
			this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
			this.state.lines.splice(this.state.cursorLine, 1);
			this.state.cursorLine--;
			this.setCursorCol(previousLine.length);
		}
		if (this.onChange) this.onChange(this.getText());
	}
	deleteToEndOfLine() {
		this.exitHistoryBrowsing();
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		if (this.state.cursorCol < currentLine.length) {
			this.pushUndoSnapshot();
			const deletedText = currentLine.slice(this.state.cursorCol);
			this.killRing.push(deletedText, {
				prepend: false,
				accumulate: this.lastAction === "kill"
			});
			this.lastAction = "kill";
			this.state.lines[this.state.cursorLine] = currentLine.slice(0, this.state.cursorCol);
		} else if (this.state.cursorLine < this.state.lines.length - 1) {
			this.pushUndoSnapshot();
			this.killRing.push("\n", {
				prepend: false,
				accumulate: this.lastAction === "kill"
			});
			this.lastAction = "kill";
			const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
			this.state.lines[this.state.cursorLine] = currentLine + nextLine;
			this.state.lines.splice(this.state.cursorLine + 1, 1);
		}
		if (this.onChange) this.onChange(this.getText());
	}
	deleteWordBackwards() {
		this.exitHistoryBrowsing();
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		if (this.state.cursorCol === 0) {
			if (this.state.cursorLine > 0) {
				this.pushUndoSnapshot();
				this.killRing.push("\n", {
					prepend: true,
					accumulate: this.lastAction === "kill"
				});
				this.lastAction = "kill";
				const previousLine = this.state.lines[this.state.cursorLine - 1] || "";
				this.state.lines[this.state.cursorLine - 1] = previousLine + currentLine;
				this.state.lines.splice(this.state.cursorLine, 1);
				this.state.cursorLine--;
				this.setCursorCol(previousLine.length);
			}
		} else {
			this.pushUndoSnapshot();
			const wasKill = this.lastAction === "kill";
			const oldCursorCol = this.state.cursorCol;
			this.moveWordBackwards();
			const deleteFrom = this.state.cursorCol;
			this.setCursorCol(oldCursorCol);
			const deletedText = currentLine.slice(deleteFrom, this.state.cursorCol);
			this.killRing.push(deletedText, {
				prepend: true,
				accumulate: wasKill
			});
			this.lastAction = "kill";
			this.state.lines[this.state.cursorLine] = currentLine.slice(0, deleteFrom) + currentLine.slice(this.state.cursorCol);
			this.setCursorCol(deleteFrom);
		}
		if (this.onChange) this.onChange(this.getText());
	}
	deleteWordForward() {
		this.exitHistoryBrowsing();
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		if (this.state.cursorCol >= currentLine.length) {
			if (this.state.cursorLine < this.state.lines.length - 1) {
				this.pushUndoSnapshot();
				this.killRing.push("\n", {
					prepend: false,
					accumulate: this.lastAction === "kill"
				});
				this.lastAction = "kill";
				const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
				this.state.lines[this.state.cursorLine] = currentLine + nextLine;
				this.state.lines.splice(this.state.cursorLine + 1, 1);
			}
		} else {
			this.pushUndoSnapshot();
			const wasKill = this.lastAction === "kill";
			const oldCursorCol = this.state.cursorCol;
			this.moveWordForwards();
			const deleteTo = this.state.cursorCol;
			this.setCursorCol(oldCursorCol);
			const deletedText = currentLine.slice(this.state.cursorCol, deleteTo);
			this.killRing.push(deletedText, {
				prepend: false,
				accumulate: wasKill
			});
			this.lastAction = "kill";
			this.state.lines[this.state.cursorLine] = currentLine.slice(0, this.state.cursorCol) + currentLine.slice(deleteTo);
		}
		if (this.onChange) this.onChange(this.getText());
	}
	handleForwardDelete() {
		this.exitHistoryBrowsing();
		this.lastAction = null;
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		if (this.state.cursorCol < currentLine.length) {
			this.pushUndoSnapshot();
			const afterCursor = currentLine.slice(this.state.cursorCol);
			const firstGrapheme = [...this.segment(afterCursor, "grapheme")][0];
			const graphemeLength = firstGrapheme ? firstGrapheme.segment.length : 1;
			const before = currentLine.slice(0, this.state.cursorCol);
			const after = currentLine.slice(this.state.cursorCol + graphemeLength);
			this.state.lines[this.state.cursorLine] = before + after;
		} else if (this.state.cursorLine < this.state.lines.length - 1) {
			this.pushUndoSnapshot();
			const nextLine = this.state.lines[this.state.cursorLine + 1] || "";
			this.state.lines[this.state.cursorLine] = currentLine + nextLine;
			this.state.lines.splice(this.state.cursorLine + 1, 1);
		}
		if (this.onChange) this.onChange(this.getText());
		if (this.autocompleteState) this.updateAutocomplete();
		else {
			const textBeforeCursor = (this.state.lines[this.state.cursorLine] || "").slice(0, this.state.cursorCol);
			if (this.isInSlashCommandContext(textBeforeCursor)) this.tryTriggerAutocomplete();
			else if (this.autocompleteTriggerPattern.test(textBeforeCursor)) this.tryTriggerAutocomplete();
		}
	}
	/**
	* Build a mapping from visual lines to logical positions.
	* Returns an array where each element represents a visual line with:
	* - logicalLine: index into this.state.lines
	* - startCol: starting column in the logical line
	* - length: length of this visual line segment
	*/
	buildVisualLineMap(width, continuationWidth = this.lastContinuationWidth) {
		const visualLines = [];
		for (let i = 0; i < this.state.lines.length; i++) {
			const line = this.state.lines[i] || "";
			const lineVisWidth = visibleWidth(line);
			if (line.length === 0) visualLines.push({
				logicalLine: i,
				startCol: 0,
				length: 0
			});
			else if (lineVisWidth <= width) visualLines.push({
				logicalLine: i,
				startCol: 0,
				length: line.length
			});
			else {
				const chunks = wordWrapLine(line, width, [...this.segment(line, "grapheme")], continuationWidth);
				for (const chunk of chunks) visualLines.push({
					logicalLine: i,
					startCol: chunk.startIndex,
					length: chunk.endIndex - chunk.startIndex
				});
			}
		}
		return visualLines;
	}
	/**
	* Find the visual line index that contains the given logical position.
	*/
	findVisualLineAt(visualLines, line, col) {
		for (let i = 0; i < visualLines.length; i++) {
			const vl = visualLines[i];
			if (!vl || vl.logicalLine !== line) continue;
			const offset = col - vl.startCol;
			const isLastSegmentOfLine = i === visualLines.length - 1 || visualLines[i + 1]?.logicalLine !== vl.logicalLine;
			if (offset >= 0 && (offset < vl.length || isLastSegmentOfLine && offset === vl.length)) return i;
		}
		return visualLines.length - 1;
	}
	/**
	* Find the visual line index for the current cursor position.
	*/
	findCurrentVisualLine(visualLines) {
		return this.findVisualLineAt(visualLines, this.state.cursorLine, this.state.cursorCol);
	}
	moveCursor(deltaLine, deltaCol) {
		this.lastAction = null;
		const visualLines = this.buildVisualLineMap(this.lastWidth);
		const currentVisualLine = this.findCurrentVisualLine(visualLines);
		if (deltaLine !== 0) {
			const targetVisualLine = currentVisualLine + deltaLine;
			if (targetVisualLine >= 0 && targetVisualLine < visualLines.length) this.moveToVisualLine(visualLines, currentVisualLine, targetVisualLine);
		}
		if (deltaCol !== 0) {
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			if (deltaCol > 0) {
				if (this.state.cursorCol < currentLine.length) {
					const afterCursor = currentLine.slice(this.state.cursorCol);
					const firstGrapheme = [...this.segment(afterCursor, "grapheme")][0];
					this.setCursorCol(this.state.cursorCol + (firstGrapheme ? firstGrapheme.segment.length : 1));
				} else if (this.state.cursorLine < this.state.lines.length - 1) {
					this.state.cursorLine++;
					this.setCursorCol(0);
				} else {
					const currentVL = visualLines[currentVisualLine];
					if (currentVL) this.preferredVisualCol = this.state.cursorCol - currentVL.startCol;
				}
			} else if (this.state.cursorCol > 0) {
				const beforeCursor = currentLine.slice(0, this.state.cursorCol);
				const graphemes = [...this.segment(beforeCursor, "grapheme")];
				const lastGrapheme = graphemes[graphemes.length - 1];
				this.setCursorCol(this.state.cursorCol - (lastGrapheme ? lastGrapheme.segment.length : 1));
			} else if (this.state.cursorLine > 0) {
				this.state.cursorLine--;
				const prevLine = this.state.lines[this.state.cursorLine] || "";
				this.setCursorCol(prevLine.length);
			}
		}
		if (this.autocompleteState) this.updateAutocomplete();
	}
	/**
	* Scroll by a page (direction: -1 for up, 1 for down).
	* Moves cursor by the page size while keeping it in bounds.
	*/
	pageScroll(direction) {
		this.lastAction = null;
		const terminalRows = this.tui.terminal.rows;
		const pageSize = Math.max(5, Math.floor(terminalRows * .3));
		const visualLines = this.buildVisualLineMap(this.lastWidth);
		const currentVisualLine = this.findCurrentVisualLine(visualLines);
		const targetVisualLine = Math.max(0, Math.min(visualLines.length - 1, currentVisualLine + direction * pageSize));
		this.moveToVisualLine(visualLines, currentVisualLine, targetVisualLine);
	}
	moveWordBackwards() {
		this.lastAction = null;
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		if (this.state.cursorCol === 0) {
			if (this.state.cursorLine > 0) {
				this.state.cursorLine--;
				const prevLine = this.state.lines[this.state.cursorLine] || "";
				this.setCursorCol(prevLine.length);
			}
			return;
		}
		this.setCursorCol(findWordBackward(currentLine, this.state.cursorCol, {
			segment: (text) => this.segment(text, "word"),
			isAtomicSegment: isPasteMarker
		}));
	}
	/**
	* Yank (paste) the most recent kill ring entry at cursor position.
	*/
	yank() {
		if (this.killRing.length === 0) return;
		this.pushUndoSnapshot();
		const text = this.killRing.peek();
		this.insertYankedText(text);
		this.lastAction = "yank";
	}
	/**
	* Cycle through kill ring (only works immediately after yank or yank-pop).
	* Replaces the last yanked text with the previous entry in the ring.
	*/
	yankPop() {
		if (this.lastAction !== "yank" || this.killRing.length <= 1) return;
		this.pushUndoSnapshot();
		this.deleteYankedText();
		this.killRing.rotate();
		const text = this.killRing.peek();
		this.insertYankedText(text);
		this.lastAction = "yank";
	}
	/**
	* Insert text at cursor position (used by yank operations).
	*/
	insertYankedText(text) {
		this.exitHistoryBrowsing();
		const lines = text.split("\n");
		if (lines.length === 1) {
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const before = currentLine.slice(0, this.state.cursorCol);
			const after = currentLine.slice(this.state.cursorCol);
			this.state.lines[this.state.cursorLine] = before + text + after;
			this.setCursorCol(this.state.cursorCol + text.length);
		} else {
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const before = currentLine.slice(0, this.state.cursorCol);
			const after = currentLine.slice(this.state.cursorCol);
			this.state.lines[this.state.cursorLine] = before + (lines[0] || "");
			for (let i = 1; i < lines.length - 1; i++) this.state.lines.splice(this.state.cursorLine + i, 0, lines[i] || "");
			const lastLineIndex = this.state.cursorLine + lines.length - 1;
			this.state.lines.splice(lastLineIndex, 0, (lines[lines.length - 1] || "") + after);
			this.state.cursorLine = lastLineIndex;
			this.setCursorCol((lines[lines.length - 1] || "").length);
		}
		if (this.onChange) this.onChange(this.getText());
	}
	/**
	* Delete the previously yanked text (used by yank-pop).
	* The yanked text is derived from killRing[end] since it hasn't been rotated yet.
	*/
	deleteYankedText() {
		const yankedText = this.killRing.peek();
		if (!yankedText) return;
		const yankLines = yankedText.split("\n");
		if (yankLines.length === 1) {
			const currentLine = this.state.lines[this.state.cursorLine] || "";
			const deleteLen = yankedText.length;
			const before = currentLine.slice(0, this.state.cursorCol - deleteLen);
			const after = currentLine.slice(this.state.cursorCol);
			this.state.lines[this.state.cursorLine] = before + after;
			this.setCursorCol(this.state.cursorCol - deleteLen);
		} else {
			const startLine = this.state.cursorLine - (yankLines.length - 1);
			const startCol = (this.state.lines[startLine] || "").length - (yankLines[0] || "").length;
			const afterCursor = (this.state.lines[this.state.cursorLine] || "").slice(this.state.cursorCol);
			const beforeYank = (this.state.lines[startLine] || "").slice(0, startCol);
			this.state.lines.splice(startLine, yankLines.length, beforeYank + afterCursor);
			this.state.cursorLine = startLine;
			this.setCursorCol(startCol);
		}
		if (this.onChange) this.onChange(this.getText());
	}
	pushUndoSnapshot() {
		this.undoStack.push(this.state);
	}
	undo() {
		this.exitHistoryBrowsing();
		const snapshot = this.undoStack.pop();
		if (!snapshot) return;
		Object.assign(this.state, snapshot);
		this.lastAction = null;
		this.preferredVisualCol = null;
		if (this.onChange) this.onChange(this.getText());
	}
	/**
	* Jump to the first occurrence of a character in the specified direction.
	* Multi-line search. Case-sensitive. Skips the current cursor position.
	*/
	jumpToChar(char, direction) {
		this.lastAction = null;
		const isForward = direction === "forward";
		const lines = this.state.lines;
		const end = isForward ? lines.length : -1;
		const step = isForward ? 1 : -1;
		for (let lineIdx = this.state.cursorLine; lineIdx !== end; lineIdx += step) {
			const line = lines[lineIdx] || "";
			const searchFrom = lineIdx === this.state.cursorLine ? isForward ? this.state.cursorCol + 1 : this.state.cursorCol - 1 : void 0;
			const idx = isForward ? line.indexOf(char, searchFrom) : line.lastIndexOf(char, searchFrom);
			if (idx !== -1) {
				this.state.cursorLine = lineIdx;
				this.setCursorCol(idx);
				return;
			}
		}
	}
	moveWordForwards() {
		this.lastAction = null;
		const currentLine = this.state.lines[this.state.cursorLine] || "";
		if (this.state.cursorCol >= currentLine.length) {
			if (this.state.cursorLine < this.state.lines.length - 1) {
				this.state.cursorLine++;
				this.setCursorCol(0);
			}
			return;
		}
		this.setCursorCol(findWordForward(currentLine, this.state.cursorCol, {
			segment: (text) => this.segment(text, "word"),
			isAtomicSegment: isPasteMarker
		}));
	}
	isSlashMenuAllowed() {
		return this.state.cursorLine === 0;
	}
	isAtStartOfMessage() {
		if (!this.isSlashMenuAllowed()) return false;
		const beforeCursor = (this.state.lines[this.state.cursorLine] || "").slice(0, this.state.cursorCol);
		return beforeCursor.trim() === "" || beforeCursor.trim() === "/";
	}
	isInSlashCommandContext(textBeforeCursor) {
		return this.isSlashMenuAllowed() && textBeforeCursor.trimStart().startsWith("/");
	}
	/**
	* Find the best autocomplete item index for the given prefix.
	* Returns -1 if no match is found.
	*
	* Match priority:
	* 1. Exact match (prefix === item.value) -> always selected
	* 2. Prefix match -> first item whose value starts with prefix
	* 3. No match -> -1 (keep default highlight)
	*
	* Matching is case-sensitive and checks item.value only.
	*/
	getBestAutocompleteMatchIndex(items, prefix) {
		if (!prefix) return -1;
		let firstPrefixIndex = -1;
		for (let i = 0; i < items.length; i++) {
			const value = items[i].value;
			if (value === prefix) return i;
			if (firstPrefixIndex === -1 && value.startsWith(prefix)) firstPrefixIndex = i;
		}
		return firstPrefixIndex;
	}
	createAutocompleteList(prefix, items) {
		const layout = prefix.startsWith("/") ? SLASH_COMMAND_SELECT_LIST_LAYOUT : void 0;
		return new SelectList(items, this.autocompleteMaxVisible, this.theme.selectList, layout);
	}
	tryTriggerAutocomplete(explicitTab = false) {
		this.requestAutocomplete({
			force: false,
			explicitTab
		});
	}
	handleTabCompletion() {
		if (!this.autocompleteProvider) return;
		const beforeCursor = (this.state.lines[this.state.cursorLine] || "").slice(0, this.state.cursorCol);
		if (this.isInSlashCommandContext(beforeCursor) && !beforeCursor.trimStart().includes(" ")) this.handleSlashCommandCompletion();
		else this.forceFileAutocomplete(true);
	}
	handleSlashCommandCompletion() {
		this.requestAutocomplete({
			force: false,
			explicitTab: true
		});
	}
	forceFileAutocomplete(explicitTab = false) {
		this.requestAutocomplete({
			force: true,
			explicitTab
		});
	}
	requestAutocomplete(options) {
		if (!this.autocompleteProvider) return;
		if (options.force) {
			if (!(!this.autocompleteProvider.shouldTriggerFileCompletion || this.autocompleteProvider.shouldTriggerFileCompletion(this.state.lines, this.state.cursorLine, this.state.cursorCol))) return;
		}
		this.cancelAutocompleteRequest();
		const startToken = ++this.autocompleteStartToken;
		const debounceMs = this.getAutocompleteDebounceMs(options);
		if (debounceMs > 0) {
			this.autocompleteDebounceTimer = setTimeout(() => {
				this.autocompleteDebounceTimer = void 0;
				this.startAutocompleteRequest(startToken, options);
			}, debounceMs);
			return;
		}
		this.startAutocompleteRequest(startToken, options);
	}
	async startAutocompleteRequest(startToken, options) {
		const previousTask = this.autocompleteRequestTask;
		this.autocompleteRequestTask = (async () => {
			await previousTask;
			if (startToken !== this.autocompleteStartToken || !this.autocompleteProvider) return;
			const controller = new AbortController();
			this.autocompleteAbort = controller;
			const requestId = ++this.autocompleteRequestId;
			const snapshotText = this.getText();
			const snapshotLine = this.state.cursorLine;
			const snapshotCol = this.state.cursorCol;
			await this.runAutocompleteRequest(requestId, controller, snapshotText, snapshotLine, snapshotCol, options);
		})();
		await this.autocompleteRequestTask;
	}
	setAutocompleteTriggerCharacters(triggerCharacters) {
		const next = [...DEFAULT_AUTOCOMPLETE_TRIGGER_CHARACTERS];
		for (const character of triggerCharacters) {
			if (character.length !== 1 || character === "/" || isWhitespaceChar(character) || next.includes(character)) continue;
			next.push(character);
		}
		this.autocompleteTriggerCharacters = next;
		this.autocompleteTriggerPattern = buildTriggerPattern(next);
		this.autocompleteDebouncePattern = buildDebouncePattern(next);
	}
	getAutocompleteDebounceMs(options) {
		if (options.explicitTab || options.force) return 0;
		const textBeforeCursor = (this.state.lines[this.state.cursorLine] || "").slice(0, this.state.cursorCol);
		return this.autocompleteDebouncePattern.test(textBeforeCursor) ? ATTACHMENT_AUTOCOMPLETE_DEBOUNCE_MS : 0;
	}
	async runAutocompleteRequest(requestId, controller, snapshotText, snapshotLine, snapshotCol, options) {
		if (!this.autocompleteProvider) return;
		const suggestions = await this.autocompleteProvider.getSuggestions(this.state.lines, this.state.cursorLine, this.state.cursorCol, {
			signal: controller.signal,
			force: options.force
		});
		if (!this.isAutocompleteRequestCurrent(requestId, controller, snapshotText, snapshotLine, snapshotCol)) return;
		this.autocompleteAbort = void 0;
		if (!suggestions || !Array.isArray(suggestions.items) || suggestions.items.length === 0) {
			this.cancelAutocomplete();
			this.tui.requestRender();
			return;
		}
		if (options.force && options.explicitTab && suggestions.items.length === 1) {
			const item = suggestions.items[0];
			this.pushUndoSnapshot();
			this.lastAction = null;
			const result = this.autocompleteProvider.applyCompletion(this.state.lines, this.state.cursorLine, this.state.cursorCol, item, suggestions.prefix);
			this.state.lines = result.lines;
			this.state.cursorLine = result.cursorLine;
			this.setCursorCol(result.cursorCol);
			if (this.onChange) this.onChange(this.getText());
			this.tui.requestRender();
			return;
		}
		this.applyAutocompleteSuggestions(suggestions, options.force ? "force" : "regular");
		this.tui.requestRender();
	}
	isAutocompleteRequestCurrent(requestId, controller, snapshotText, snapshotLine, snapshotCol) {
		return !controller.signal.aborted && requestId === this.autocompleteRequestId && this.getText() === snapshotText && this.state.cursorLine === snapshotLine && this.state.cursorCol === snapshotCol;
	}
	applyAutocompleteSuggestions(suggestions, state) {
		this.autocompletePrefix = suggestions.prefix;
		this.autocompleteList = this.createAutocompleteList(suggestions.prefix, suggestions.items);
		const bestMatchIndex = this.getBestAutocompleteMatchIndex(suggestions.items, suggestions.prefix);
		if (bestMatchIndex >= 0) this.autocompleteList.setSelectedIndex(bestMatchIndex);
		this.autocompleteState = state;
	}
	cancelAutocompleteRequest() {
		this.autocompleteStartToken += 1;
		if (this.autocompleteDebounceTimer) {
			clearTimeout(this.autocompleteDebounceTimer);
			this.autocompleteDebounceTimer = void 0;
		}
		this.autocompleteAbort?.abort();
		this.autocompleteAbort = void 0;
	}
	clearAutocompleteUi() {
		this.autocompleteState = null;
		this.autocompleteList = void 0;
		this.autocompletePrefix = "";
	}
	cancelAutocomplete() {
		this.cancelAutocompleteRequest();
		this.clearAutocompleteUi();
	}
	isShowingAutocomplete() {
		return this.autocompleteState !== null;
	}
	updateAutocomplete() {
		if (!this.autocompleteState || !this.autocompleteProvider) return;
		this.requestAutocomplete({
			force: this.autocompleteState === "force",
			explicitTab: false
		});
	}
};

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/components/input.js
const segmenter = getGraphemeSegmenter();
/**
* Input component - single-line text input with horizontal scrolling
*/
var Input = class {
	value = "";
	cursor = 0;
	onSubmit;
	onEscape;
	/** Focusable interface - set by TUI when focus changes */
	focused = false;
	pasteBuffer = "";
	isInPaste = false;
	killRing = new KillRing();
	lastAction = null;
	undoStack = new UndoStack();
	getValue() {
		return this.value;
	}
	setValue(value) {
		this.value = value;
		this.cursor = Math.min(this.cursor, value.length);
	}
	handleInput(data) {
		if (data.includes("\x1B[200~")) {
			this.isInPaste = true;
			this.pasteBuffer = "";
			data = data.replace("\x1B[200~", "");
		}
		if (this.isInPaste) {
			this.pasteBuffer += data;
			const endIndex = this.pasteBuffer.indexOf("\x1B[201~");
			if (endIndex !== -1) {
				const pasteContent = this.pasteBuffer.substring(0, endIndex);
				this.handlePaste(pasteContent);
				this.isInPaste = false;
				const remaining = this.pasteBuffer.substring(endIndex + 6);
				this.pasteBuffer = "";
				if (remaining) this.handleInput(remaining);
			}
			return;
		}
		const kb = getKeybindings();
		if (kb.matches(data, "tui.select.cancel")) {
			if (this.onEscape) this.onEscape();
			return;
		}
		if (kb.matches(data, "tui.editor.undo")) {
			this.undo();
			return;
		}
		if (kb.matches(data, "tui.input.submit") || data === "\n") {
			if (this.onSubmit) this.onSubmit(this.value);
			return;
		}
		if (kb.matches(data, "tui.editor.deleteCharBackward")) {
			this.handleBackspace();
			return;
		}
		if (kb.matches(data, "tui.editor.deleteCharForward")) {
			this.handleForwardDelete();
			return;
		}
		if (kb.matches(data, "tui.editor.deleteWordBackward")) {
			this.deleteWordBackwards();
			return;
		}
		if (kb.matches(data, "tui.editor.deleteWordForward")) {
			this.deleteWordForward();
			return;
		}
		if (kb.matches(data, "tui.editor.deleteToLineStart")) {
			this.deleteToLineStart();
			return;
		}
		if (kb.matches(data, "tui.editor.deleteToLineEnd")) {
			this.deleteToLineEnd();
			return;
		}
		if (kb.matches(data, "tui.editor.yank")) {
			this.yank();
			return;
		}
		if (kb.matches(data, "tui.editor.yankPop")) {
			this.yankPop();
			return;
		}
		if (kb.matches(data, "tui.editor.cursorLeft")) {
			this.lastAction = null;
			if (this.cursor > 0) {
				const beforeCursor = this.value.slice(0, this.cursor);
				const graphemes = [...segmenter.segment(beforeCursor)];
				const lastGrapheme = graphemes[graphemes.length - 1];
				this.cursor -= lastGrapheme ? lastGrapheme.segment.length : 1;
			}
			return;
		}
		if (kb.matches(data, "tui.editor.cursorRight")) {
			this.lastAction = null;
			if (this.cursor < this.value.length) {
				const afterCursor = this.value.slice(this.cursor);
				const firstGrapheme = [...segmenter.segment(afterCursor)][0];
				this.cursor += firstGrapheme ? firstGrapheme.segment.length : 1;
			}
			return;
		}
		if (kb.matches(data, "tui.editor.cursorLineStart")) {
			this.lastAction = null;
			this.cursor = 0;
			return;
		}
		if (kb.matches(data, "tui.editor.cursorLineEnd")) {
			this.lastAction = null;
			this.cursor = this.value.length;
			return;
		}
		if (kb.matches(data, "tui.editor.cursorWordLeft")) {
			this.moveWordBackwards();
			return;
		}
		if (kb.matches(data, "tui.editor.cursorWordRight")) {
			this.moveWordForwards();
			return;
		}
		const kittyPrintable = decodeKittyPrintable(data);
		if (kittyPrintable !== void 0) {
			this.insertCharacter(kittyPrintable);
			return;
		}
		if (![...data].some((ch) => {
			const code = ch.charCodeAt(0);
			return code < 32 || code === 127 || code >= 128 && code <= 159;
		})) this.insertCharacter(data);
	}
	insertCharacter(char) {
		if (isWhitespaceChar(char) || this.lastAction !== "type-word") this.pushUndo();
		this.lastAction = "type-word";
		this.value = this.value.slice(0, this.cursor) + char + this.value.slice(this.cursor);
		this.cursor += char.length;
	}
	handleBackspace() {
		this.lastAction = null;
		if (this.cursor > 0) {
			this.pushUndo();
			const beforeCursor = this.value.slice(0, this.cursor);
			const graphemes = [...segmenter.segment(beforeCursor)];
			const lastGrapheme = graphemes[graphemes.length - 1];
			const graphemeLength = lastGrapheme ? lastGrapheme.segment.length : 1;
			this.value = this.value.slice(0, this.cursor - graphemeLength) + this.value.slice(this.cursor);
			this.cursor -= graphemeLength;
		}
	}
	handleForwardDelete() {
		this.lastAction = null;
		if (this.cursor < this.value.length) {
			this.pushUndo();
			const afterCursor = this.value.slice(this.cursor);
			const firstGrapheme = [...segmenter.segment(afterCursor)][0];
			const graphemeLength = firstGrapheme ? firstGrapheme.segment.length : 1;
			this.value = this.value.slice(0, this.cursor) + this.value.slice(this.cursor + graphemeLength);
		}
	}
	deleteToLineStart() {
		if (this.cursor === 0) return;
		this.pushUndo();
		const deletedText = this.value.slice(0, this.cursor);
		this.killRing.push(deletedText, {
			prepend: true,
			accumulate: this.lastAction === "kill"
		});
		this.lastAction = "kill";
		this.value = this.value.slice(this.cursor);
		this.cursor = 0;
	}
	deleteToLineEnd() {
		if (this.cursor >= this.value.length) return;
		this.pushUndo();
		const deletedText = this.value.slice(this.cursor);
		this.killRing.push(deletedText, {
			prepend: false,
			accumulate: this.lastAction === "kill"
		});
		this.lastAction = "kill";
		this.value = this.value.slice(0, this.cursor);
	}
	deleteWordBackwards() {
		if (this.cursor === 0) return;
		const wasKill = this.lastAction === "kill";
		this.pushUndo();
		const oldCursor = this.cursor;
		this.moveWordBackwards();
		const deleteFrom = this.cursor;
		this.cursor = oldCursor;
		const deletedText = this.value.slice(deleteFrom, this.cursor);
		this.killRing.push(deletedText, {
			prepend: true,
			accumulate: wasKill
		});
		this.lastAction = "kill";
		this.value = this.value.slice(0, deleteFrom) + this.value.slice(this.cursor);
		this.cursor = deleteFrom;
	}
	deleteWordForward() {
		if (this.cursor >= this.value.length) return;
		const wasKill = this.lastAction === "kill";
		this.pushUndo();
		const oldCursor = this.cursor;
		this.moveWordForwards();
		const deleteTo = this.cursor;
		this.cursor = oldCursor;
		const deletedText = this.value.slice(this.cursor, deleteTo);
		this.killRing.push(deletedText, {
			prepend: false,
			accumulate: wasKill
		});
		this.lastAction = "kill";
		this.value = this.value.slice(0, this.cursor) + this.value.slice(deleteTo);
	}
	yank() {
		const text = this.killRing.peek();
		if (!text) return;
		this.pushUndo();
		this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
		this.cursor += text.length;
		this.lastAction = "yank";
	}
	yankPop() {
		if (this.lastAction !== "yank" || this.killRing.length <= 1) return;
		this.pushUndo();
		const prevText = this.killRing.peek() || "";
		this.value = this.value.slice(0, this.cursor - prevText.length) + this.value.slice(this.cursor);
		this.cursor -= prevText.length;
		this.killRing.rotate();
		const text = this.killRing.peek() || "";
		this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
		this.cursor += text.length;
		this.lastAction = "yank";
	}
	pushUndo() {
		this.undoStack.push({
			value: this.value,
			cursor: this.cursor
		});
	}
	undo() {
		const snapshot = this.undoStack.pop();
		if (!snapshot) return;
		this.value = snapshot.value;
		this.cursor = snapshot.cursor;
		this.lastAction = null;
	}
	moveWordBackwards() {
		if (this.cursor === 0) return;
		this.lastAction = null;
		this.cursor = findWordBackward(this.value, this.cursor);
	}
	moveWordForwards() {
		if (this.cursor >= this.value.length) return;
		this.lastAction = null;
		this.cursor = findWordForward(this.value, this.cursor);
	}
	handlePaste(pastedText) {
		this.lastAction = null;
		this.pushUndo();
		const cleanText = pastedText.replace(/\r\n/g, "").replace(/\r/g, "").replace(/\n/g, "").replace(/\t/g, "    ");
		this.value = this.value.slice(0, this.cursor) + cleanText + this.value.slice(this.cursor);
		this.cursor += cleanText.length;
	}
	invalidate() {}
	render(width) {
		const prompt = "> ";
		const availableWidth = width - 2;
		if (availableWidth <= 0) return [prompt];
		let visibleText = "";
		let cursorDisplay = this.cursor;
		const totalWidth = visibleWidth(this.value);
		if (totalWidth < availableWidth) visibleText = this.value;
		else {
			const scrollWidth = this.cursor === this.value.length ? availableWidth - 1 : availableWidth;
			const cursorCol = visibleWidth(this.value.slice(0, this.cursor));
			if (scrollWidth > 0) {
				const halfWidth = Math.floor(scrollWidth / 2);
				let startCol = 0;
				if (cursorCol < halfWidth) startCol = 0;
				else if (cursorCol > totalWidth - halfWidth) startCol = Math.max(0, totalWidth - scrollWidth);
				else startCol = Math.max(0, cursorCol - halfWidth);
				visibleText = sliceByColumn(this.value, startCol, scrollWidth, true);
				cursorDisplay = sliceByColumn(this.value, startCol, Math.max(0, cursorCol - startCol), true).length;
			} else {
				visibleText = "";
				cursorDisplay = 0;
			}
		}
		const cursorGrapheme = [...segmenter.segment(visibleText.slice(cursorDisplay))][0];
		const beforeCursor = visibleText.slice(0, cursorDisplay);
		const atCursor = cursorGrapheme?.segment ?? " ";
		const afterCursor = visibleText.slice(cursorDisplay + atCursor.length);
		const marker = this.focused ? CURSOR_MARKER : "";
		const cursorChar = `\x1b[7m${atCursor}\x1b[27m`;
		const textWithCursor = beforeCursor + marker + cursorChar + afterCursor;
		const visualLength = visibleWidth(textWithCursor);
		const padding = " ".repeat(Math.max(0, availableWidth - visualLength));
		return [prompt + textWithCursor + padding];
	}
};

//#endregion
//#region node_modules/.pnpm/marked@18.0.5/node_modules/marked/lib/marked.esm.js
/**
* marked v18.0.5 - a markdown parser
* Copyright (c) 2018-2026, MarkedJS. (MIT License)
* Copyright (c) 2011-2018, Christopher Jeffrey. (MIT License)
* https://github.com/markedjs/marked
*/
/**
* DO NOT EDIT THIS FILE
* The code in this file is generated from files in ./src/
*/
function M() {
	return {
		async: !1,
		breaks: !1,
		extensions: null,
		gfm: !0,
		hooks: null,
		pedantic: !1,
		renderer: null,
		silent: !1,
		tokenizer: null,
		walkTokens: null
	};
}
var T = M();
function N(l) {
	T = l;
}
var _ = { exec: () => null };
function E(l) {
	let e = [];
	return (t) => {
		let n = Math.max(0, Math.min(3, t - 1)), s = e[n];
		return s || (s = l(n), e[n] = s), s;
	};
}
function d(l, e = "") {
	let t = typeof l == "string" ? l : l.source, n = {
		replace: (s, r) => {
			let i = typeof r == "string" ? r : r.source;
			return i = i.replace(m.caret, "$1"), t = t.replace(s, i), n;
		},
		getRegex: () => new RegExp(t, e)
	};
	return n;
}
var Te = ((l = "") => {
	try {
		return !!new RegExp("(?<=1)(?<!1)" + l);
	} catch {
		return !1;
	}
})();
var m = {
	codeRemoveIndent: /^(?: {1,4}| {0,3}\t)/gm,
	outputLinkReplace: /\\([\[\]])/g,
	indentCodeCompensation: /^(\s+)(?:```)/,
	beginningSpace: /^\s+/,
	endingHash: /#$/,
	startingSpaceChar: /^ /,
	endingSpaceChar: / $/,
	nonSpaceChar: /[^ ]/,
	newLineCharGlobal: /\n/g,
	tabCharGlobal: /\t/g,
	multipleSpaceGlobal: /\s+/g,
	blankLine: /^[ \t]*$/,
	doubleBlankLine: /\n[ \t]*\n[ \t]*$/,
	blockquoteStart: /^ {0,3}>/,
	blockquoteSetextReplace: /\n {0,3}((?:=+|-+) *)(?=\n|$)/g,
	blockquoteSetextReplace2: /^ {0,3}>[ \t]?/gm,
	listReplaceNesting: /^ {1,4}(?=( {4})*[^ ])/g,
	listIsTask: /^\[[ xX]\] +\S/,
	listReplaceTask: /^\[[ xX]\] +/,
	listTaskCheckbox: /\[[ xX]\]/,
	anyLine: /\n.*\n/,
	hrefBrackets: /^<(.*)>$/,
	tableDelimiter: /[:|]/,
	tableAlignChars: /^\||\| *$/g,
	tableRowBlankLine: /\n[ \t]*$/,
	tableAlignRight: /^ *-+: *$/,
	tableAlignCenter: /^ *:-+: *$/,
	tableAlignLeft: /^ *:-+ *$/,
	startATag: /^<a /i,
	endATag: /^<\/a>/i,
	startPreScriptTag: /^<(pre|code|kbd|script)(\s|>)/i,
	endPreScriptTag: /^<\/(pre|code|kbd|script)(\s|>)/i,
	startAngleBracket: /^</,
	endAngleBracket: />$/,
	pedanticHrefTitle: /^([^'"]*[^\s])\s+(['"])(.*)\2/,
	unicodeAlphaNumeric: /[\p{L}\p{N}]/u,
	escapeTest: /[&<>"']/,
	escapeReplace: /[&<>"']/g,
	escapeTestNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/,
	escapeReplaceNoEncode: /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
	caret: /(^|[^\[])\^/g,
	percentDecode: /%25/g,
	findPipe: /\|/g,
	splitPipe: / \|/,
	slashPipe: /\\\|/g,
	carriageReturn: /\r\n|\r/g,
	spaceLine: /^ +$/gm,
	notSpaceStart: /^\S*/,
	endingNewline: /\n$/,
	listItemRegex: (l) => new RegExp(`^( {0,3}${l})((?:[	 ][^\\n]*)?(?:\\n|$))`),
	nextBulletRegex: E((l) => new RegExp(`^ {0,${l}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`)),
	hrRegex: E((l) => new RegExp(`^ {0,${l}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`)),
	fencesBeginRegex: E((l) => new RegExp(`^ {0,${l}}(?:\`\`\`|~~~)`)),
	headingBeginRegex: E((l) => new RegExp(`^ {0,${l}}#`)),
	htmlBeginRegex: E((l) => new RegExp(`^ {0,${l}}<(?:[a-z].*>|!--)`, "i")),
	blockquoteBeginRegex: E((l) => new RegExp(`^ {0,${l}}>`))
};
var Oe = /^(?:[ \t]*(?:\n|$))+/;
var we = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var ye = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var B = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var Pe = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var j = / {0,3}(?:[*+-]|\d{1,9}[.)])/;
var oe = /^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html|table))+?)\n {0,3}(=+|-+) *(?:\n+|$)/;
var ae = d(oe).replace(/bull/g, j).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/\|table/g, "").getRegex();
var Se = d(oe).replace(/bull/g, j).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).replace(/table/g, / {0,3}\|?(?:[:\- ]*\|)+[\:\- ]*\n/).getRegex();
var F = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/;
var $e = /^[^\n]+/;
var U = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\])+/;
var Le = d(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", U).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var _e = d(/^(bull)([ \t][^\n]*?)?(?:\n|$)/).replace(/bull/g, j).getRegex();
var H = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var K = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var ze = d("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", K).replace("tag", H).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var le = d(F).replace("hr", B).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", H).getRegex();
var W = {
	blockquote: d(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", le).getRegex(),
	code: we,
	def: Le,
	fences: ye,
	heading: Pe,
	hr: B,
	html: ze,
	lheading: ae,
	list: _e,
	newline: Oe,
	paragraph: le,
	table: _,
	text: $e
};
var se = d("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", B).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", H).getRegex();
var Ee = {
	...W,
	lheading: Se,
	table: se,
	paragraph: d(F).replace("hr", B).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", se).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", H).getRegex()
};
var Ie = {
	...W,
	html: d(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", K).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),
	def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,
	heading: /^(#{1,6})(.*)(?:\n+|$)/,
	fences: _,
	lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
	paragraph: d(F).replace("hr", B).replace("heading", ` *#{1,6} *[^
]`).replace("lheading", ae).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex()
};
var Ae = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var Ce = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var ue = /^( {2,}|\\)\n(?!\s*$)/;
var Be = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var I = /[\p{P}\p{S}]/u;
var Z = /[\s\p{P}\p{S}]/u;
var X = /[^\s\p{P}\p{S}]/u;
var De = d(/^((?![*_])punctSpace)/, "u").replace(/punctSpace/g, Z).getRegex();
var pe = /(?!~)[\p{P}\p{S}]/u;
var qe = /(?!~)[\s\p{P}\p{S}]/u;
var ve = /(?:[^\s\p{P}\p{S}]|~)/u;
var He = d(/link|precode-code|html/, "g").replace("link", /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/).replace("precode-", Te ? "(?<!`)()" : "(^^|[^`])").replace("code", /(?<b>`+)[^`]+\k<b>(?!`)/).replace("html", /<(?! )[^<>]*?>/).getRegex();
var ce = /^(?:\*+(?:((?!\*)punct)|([^\s*]))?)|^_+(?:((?!_)punct)|([^\s_]))?/;
var Ze = d(ce, "u").replace(/punct/g, I).getRegex();
var Ge = d(ce, "u").replace(/punct/g, pe).getRegex();
var he = "^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)";
var Ne = d(he, "gu").replace(/notPunctSpace/g, X).replace(/punctSpace/g, Z).replace(/punct/g, I).getRegex();
var Qe = d(he, "gu").replace(/notPunctSpace/g, ve).replace(/punctSpace/g, qe).replace(/punct/g, pe).getRegex();
var je = d("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)", "gu").replace(/notPunctSpace/g, X).replace(/punctSpace/g, Z).replace(/punct/g, I).getRegex();
var Fe = d(/^~~?(?:((?!~)punct)|[^\s~])/, "u").replace(/punct/g, I).getRegex();
var Ke = d("^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)", "gu").replace(/notPunctSpace/g, X).replace(/punctSpace/g, Z).replace(/punct/g, I).getRegex();
var We = d(/\\(punct)/, "gu").replace(/punct/g, I).getRegex();
var Xe = d(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var Je = d(K).replace("(?:-->|$)", "-->").getRegex();
var Ve = d("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", Je).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var v = /(?:\[(?:\\[\s\S]|[^\[\]\\])*\]|\\[\s\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\])|[^\[\]\\`])*?/;
var Ye = d(/^!?\[(label)\]\(\s*(href)(?:(?:[ \t]+(?:\n[ \t]*)?|\n[ \t]*)(title))?\s*\)/).replace("label", v).replace("href", /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]*/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var ke = d(/^!?\[(label)\]\[(ref)\]/).replace("label", v).replace("ref", U).getRegex();
var de = d(/^!?\[(ref)\](?:\[\])?/).replace("ref", U).getRegex();
var et = d("reflink|nolink(?!\\()", "g").replace("reflink", ke).replace("nolink", de).getRegex();
var ie = /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/;
var J = {
	_backpedal: _,
	anyPunctuation: We,
	autolink: Xe,
	blockSkip: He,
	br: ue,
	code: Ce,
	del: _,
	delLDelim: _,
	delRDelim: _,
	emStrongLDelim: Ze,
	emStrongRDelimAst: Ne,
	emStrongRDelimUnd: je,
	escape: Ae,
	link: Ye,
	nolink: de,
	punctuation: De,
	reflink: ke,
	reflinkSearch: et,
	tag: Ve,
	text: Be,
	url: _
};
var tt = {
	...J,
	link: d(/^!?\[(label)\]\((.*?)\)/).replace("label", v).getRegex(),
	reflink: d(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", v).getRegex()
};
var Q = {
	...J,
	emStrongRDelimAst: Qe,
	emStrongLDelim: Ge,
	delLDelim: Fe,
	delRDelim: Ke,
	url: d(/^((?:protocol):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/).replace("protocol", ie).replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),
	_backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
	del: /^(~~?)(?=[^\s~])((?:\\[\s\S]|[^\\])*?(?:\\[\s\S]|[^\s~\\]))\1(?=[^~]|$)/,
	text: d(/^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|protocol:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/).replace("protocol", ie).getRegex()
};
var nt = {
	...Q,
	br: d(ue).replace("{2,}", "*").getRegex(),
	text: d(Q.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex()
};
var D = {
	normal: W,
	gfm: Ee,
	pedantic: Ie
};
var A = {
	normal: J,
	gfm: Q,
	breaks: nt,
	pedantic: tt
};
var rt = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;"
};
var ge = (l) => rt[l];
function O(l, e) {
	if (e) {
		if (m.escapeTest.test(l)) return l.replace(m.escapeReplace, ge);
	} else if (m.escapeTestNoEncode.test(l)) return l.replace(m.escapeReplaceNoEncode, ge);
	return l;
}
function V(l) {
	try {
		l = encodeURI(l).replace(m.percentDecode, "%");
	} catch {
		return null;
	}
	return l;
}
function Y(l, e) {
	let n = l.replace(m.findPipe, (r, i, o) => {
		let u = !1, a = i;
		for (; --a >= 0 && o[a] === "\\";) u = !u;
		return u ? "|" : " |";
	}).split(m.splitPipe), s = 0;
	if (n[0].trim() || n.shift(), n.length > 0 && !n.at(-1)?.trim() && n.pop(), e) if (n.length > e) n.splice(e);
	else for (; n.length < e;) n.push("");
	for (; s < n.length; s++) n[s] = n[s].trim().replace(m.slashPipe, "|");
	return n;
}
function $(l, e, t) {
	let n = l.length;
	if (n === 0) return "";
	let s = 0;
	for (; s < n;) {
		let r = l.charAt(n - s - 1);
		if (r === e && !t) s++;
		else if (r !== e && t) s++;
		else break;
	}
	return l.slice(0, n - s);
}
function ee(l) {
	let e = l.split(`
`), t = e.length - 1;
	for (; t >= 0 && m.blankLine.test(e[t]);) t--;
	return e.length - t <= 2 ? l : e.slice(0, t + 1).join(`
`);
}
function fe(l, e) {
	if (l.indexOf(e[1]) === -1) return -1;
	let t = 0;
	for (let n = 0; n < l.length; n++) if (l[n] === "\\") n++;
	else if (l[n] === e[0]) t++;
	else if (l[n] === e[1] && (t--, t < 0)) return n;
	return t > 0 ? -2 : -1;
}
function me(l, e = 0) {
	let t = e, n = "";
	for (let s of l) if (s === "	") {
		let r = 4 - t % 4;
		n += " ".repeat(r), t += r;
	} else n += s, t++;
	return n;
}
function xe(l, e, t, n, s) {
	let r = e.href, i = e.title || null, o = l[1].replace(s.other.outputLinkReplace, "$1");
	n.state.inLink = !0;
	let u = {
		type: l[0].charAt(0) === "!" ? "image" : "link",
		raw: t,
		href: r,
		title: i,
		text: o,
		tokens: n.inlineTokens(o)
	};
	return n.state.inLink = !1, u;
}
function st(l, e, t) {
	let n = l.match(t.other.indentCodeCompensation);
	if (n === null) return e;
	let s = n[1];
	return e.split(`
`).map((r) => {
		let i = r.match(t.other.beginningSpace);
		if (i === null) return r;
		let [o] = i;
		return o.length >= s.length ? r.slice(s.length) : r;
	}).join(`
`);
}
var w = class {
	options;
	rules;
	lexer;
	constructor(e) {
		this.options = e || T;
	}
	space(e) {
		let t = this.rules.block.newline.exec(e);
		if (t && t[0].length > 0) return {
			type: "space",
			raw: t[0]
		};
	}
	code(e) {
		let t = this.rules.block.code.exec(e);
		if (t) {
			let n = this.options.pedantic ? t[0] : ee(t[0]);
			return {
				type: "code",
				raw: n,
				codeBlockStyle: "indented",
				text: n.replace(this.rules.other.codeRemoveIndent, "")
			};
		}
	}
	fences(e) {
		let t = this.rules.block.fences.exec(e);
		if (t) {
			let n = t[0], s = st(n, t[3] || "", this.rules);
			return {
				type: "code",
				raw: n,
				lang: t[2] ? t[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : t[2],
				text: s
			};
		}
	}
	heading(e) {
		let t = this.rules.block.heading.exec(e);
		if (t) {
			let n = t[2].trim();
			if (this.rules.other.endingHash.test(n)) {
				let s = $(n, "#");
				(this.options.pedantic || !s || this.rules.other.endingSpaceChar.test(s)) && (n = s.trim());
			}
			return {
				type: "heading",
				raw: $(t[0], `
`),
				depth: t[1].length,
				text: n,
				tokens: this.lexer.inline(n)
			};
		}
	}
	hr(e) {
		let t = this.rules.block.hr.exec(e);
		if (t) return {
			type: "hr",
			raw: $(t[0], `
`)
		};
	}
	blockquote(e) {
		let t = this.rules.block.blockquote.exec(e);
		if (t) {
			let n = $(t[0], `
`).split(`
`), s = "", r = "", i = [];
			for (; n.length > 0;) {
				let o = !1, u = [], a;
				for (a = 0; a < n.length; a++) if (this.rules.other.blockquoteStart.test(n[a])) u.push(n[a]), o = !0;
				else if (!o) u.push(n[a]);
				else break;
				n = n.slice(a);
				let c = u.join(`
`), p = c.replace(this.rules.other.blockquoteSetextReplace, `
    $1`).replace(this.rules.other.blockquoteSetextReplace2, "");
				s = s ? `${s}
${c}` : c, r = r ? `${r}
${p}` : p;
				let k = this.lexer.state.top;
				if (this.lexer.state.top = !0, this.lexer.blockTokens(p, i, !0), this.lexer.state.top = k, n.length === 0) break;
				let h = i.at(-1);
				if (h?.type === "code") break;
				if (h?.type === "blockquote") {
					let R = h, f = R.raw + `
` + n.join(`
`), S = this.blockquote(f);
					i[i.length - 1] = S, s = s.substring(0, s.length - R.raw.length) + S.raw, r = r.substring(0, r.length - R.text.length) + S.text;
					break;
				} else if (h?.type === "list") {
					let R = h, f = R.raw + `
` + n.join(`
`), S = this.list(f);
					i[i.length - 1] = S, s = s.substring(0, s.length - h.raw.length) + S.raw, r = r.substring(0, r.length - R.raw.length) + S.raw, n = f.substring(i.at(-1).raw.length).split(`
`);
					continue;
				}
			}
			return {
				type: "blockquote",
				raw: s,
				tokens: i,
				text: r
			};
		}
	}
	list(e) {
		let t = this.rules.block.list.exec(e);
		if (t) {
			let n = t[1].trim(), s = n.length > 1, r = {
				type: "list",
				raw: "",
				ordered: s,
				start: s ? +n.slice(0, -1) : "",
				loose: !1,
				items: []
			};
			n = s ? `\\d{1,9}\\${n.slice(-1)}` : `\\${n}`, this.options.pedantic && (n = s ? n : "[*+-]");
			let i = this.rules.other.listItemRegex(n), o = !1;
			for (; e;) {
				let a = !1, c = "", p = "";
				if (!(t = i.exec(e)) || this.rules.block.hr.test(e)) break;
				c = t[0], e = e.substring(c.length);
				let k = me(t[2].split(`
`, 1)[0], t[1].length), h = e.split(`
`, 1)[0], R = !k.trim(), f = 0;
				if (this.options.pedantic ? (f = 2, p = k.trimStart()) : R ? f = t[1].length + 1 : (f = k.search(this.rules.other.nonSpaceChar), f = f > 4 ? 1 : f, p = k.slice(f), f += t[1].length), R && this.rules.other.blankLine.test(h) && (c += h + `
`, e = e.substring(h.length + 1), a = !0), !a) {
					let S = this.rules.other.nextBulletRegex(f), te = this.rules.other.hrRegex(f), ne = this.rules.other.fencesBeginRegex(f), re = this.rules.other.headingBeginRegex(f), be = this.rules.other.htmlBeginRegex(f), Re = this.rules.other.blockquoteBeginRegex(f);
					for (; e;) {
						let G = e.split(`
`, 1)[0], C;
						if (h = G, this.options.pedantic ? (h = h.replace(this.rules.other.listReplaceNesting, "  "), C = h) : C = h.replace(this.rules.other.tabCharGlobal, "    "), ne.test(h) || re.test(h) || be.test(h) || Re.test(h) || S.test(h) || te.test(h)) break;
						if (C.search(this.rules.other.nonSpaceChar) >= f || !h.trim()) p += `
` + C.slice(f);
						else {
							if (R || k.replace(this.rules.other.tabCharGlobal, "    ").search(this.rules.other.nonSpaceChar) >= 4 || ne.test(k) || re.test(k) || te.test(k)) break;
							p += `
` + h;
						}
						R = !h.trim(), c += G + `
`, e = e.substring(G.length + 1), k = C.slice(f);
					}
				}
				r.loose || (o ? r.loose = !0 : this.rules.other.doubleBlankLine.test(c) && (o = !0)), r.items.push({
					type: "list_item",
					raw: c,
					task: !!this.options.gfm && this.rules.other.listIsTask.test(p),
					loose: !1,
					text: p,
					tokens: []
				}), r.raw += c;
			}
			let u = r.items.at(-1);
			if (u) u.raw = u.raw.trimEnd(), u.text = u.text.trimEnd();
			else return;
			r.raw = r.raw.trimEnd();
			for (let a of r.items) {
				this.lexer.state.top = !1, a.tokens = this.lexer.blockTokens(a.text, []);
				let c = a.tokens[0];
				if (a.task && (c?.type === "text" || c?.type === "paragraph")) {
					a.text = a.text.replace(this.rules.other.listReplaceTask, ""), c.raw = c.raw.replace(this.rules.other.listReplaceTask, ""), c.text = c.text.replace(this.rules.other.listReplaceTask, "");
					for (let k = this.lexer.inlineQueue.length - 1; k >= 0; k--) if (this.rules.other.listIsTask.test(this.lexer.inlineQueue[k].src)) {
						this.lexer.inlineQueue[k].src = this.lexer.inlineQueue[k].src.replace(this.rules.other.listReplaceTask, "");
						break;
					}
					let p = this.rules.other.listTaskCheckbox.exec(a.raw);
					if (p) {
						let k = {
							type: "checkbox",
							raw: p[0] + " ",
							checked: p[0] !== "[ ]"
						};
						a.checked = k.checked, r.loose ? a.tokens[0] && ["paragraph", "text"].includes(a.tokens[0].type) && "tokens" in a.tokens[0] && a.tokens[0].tokens ? (a.tokens[0].raw = k.raw + a.tokens[0].raw, a.tokens[0].text = k.raw + a.tokens[0].text, a.tokens[0].tokens.unshift(k)) : a.tokens.unshift({
							type: "paragraph",
							raw: k.raw,
							text: k.raw,
							tokens: [k]
						}) : a.tokens.unshift(k);
					}
				} else a.task && (a.task = !1);
				if (!r.loose) {
					let p = a.tokens.filter((h) => h.type === "space");
					r.loose = p.length > 0 && p.some((h) => this.rules.other.anyLine.test(h.raw));
				}
			}
			if (r.loose) for (let a of r.items) {
				a.loose = !0;
				for (let c of a.tokens) c.type === "text" && (c.type = "paragraph");
			}
			return r;
		}
	}
	html(e) {
		let t = this.rules.block.html.exec(e);
		if (t) {
			let n = ee(t[0]);
			return {
				type: "html",
				block: !0,
				raw: n,
				pre: t[1] === "pre" || t[1] === "script" || t[1] === "style",
				text: n
			};
		}
	}
	def(e) {
		let t = this.rules.block.def.exec(e);
		if (t) {
			let n = t[1].toLowerCase().replace(this.rules.other.multipleSpaceGlobal, " "), s = t[2] ? t[2].replace(this.rules.other.hrefBrackets, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "", r = t[3] ? t[3].substring(1, t[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : t[3];
			return {
				type: "def",
				tag: n,
				raw: $(t[0], `
`),
				href: s,
				title: r
			};
		}
	}
	table(e) {
		let t = this.rules.block.table.exec(e);
		if (!t || !this.rules.other.tableDelimiter.test(t[2])) return;
		let n = Y(t[1]), s = t[2].replace(this.rules.other.tableAlignChars, "").split("|"), r = t[3]?.trim() ? t[3].replace(this.rules.other.tableRowBlankLine, "").split(`
`) : [], i = {
			type: "table",
			raw: $(t[0], `
`),
			header: [],
			align: [],
			rows: []
		};
		if (n.length === s.length) {
			for (let o of s) this.rules.other.tableAlignRight.test(o) ? i.align.push("right") : this.rules.other.tableAlignCenter.test(o) ? i.align.push("center") : this.rules.other.tableAlignLeft.test(o) ? i.align.push("left") : i.align.push(null);
			for (let o = 0; o < n.length; o++) i.header.push({
				text: n[o],
				tokens: this.lexer.inline(n[o]),
				header: !0,
				align: i.align[o]
			});
			for (let o of r) i.rows.push(Y(o, i.header.length).map((u, a) => ({
				text: u,
				tokens: this.lexer.inline(u),
				header: !1,
				align: i.align[a]
			})));
			return i;
		}
	}
	lheading(e) {
		let t = this.rules.block.lheading.exec(e);
		if (t) {
			let n = t[1].trim();
			return {
				type: "heading",
				raw: $(t[0], `
`),
				depth: t[2].charAt(0) === "=" ? 1 : 2,
				text: n,
				tokens: this.lexer.inline(n)
			};
		}
	}
	paragraph(e) {
		let t = this.rules.block.paragraph.exec(e);
		if (t) {
			let n = t[1].charAt(t[1].length - 1) === `
` ? t[1].slice(0, -1) : t[1];
			return {
				type: "paragraph",
				raw: t[0],
				text: n,
				tokens: this.lexer.inline(n)
			};
		}
	}
	text(e) {
		let t = this.rules.block.text.exec(e);
		if (t) return {
			type: "text",
			raw: t[0],
			text: t[0],
			tokens: this.lexer.inline(t[0])
		};
	}
	escape(e) {
		let t = this.rules.inline.escape.exec(e);
		if (t) return {
			type: "escape",
			raw: t[0],
			text: t[1]
		};
	}
	tag(e) {
		let t = this.rules.inline.tag.exec(e);
		if (t) return !this.lexer.state.inLink && this.rules.other.startATag.test(t[0]) ? this.lexer.state.inLink = !0 : this.lexer.state.inLink && this.rules.other.endATag.test(t[0]) && (this.lexer.state.inLink = !1), !this.lexer.state.inRawBlock && this.rules.other.startPreScriptTag.test(t[0]) ? this.lexer.state.inRawBlock = !0 : this.lexer.state.inRawBlock && this.rules.other.endPreScriptTag.test(t[0]) && (this.lexer.state.inRawBlock = !1), {
			type: "html",
			raw: t[0],
			inLink: this.lexer.state.inLink,
			inRawBlock: this.lexer.state.inRawBlock,
			block: !1,
			text: t[0]
		};
	}
	link(e) {
		let t = this.rules.inline.link.exec(e);
		if (t) {
			let n = t[2].trim();
			if (!this.options.pedantic && this.rules.other.startAngleBracket.test(n)) {
				if (!this.rules.other.endAngleBracket.test(n)) return;
				let i = $(n.slice(0, -1), "\\");
				if ((n.length - i.length) % 2 === 0) return;
			} else {
				let i = fe(t[2], "()");
				if (i === -2) return;
				if (i > -1) {
					let u = (t[0].indexOf("!") === 0 ? 5 : 4) + t[1].length + i;
					t[2] = t[2].substring(0, i), t[0] = t[0].substring(0, u).trim(), t[3] = "";
				}
			}
			let s = t[2], r = "";
			if (this.options.pedantic) {
				let i = this.rules.other.pedanticHrefTitle.exec(s);
				i && (s = i[1], r = i[3]);
			} else r = t[3] ? t[3].slice(1, -1) : "";
			return s = s.trim(), this.rules.other.startAngleBracket.test(s) && (this.options.pedantic && !this.rules.other.endAngleBracket.test(n) ? s = s.slice(1) : s = s.slice(1, -1)), xe(t, {
				href: s && s.replace(this.rules.inline.anyPunctuation, "$1"),
				title: r && r.replace(this.rules.inline.anyPunctuation, "$1")
			}, t[0], this.lexer, this.rules);
		}
	}
	reflink(e, t) {
		let n;
		if ((n = this.rules.inline.reflink.exec(e)) || (n = this.rules.inline.nolink.exec(e))) {
			let r = t[(n[2] || n[1]).replace(this.rules.other.multipleSpaceGlobal, " ").toLowerCase()];
			if (!r) {
				let i = n[0].charAt(0);
				return {
					type: "text",
					raw: i,
					text: i
				};
			}
			return xe(n, r, n[0], this.lexer, this.rules);
		}
	}
	emStrong(e, t, n = "") {
		let s = this.rules.inline.emStrongLDelim.exec(e);
		if (!s || !s[1] && !s[2] && !s[3] && !s[4] || s[4] && n.match(this.rules.other.unicodeAlphaNumeric)) return;
		if (!(s[1] || s[3] || "") || !n || this.rules.inline.punctuation.exec(n)) {
			let i = [...s[0]].length - 1, o, u, a = i, c = 0, p = s[0][0] === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
			for (p.lastIndex = 0, t = t.slice(-1 * e.length + i); (s = p.exec(t)) !== null;) {
				if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o) continue;
				if (u = [...o].length, s[3] || s[4]) {
					a += u;
					continue;
				} else if ((s[5] || s[6]) && i % 3 && !((i + u) % 3)) {
					c += u;
					continue;
				}
				if (a -= u, a > 0) continue;
				u = Math.min(u, u + a + c);
				let k = [...s[0]][0].length, h = e.slice(0, i + s.index + k + u);
				if (Math.min(i, u) % 2) {
					let f = h.slice(1, -1);
					return {
						type: "em",
						raw: h,
						text: f,
						tokens: this.lexer.inlineTokens(f)
					};
				}
				let R = h.slice(2, -2);
				return {
					type: "strong",
					raw: h,
					text: R,
					tokens: this.lexer.inlineTokens(R)
				};
			}
		}
	}
	codespan(e) {
		let t = this.rules.inline.code.exec(e);
		if (t) {
			let n = t[2].replace(this.rules.other.newLineCharGlobal, " "), s = this.rules.other.nonSpaceChar.test(n), r = this.rules.other.startingSpaceChar.test(n) && this.rules.other.endingSpaceChar.test(n);
			return s && r && (n = n.substring(1, n.length - 1)), {
				type: "codespan",
				raw: t[0],
				text: n
			};
		}
	}
	br(e) {
		let t = this.rules.inline.br.exec(e);
		if (t) return {
			type: "br",
			raw: t[0]
		};
	}
	del(e, t, n = "") {
		let s = this.rules.inline.delLDelim.exec(e);
		if (!s) return;
		if (!(s[1] || "") || !n || this.rules.inline.punctuation.exec(n)) {
			let i = [...s[0]].length - 1, o, u, a = i, c = this.rules.inline.delRDelim;
			for (c.lastIndex = 0, t = t.slice(-1 * e.length + i); (s = c.exec(t)) !== null;) {
				if (o = s[1] || s[2] || s[3] || s[4] || s[5] || s[6], !o || (u = [...o].length, u !== i)) continue;
				if (s[3] || s[4]) {
					a += u;
					continue;
				}
				if (a -= u, a > 0) continue;
				u = Math.min(u, u + a);
				let p = [...s[0]][0].length, k = e.slice(0, i + s.index + p + u), h = k.slice(i, -i);
				return {
					type: "del",
					raw: k,
					text: h,
					tokens: this.lexer.inlineTokens(h)
				};
			}
		}
	}
	autolink(e) {
		let t = this.rules.inline.autolink.exec(e);
		if (t) {
			let n, s;
			return t[2] === "@" ? (n = t[1], s = "mailto:" + n) : (n = t[1], s = n), {
				type: "link",
				raw: t[0],
				text: n,
				href: s,
				tokens: [{
					type: "text",
					raw: n,
					text: n
				}]
			};
		}
	}
	url(e) {
		let t;
		if (t = this.rules.inline.url.exec(e)) {
			let n, s;
			if (t[2] === "@") n = t[0], s = "mailto:" + n;
			else {
				let r;
				do
					r = t[0], t[0] = this.rules.inline._backpedal.exec(t[0])?.[0] ?? "";
				while (r !== t[0]);
				n = t[0], t[1] === "www." ? s = "http://" + t[0] : s = t[0];
			}
			return {
				type: "link",
				raw: t[0],
				text: n,
				href: s,
				tokens: [{
					type: "text",
					raw: n,
					text: n
				}]
			};
		}
	}
	inlineText(e) {
		let t = this.rules.inline.text.exec(e);
		if (t) {
			let n = this.lexer.state.inRawBlock;
			return {
				type: "text",
				raw: t[0],
				text: t[0],
				escaped: n
			};
		}
	}
};
var x = class l {
	tokens;
	options;
	state;
	inlineQueue;
	tokenizer;
	constructor(e) {
		this.tokens = [], this.tokens.links = Object.create(null), this.options = e || T, this.options.tokenizer = this.options.tokenizer || new w(), this.tokenizer = this.options.tokenizer, this.tokenizer.options = this.options, this.tokenizer.lexer = this, this.inlineQueue = [], this.state = {
			inLink: !1,
			inRawBlock: !1,
			top: !0
		};
		let t = {
			other: m,
			block: D.normal,
			inline: A.normal
		};
		this.options.pedantic ? (t.block = D.pedantic, t.inline = A.pedantic) : this.options.gfm && (t.block = D.gfm, this.options.breaks ? t.inline = A.breaks : t.inline = A.gfm), this.tokenizer.rules = t;
	}
	static get rules() {
		return {
			block: D,
			inline: A
		};
	}
	static lex(e, t) {
		return new l(t).lex(e);
	}
	static lexInline(e, t) {
		return new l(t).inlineTokens(e);
	}
	lex(e) {
		e = e.replace(m.carriageReturn, `
`), this.blockTokens(e, this.tokens);
		for (let t = 0; t < this.inlineQueue.length; t++) {
			let n = this.inlineQueue[t];
			this.inlineTokens(n.src, n.tokens);
		}
		return this.inlineQueue = [], this.tokens;
	}
	blockTokens(e, t = [], n = !1) {
		this.tokenizer.lexer = this, this.options.pedantic && (e = e.replace(m.tabCharGlobal, "    ").replace(m.spaceLine, ""));
		let s = 1 / 0;
		for (; e;) {
			if (e.length < s) s = e.length;
			else {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
			let r;
			if (this.options.extensions?.block?.some((o) => (r = o.call({ lexer: this }, e, t)) ? (e = e.substring(r.raw.length), t.push(r), !0) : !1)) continue;
			if (r = this.tokenizer.space(e)) {
				e = e.substring(r.raw.length);
				let o = t.at(-1);
				r.raw.length === 1 && o !== void 0 ? o.raw += `
` : t.push(r);
				continue;
			}
			if (r = this.tokenizer.code(e)) {
				e = e.substring(r.raw.length);
				let o = t.at(-1);
				o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.at(-1).src = o.text) : t.push(r);
				continue;
			}
			if (r = this.tokenizer.fences(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.heading(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.hr(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.blockquote(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.list(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.html(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.def(e)) {
				e = e.substring(r.raw.length);
				let o = t.at(-1);
				o?.type === "paragraph" || o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.raw, this.inlineQueue.at(-1).src = o.text) : this.tokens.links[r.tag] || (this.tokens.links[r.tag] = {
					href: r.href,
					title: r.title
				}, t.push(r));
				continue;
			}
			if (r = this.tokenizer.table(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			if (r = this.tokenizer.lheading(e)) {
				e = e.substring(r.raw.length), t.push(r);
				continue;
			}
			let i = e;
			if (this.options.extensions?.startBlock) {
				let o = 1 / 0, u = e.slice(1), a;
				this.options.extensions.startBlock.forEach((c) => {
					a = c.call({ lexer: this }, u), typeof a == "number" && a >= 0 && (o = Math.min(o, a));
				}), o < 1 / 0 && o >= 0 && (i = e.substring(0, o + 1));
			}
			if (this.state.top && (r = this.tokenizer.paragraph(i))) {
				let o = t.at(-1);
				n && o?.type === "paragraph" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r), n = i.length !== e.length, e = e.substring(r.raw.length);
				continue;
			}
			if (r = this.tokenizer.text(e)) {
				e = e.substring(r.raw.length);
				let o = t.at(-1);
				o?.type === "text" ? (o.raw += (o.raw.endsWith(`
`) ? "" : `
`) + r.raw, o.text += `
` + r.text, this.inlineQueue.pop(), this.inlineQueue.at(-1).src = o.text) : t.push(r);
				continue;
			}
			if (e) {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
		}
		return this.state.top = !0, t;
	}
	inline(e, t = []) {
		return this.inlineQueue.push({
			src: e,
			tokens: t
		}), t;
	}
	inlineTokens(e, t = []) {
		this.tokenizer.lexer = this;
		let n = e, s = null;
		if (this.tokens.links) {
			let a = Object.keys(this.tokens.links);
			if (a.length > 0) for (; (s = this.tokenizer.rules.inline.reflinkSearch.exec(n)) !== null;) a.includes(s[0].slice(s[0].lastIndexOf("[") + 1, -1)) && (n = n.slice(0, s.index) + "[" + "a".repeat(s[0].length - 2) + "]" + n.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex));
		}
		for (; (s = this.tokenizer.rules.inline.anyPunctuation.exec(n)) !== null;) n = n.slice(0, s.index) + "++" + n.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
		let r;
		for (; (s = this.tokenizer.rules.inline.blockSkip.exec(n)) !== null;) r = s[2] ? s[2].length : 0, n = n.slice(0, s.index + r) + "[" + "a".repeat(s[0].length - r - 2) + "]" + n.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
		n = this.options.hooks?.emStrongMask?.call({ lexer: this }, n) ?? n;
		let i = !1, o = "", u = 1 / 0;
		for (; e;) {
			if (e.length < u) u = e.length;
			else {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
			i || (o = ""), i = !1;
			let a;
			if (this.options.extensions?.inline?.some((p) => (a = p.call({ lexer: this }, e, t)) ? (e = e.substring(a.raw.length), t.push(a), !0) : !1)) continue;
			if (a = this.tokenizer.escape(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.tag(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.link(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.reflink(e, this.tokens.links)) {
				e = e.substring(a.raw.length);
				let p = t.at(-1);
				a.type === "text" && p?.type === "text" ? (p.raw += a.raw, p.text += a.text) : t.push(a);
				continue;
			}
			if (a = this.tokenizer.emStrong(e, n, o)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.codespan(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.br(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.del(e, n, o)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (a = this.tokenizer.autolink(e)) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			if (!this.state.inLink && (a = this.tokenizer.url(e))) {
				e = e.substring(a.raw.length), t.push(a);
				continue;
			}
			let c = e;
			if (this.options.extensions?.startInline) {
				let p = 1 / 0, k = e.slice(1), h;
				this.options.extensions.startInline.forEach((R) => {
					h = R.call({ lexer: this }, k), typeof h == "number" && h >= 0 && (p = Math.min(p, h));
				}), p < 1 / 0 && p >= 0 && (c = e.substring(0, p + 1));
			}
			if (a = this.tokenizer.inlineText(c)) {
				e = e.substring(a.raw.length), a.raw.slice(-1) !== "_" && (o = a.raw.slice(-1)), i = !0;
				let p = t.at(-1);
				p?.type === "text" ? (p.raw += a.raw, p.text += a.text) : t.push(a);
				continue;
			}
			if (e) {
				this.infiniteLoopError(e.charCodeAt(0));
				break;
			}
		}
		return t;
	}
	infiniteLoopError(e) {
		let t = "Infinite loop on byte: " + e;
		if (this.options.silent) console.error(t);
		else throw new Error(t);
	}
};
var y = class {
	options;
	parser;
	constructor(e) {
		this.options = e || T;
	}
	space(e) {
		return "";
	}
	code({ text: e, lang: t, escaped: n }) {
		let s = (t || "").match(m.notSpaceStart)?.[0], r = e.replace(m.endingNewline, "") + `
`;
		return s ? "<pre><code class=\"language-" + O(s) + "\">" + (n ? r : O(r, !0)) + `</code></pre>
` : "<pre><code>" + (n ? r : O(r, !0)) + `</code></pre>
`;
	}
	blockquote({ tokens: e }) {
		return `<blockquote>
${this.parser.parse(e)}</blockquote>
`;
	}
	html({ text: e }) {
		return e;
	}
	def(e) {
		return "";
	}
	heading({ tokens: e, depth: t }) {
		return `<h${t}>${this.parser.parseInline(e)}</h${t}>
`;
	}
	hr(e) {
		return `<hr>
`;
	}
	list(e) {
		let t = e.ordered, n = e.start, s = "";
		for (let o = 0; o < e.items.length; o++) {
			let u = e.items[o];
			s += this.listitem(u);
		}
		let r = t ? "ol" : "ul", i = t && n !== 1 ? " start=\"" + n + "\"" : "";
		return "<" + r + i + `>
` + s + "</" + r + `>
`;
	}
	listitem(e) {
		return `<li>${this.parser.parse(e.tokens)}</li>
`;
	}
	checkbox({ checked: e }) {
		return "<input " + (e ? "checked=\"\" " : "") + "disabled=\"\" type=\"checkbox\"> ";
	}
	paragraph({ tokens: e }) {
		return `<p>${this.parser.parseInline(e)}</p>
`;
	}
	table(e) {
		let t = "", n = "";
		for (let r = 0; r < e.header.length; r++) n += this.tablecell(e.header[r]);
		t += this.tablerow({ text: n });
		let s = "";
		for (let r = 0; r < e.rows.length; r++) {
			let i = e.rows[r];
			n = "";
			for (let o = 0; o < i.length; o++) n += this.tablecell(i[o]);
			s += this.tablerow({ text: n });
		}
		return s && (s = `<tbody>${s}</tbody>`), `<table>
<thead>
` + t + `</thead>
` + s + `</table>
`;
	}
	tablerow({ text: e }) {
		return `<tr>
${e}</tr>
`;
	}
	tablecell(e) {
		let t = this.parser.parseInline(e.tokens), n = e.header ? "th" : "td";
		return (e.align ? `<${n} align="${e.align}">` : `<${n}>`) + t + `</${n}>
`;
	}
	strong({ tokens: e }) {
		return `<strong>${this.parser.parseInline(e)}</strong>`;
	}
	em({ tokens: e }) {
		return `<em>${this.parser.parseInline(e)}</em>`;
	}
	codespan({ text: e }) {
		return `<code>${O(e, !0)}</code>`;
	}
	br(e) {
		return "<br>";
	}
	del({ tokens: e }) {
		return `<del>${this.parser.parseInline(e)}</del>`;
	}
	link({ href: e, title: t, tokens: n }) {
		let s = this.parser.parseInline(n), r = V(e);
		if (r === null) return s;
		e = r;
		let i = "<a href=\"" + e + "\"";
		return t && (i += " title=\"" + O(t) + "\""), i += ">" + s + "</a>", i;
	}
	image({ href: e, title: t, text: n, tokens: s }) {
		s && (n = this.parser.parseInline(s, this.parser.textRenderer));
		let r = V(e);
		if (r === null) return O(n);
		e = r;
		let i = `<img src="${e}" alt="${O(n)}"`;
		return t && (i += ` title="${O(t)}"`), i += ">", i;
	}
	text(e) {
		return "tokens" in e && e.tokens ? this.parser.parseInline(e.tokens) : "escaped" in e && e.escaped ? e.text : O(e.text);
	}
};
var L = class {
	strong({ text: e }) {
		return e;
	}
	em({ text: e }) {
		return e;
	}
	codespan({ text: e }) {
		return e;
	}
	del({ text: e }) {
		return e;
	}
	html({ text: e }) {
		return e;
	}
	text({ text: e }) {
		return e;
	}
	link({ text: e }) {
		return "" + e;
	}
	image({ text: e }) {
		return "" + e;
	}
	br() {
		return "";
	}
	checkbox({ raw: e }) {
		return e;
	}
};
var b = class l {
	options;
	renderer;
	textRenderer;
	constructor(e) {
		this.options = e || T, this.options.renderer = this.options.renderer || new y(), this.renderer = this.options.renderer, this.renderer.options = this.options, this.renderer.parser = this, this.textRenderer = new L();
	}
	static parse(e, t) {
		return new l(t).parse(e);
	}
	static parseInline(e, t) {
		return new l(t).parseInline(e);
	}
	parse(e) {
		this.renderer.parser = this;
		let t = "";
		for (let n = 0; n < e.length; n++) {
			let s = e[n];
			if (this.options.extensions?.renderers?.[s.type]) {
				let i = s, o = this.options.extensions.renderers[i.type].call({ parser: this }, i);
				if (o !== !1 || ![
					"space",
					"hr",
					"heading",
					"code",
					"table",
					"blockquote",
					"list",
					"html",
					"def",
					"paragraph",
					"text"
				].includes(i.type)) {
					t += o || "";
					continue;
				}
			}
			let r = s;
			switch (r.type) {
				case "space":
					t += this.renderer.space(r);
					break;
				case "hr":
					t += this.renderer.hr(r);
					break;
				case "heading":
					t += this.renderer.heading(r);
					break;
				case "code":
					t += this.renderer.code(r);
					break;
				case "table":
					t += this.renderer.table(r);
					break;
				case "blockquote":
					t += this.renderer.blockquote(r);
					break;
				case "list":
					t += this.renderer.list(r);
					break;
				case "checkbox":
					t += this.renderer.checkbox(r);
					break;
				case "html":
					t += this.renderer.html(r);
					break;
				case "def":
					t += this.renderer.def(r);
					break;
				case "paragraph":
					t += this.renderer.paragraph(r);
					break;
				case "text":
					t += this.renderer.text(r);
					break;
				default: {
					let i = "Token with \"" + r.type + "\" type was not found.";
					if (this.options.silent) return console.error(i), "";
					throw new Error(i);
				}
			}
		}
		return t;
	}
	parseInline(e, t = this.renderer) {
		this.renderer.parser = this;
		let n = "";
		for (let s = 0; s < e.length; s++) {
			let r = e[s];
			if (this.options.extensions?.renderers?.[r.type]) {
				let o = this.options.extensions.renderers[r.type].call({ parser: this }, r);
				if (o !== !1 || ![
					"escape",
					"html",
					"link",
					"image",
					"strong",
					"em",
					"codespan",
					"br",
					"del",
					"text"
				].includes(r.type)) {
					n += o || "";
					continue;
				}
			}
			let i = r;
			switch (i.type) {
				case "escape":
					n += t.text(i);
					break;
				case "html":
					n += t.html(i);
					break;
				case "link":
					n += t.link(i);
					break;
				case "image":
					n += t.image(i);
					break;
				case "checkbox":
					n += t.checkbox(i);
					break;
				case "strong":
					n += t.strong(i);
					break;
				case "em":
					n += t.em(i);
					break;
				case "codespan":
					n += t.codespan(i);
					break;
				case "br":
					n += t.br(i);
					break;
				case "del":
					n += t.del(i);
					break;
				case "text":
					n += t.text(i);
					break;
				default: {
					let o = "Token with \"" + i.type + "\" type was not found.";
					if (this.options.silent) return console.error(o), "";
					throw new Error(o);
				}
			}
		}
		return n;
	}
};
var P = class {
	options;
	block;
	constructor(e) {
		this.options = e || T;
	}
	static passThroughHooks = /* @__PURE__ */ new Set([
		"preprocess",
		"postprocess",
		"processAllTokens",
		"emStrongMask"
	]);
	static passThroughHooksRespectAsync = /* @__PURE__ */ new Set([
		"preprocess",
		"postprocess",
		"processAllTokens"
	]);
	preprocess(e) {
		return e;
	}
	postprocess(e) {
		return e;
	}
	processAllTokens(e) {
		return e;
	}
	emStrongMask(e) {
		return e;
	}
	provideLexer(e = this.block) {
		return e ? x.lex : x.lexInline;
	}
	provideParser(e = this.block) {
		return e ? b.parse : b.parseInline;
	}
};
var q = class {
	defaults = M();
	options = this.setOptions;
	parse = this.parseMarkdown(!0);
	parseInline = this.parseMarkdown(!1);
	Parser = b;
	Renderer = y;
	TextRenderer = L;
	Lexer = x;
	Tokenizer = w;
	Hooks = P;
	constructor(...e) {
		this.use(...e);
	}
	walkTokens(e, t) {
		let n = [];
		for (let s of e) switch (n = n.concat(t.call(this, s)), s.type) {
			case "table": {
				let r = s;
				for (let i of r.header) n = n.concat(this.walkTokens(i.tokens, t));
				for (let i of r.rows) for (let o of i) n = n.concat(this.walkTokens(o.tokens, t));
				break;
			}
			case "list": {
				let r = s;
				n = n.concat(this.walkTokens(r.items, t));
				break;
			}
			default: {
				let r = s;
				this.defaults.extensions?.childTokens?.[r.type] ? this.defaults.extensions.childTokens[r.type].forEach((i) => {
					let o = r[i].flat(1 / 0);
					n = n.concat(this.walkTokens(o, t));
				}) : r.tokens && (n = n.concat(this.walkTokens(r.tokens, t)));
			}
		}
		return n;
	}
	use(...e) {
		let t = this.defaults.extensions || {
			renderers: {},
			childTokens: {}
		};
		return e.forEach((n) => {
			let s = { ...n };
			if (s.async = this.defaults.async || s.async || !1, n.extensions && (n.extensions.forEach((r) => {
				if (!r.name) throw new Error("extension name required");
				if ("renderer" in r) {
					let i = t.renderers[r.name];
					i ? t.renderers[r.name] = function(...o) {
						let u = r.renderer.apply(this, o);
						return u === !1 && (u = i.apply(this, o)), u;
					} : t.renderers[r.name] = r.renderer;
				}
				if ("tokenizer" in r) {
					if (!r.level || r.level !== "block" && r.level !== "inline") throw new Error("extension level must be 'block' or 'inline'");
					let i = t[r.level];
					i ? i.unshift(r.tokenizer) : t[r.level] = [r.tokenizer], r.start && (r.level === "block" ? t.startBlock ? t.startBlock.push(r.start) : t.startBlock = [r.start] : r.level === "inline" && (t.startInline ? t.startInline.push(r.start) : t.startInline = [r.start]));
				}
				"childTokens" in r && r.childTokens && (t.childTokens[r.name] = r.childTokens);
			}), s.extensions = t), n.renderer) {
				let r = this.defaults.renderer || new y(this.defaults);
				for (let i in n.renderer) {
					if (!(i in r)) throw new Error(`renderer '${i}' does not exist`);
					if (["options", "parser"].includes(i)) continue;
					let o = i, u = n.renderer[o], a = r[o];
					r[o] = (...c) => {
						let p = u.apply(r, c);
						return p === !1 && (p = a.apply(r, c)), p || "";
					};
				}
				s.renderer = r;
			}
			if (n.tokenizer) {
				let r = this.defaults.tokenizer || new w(this.defaults);
				for (let i in n.tokenizer) {
					if (!(i in r)) throw new Error(`tokenizer '${i}' does not exist`);
					if ([
						"options",
						"rules",
						"lexer"
					].includes(i)) continue;
					let o = i, u = n.tokenizer[o], a = r[o];
					r[o] = (...c) => {
						let p = u.apply(r, c);
						return p === !1 && (p = a.apply(r, c)), p;
					};
				}
				s.tokenizer = r;
			}
			if (n.hooks) {
				let r = this.defaults.hooks || new P();
				for (let i in n.hooks) {
					if (!(i in r)) throw new Error(`hook '${i}' does not exist`);
					if (["options", "block"].includes(i)) continue;
					let o = i, u = n.hooks[o], a = r[o];
					P.passThroughHooks.has(i) ? r[o] = (c) => {
						if (this.defaults.async && P.passThroughHooksRespectAsync.has(i)) return (async () => {
							let k = await u.call(r, c);
							return a.call(r, k);
						})();
						let p = u.call(r, c);
						return a.call(r, p);
					} : r[o] = (...c) => {
						if (this.defaults.async) return (async () => {
							let k = await u.apply(r, c);
							return k === !1 && (k = await a.apply(r, c)), k;
						})();
						let p = u.apply(r, c);
						return p === !1 && (p = a.apply(r, c)), p;
					};
				}
				s.hooks = r;
			}
			if (n.walkTokens) {
				let r = this.defaults.walkTokens, i = n.walkTokens;
				s.walkTokens = function(o) {
					let u = [];
					return u.push(i.call(this, o)), r && (u = u.concat(r.call(this, o))), u;
				};
			}
			this.defaults = {
				...this.defaults,
				...s
			};
		}), this;
	}
	setOptions(e) {
		return this.defaults = {
			...this.defaults,
			...e
		}, this;
	}
	lexer(e, t) {
		return x.lex(e, t ?? this.defaults);
	}
	parser(e, t) {
		return b.parse(e, t ?? this.defaults);
	}
	parseMarkdown(e) {
		return (n, s) => {
			let r = { ...s }, i = {
				...this.defaults,
				...r
			}, o = this.onError(!!i.silent, !!i.async);
			if (this.defaults.async === !0 && r.async === !1) return o(/* @__PURE__ */ new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
			if (typeof n > "u" || n === null) return o(/* @__PURE__ */ new Error("marked(): input parameter is undefined or null"));
			if (typeof n != "string") return o(/* @__PURE__ */ new Error("marked(): input parameter is of type " + Object.prototype.toString.call(n) + ", string expected"));
			if (i.hooks && (i.hooks.options = i, i.hooks.block = e), i.async) return (async () => {
				let u = i.hooks ? await i.hooks.preprocess(n) : n, c = await (i.hooks ? await i.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(u, i), p = i.hooks ? await i.hooks.processAllTokens(c) : c;
				i.walkTokens && await Promise.all(this.walkTokens(p, i.walkTokens));
				let h = await (i.hooks ? await i.hooks.provideParser(e) : e ? b.parse : b.parseInline)(p, i);
				return i.hooks ? await i.hooks.postprocess(h) : h;
			})().catch(o);
			try {
				i.hooks && (n = i.hooks.preprocess(n));
				let a = (i.hooks ? i.hooks.provideLexer(e) : e ? x.lex : x.lexInline)(n, i);
				i.hooks && (a = i.hooks.processAllTokens(a)), i.walkTokens && this.walkTokens(a, i.walkTokens);
				let p = (i.hooks ? i.hooks.provideParser(e) : e ? b.parse : b.parseInline)(a, i);
				return i.hooks && (p = i.hooks.postprocess(p)), p;
			} catch (u) {
				return o(u);
			}
		};
	}
	onError(e, t) {
		return (n) => {
			if (n.message += `
Please report this to https://github.com/markedjs/marked.`, e) {
				let s = "<p>An error occurred:</p><pre>" + O(n.message + "", !0) + "</pre>";
				return t ? Promise.resolve(s) : s;
			}
			if (t) return Promise.reject(n);
			throw n;
		};
	}
};
var z$1 = new q();
function g(l, e) {
	return z$1.parse(l, e);
}
g.options = g.setOptions = function(l) {
	return z$1.setOptions(l), g.defaults = z$1.defaults, N(g.defaults), g;
};
g.getDefaults = M;
g.defaults = T;
g.use = function(...l) {
	return z$1.use(...l), g.defaults = z$1.defaults, N(g.defaults), g;
};
g.walkTokens = function(l, e) {
	return z$1.walkTokens(l, e);
};
g.parseInline = z$1.parseInline;
g.Parser = b;
g.parser = b.parse;
g.Renderer = y;
g.TextRenderer = L;
g.Lexer = x;
g.lexer = x.lex;
g.Tokenizer = w;
g.Hooks = P;
g.parse = g;
var Ft = g.options;
var Ut = g.setOptions;
var Kt = g.use;
var Wt = g.walkTokens;
var Xt = g.parseInline;
var Vt = b.parse;
var Yt = x.lex;

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/components/markdown.js
const STRICT_STRIKETHROUGH_REGEX = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/;
var StrictStrikethroughTokenizer = class extends w {
	del(src) {
		const match = STRICT_STRIKETHROUGH_REGEX.exec(src);
		if (!match) return;
		const text = match[2];
		return {
			type: "del",
			raw: match[0],
			text,
			tokens: this.lexer.inlineTokens(text)
		};
	}
};
function trimPartialClosingFences(tokens) {
	const token = tokens[tokens.length - 1];
	if (token?.type === "list") {
		trimPartialClosingFences(token.items[token.items.length - 1]?.tokens ?? []);
		return;
	}
	if (token?.type === "blockquote") {
		trimPartialClosingFences(token.tokens ?? []);
		return;
	}
	if (token?.type !== "code") return;
	const marker = /^(`{3,}|~{3,})/.exec(token.raw)?.[1];
	const lastLine = token.raw.split("\n").pop();
	if (!marker || !lastLine || lastLine.length >= marker.length || lastLine !== marker[0]?.repeat(lastLine.length)) return;
	token.text = token.text.slice(0, -lastLine.length).replace(/\n$/, "");
}
const markdownParser = new q();
markdownParser.setOptions({ tokenizer: new StrictStrikethroughTokenizer() });
var Markdown = class {
	text;
	paddingX;
	paddingY;
	defaultTextStyle;
	theme;
	options;
	defaultStylePrefix;
	cachedText;
	cachedWidth;
	cachedLines;
	constructor(text, paddingX, paddingY, theme, defaultTextStyle, options) {
		this.text = text;
		this.paddingX = paddingX;
		this.paddingY = paddingY;
		this.theme = theme;
		this.defaultTextStyle = defaultTextStyle;
		this.options = options ? { ...options } : {};
	}
	setText(text) {
		this.text = text;
		this.invalidate();
	}
	invalidate() {
		this.cachedText = void 0;
		this.cachedWidth = void 0;
		this.cachedLines = void 0;
	}
	render(width) {
		if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width) return this.cachedLines;
		const contentWidth = Math.max(1, width - this.paddingX * 2);
		if (!this.text || this.text.trim() === "") {
			const result = [];
			this.cachedText = this.text;
			this.cachedWidth = width;
			this.cachedLines = result;
			return result;
		}
		const normalizedText = this.text.replace(/\t/g, "   ");
		const tokens = markdownParser.lexer(normalizedText);
		trimPartialClosingFences(tokens);
		const renderedLines = [];
		for (let i = 0; i < tokens.length; i++) {
			const token = tokens[i];
			const nextToken = tokens[i + 1];
			const tokenLines = this.renderToken(token, contentWidth, nextToken?.type);
			for (const tokenLine of tokenLines) renderedLines.push(tokenLine);
		}
		const wrappedLines = [];
		for (const line of renderedLines) if (isImageLine(line)) wrappedLines.push(line);
		else for (const wrappedLine of wrapTextWithAnsi(line, contentWidth)) wrappedLines.push(wrappedLine);
		const leftMargin = " ".repeat(this.paddingX);
		const rightMargin = " ".repeat(this.paddingX);
		const bgFn = this.defaultTextStyle?.bgColor;
		const contentLines = [];
		for (const line of wrappedLines) {
			if (isImageLine(line)) {
				contentLines.push(line);
				continue;
			}
			const lineWithMargins = leftMargin + line + rightMargin;
			if (bgFn) contentLines.push(applyBackgroundToLine(lineWithMargins, width, bgFn));
			else {
				const visibleLen = visibleWidth(lineWithMargins);
				const paddingNeeded = Math.max(0, width - visibleLen);
				contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
			}
		}
		const emptyLine = " ".repeat(width);
		const emptyLines = [];
		for (let i = 0; i < this.paddingY; i++) {
			const line = bgFn ? applyBackgroundToLine(emptyLine, width, bgFn) : emptyLine;
			emptyLines.push(line);
		}
		const result = emptyLines.concat(contentLines, emptyLines);
		this.cachedText = this.text;
		this.cachedWidth = width;
		this.cachedLines = result;
		return result.length > 0 ? result : [""];
	}
	/**
	* Apply default text style to a string.
	* This is the base styling applied to all text content.
	* NOTE: Background color is NOT applied here - it's applied at the padding stage
	* to ensure it extends to the full line width.
	*/
	applyDefaultStyle(text) {
		if (!this.defaultTextStyle) return text;
		let styled = text;
		if (this.defaultTextStyle.color) styled = this.defaultTextStyle.color(styled);
		if (this.defaultTextStyle.bold) styled = this.theme.bold(styled);
		if (this.defaultTextStyle.italic) styled = this.theme.italic(styled);
		if (this.defaultTextStyle.strikethrough) styled = this.theme.strikethrough(styled);
		if (this.defaultTextStyle.underline) styled = this.theme.underline(styled);
		return styled;
	}
	getDefaultStylePrefix() {
		if (!this.defaultTextStyle) return "";
		if (this.defaultStylePrefix !== void 0) return this.defaultStylePrefix;
		const sentinel = "\0";
		let styled = sentinel;
		if (this.defaultTextStyle.color) styled = this.defaultTextStyle.color(styled);
		if (this.defaultTextStyle.bold) styled = this.theme.bold(styled);
		if (this.defaultTextStyle.italic) styled = this.theme.italic(styled);
		if (this.defaultTextStyle.strikethrough) styled = this.theme.strikethrough(styled);
		if (this.defaultTextStyle.underline) styled = this.theme.underline(styled);
		const sentinelIndex = styled.indexOf(sentinel);
		this.defaultStylePrefix = sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
		return this.defaultStylePrefix;
	}
	getStylePrefix(styleFn) {
		const sentinel = "\0";
		const styled = styleFn(sentinel);
		const sentinelIndex = styled.indexOf(sentinel);
		return sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
	}
	getDefaultInlineStyleContext() {
		return {
			applyText: (text) => this.applyDefaultStyle(text),
			stylePrefix: this.getDefaultStylePrefix()
		};
	}
	renderToken(token, width, nextTokenType, styleContext) {
		const lines = [];
		switch (token.type) {
			case "heading": {
				const headingLevel = token.depth;
				const headingPrefix = `${"#".repeat(headingLevel)} `;
				let headingStyleFn;
				if (headingLevel === 1) headingStyleFn = (text) => this.theme.heading(this.theme.bold(this.theme.underline(text)));
				else headingStyleFn = (text) => this.theme.heading(this.theme.bold(text));
				const headingStyleContext = {
					applyText: headingStyleFn,
					stylePrefix: this.getStylePrefix(headingStyleFn)
				};
				const headingText = this.renderInlineTokens(token.tokens || [], headingStyleContext);
				const styledHeading = headingLevel >= 3 ? headingStyleFn(headingPrefix) + headingText : headingText;
				lines.push(styledHeading);
				if (nextTokenType && nextTokenType !== "space") lines.push("");
				break;
			}
			case "paragraph": {
				const paragraphText = this.renderInlineTokens(token.tokens || [], styleContext);
				lines.push(paragraphText);
				if (nextTokenType && nextTokenType !== "list" && nextTokenType !== "space") lines.push("");
				break;
			}
			case "text":
				lines.push(this.renderInlineTokens([token], styleContext));
				break;
			case "code": {
				const indent = this.theme.codeBlockIndent ?? "  ";
				lines.push(this.theme.codeBlockBorder(`\`\`\`${token.lang || ""}`));
				if (this.theme.highlightCode) {
					const highlightedLines = this.theme.highlightCode(token.text, token.lang);
					for (const hlLine of highlightedLines) lines.push(`${indent}${hlLine}`);
				} else {
					const codeLines = token.text.split("\n");
					for (const codeLine of codeLines) lines.push(`${indent}${this.theme.codeBlock(codeLine)}`);
				}
				lines.push(this.theme.codeBlockBorder("```"));
				if (nextTokenType && nextTokenType !== "space") lines.push("");
				break;
			}
			case "list": {
				const listLines = this.renderList(token, 0, width, styleContext);
				lines.push(...listLines);
				break;
			}
			case "table": {
				const tableLines = this.renderTable(token, width, nextTokenType, styleContext);
				lines.push(...tableLines);
				break;
			}
			case "blockquote": {
				const quoteStyle = (text) => this.theme.quote(this.theme.italic(text));
				const quoteStylePrefix = this.getStylePrefix(quoteStyle);
				const applyQuoteStyle = (line) => {
					if (!quoteStylePrefix) return quoteStyle(line);
					const lineWithReappliedStyle = line.replace(/\x1b\[0m/g, `\x1b[0m${quoteStylePrefix}`);
					return quoteStyle(lineWithReappliedStyle);
				};
				const quoteContentWidth = Math.max(1, width - 2);
				const quoteInlineStyleContext = {
					applyText: (text) => text,
					stylePrefix: quoteStylePrefix
				};
				const quoteTokens = token.tokens || [];
				const renderedQuoteLines = [];
				for (let i = 0; i < quoteTokens.length; i++) {
					const quoteToken = quoteTokens[i];
					const nextQuoteToken = quoteTokens[i + 1];
					renderedQuoteLines.push(...this.renderToken(quoteToken, quoteContentWidth, nextQuoteToken?.type, quoteInlineStyleContext));
				}
				while (renderedQuoteLines.length > 0 && renderedQuoteLines[renderedQuoteLines.length - 1] === "") renderedQuoteLines.pop();
				for (const quoteLine of renderedQuoteLines) {
					const styledLine = applyQuoteStyle(quoteLine);
					const wrappedLines = wrapTextWithAnsi(styledLine, quoteContentWidth);
					for (const wrappedLine of wrappedLines) lines.push(this.theme.quoteBorder("│ ") + wrappedLine);
				}
				if (nextTokenType && nextTokenType !== "space") lines.push("");
				break;
			}
			case "hr":
				lines.push(this.theme.hr("─".repeat(Math.min(width, 80))));
				if (nextTokenType && nextTokenType !== "space") lines.push("");
				break;
			case "html":
				if ("raw" in token && typeof token.raw === "string") lines.push(this.applyDefaultStyle(token.raw.trim()));
				break;
			case "space":
				lines.push("");
				break;
			default: if ("text" in token && typeof token.text === "string") lines.push(token.text);
		}
		return lines;
	}
	renderInlineTokens(tokens, styleContext) {
		let result = "";
		const resolvedStyleContext = styleContext ?? this.getDefaultInlineStyleContext();
		const { applyText, stylePrefix } = resolvedStyleContext;
		const applyTextWithNewlines = (text) => {
			return text.split("\n").map((segment) => applyText(segment)).join("\n");
		};
		for (const token of tokens) switch (token.type) {
			case "escape":
				result += applyTextWithNewlines(this.options.preserveBackslashEscapes ? token.raw : token.text);
				break;
			case "text":
				if (token.tokens && token.tokens.length > 0) result += this.renderInlineTokens(token.tokens, resolvedStyleContext);
				else result += applyTextWithNewlines(token.text);
				break;
			case "paragraph":
				result += this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
				break;
			case "strong": {
				const boldContent = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
				result += this.theme.bold(boldContent) + stylePrefix;
				break;
			}
			case "em": {
				const italicContent = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
				result += this.theme.italic(italicContent) + stylePrefix;
				break;
			}
			case "codespan":
				result += this.theme.code(token.text) + stylePrefix;
				break;
			case "link": {
				const linkText = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
				const styledLink = this.theme.link(this.theme.underline(linkText));
				if (getCapabilities().hyperlinks) result += hyperlink(styledLink, token.href) + stylePrefix;
				else {
					const hrefForComparison = token.href.startsWith("mailto:") ? token.href.slice(7) : token.href;
					if (token.text === token.href || token.text === hrefForComparison) result += styledLink + stylePrefix;
					else result += styledLink + this.theme.linkUrl(` (${token.href})`) + stylePrefix;
				}
				break;
			}
			case "br":
				result += "\n";
				break;
			case "del": {
				const delContent = this.renderInlineTokens(token.tokens || [], resolvedStyleContext);
				result += this.theme.strikethrough(delContent) + stylePrefix;
				break;
			}
			case "html":
				if ("raw" in token && typeof token.raw === "string") result += applyTextWithNewlines(token.raw);
				break;
			default: if ("text" in token && typeof token.text === "string") result += applyTextWithNewlines(token.text);
		}
		while (stylePrefix && result.endsWith(stylePrefix)) result = result.slice(0, -stylePrefix.length);
		return result;
	}
	getOrderedListMarker(item) {
		const match = /^(?: {0,3})(\d{1,9}[.)])[ \t]+/.exec(item.raw);
		return match ? `${match[1]} ` : void 0;
	}
	getUnorderedListMarker(item) {
		const match = /^(?: {0,3})([-+*])(?:[ \t]+|(?=\r?\n|$))/.exec(item.raw);
		return match ? `${match[1]} ` : void 0;
	}
	/**
	* Render a list with proper nesting support
	*/
	renderList(token, depth, width, styleContext) {
		const lines = [];
		const indent = "    ".repeat(depth);
		const startNumber = typeof token.start === "number" ? token.start : 1;
		for (let i = 0; i < token.items.length; i++) {
			const item = token.items[i];
			const isLastItem = i === token.items.length - 1;
			const marker = (token.ordered ? this.options.preserveOrderedListMarkers ? this.getOrderedListMarker(item) ?? `${startNumber + i}. ` : `${startNumber + i}. ` : this.options.preserveOrderedListMarkers ? this.getUnorderedListMarker(item) ?? "- " : "- ") + (item.task ? `[${item.checked ? "x" : " "}] ` : "");
			const firstPrefix = indent + this.theme.listBullet(marker);
			const continuationPrefix = indent + " ".repeat(visibleWidth(marker));
			const itemWidth = Math.max(1, width - visibleWidth(firstPrefix));
			let renderedAnyLine = false;
			for (const itemToken of item.tokens) {
				if (itemToken.type === "list") {
					lines.push(...this.renderList(itemToken, depth + 1, width, styleContext));
					renderedAnyLine = true;
					continue;
				}
				const itemLines = this.renderToken(itemToken, itemWidth, void 0, styleContext);
				for (const line of itemLines) for (const wrappedLine of wrapTextWithAnsi(line, itemWidth)) {
					const linePrefix = renderedAnyLine ? continuationPrefix : firstPrefix;
					lines.push(linePrefix + wrappedLine);
					renderedAnyLine = true;
				}
			}
			if (!renderedAnyLine) lines.push(firstPrefix);
			if (token.loose && !isLastItem) lines.push("");
		}
		return lines;
	}
	/**
	* Get the visible width of the longest word in a string.
	*/
	getLongestWordWidth(text, maxWidth) {
		const words = text.split(/\s+/).filter((word) => word.length > 0);
		let longest = 0;
		for (const word of words) longest = Math.max(longest, visibleWidth(word));
		if (maxWidth === void 0) return longest;
		return Math.min(longest, maxWidth);
	}
	/**
	* Wrap a table cell to fit into a column.
	*
	* Delegates to wrapTextWithAnsi() so ANSI codes + long tokens are handled
	* consistently with the rest of the renderer.
	*/
	wrapCellText(text, maxWidth) {
		return wrapTextWithAnsi(text, Math.max(1, maxWidth));
	}
	/**
	* Render a table with width-aware cell wrapping.
	* Cells that don't fit are wrapped to multiple lines.
	*/
	renderTable(token, availableWidth, nextTokenType, styleContext) {
		const lines = [];
		const numCols = token.header.length;
		if (numCols === 0) return lines;
		const borderOverhead = 3 * numCols + 1;
		const availableForCells = availableWidth - borderOverhead;
		if (availableForCells < numCols) {
			const fallbackLines = token.raw ? wrapTextWithAnsi(token.raw, availableWidth) : [];
			if (nextTokenType && nextTokenType !== "space") fallbackLines.push("");
			return fallbackLines;
		}
		const maxUnbrokenWordWidth = 30;
		const naturalWidths = [];
		const minWordWidths = [];
		for (let i = 0; i < numCols; i++) {
			const headerText = this.renderInlineTokens(token.header[i].tokens || [], styleContext);
			naturalWidths[i] = visibleWidth(headerText);
			minWordWidths[i] = Math.max(1, this.getLongestWordWidth(headerText, maxUnbrokenWordWidth));
		}
		for (const row of token.rows) for (let i = 0; i < row.length; i++) {
			const cellText = this.renderInlineTokens(row[i].tokens || [], styleContext);
			naturalWidths[i] = Math.max(naturalWidths[i] || 0, visibleWidth(cellText));
			minWordWidths[i] = Math.max(minWordWidths[i] || 1, this.getLongestWordWidth(cellText, maxUnbrokenWordWidth));
		}
		let minColumnWidths = minWordWidths;
		let minCellsWidth = minColumnWidths.reduce((a, b) => a + b, 0);
		if (minCellsWidth > availableForCells) {
			minColumnWidths = new Array(numCols).fill(1);
			const remaining = availableForCells - numCols;
			if (remaining > 0) {
				const totalWeight = minWordWidths.reduce((total, width) => total + Math.max(0, width - 1), 0);
				const growth = minWordWidths.map((width) => {
					const weight = Math.max(0, width - 1);
					return totalWeight > 0 ? Math.floor(weight / totalWeight * remaining) : 0;
				});
				for (let i = 0; i < numCols; i++) minColumnWidths[i] += growth[i] ?? 0;
				let leftover = remaining - growth.reduce((total, width) => total + width, 0);
				for (let i = 0; leftover > 0 && i < numCols; i++) {
					minColumnWidths[i]++;
					leftover--;
				}
			}
			minCellsWidth = minColumnWidths.reduce((a, b) => a + b, 0);
		}
		const totalNaturalWidth = naturalWidths.reduce((a, b) => a + b, 0) + borderOverhead;
		let columnWidths;
		if (totalNaturalWidth <= availableWidth) columnWidths = naturalWidths.map((width, index) => Math.max(width, minColumnWidths[index]));
		else {
			const totalGrowPotential = naturalWidths.reduce((total, width, index) => {
				return total + Math.max(0, width - minColumnWidths[index]);
			}, 0);
			const extraWidth = Math.max(0, availableForCells - minCellsWidth);
			columnWidths = minColumnWidths.map((minWidth, index) => {
				const naturalWidth = naturalWidths[index];
				const minWidthDelta = Math.max(0, naturalWidth - minWidth);
				let grow = 0;
				if (totalGrowPotential > 0) grow = Math.floor(minWidthDelta / totalGrowPotential * extraWidth);
				return minWidth + grow;
			});
			let remaining = availableForCells - columnWidths.reduce((a, b) => a + b, 0);
			while (remaining > 0) {
				let grew = false;
				for (let i = 0; i < numCols && remaining > 0; i++) if (columnWidths[i] < naturalWidths[i]) {
					columnWidths[i]++;
					remaining--;
					grew = true;
				}
				if (!grew) break;
			}
		}
		const topBorderCells = columnWidths.map((w) => "─".repeat(w));
		lines.push(`┌─${topBorderCells.join("─┬─")}─┐`);
		const headerCellLines = token.header.map((cell, i) => {
			const text = this.renderInlineTokens(cell.tokens || [], styleContext);
			return this.wrapCellText(text, columnWidths[i]);
		});
		const headerLineCount = Math.max(...headerCellLines.map((c) => c.length));
		for (let lineIdx = 0; lineIdx < headerLineCount; lineIdx++) {
			const rowParts = headerCellLines.map((cellLines, colIdx) => {
				const text = cellLines[lineIdx] || "";
				const padded = text + " ".repeat(Math.max(0, columnWidths[colIdx] - visibleWidth(text)));
				return this.theme.bold(padded);
			});
			lines.push(`│ ${rowParts.join(" │ ")} │`);
		}
		const separatorLine = `├─${columnWidths.map((w) => "─".repeat(w)).join("─┼─")}─┤`;
		lines.push(separatorLine);
		for (let rowIndex = 0; rowIndex < token.rows.length; rowIndex++) {
			const rowCellLines = token.rows[rowIndex].map((cell, i) => {
				const text = this.renderInlineTokens(cell.tokens || [], styleContext);
				return this.wrapCellText(text, columnWidths[i]);
			});
			const rowLineCount = Math.max(...rowCellLines.map((c) => c.length));
			for (let lineIdx = 0; lineIdx < rowLineCount; lineIdx++) {
				const rowParts = rowCellLines.map((cellLines, colIdx) => {
					const text = cellLines[lineIdx] || "";
					return text + " ".repeat(Math.max(0, columnWidths[colIdx] - visibleWidth(text)));
				});
				lines.push(`│ ${rowParts.join(" │ ")} │`);
			}
			if (rowIndex < token.rows.length - 1) lines.push(separatorLine);
		}
		const bottomBorderCells = columnWidths.map((w) => "─".repeat(w));
		lines.push(`└─${bottomBorderCells.join("─┴─")}─┘`);
		if (nextTokenType && nextTokenType !== "space") lines.push("");
		return lines;
	}
};

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/components/spacer.js
/**
* Spacer component that renders empty lines
*/
var Spacer = class {
	lines;
	constructor(lines = 1) {
		this.lines = lines;
	}
	setLines(lines) {
		this.lines = lines;
	}
	invalidate() {}
	render(_width) {
		const result = [];
		for (let i = 0; i < this.lines; i++) result.push("");
		return result;
	}
};

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/stdin-buffer.js
/**
* StdinBuffer buffers input and emits complete sequences.
*
* This is necessary because stdin data events can arrive in partial chunks,
* especially for escape sequences like mouse events. Without buffering,
* partial sequences can be misinterpreted as regular keypresses.
*
* For example, the mouse SGR sequence `\x1b[<35;20;5m` might arrive as:
* - Event 1: `\x1b`
* - Event 2: `[<35`
* - Event 3: `;20;5m`
*
* The buffer accumulates these until a complete sequence is detected.
* Call the `process()` method to feed input data.
*
* Based on code from OpenTUI (https://github.com/anomalyco/opentui)
* MIT License - Copyright (c) 2025 opentui
*/
const ESC = "\x1B";
const BRACKETED_PASTE_START$1 = "\x1B[200~";
const BRACKETED_PASTE_END$1 = "\x1B[201~";
/**
* Check if a string is a complete escape sequence or needs more data
*/
function isCompleteSequence(data) {
	if (!data.startsWith(ESC)) return "not-escape";
	if (data.length === 1) return "incomplete";
	const afterEsc = data.slice(1);
	if (afterEsc.startsWith("[")) {
		if (afterEsc.startsWith("[M")) return data.length >= 6 ? "complete" : "incomplete";
		return isCompleteCsiSequence(data);
	}
	if (afterEsc.startsWith("]")) return isCompleteOscSequence(data);
	if (afterEsc.startsWith("P")) return isCompleteDcsSequence(data);
	if (afterEsc.startsWith("_")) return isCompleteApcSequence(data);
	if (afterEsc.startsWith("O")) return afterEsc.length >= 2 ? "complete" : "incomplete";
	if (afterEsc.length === 1) return "complete";
	return "complete";
}
/**
* Check if CSI sequence is complete
* CSI sequences: ESC [ ... followed by a final byte (0x40-0x7E)
*/
function isCompleteCsiSequence(data) {
	if (!data.startsWith(`${ESC}[`)) return "complete";
	if (data.length < 3) return "incomplete";
	const payload = data.slice(2);
	const lastChar = payload[payload.length - 1];
	const lastCharCode = lastChar.charCodeAt(0);
	if (lastCharCode >= 64 && lastCharCode <= 126) {
		if (payload.startsWith("<")) {
			if (/^<\d+;\d+;\d+[Mm]$/.test(payload)) return "complete";
			if (lastChar === "M" || lastChar === "m") {
				const parts = payload.slice(1, -1).split(";");
				if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) return "complete";
			}
			return "incomplete";
		}
		return "complete";
	}
	return "incomplete";
}
/**
* Check if OSC sequence is complete
* OSC sequences: ESC ] ... ST (where ST is ESC \ or BEL)
*/
function isCompleteOscSequence(data) {
	if (!data.startsWith(`${ESC}]`)) return "complete";
	if (data.endsWith(`${ESC}\\`) || data.endsWith("\x07")) return "complete";
	return "incomplete";
}
/**
* Check if DCS (Device Control String) sequence is complete
* DCS sequences: ESC P ... ST (where ST is ESC \)
* Used for XTVersion responses like ESC P >| ... ESC \
*/
function isCompleteDcsSequence(data) {
	if (!data.startsWith(`${ESC}P`)) return "complete";
	if (data.endsWith(`${ESC}\\`)) return "complete";
	return "incomplete";
}
/**
* Check if APC (Application Program Command) sequence is complete
* APC sequences: ESC _ ... ST (where ST is ESC \)
* Used for Kitty graphics responses like ESC _ G ... ESC \
*/
function isCompleteApcSequence(data) {
	if (!data.startsWith(`${ESC}_`)) return "complete";
	if (data.endsWith(`${ESC}\\`)) return "complete";
	return "incomplete";
}
/**
* Split accumulated buffer into complete sequences
*/
function parseUnmodifiedKittyPrintableCodepoint(sequence) {
	const match = sequence.match(/^\x1b\[(\d+)(?::\d*)?(?::\d+)?u$/);
	if (!match) return void 0;
	const codepoint = parseInt(match[1], 10);
	return codepoint >= 32 ? codepoint : void 0;
}
function extractCompleteSequences(buffer) {
	const sequences = [];
	let pos = 0;
	while (pos < buffer.length) {
		const remaining = buffer.slice(pos);
		if (remaining.startsWith(ESC)) {
			let seqEnd = 1;
			while (seqEnd <= remaining.length) {
				const candidate = remaining.slice(0, seqEnd);
				const status = isCompleteSequence(candidate);
				if (status === "complete") {
					if (candidate === "\x1B\x1B") {
						const nextChar = remaining[seqEnd];
						if (nextChar === "[" || nextChar === "]" || nextChar === "O" || nextChar === "P" || nextChar === "_") {
							sequences.push(ESC);
							pos += 1;
							break;
						}
					}
					sequences.push(candidate);
					pos += seqEnd;
					break;
				} else if (status === "incomplete") seqEnd++;
				else {
					sequences.push(candidate);
					pos += seqEnd;
					break;
				}
			}
			if (seqEnd > remaining.length) return {
				sequences,
				remainder: remaining
			};
		} else {
			sequences.push(remaining[0]);
			pos++;
		}
	}
	return {
		sequences,
		remainder: ""
	};
}
/**
* Buffers stdin input and emits complete sequences via the 'data' event.
* Handles partial escape sequences that arrive across multiple chunks.
*/
var StdinBuffer = class extends EventEmitter {
	buffer = "";
	timeout = null;
	timeoutMs;
	pasteMode = false;
	pasteBuffer = "";
	pendingKittyPrintableCodepoint;
	constructor(options = {}) {
		super();
		this.timeoutMs = options.timeout ?? 10;
	}
	process(data) {
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
		let str;
		if (Buffer.isBuffer(data)) {
			if (data.length === 1 && data[0] > 127) {
				const byte = data[0] - 128;
				str = `\x1b${String.fromCharCode(byte)}`;
			} else str = data.toString();
		} else str = data;
		if (str.length === 0 && this.buffer.length === 0) {
			this.emitDataSequence("");
			return;
		}
		this.buffer += str;
		if (this.pasteMode) {
			this.pasteBuffer += this.buffer;
			this.buffer = "";
			const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END$1);
			if (endIndex !== -1) {
				const pastedContent = this.pasteBuffer.slice(0, endIndex);
				const remaining = this.pasteBuffer.slice(endIndex + 6);
				this.pasteMode = false;
				this.pasteBuffer = "";
				this.pendingKittyPrintableCodepoint = void 0;
				this.emit("paste", pastedContent);
				if (remaining.length > 0) this.process(remaining);
			}
			return;
		}
		const startIndex = this.buffer.indexOf(BRACKETED_PASTE_START$1);
		if (startIndex !== -1) {
			if (startIndex > 0) {
				const result = extractCompleteSequences(this.buffer.slice(0, startIndex));
				for (const sequence of result.sequences) this.emitDataSequence(sequence);
			}
			this.pendingKittyPrintableCodepoint = void 0;
			this.buffer = this.buffer.slice(startIndex + 6);
			this.pasteMode = true;
			this.pasteBuffer = this.buffer;
			this.buffer = "";
			const endIndex = this.pasteBuffer.indexOf(BRACKETED_PASTE_END$1);
			if (endIndex !== -1) {
				const pastedContent = this.pasteBuffer.slice(0, endIndex);
				const remaining = this.pasteBuffer.slice(endIndex + 6);
				this.pasteMode = false;
				this.pasteBuffer = "";
				this.pendingKittyPrintableCodepoint = void 0;
				this.emit("paste", pastedContent);
				if (remaining.length > 0) this.process(remaining);
			}
			return;
		}
		const result = extractCompleteSequences(this.buffer);
		this.buffer = result.remainder;
		for (const sequence of result.sequences) this.emitDataSequence(sequence);
		if (this.buffer.length > 0) this.timeout = setTimeout(() => {
			const flushed = this.flush();
			for (const sequence of flushed) this.emitDataSequence(sequence);
		}, this.timeoutMs);
	}
	emitDataSequence(sequence) {
		const rawCodepoint = sequence.length === 1 ? sequence.codePointAt(0) : void 0;
		if (rawCodepoint !== void 0 && rawCodepoint === this.pendingKittyPrintableCodepoint) {
			this.pendingKittyPrintableCodepoint = void 0;
			return;
		}
		this.pendingKittyPrintableCodepoint = parseUnmodifiedKittyPrintableCodepoint(sequence);
		this.emit("data", sequence);
	}
	flush() {
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
		if (this.buffer.length === 0) return [];
		const sequences = [this.buffer];
		this.buffer = "";
		this.pendingKittyPrintableCodepoint = void 0;
		return sequences;
	}
	clear() {
		if (this.timeout) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
		this.buffer = "";
		this.pasteMode = false;
		this.pasteBuffer = "";
		this.pendingKittyPrintableCodepoint = void 0;
	}
	getBuffer() {
		return this.buffer;
	}
	destroy() {
		this.clear();
	}
};

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/native-modifiers.js
const cjsRequire$1 = createRequire(import.meta.url);
let nativeModifiersHelper;
function isNativeModifiersHelper(value) {
	if (typeof value !== "object" || value === null) return false;
	return typeof value.isModifierPressed === "function";
}
function loadNativeModifiersHelper() {
	if (nativeModifiersHelper !== void 0) return nativeModifiersHelper ?? void 0;
	nativeModifiersHelper = null;
	if (process.platform !== "darwin") return void 0;
	const arch = process.arch;
	if (arch !== "x64" && arch !== "arm64") return void 0;
	const moduleDir = path$1.dirname(fileURLToPath(import.meta.url));
	const nativePath = path$1.join("native", "darwin", "prebuilds", `darwin-${arch}`, "darwin-modifiers.node");
	const candidates = [
		path$1.join(moduleDir, "..", nativePath),
		path$1.join(moduleDir, nativePath),
		path$1.join(path$1.dirname(process.execPath), nativePath)
	];
	for (const modulePath of candidates) try {
		const helper = cjsRequire$1(modulePath);
		if (isNativeModifiersHelper(helper)) {
			nativeModifiersHelper = helper;
			return helper;
		}
	} catch {}
}
function isNativeModifierPressed(key) {
	const helper = loadNativeModifiersHelper();
	if (!helper) return false;
	try {
		return helper.isModifierPressed(key) === true;
	} catch {
		return false;
	}
}

//#endregion
//#region node_modules/.pnpm/@earendil-works+pi-tui@0.80.7_patch_hash=6c30c5386c0159131e1361023cddf31377f5728962524841964373312c1ed946/node_modules/@earendil-works/pi-tui/dist/terminal.js
const cjsRequire = createRequire(import.meta.url);
const TERMINAL_PROGRESS_KEEPALIVE_MS = 1e3;
const TERMINAL_PROGRESS_ACTIVE_SEQUENCE = "\x1B]9;4;3\x07";
const TERMINAL_PROGRESS_CLEAR_SEQUENCE = "\x1B]9;4;0;\x07";
const APPLE_TERMINAL_SHIFT_ENTER_SEQUENCE = "\x1B[13;2u";
const DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS = 7;
const KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS = 150;
const KITTY_KEYBOARD_PROTOCOL_QUERY = `\x1b[>${DESIRED_KITTY_KEYBOARD_PROTOCOL_FLAGS}u\x1b[?u\x1b[c`;
function parseKeyboardProtocolNegotiationSequence(sequence) {
	const kittyFlags = sequence.match(/^\x1b\[\?(\d+)u$/);
	if (kittyFlags) return {
		type: "kitty-flags",
		flags: Number.parseInt(kittyFlags[1], 10)
	};
	if (/^\x1b\[\?[\d;]*c$/.test(sequence)) return { type: "device-attributes" };
}
function isKeyboardProtocolNegotiationSequencePrefix(sequence) {
	return sequence === "\x1B[" || /^\x1b\[\?[\d;]*$/.test(sequence);
}
function isAppleTerminalSession() {
	return process.platform === "darwin" && process.env.TERM_PROGRAM === "Apple_Terminal";
}
function normalizeAppleTerminalInput(data, isAppleTerminal, isShiftPressed) {
	if (isAppleTerminal && data === "\r" && isShiftPressed) return APPLE_TERMINAL_SHIFT_ENTER_SEQUENCE;
	return data;
}
/**
* Real terminal using process.stdin/stdout
*/
var ProcessTerminal = class {
	wasRaw = false;
	inputHandler;
	resizeHandler;
	_kittyProtocolActive = false;
	_modifyOtherKeysActive = false;
	keyboardProtocolPushed = false;
	keyboardProtocolNegotiationBuffer = "";
	keyboardProtocolBufferFlushTimer;
	stdinBuffer;
	stdinDataHandler;
	progressInterval;
	writeLogPath = (() => {
		const env = process.env.PI_TUI_WRITE_LOG || "";
		if (!env) return "";
		try {
			if (fs$1.statSync(env).isDirectory()) {
				const now = /* @__PURE__ */ new Date();
				const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
				return path$1.join(env, `tui-${ts}-${process.pid}.log`);
			}
		} catch {}
		return env;
	})();
	get kittyProtocolActive() {
		return this._kittyProtocolActive;
	}
	get modifyOtherKeysActive() {
		return this._modifyOtherKeysActive;
	}
	start(onInput, onResize) {
		this.inputHandler = onInput;
		this.resizeHandler = onResize;
		this.wasRaw = process.stdin.isRaw || false;
		if (process.stdin.setRawMode) process.stdin.setRawMode(true);
		process.stdin.setEncoding("utf8");
		process.stdin.resume();
		process.stdout.write("\x1B[?2004h");
		process.stdout.on("resize", this.resizeHandler);
		if (process.platform !== "win32") process.kill(process.pid, "SIGWINCH");
		this.enableWindowsVTInput();
		this.queryAndEnableKittyProtocol();
	}
	/**
	* Set up StdinBuffer to split batched input into individual sequences.
	* This ensures components receive single events, making matchesKey/isKeyRelease work correctly.
	*
	* Also watches for Kitty protocol response and enables it when detected.
	* This is done here (after stdinBuffer parsing) rather than on raw stdin
	* to handle the case where the response arrives split across multiple events.
	*/
	setupStdinBuffer() {
		this.stdinBuffer = new StdinBuffer({ timeout: 10 });
		this.stdinBuffer.on("data", (sequence) => {
			const negotiationSequence = this.readKeyboardProtocolNegotiationSequence(sequence);
			if (negotiationSequence === "pending") {
				this.scheduleKeyboardProtocolNegotiationBufferFlush();
				return;
			}
			if (this.handleKeyboardProtocolNegotiationSequence(negotiationSequence)) return;
			this.forwardInputSequence(sequence);
		});
		this.stdinBuffer.on("paste", (content) => {
			if (this.inputHandler) this.inputHandler(`\x1b[200~${content}\x1b[201~`);
		});
		this.stdinDataHandler = (data) => {
			this.stdinBuffer.process(data);
		};
	}
	/**
	* Query terminal for Kitty keyboard protocol support and enable it if available.
	*
	* Kitty's progressive enhancement detection requires requesting the desired
	* flags before querying them. The trailing DA query is a sentinel supported by
	* terminals that do not know Kitty keyboard protocol; receiving DA before a
	* Kitty response enables modifyOtherKeys fallback without a startup timeout.
	*
	* The requested flags are:
	* - 1 = disambiguate escape codes
	* - 2 = report event types (press/repeat/release)
	* - 4 = report alternate keys (shifted key, base layout key)
	*/
	queryAndEnableKittyProtocol() {
		this.setupStdinBuffer();
		process.stdin.on("data", this.stdinDataHandler);
		this.keyboardProtocolPushed = true;
		this.clearKeyboardProtocolNegotiationBuffer();
		process.stdout.write(KITTY_KEYBOARD_PROTOCOL_QUERY);
	}
	handleKeyboardProtocolNegotiationSequence(negotiationSequence) {
		if (!negotiationSequence) return false;
		this.clearKeyboardProtocolNegotiationBuffer();
		if (negotiationSequence.type === "kitty-flags") {
			if (negotiationSequence.flags !== 0) {
				this.disableModifyOtherKeys();
				if (!this._kittyProtocolActive) {
					this._kittyProtocolActive = true;
					setKittyProtocolActive(true);
				}
			} else this.enableModifyOtherKeys();
			return true;
		}
		if (!this._kittyProtocolActive) this.enableModifyOtherKeys();
		return true;
	}
	readKeyboardProtocolNegotiationSequence(sequence) {
		if (this.keyboardProtocolNegotiationBuffer) {
			const bufferedSequence = this.keyboardProtocolNegotiationBuffer + sequence;
			const negotiationSequence = parseKeyboardProtocolNegotiationSequence(bufferedSequence);
			if (negotiationSequence) {
				this.clearKeyboardProtocolNegotiationBuffer();
				return negotiationSequence;
			}
			if (isKeyboardProtocolNegotiationSequencePrefix(bufferedSequence)) {
				this.setKeyboardProtocolNegotiationBuffer(bufferedSequence);
				return "pending";
			}
			this.flushKeyboardProtocolNegotiationBufferAsInput();
		}
		const negotiationSequence = parseKeyboardProtocolNegotiationSequence(sequence);
		if (negotiationSequence) return negotiationSequence;
		if (isKeyboardProtocolNegotiationSequencePrefix(sequence)) {
			this.setKeyboardProtocolNegotiationBuffer(sequence);
			return "pending";
		}
	}
	setKeyboardProtocolNegotiationBuffer(sequence) {
		this.clearKeyboardProtocolNegotiationBufferFlushTimer();
		this.keyboardProtocolNegotiationBuffer = sequence;
	}
	clearKeyboardProtocolNegotiationBuffer() {
		this.clearKeyboardProtocolNegotiationBufferFlushTimer();
		this.keyboardProtocolNegotiationBuffer = "";
	}
	flushKeyboardProtocolNegotiationBufferAsInput() {
		if (!this.keyboardProtocolNegotiationBuffer) return;
		const sequence = this.keyboardProtocolNegotiationBuffer;
		this.clearKeyboardProtocolNegotiationBuffer();
		this.forwardInputSequence(sequence);
	}
	scheduleKeyboardProtocolNegotiationBufferFlush() {
		if (!this.keyboardProtocolNegotiationBuffer || this.keyboardProtocolBufferFlushTimer) return;
		this.keyboardProtocolBufferFlushTimer = setTimeout(() => {
			this.keyboardProtocolBufferFlushTimer = void 0;
			this.flushKeyboardProtocolNegotiationBufferAsInput();
		}, KEYBOARD_PROTOCOL_RESPONSE_FRAGMENT_TIMEOUT_MS);
	}
	clearKeyboardProtocolNegotiationBufferFlushTimer() {
		if (!this.keyboardProtocolBufferFlushTimer) return;
		clearTimeout(this.keyboardProtocolBufferFlushTimer);
		this.keyboardProtocolBufferFlushTimer = void 0;
	}
	forwardInputSequence(sequence) {
		if (!this.inputHandler) return;
		const isAppleTerminal = sequence === "\r" && isAppleTerminalSession();
		const input = normalizeAppleTerminalInput(sequence, isAppleTerminal, isAppleTerminal && isNativeModifierPressed("shift"));
		this.inputHandler(input);
	}
	enableModifyOtherKeys() {
		if (this._kittyProtocolActive || this._modifyOtherKeysActive) return;
		process.stdout.write("\x1B[>4;2m");
		this._modifyOtherKeysActive = true;
	}
	disableModifyOtherKeys() {
		if (!this._modifyOtherKeysActive) return;
		process.stdout.write("\x1B[>4;0m");
		this._modifyOtherKeysActive = false;
	}
	/**
	* On Windows, add ENABLE_VIRTUAL_TERMINAL_INPUT (0x0200) to the stdin
	* console handle so the terminal sends VT sequences for modified keys
	* (e.g. \x1b[Z for Shift+Tab). Without this, libuv's ReadConsoleInputW
	* discards modifier state and Shift+Tab arrives as plain \t.
	*/
	enableWindowsVTInput() {
		if (process.platform !== "win32") return;
		try {
			const arch = process.arch;
			if (arch !== "x64" && arch !== "arm64") return;
			const moduleDir = path$1.dirname(fileURLToPath(import.meta.url));
			const nativePath = path$1.join("native", "win32", "prebuilds", `win32-${arch}`, "win32-console-mode.node");
			const candidates = [
				path$1.join(moduleDir, "..", nativePath),
				path$1.join(moduleDir, nativePath),
				path$1.join(path$1.dirname(process.execPath), nativePath)
			];
			for (const modulePath of candidates) try {
				cjsRequire(modulePath).enableVirtualTerminalInput?.();
				return;
			} catch {}
		} catch {}
	}
	async drainInput(maxMs = 1e3, idleMs = 50) {
		const shouldDisableKittyProtocol = this.keyboardProtocolPushed || this._kittyProtocolActive;
		this.clearKeyboardProtocolNegotiationBuffer();
		if (shouldDisableKittyProtocol) {
			process.stdout.write("\x1B[<u");
			this.keyboardProtocolPushed = false;
			this._kittyProtocolActive = false;
			setKittyProtocolActive(false);
		}
		this.disableModifyOtherKeys();
		const previousHandler = this.inputHandler;
		this.inputHandler = void 0;
		let lastDataTime = Date.now();
		const onData = () => {
			lastDataTime = Date.now();
		};
		process.stdin.on("data", onData);
		const endTime = Date.now() + maxMs;
		try {
			while (true) {
				const now = Date.now();
				const timeLeft = endTime - now;
				if (timeLeft <= 0) break;
				if (now - lastDataTime >= idleMs) break;
				await new Promise((resolve) => setTimeout(resolve, Math.min(idleMs, timeLeft)));
			}
		} finally {
			process.stdin.removeListener("data", onData);
			this.inputHandler = previousHandler;
		}
	}
	stop() {
		if (this.clearProgressInterval()) process.stdout.write(TERMINAL_PROGRESS_CLEAR_SEQUENCE);
		process.stdout.write("\x1B[?2004l");
		const shouldDisableKittyProtocol = this.keyboardProtocolPushed || this._kittyProtocolActive;
		this.clearKeyboardProtocolNegotiationBuffer();
		if (shouldDisableKittyProtocol) {
			process.stdout.write("\x1B[<u");
			this.keyboardProtocolPushed = false;
			this._kittyProtocolActive = false;
			setKittyProtocolActive(false);
		}
		this.disableModifyOtherKeys();
		if (this.stdinBuffer) {
			this.stdinBuffer.destroy();
			this.stdinBuffer = void 0;
		}
		if (this.stdinDataHandler) {
			process.stdin.removeListener("data", this.stdinDataHandler);
			this.stdinDataHandler = void 0;
		}
		this.inputHandler = void 0;
		if (this.resizeHandler) {
			process.stdout.removeListener("resize", this.resizeHandler);
			this.resizeHandler = void 0;
		}
		process.stdin.pause();
		if (process.stdin.setRawMode) process.stdin.setRawMode(this.wasRaw);
	}
	write(data) {
		process.stdout.write(data);
		if (this.writeLogPath) try {
			fs$1.appendFileSync(this.writeLogPath, data, { encoding: "utf8" });
		} catch {}
	}
	get columns() {
		return process.stdout.columns || Number(process.env.COLUMNS) || 80;
	}
	get rows() {
		return process.stdout.rows || Number(process.env.LINES) || 24;
	}
	moveBy(lines) {
		if (lines > 0) process.stdout.write(`\x1b[${lines}B`);
		else if (lines < 0) process.stdout.write(`\x1b[${-lines}A`);
	}
	hideCursor() {
		process.stdout.write("\x1B[?25l");
	}
	showCursor() {
		process.stdout.write("\x1B[?25h");
	}
	clearLine() {
		process.stdout.write("\x1B[K");
	}
	clearFromCursor() {
		process.stdout.write("\x1B[J");
	}
	clearScreen() {
		process.stdout.write("\x1B[2J\x1B[H");
	}
	setTitle(title) {
		process.stdout.write(`\x1b]0;${title}\x07`);
	}
	setProgress(active) {
		if (active) {
			process.stdout.write(TERMINAL_PROGRESS_ACTIVE_SEQUENCE);
			if (!this.progressInterval) this.progressInterval = setInterval(() => {
				process.stdout.write(TERMINAL_PROGRESS_ACTIVE_SEQUENCE);
			}, TERMINAL_PROGRESS_KEEPALIVE_MS);
		} else {
			this.clearProgressInterval();
			process.stdout.write(TERMINAL_PROGRESS_CLEAR_SEQUENCE);
		}
	}
	clearProgressInterval() {
		if (!this.progressInterval) return false;
		clearInterval(this.progressInterval);
		this.progressInterval = void 0;
		return true;
	}
};

//#endregion
//#region packages/tui/src/chat/file-autocomplete.ts
/**
* Host-workspace discovery for TUI `@file` completion. The index contains
* paths only: selected values remain ordinary prompt text and file contents
* stay behind the model-facing `read` tool.
*
* @module @deepseek-ai/dsh-tui/chat/file-autocomplete
*/
/** Default maximum entries retained in one workspace search index. */
const DEFAULT_FILE_SEARCH_MAX_ENTRIES = 1e4;
/** Directory basenames omitted from traversal unless the deployment overrides them. */
const DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES = [".git", "node_modules"];
/**
* Extract an `@path` or `@"path with spaces` token at the cursor. An `@`
* inside another token, such as an email address, is not a completion trigger.
* @param line - current editor line.
* @param cursorCol - cursor column within that line.
* @returns the active token, or `undefined` outside an `@` token.
*/
function activeAtToken(line, cursorCol) {
	const beforeCursor = line.slice(0, cursorCol);
	const quoted = /(?:^|\s)(@"([^"]*))$/u.exec(beforeCursor);
	if (quoted?.[1] !== void 0 && quoted[2] !== void 0) return {
		prefix: quoted[1],
		query: quoted[2],
		quoted: true
	};
	const plain = /(?:^|\s)(@([^\s]*))$/u.exec(beforeCursor);
	if (plain?.[1] === void 0 || plain[2] === void 0) return void 0;
	return {
		prefix: plain[1],
		query: plain[2],
		quoted: false
	};
}
/**
* Format a selected path as prompt text. Whitespace uses Pi's quoted
* `@"path"` grammar; directories retain a trailing slash so completion can
* descend another level.
* @param candidate - selected file or directory.
* @param preserveQuote - retain an explicitly opened quote even when unnecessary.
* @returns the insertion value, or `undefined` for a path the editor grammar cannot represent safely.
*/
function formatFileMention(candidate, preserveQuote) {
	const path = candidate.kind === "directory" ? `${candidate.path}/` : candidate.path;
	if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return void 0;
	if (!(preserveQuote || /\s/u.test(path))) return `@${path}`;
	return `@"${path}"`;
}
/**
* Cancellable, reusable fuzzy index rooted at one agent working directory.
* Directory-scoped queries list live state; bare fuzzy queries share one
* bounded traversal until the `@` interaction ends or a tool result invalidates it.
*/
var WorkspaceFileSearch = class {
	root;
	config;
	excludedDirectories;
	generation;
	disposed = false;
	constructor(root, config) {
		this.root = root;
		this.config = config;
		if (!Number.isSafeInteger(config.maxResults) || config.maxResults <= 0) throw new Error("file search maxResults must be a positive safe integer");
		if (!Number.isSafeInteger(config.maxEntries) || config.maxEntries <= 0) throw new Error("file search maxEntries must be a positive safe integer");
		if (config.excludedDirectories.some((name) => name.length === 0 || name.includes("/") || name.includes("\\"))) throw new Error("file search excludedDirectories entries must be non-empty directory basenames");
		this.excludedDirectories = new Set(config.excludedDirectories);
	}
	/**
	* Return ranked path candidates for the current token.
	* @param rawQuery - path text following `@` or `@"`.
	* @param signal - cancels this caller's wait without killing an index shared by a newer query.
	* @returns at most `maxResults` deterministic candidates.
	*/
	async list(rawQuery, signal) {
		signal.throwIfAborted();
		if (this.disposed) return [];
		const query = rawQuery.replaceAll("\\", "/");
		const slash = query.lastIndexOf("/");
		if (query === "" || slash >= 0) {
			const directory = slash < 0 ? "" : query.slice(0, slash + 1);
			const fragment = slash < 0 ? "" : query.slice(slash + 1);
			return this.listDirectory(directory, fragment, signal);
		}
		return rankCandidates((await waitForPromise(this.ensureIndex(), signal)).filter((candidate) => visibleForGlobalQuery(candidate.path, query)), query, this.config.maxResults);
	}
	/** Discard the current index so the next bare query observes a fresh tree. */
	invalidate() {
		this.generation?.controller.abort(/* @__PURE__ */ new Error("file search index invalidated"));
		this.generation = void 0;
	}
	/** Abort traversal and make later queries return no candidates. */
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.invalidate();
	}
	ensureIndex() {
		if (this.generation !== void 0) return this.generation.promise;
		const controller = new AbortController();
		const generation = {
			controller,
			promise: Promise.resolve([])
		};
		generation.promise = this.scanWorkspace(controller.signal).catch((error) => {
			/* v8 ignore next -- every owned abort clears `generation` synchronously; this only protects an unexpected scan failure */
			if (this.generation === generation) this.generation = void 0;
			throw error;
		});
		this.generation = generation;
		return generation.promise;
	}
	async scanWorkspace(signal) {
		const indexed = [];
		const directories = [{
			absolute: this.root,
			relative: ""
		}];
		for (let cursor = 0; cursor < directories.length && indexed.length < this.config.maxEntries; cursor += 1) {
			signal.throwIfAborted();
			const directory = directories[cursor];
			/* v8 ignore next 3 -- cursor is bounded by this exact queue's length. */
			if (directory === void 0) throw new Error("file search selected a missing directory");
			const entries = await readDirectory(directory.absolute, signal);
			for (const entry of entries) {
				signal.throwIfAborted();
				const path = directory.relative === "" ? entry.name : `${directory.relative}/${entry.name}`;
				if (entry.isDirectory()) {
					if (this.excludedDirectories.has(entry.name)) continue;
					indexed.push({
						path,
						kind: "directory"
					});
					directories.push({
						absolute: join$1(directory.absolute, entry.name),
						relative: path
					});
				} else if (entry.isFile()) indexed.push({
					path,
					kind: "file"
				});
				if (indexed.length >= this.config.maxEntries) break;
			}
		}
		return indexed;
	}
	async listDirectory(displayDirectory, fragment, signal) {
		if (displayDirectory.split("/").some((segment) => this.excludedDirectories.has(segment))) return [];
		const absolute = await resolveDisplayDirectory(this.root, displayDirectory, signal);
		if (absolute === void 0) return [];
		const entries = await readDirectory(absolute, signal);
		const candidates = [];
		for (const entry of entries) {
			if (entry.name.startsWith(".") && !fragment.startsWith(".")) continue;
			if (entry.isDirectory()) {
				if (this.excludedDirectories.has(entry.name)) continue;
				candidates.push({
					path: `${displayDirectory}${entry.name}`,
					kind: "directory"
				});
			} else if (entry.isFile()) candidates.push({
				path: `${displayDirectory}${entry.name}`,
				kind: "file"
			});
		}
		return rankCandidates(candidates, fragment, this.config.maxResults);
	}
};
async function resolveDisplayDirectory(root, displayDirectory, signal) {
	const resolvedRoot = resolve(root);
	const absolute = resolve(resolvedRoot, displayDirectory === "" ? "." : displayDirectory);
	const fromRoot = relative(resolvedRoot, absolute);
	if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) return void 0;
	/* v8 ignore next -- only Windows can produce a cross-volume absolute relative path */
	if (isAbsolute(fromRoot)) return void 0;
	let current = resolvedRoot;
	for (const segment of fromRoot.split(sep).filter(Boolean)) {
		signal.throwIfAborted();
		current = join$1(current, segment);
		try {
			const status = await lstat(current);
			signal.throwIfAborted();
			if (status.isSymbolicLink() || !status.isDirectory()) return void 0;
		} catch (_error) {
			signal.throwIfAborted();
			return;
		}
	}
	return absolute;
}
async function readDirectory(absolute, signal) {
	signal.throwIfAborted();
	try {
		const entries = await readdir(absolute, { withFileTypes: true });
		signal.throwIfAborted();
		return entries.sort((left, right) => compareText(left.name, right.name));
	} catch (_error) {
		signal.throwIfAborted();
		return [];
	}
}
function visibleForGlobalQuery(path, query) {
	if (query.startsWith(".") || query.includes("/.")) return true;
	return !path.split("/").some((segment) => segment.startsWith("."));
}
function rankCandidates(candidates, query, limit) {
	const ranked = [];
	for (const candidate of candidates) {
		const score = scoreCandidate(candidate, query);
		if (score !== void 0) ranked.push({
			candidate,
			score
		});
	}
	ranked.sort((left, right) => right.score - left.score || kindRank(left.candidate.kind) - kindRank(right.candidate.kind) || (query === "" ? 0 : left.candidate.path.length - right.candidate.path.length) || compareText(left.candidate.path, right.candidate.path));
	return ranked.slice(0, limit).map((entry) => entry.candidate);
}
function scoreCandidate(candidate, query) {
	if (query === "") return 0;
	const path = candidate.path.toLowerCase();
	const name = path.slice(path.lastIndexOf("/") + 1);
	const needle = query.toLowerCase();
	const directoryBonus = candidate.kind === "directory" ? 25 : 0;
	if (name === needle) return 1e3 + directoryBonus;
	if (name.startsWith(needle)) return 900 + directoryBonus;
	if (name.includes(needle)) return 700 + directoryBonus;
	if (path.includes(needle)) return 500 + directoryBonus;
	const subsequence = subsequenceScore(path, needle);
	return subsequence === void 0 ? void 0 : 300 + subsequence + directoryBonus;
}
function subsequenceScore(target, query) {
	let targetIndex = 0;
	let gap = 0;
	for (const character of query) {
		const found = target.indexOf(character, targetIndex);
		if (found < 0) return void 0;
		gap += found - targetIndex;
		targetIndex = found + 1;
	}
	return Math.max(0, 100 - gap);
}
function kindRank(kind) {
	return kind === "directory" ? 0 : 1;
}
function compareText(left, right) {
	/* v8 ignore next -- entries and candidates are unique; host enumeration
	* order determines which comparison direction sort requests. */
	return left < right ? -1 : left > right ? 1 : 0;
}
function waitForPromise(promise, signal) {
	/* v8 ignore next -- `list()` checks this signal immediately before its synchronous call into this helper */
	if (signal.aborted) return Promise.reject(errorReason(signal.reason, "file search aborted"));
	return new Promise((resolvePromise, rejectPromise) => {
		const onAbort = () => {
			rejectPromise(errorReason(signal.reason, "file search aborted"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolvePromise(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			rejectPromise(errorReason(error, "file search index failed"));
		});
	});
}
function errorReason(reason, fallback) {
	return reason instanceof Error ? reason : new Error(fallback, { cause: reason });
}

//#endregion
//#region packages/tui/src/config.ts
/**
* Serializable configuration and defaults for the pi-tui terminal mode. Loader
* schema validation normally fills defaults; {@link resolveTuiConfig} applies
* the same defaults for direct callers that bypass the Loader.
* @module @deepseek-ai/dsh-tui/config
*/
const showReasoningSchema = z.boolean().default(true);
const maxToolOutputLinesSchema = z.number().step(1).min(1).default(6);
const maxDiffEditLengthSchema = z.number().step(1).min(1).default(1e3);
const maxQuestionOptionsSchema = z.number().step(1).min(1).default(8);
const maxModelOptionsSchema = z.number().step(1).min(1).default(8);
const maxResumeOptionsSchema = z.number().step(1).min(1).default(8);
const resumeScanConcurrencySchema = z.number().step(1).min(1).default(4);
const questionDialogWidthSchema = z.number().step(1).min(20).default(200);
const questionDialogMaxHeightSchema = z.number().step(1).min(6).default(20);
const modelDialogWidthSchema = z.number().step(1).min(20).default(76);
const modelDialogMaxHeightSchema = z.number().step(1).min(6).default(20);
const fileSearchMaxResultsSchema = z.number().step(1).min(1).default(20);
const fileSearchMaxEntriesSchema = z.number().step(1).min(1).default(DEFAULT_FILE_SEARCH_MAX_ENTRIES);
const fileSearchExcludedDirectoriesSchema = z.array(z.string()).default([...DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES]);
const showHardwareCursorSchema = z.boolean().default(false);
const maxInitialMessagesSchema = z.number().step(1).min(1).default(200);
const historyPageSizeSchema = z.number().step(1).min(1).default(100);
const transcriptResidentMaxBytesSchema = z.number().step(1).min(1024).default(4194304);
const cardCacheEntriesSchema = z.number().step(1).min(16).default(2e3);
const statusIntervalMsSchema = z.number().step(1).min(50).default(500);
const colorSchema = z.boolean().default(true);
const truecolorSchema = z.boolean();
/**
* Presentation fields shared verbatim by {@link TuiConfigSchema} and the
* plugin-level {@link Config} schema — the single field table; both schemas
* spread it, so a knob added here is settable through either path.
*/
const tuiConfigSchemaFields = {
	showReasoning: showReasoningSchema,
	maxToolOutputLines: maxToolOutputLinesSchema,
	maxDiffEditLength: maxDiffEditLengthSchema,
	maxQuestionOptions: maxQuestionOptionsSchema,
	maxModelOptions: maxModelOptionsSchema,
	maxResumeOptions: maxResumeOptionsSchema,
	resumeScanConcurrency: resumeScanConcurrencySchema,
	questionDialogWidth: questionDialogWidthSchema,
	questionDialogMaxHeight: questionDialogMaxHeightSchema,
	modelDialogWidth: modelDialogWidthSchema,
	modelDialogMaxHeight: modelDialogMaxHeightSchema,
	fileSearchMaxResults: fileSearchMaxResultsSchema,
	fileSearchMaxEntries: fileSearchMaxEntriesSchema,
	fileSearchExcludedDirectories: fileSearchExcludedDirectoriesSchema,
	showHardwareCursor: showHardwareCursorSchema,
	maxInitialMessages: maxInitialMessagesSchema,
	historyPageSize: historyPageSizeSchema,
	transcriptResidentMaxBytes: transcriptResidentMaxBytesSchema,
	cardCacheEntries: cardCacheEntriesSchema,
	statusIntervalMs: statusIntervalMsSchema,
	theme: z.object({
		color: colorSchema,
		truecolor: truecolorSchema
	}),
	title: z.string().default("DeepSeek Harness")
};
/** Schemastery schema for presentation settings embedded by app bundles. */
const TuiConfigSchema = z.object(tuiConfigSchemaFields);
/** Schemastery schema for the full plugin configuration. */
const Config = z.object({
	welcome: z.string(),
	sessionId: z.string().default("main"),
	model: z.string(),
	...tuiConfigSchemaFields
});
/**
* Apply direct-call defaults after Loader schema validation has normally run.
*
* @param config - Deployment-provided terminal presentation settings.
* @returns Complete settings consumed by the TUI renderer.
*/
function resolveTuiConfig(config) {
	return {
		showReasoning: config?.showReasoning ?? true,
		maxToolOutputLines: config?.maxToolOutputLines ?? 6,
		maxDiffEditLength: config?.maxDiffEditLength ?? 1e3,
		maxQuestionOptions: config?.maxQuestionOptions ?? 8,
		maxModelOptions: config?.maxModelOptions ?? 8,
		maxResumeOptions: config?.maxResumeOptions ?? 8,
		resumeScanConcurrency: config?.resumeScanConcurrency ?? 4,
		questionDialogWidth: config?.questionDialogWidth ?? 200,
		questionDialogMaxHeight: config?.questionDialogMaxHeight ?? 20,
		modelDialogWidth: config?.modelDialogWidth ?? 76,
		modelDialogMaxHeight: config?.modelDialogMaxHeight ?? 20,
		fileSearchMaxResults: config?.fileSearchMaxResults ?? 20,
		fileSearchMaxEntries: config?.fileSearchMaxEntries ?? 1e4,
		fileSearchExcludedDirectories: [...config?.fileSearchExcludedDirectories ?? DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES],
		showHardwareCursor: config?.showHardwareCursor ?? false,
		maxInitialMessages: config?.maxInitialMessages ?? 200,
		historyPageSize: config?.historyPageSize ?? 100,
		transcriptResidentMaxBytes: config?.transcriptResidentMaxBytes ?? 4194304,
		cardCacheEntries: config?.cardCacheEntries ?? 2e3,
		statusIntervalMs: config?.statusIntervalMs ?? 500,
		theme: {
			color: config?.theme?.color ?? true,
			truecolor: config?.theme?.truecolor ?? false
		},
		title: config?.title ?? "DeepSeek Harness"
	};
}

//#endregion
//#region packages/tui/src/components/text.ts
/**
* Terminal text sanitization shared across the pi-tui front door. External text
* (model output, tool results, clipboard) is escaped or stripped of C0/C1
* controls before the TUI adds its own application-owned ANSI.
* @module @deepseek-ai/dsh-tui/components/text
*/
const TERMINAL_CONTROL_PATTERN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/gu;
const TERMINAL_OSC_PATTERN = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu;
const TERMINAL_CSI_PATTERN = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu;
const TERMINAL_ESCAPE_PATTERN = /\u001B[@-_]/gu;
/** Bracketed-paste start marker emitted by terminals around pasted content. */
const BRACKETED_PASTE_START = "\x1B[200~";
/** Bracketed-paste end marker emitted by terminals around pasted content. */
const BRACKETED_PASTE_END = "\x1B[201~";
/**
* Escape external C0/C1 controls before pi-tui adds application-owned ANSI.
* Line feeds remain structural so transcript and tool output retain their layout.
* @param text - Untrusted text to render.
* @returns The text with control characters escaped as `\xNN`.
*/
function displayText(text) {
	return text.replace(TERMINAL_CONTROL_PATTERN, (control) => `\\x${control.charCodeAt(0).toString(16).padStart(2, "0")}`);
}
/**
* Escape external controls for terminal fields that must remain on one line.
* @param text - Untrusted text to render inline.
* @returns The escaped text with newlines rendered as `\x0a`.
*/
function displayInlineText(text) {
	return displayText(text).replaceAll("\n", "\\x0a");
}
/**
* Remove terminal controls from clipboard text before an editable field stores it.
* @param text - Raw pasted clipboard text.
* @returns The text stripped of OSC, CSI, escape, and control sequences.
*/
function sanitizePastedText(text) {
	return text.replace(TERMINAL_OSC_PATTERN, "").replace(TERMINAL_CSI_PATTERN, "").replace(TERMINAL_ESCAPE_PATTERN, "").replace(TERMINAL_CONTROL_PATTERN, "");
}

//#endregion
//#region packages/tui/src/components/bordered-editor.ts
/**
* Rounded bordered input box wrapping pi-tui's `Editor`.
*
* pi-tui's `Editor` only supports a horizontal frame (`frame: 'horizontal' |
* 'none'`). This component keeps the editor's own layout (prompt, wrapping,
* scroll indicators, autocomplete) and draws a full rounded border around it:
*
* ```text
* ╭─ dsh ───────────────── deepseek-v4-pro [deepseek-official] ─╮
* │ hello                                                       │
* ╰─────────────────────────────────────────────────────────────╯
* ```
*
* The border is theme-agnostic: it uses only the standard palette roles
* (`accent` when the editor is focused, `dim` when it is not) and never adds
* background/truecolor/extended-color escapes.
* @module @deepseek-ai/dsh-tui/components/bordered-editor
*/
/**
* Pad one editor body line to `innerWidth` visible columns without breaking
* ANSI styling. Editor output is normally already full-width; this is a
* defensive fit before the side borders are added.
*/
function padRow$1(line, innerWidth) {
	const bounded = truncateToWidth(line, innerWidth, "");
	return `${bounded}${" ".repeat(Math.max(0, innerWidth - visibleWidth(bounded)))}`;
}
/**
* Compose a rounded top border of exactly `width` visible columns.
*
* Format (mirroring the existing status-card title row):
* - no chip: `╭─ dsh ─────────╮`
* - chip:    `╭─ dsh ───── <name> [<provider>] ─╮`
*
* The right chip is truncated with `…` when needed, and dropped entirely when
* even the truncated chip cannot share the border with two dash runs.
*
* @param width - Terminal columns available to the border.
* @param leftLabel - Left label, already display-sanitized by the caller.
* @param rightLabel - Optional right chip text, already display-sanitized.
* @returns The top border line.
*/
function composeTopBorder(width, leftLabel, rightLabel) {
	const safeWidth = Math.max(1, width);
	const left = displayInlineText(leftLabel);
	const right = rightLabel === void 0 ? void 0 : displayText(rightLabel);
	if (safeWidth < 4) return `╭${"─".repeat(Math.max(0, safeWidth - 2))}╮`.slice(0, safeWidth);
	const contentWidth = safeWidth - 3;
	const noChip = () => {
		let label = left;
		let labelWidth = visibleWidth(label);
		if (labelWidth > contentWidth) {
			const maxLabel = Math.max(0, contentWidth - 1);
			label = maxLabel <= 0 ? "" : truncateToWidth(left, maxLabel, "…");
			labelWidth = visibleWidth(label);
		}
		const dashes = Math.max(0, contentWidth - labelWidth);
		return `╭─${label}${"─".repeat(dashes)}╮`;
	};
	if (right === void 0) return noChip();
	const leftWidth = visibleWidth(left);
	const availableForChip = contentWidth - leftWidth - 2;
	if (availableForChip >= 3) {
		const chipMax = availableForChip - 2;
		const spaced = ` ${truncateToWidth(right, chipMax, "…")} `;
		const spacedWidth = visibleWidth(spaced);
		const dashes = contentWidth - leftWidth - spacedWidth;
		if (dashes >= 2) {
			const leftDashes = Math.max(1, dashes - 1);
			const rightDashes = Math.max(1, dashes - leftDashes);
			return `╭─${left}${"─".repeat(leftDashes)}${spaced}${"─".repeat(rightDashes)}╮`;
		}
	}
	return noChip();
}
/**
* Full rounded border around a pi-tui `Editor`.
*
* The component extends `Container` so pi-tui's overlay focus-restore /
* `isComponentMounted` traversal still sees the editor child. The editor keeps
* receiving focus directly (`ui.setFocus(editor)`), while this wrapper reads
* `editor.focused` to choose the border color.
*/
var BorderedEditor = class extends Container {
	editor;
	palette;
	leftLabel;
	rightLabel;
	constructor(editor, palette, options = {}) {
		super();
		this.editor = editor;
		this.palette = palette;
		this.leftLabel = options.leftLabel ?? " dsh ";
		this.rightLabel = options.rightLabel;
		this.addChild(editor);
	}
	/** Focus state is owned by the wrapped editor; expose it for symmetry. */
	get focused() {
		return this.editor.focused;
	}
	set focused(value) {
		this.editor.focused = value;
	}
	/** Key-release handling is owned by the wrapped editor; expose it for symmetry. */
	get wantsKeyRelease() {
		return this.editor.wantsKeyRelease ?? false;
	}
	set wantsKeyRelease(value) {
		const target = this.editor;
		target.wantsKeyRelease = value;
	}
	/** Delegate input to the wrapped editor when this wrapper is focused directly. */
	handleInput(data) {
		this.editor.handleInput(data);
	}
	/** Update the right model chip shown in the top border. */
	setRightLabel(label) {
		this.rightLabel = label;
		this.invalidate();
	}
	/** Update the left brand label shown in the top border. */
	setLeftLabel(label) {
		this.leftLabel = label;
		this.invalidate();
	}
	render(width) {
		if (width < 4) return super.render(Math.max(1, width));
		const innerWidth = Math.max(1, width - 2);
		const border = this.editor.focused ? this.palette.accent : this.palette.dim;
		const lines = [border(composeTopBorder(width, this.leftLabel, this.rightLabel))];
		for (const line of super.render(innerWidth)) {
			const leftBorder = border("│");
			const rightBorder = border("│");
			lines.push(`${leftBorder}${padRow$1(line, innerWidth)}${rightBorder}`);
		}
		lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}
};

//#endregion
//#region packages/tui/src/components/content.ts
/**
* Flatten content blocks into a single display string, recursing into
* tool-result content and naming unknown block types.
* @param content - Content blocks to flatten.
* @returns The concatenated display text.
*/
function contentText(content) {
	const parts = [];
	for (const block of content) switch (block.type) {
		case "text":
		case "reasoning":
			parts.push(block.text);
			break;
		case "tool-call":
			parts.push(`${block.name}(${block.arguments})`);
			break;
		case "tool-result":
			parts.push(contentText(block.content));
			break;
		default: {
			const rawType = block.type;
			parts.push(`[${typeof rawType === "string" ? rawType : "content"}]`);
			break;
		}
	}
	return parts.join("");
}
/**
* Parse tool-call arguments from their JSON source.
* @param raw - Raw JSON arguments text.
* @returns The parsed value, or the raw text with `valid: false` on parse failure.
*/
function parseArguments(raw) {
	try {
		return {
			value: JSON.parse(raw),
			valid: true
		};
	} catch {
		return {
			value: raw,
			valid: false
		};
	}
}

//#endregion
//#region packages/tui/src/components/theme.ts
/** Names of the palette's color roles, in the order `/palette` prints them. */
const COLOR_ROLES = [
	"text",
	"dim",
	"accent",
	"brand",
	"code",
	"success",
	"warning",
	"error"
];
/** Names of the palette's attribute roles, in the order `/palette` prints them. */
const ATTRIBUTE_ROLES = [
	"bold",
	"italic",
	"underline",
	"strike",
	"selected"
];
/**
* Every SGR code the TUI is allowed to emit, keyed by role. This table is the
* single source: {@link createPalette} derives the wrappers from it, so no
* component hand-writes an escape.
*
* Only the standard 16-color set and SGR attributes appear here. Terminals remap
* those to the user's active theme, so the TUI stays legible on any background.
*
* @param scheme - Active terminal color scheme; only `code` differs between them.
* @returns The SGR spec for every color and attribute role.
*/
function paletteSpec(scheme) {
	return {
		colors: {
			text: {
				open: "",
				close: "",
				purpose: "Body text, the terminal default foreground"
			},
			dim: {
				open: "2;39",
				close: "22;39",
				purpose: "The one recessed tone: tool bodies, chrome, footers"
			},
			accent: {
				open: "95",
				close: "39",
				purpose: "The one emphasis color: role headers, prompt, borders"
			},
			brand: {
				open: "34",
				close: "39",
				purpose: "DeepSeek brand art when truecolor is unavailable"
			},
			code: scheme === "light" ? {
				open: "34",
				close: "39",
				purpose: "Inline code and code blocks in prose"
			} : {
				open: "36",
				close: "39",
				purpose: "Inline code and code blocks in prose"
			},
			success: {
				open: "32",
				close: "39",
				purpose: "Succeeded calls, and a diff's added lines"
			},
			warning: {
				open: "33",
				close: "39",
				purpose: "Pending calls and warnings"
			},
			error: {
				open: "31",
				close: "39",
				purpose: "Failures, signals, and a diff's removed lines"
			}
		},
		attributes: {
			bold: {
				open: "1",
				close: "22",
				purpose: "Emphasis; composes with any color"
			},
			italic: {
				open: "3",
				close: "23",
				purpose: "Reasoning text"
			},
			underline: {
				open: "4",
				close: "24",
				purpose: "Role-header banding"
			},
			strike: {
				open: "9",
				close: "29",
				purpose: "Struck-through Markdown"
			},
			selected: {
				open: "7",
				close: "27",
				purpose: "Reverse video for the active selection"
			}
		}
	};
}
/**
* Wrap text in an SGR pair, or pass it through when color is disabled.
* An empty `open` emits nothing, so the `text` role costs no escape.
*/
function ansi(spec, enabled) {
	if (!enabled || spec.open === "") return (text) => text;
	return (text) => `\x1b[${spec.open}m${text}\x1b[${spec.close}m`;
}
/**
* Theme-agnostic palette derived from {@link paletteSpec}. Body `text` stays the
* terminal's default foreground so it reads on light and dark backgrounds alike.
*
* @param enabled - Whether ANSI is emitted at all.
* @param scheme - Active terminal color scheme; adjusts the code role.
* @returns The role palette for the given scheme.
*/
function createPalette(enabled, scheme = "dark") {
	const spec = paletteSpec(scheme);
	const roles = {};
	for (const name of COLOR_ROLES) roles[name] = ansi(spec.colors[name], enabled);
	for (const name of ATTRIBUTE_ROLES) roles[name] = ansi(spec.attributes[name], enabled);
	return roles;
}
/**
* DeepSeek brand gradient stops (indigo → light blue) taken from the
* deepseek.com logo, painted across the startup banner's product name on
* truecolor terminals. Fixed brand identity, deliberately outside the
* theme-adaptive {@link Palette}.
*/
const BRAND_GRADIENT = [
	[
		77,
		107,
		254
	],
	[
		57,
		130,
		255
	],
	[
		36,
		152,
		255
	]
];
/** Official DeepSeek icon ink from the shipped 24x24 SVG. */
const DEEPSEEK_BRAND_RGB = BRAND_GRADIENT[0];
/**
* Sample {@link BRAND_GRADIENT} at fraction `t` via piecewise-linear
* interpolation across its stops.
*
* @param t - Position along the gradient; clamped to [0, 1].
* @returns The interpolated `[r, g, b]` channels, each rounded to 0–255.
*/
function brandColorAt(t) {
	const span = Math.min(Math.max(t, 0), 1) * (BRAND_GRADIENT.length - 1);
	const index = Math.min(Math.floor(span), BRAND_GRADIENT.length - 2);
	const local = span - index;
	const from = BRAND_GRADIENT[index];
	const to = BRAND_GRADIENT[index + 1];
	return [
		Math.round(from[0] + (to[0] - from[0]) * local),
		Math.round(from[1] + (to[1] - from[1]) * local),
		Math.round(from[2] + (to[2] - from[2]) * local)
	];
}
/**
* Paint `text` left-to-right in the DeepSeek brand gradient with per-character
* 24-bit foreground codes, resetting to the default foreground at the end.
* Foreground-only, so it stays legible on any terminal background; the caller
* gates it on truecolor support and wraps it in bold.
*
* @param text - Text to colorize; sampled once per character.
* @returns `text` wrapped in truecolor SGR foreground codes.
*/
function gradientText(text) {
	const glyphs = Array.from(text);
	const last = Math.max(1, glyphs.length - 1);
	let painted = "";
	for (let index = 0; index < glyphs.length; index += 1) {
		const [r, g, b] = brandColorAt(index / last);
		painted += `\x1b[38;2;${r};${g};${b}m${glyphs[index]}`;
	}
	return `${painted}\x1b[39m`;
}
/**
* Derive the pi-tui Markdown theme from a role palette.
* @param palette - Active role palette.
* @returns The Markdown theme wired to palette roles.
*/
function markdownTheme(palette) {
	return {
		heading: (text) => palette.accent(text),
		link: (text) => palette.accent(text),
		/* v8 ignore next */
		linkUrl: (text) => palette.dim(text),
		code: (text) => palette.code(text),
		codeBlock: (text) => palette.code(text),
		codeBlockBorder: (text) => palette.dim(text.slice(3)),
		quote: (text) => palette.dim(text),
		quoteBorder: (text) => palette.accent(text),
		hr: (text) => palette.dim(text),
		listBullet: (text) => palette.accent(text),
		bold: (text) => palette.bold(text),
		italic: (text) => palette.italic(text),
		strikethrough: (text) => palette.strike(text),
		underline: (text) => palette.underline(text)
	};
}
/**
* Derive the pi-tui select-list theme from a role palette.
* @param palette - Active role palette.
* @returns The select-list theme wired to palette roles.
*/
function selectTheme(palette) {
	return {
		selectedPrefix: palette.accent,
		selectedText: palette.accent,
		description: palette.dim,
		scrollInfo: palette.dim,
		noMatch: palette.warning
	};
}
/** The painted swatch every /palette sample row uses. */
const PALETTE_SAMPLE = "████";
/**
* Render the complete role palette as transcript rows: each color role's name,
* SGR pair, and purpose, plus the attribute roles that compose with any color.
* @param palette - Active role palette.
* @param scheme - The color scheme the palette was built for.
* @param colorEnabled - Whether the palette applies its escapes.
* @returns The painted rows the /palette command appends to the transcript.
*/
function renderPalette(palette, scheme, colorEnabled) {
	const spec = paletteSpec(scheme);
	const width = Math.max(...[...COLOR_ROLES, ...ATTRIBUTE_ROLES].map((name) => name.length));
	const head = (name, role, sample) => {
		const pair = role.open === "" ? "no escape" : `ESC[${role.open}m ESC[${role.close}m`;
		return `  ${sample}  ${palette.dim(`${name.padEnd(width)} ${pair}`)}`;
	};
	const purpose = (role) => `  ${palette.dim(`    ${role.purpose}`)}`;
	const rows = [
		palette.bold(palette.accent("Palette")),
		palette.dim(`${scheme} scheme · color ${colorEnabled ? "on" : "off"}`),
		"",
		palette.dim("Colors — exactly one per span; they never nest inside each other.")
	];
	for (const name of COLOR_ROLES) rows.push(head(name, spec.colors[name], palette[name](PALETTE_SAMPLE)), purpose(spec.colors[name]));
	rows.push("", palette.dim("Attributes — compose with any color, in either order."));
	for (const name of ATTRIBUTE_ROLES) rows.push(head(name, spec.attributes[name], palette[name](PALETTE_SAMPLE)), purpose(spec.attributes[name]));
	return rows;
}

//#endregion
//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/base.js
var Diff = class {
	diff(oldStr, newStr, options = {}) {
		let callback;
		if (typeof options === "function") {
			callback = options;
			options = {};
		} else if ("callback" in options) callback = options.callback;
		const oldString = this.castInput(oldStr, options);
		const newString = this.castInput(newStr, options);
		const oldTokens = this.removeEmpty(this.tokenize(oldString, options));
		const newTokens = this.removeEmpty(this.tokenize(newString, options));
		return this.diffWithOptionsObj(oldTokens, newTokens, options, callback);
	}
	diffWithOptionsObj(oldTokens, newTokens, options, callback) {
		var _a;
		const done = (value) => {
			value = this.postProcess(value, options);
			if (callback) {
				setTimeout(function() {
					callback(value);
				}, 0);
				return;
			} else return value;
		};
		const newLen = newTokens.length, oldLen = oldTokens.length;
		let editLength = 1;
		let maxEditLength = newLen + oldLen;
		if (options.maxEditLength != null) maxEditLength = Math.min(maxEditLength, options.maxEditLength);
		const maxExecutionTime = (_a = options.timeout) !== null && _a !== void 0 ? _a : Infinity;
		const abortAfterTimestamp = Date.now() + maxExecutionTime;
		const bestPath = [{
			oldPos: -1,
			lastComponent: void 0
		}];
		let newPos = this.extractCommon(bestPath[0], newTokens, oldTokens, 0, options);
		if (bestPath[0].oldPos + 1 >= oldLen && newPos + 1 >= newLen) return done(this.buildValues(bestPath[0].lastComponent, newTokens, oldTokens));
		let minDiagonalToConsider = -Infinity, maxDiagonalToConsider = Infinity;
		const execEditLength = () => {
			for (let diagonalPath = Math.max(minDiagonalToConsider, -editLength); diagonalPath <= Math.min(maxDiagonalToConsider, editLength); diagonalPath += 2) {
				let basePath;
				const removePath = bestPath[diagonalPath - 1], addPath = bestPath[diagonalPath + 1];
				if (removePath) bestPath[diagonalPath - 1] = void 0;
				let canAdd = false;
				if (addPath) {
					const addPathNewPos = addPath.oldPos - diagonalPath;
					canAdd = addPath && 0 <= addPathNewPos && addPathNewPos < newLen;
				}
				const canRemove = removePath && removePath.oldPos + 1 < oldLen;
				if (!canAdd && !canRemove) {
					bestPath[diagonalPath] = void 0;
					continue;
				}
				if (!canRemove || canAdd && removePath.oldPos < addPath.oldPos) basePath = this.addToPath(addPath, true, false, 0, options);
				else basePath = this.addToPath(removePath, false, true, 1, options);
				newPos = this.extractCommon(basePath, newTokens, oldTokens, diagonalPath, options);
				if (basePath.oldPos + 1 >= oldLen && newPos + 1 >= newLen) return done(this.buildValues(basePath.lastComponent, newTokens, oldTokens)) || true;
				else {
					bestPath[diagonalPath] = basePath;
					if (basePath.oldPos + 1 >= oldLen) maxDiagonalToConsider = Math.min(maxDiagonalToConsider, diagonalPath - 1);
					if (newPos + 1 >= newLen) minDiagonalToConsider = Math.max(minDiagonalToConsider, diagonalPath + 1);
				}
			}
			editLength++;
		};
		if (callback) (function exec() {
			setTimeout(function() {
				if (editLength > maxEditLength || Date.now() > abortAfterTimestamp) return callback(void 0);
				if (!execEditLength()) exec();
			}, 0);
		})();
		else while (editLength <= maxEditLength && Date.now() <= abortAfterTimestamp) {
			const ret = execEditLength();
			if (ret) return ret;
		}
	}
	addToPath(path, added, removed, oldPosInc, options) {
		const last = path.lastComponent;
		if (last && !options.oneChangePerToken && last.added === added && last.removed === removed) return {
			oldPos: path.oldPos + oldPosInc,
			lastComponent: {
				count: last.count + 1,
				added,
				removed,
				previousComponent: last.previousComponent
			}
		};
		else return {
			oldPos: path.oldPos + oldPosInc,
			lastComponent: {
				count: 1,
				added,
				removed,
				previousComponent: last
			}
		};
	}
	extractCommon(basePath, newTokens, oldTokens, diagonalPath, options) {
		const newLen = newTokens.length, oldLen = oldTokens.length;
		let oldPos = basePath.oldPos, newPos = oldPos - diagonalPath, commonCount = 0;
		while (newPos + 1 < newLen && oldPos + 1 < oldLen && this.equals(oldTokens[oldPos + 1], newTokens[newPos + 1], options)) {
			newPos++;
			oldPos++;
			commonCount++;
			if (options.oneChangePerToken) basePath.lastComponent = {
				count: 1,
				previousComponent: basePath.lastComponent,
				added: false,
				removed: false
			};
		}
		if (commonCount && !options.oneChangePerToken) basePath.lastComponent = {
			count: commonCount,
			previousComponent: basePath.lastComponent,
			added: false,
			removed: false
		};
		basePath.oldPos = oldPos;
		return newPos;
	}
	equals(left, right, options) {
		if (options.comparator) return options.comparator(left, right);
		else return left === right || !!options.ignoreCase && left.toLowerCase() === right.toLowerCase();
	}
	removeEmpty(array) {
		const ret = [];
		for (let i = 0; i < array.length; i++) if (array[i]) ret.push(array[i]);
		return ret;
	}
	castInput(value, options) {
		return value;
	}
	tokenize(value, options) {
		return Array.from(value);
	}
	join(chars) {
		return chars.join("");
	}
	postProcess(changeObjects, options) {
		return changeObjects;
	}
	get useLongestToken() {
		return false;
	}
	buildValues(lastComponent, newTokens, oldTokens) {
		const components = [];
		let nextComponent;
		while (lastComponent) {
			components.push(lastComponent);
			nextComponent = lastComponent.previousComponent;
			delete lastComponent.previousComponent;
			lastComponent = nextComponent;
		}
		components.reverse();
		const componentLen = components.length;
		let componentPos = 0, newPos = 0, oldPos = 0;
		for (; componentPos < componentLen; componentPos++) {
			const component = components[componentPos];
			if (!component.removed) {
				if (!component.added && this.useLongestToken) {
					let value = newTokens.slice(newPos, newPos + component.count);
					value = value.map(function(value, i) {
						const oldValue = oldTokens[oldPos + i];
						return oldValue.length > value.length ? oldValue : value;
					});
					component.value = this.join(value);
				} else component.value = this.join(newTokens.slice(newPos, newPos + component.count));
				newPos += component.count;
				if (!component.added) oldPos += component.count;
			} else {
				component.value = this.join(oldTokens.slice(oldPos, oldPos + component.count));
				oldPos += component.count;
			}
		}
		return components;
	}
};

//#endregion
//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/character.js
var CharacterDiff = class extends Diff {};
const characterDiff = new CharacterDiff();

//#endregion
//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/util/string.js
function longestCommonPrefix(str1, str2) {
	let i;
	for (i = 0; i < str1.length && i < str2.length; i++) if (str1[i] != str2[i]) return str1.slice(0, i);
	return str1.slice(0, i);
}
function longestCommonSuffix(str1, str2) {
	let i;
	if (!str1 || !str2 || str1[str1.length - 1] != str2[str2.length - 1]) return "";
	for (i = 0; i < str1.length && i < str2.length; i++) if (str1[str1.length - (i + 1)] != str2[str2.length - (i + 1)]) return str1.slice(-i);
	return str1.slice(-i);
}
function replacePrefix(string, oldPrefix, newPrefix) {
	if (string.slice(0, oldPrefix.length) != oldPrefix) throw Error(`string ${JSON.stringify(string)} doesn't start with prefix ${JSON.stringify(oldPrefix)}; this is a bug`);
	return newPrefix + string.slice(oldPrefix.length);
}
function replaceSuffix(string, oldSuffix, newSuffix) {
	if (!oldSuffix) return string + newSuffix;
	if (string.slice(-oldSuffix.length) != oldSuffix) throw Error(`string ${JSON.stringify(string)} doesn't end with suffix ${JSON.stringify(oldSuffix)}; this is a bug`);
	return string.slice(0, -oldSuffix.length) + newSuffix;
}
function removePrefix(string, oldPrefix) {
	return replacePrefix(string, oldPrefix, "");
}
function removeSuffix(string, oldSuffix) {
	return replaceSuffix(string, oldSuffix, "");
}
function maximumOverlap(string1, string2) {
	return string2.slice(0, overlapCount(string1, string2));
}
function overlapCount(a, b) {
	let startA = 0;
	if (a.length > b.length) startA = a.length - b.length;
	let endB = b.length;
	if (a.length < b.length) endB = a.length;
	const map = Array(endB);
	let k = 0;
	map[0] = 0;
	for (let j = 1; j < endB; j++) {
		if (b[j] == b[k]) map[j] = map[k];
		else map[j] = k;
		while (k > 0 && b[j] != b[k]) k = map[k];
		if (b[j] == b[k]) k++;
	}
	k = 0;
	for (let i = startA; i < a.length; i++) {
		while (k > 0 && a[i] != b[k]) k = map[k];
		if (a[i] == b[k]) k++;
	}
	return k;
}
/**
* Split a string into segments using a word segmenter, merging consecutive
* segments if they are both whitespace segments. Whitespace segments can
* appear adjacent to one another for two reasons:
* - newlines always get their own segment
* - where a diacritic is attached to a whitespace character in the text, the
*   segment ends after the diacritic, so e.g. " \u0300 " becomes two segments.
* This function therefore runs the segmenter's .segment() method and then
* merges consecutive segments of whitespace into a single part.
*/
function segment(string, segmenter) {
	const parts = [];
	for (const segmentObj of Array.from(segmenter.segment(string))) {
		const segment = segmentObj.segment;
		if (parts.length && /\s/.test(parts[parts.length - 1]) && /\s/.test(segment)) parts[parts.length - 1] += segment;
		else parts.push(segment);
	}
	return parts;
}
function trailingWs(string, segmenter) {
	if (segmenter) return leadingAndTrailingWs(string, segmenter)[1];
	let i;
	for (i = string.length - 1; i >= 0; i--) if (!string[i].match(/\s/)) break;
	return string.substring(i + 1);
}
function leadingWs(string, segmenter) {
	if (segmenter) return leadingAndTrailingWs(string, segmenter)[0];
	const match = string.match(/^\s*/);
	return match ? match[0] : "";
}
function leadingAndTrailingWs(string, segmenter) {
	if (!segmenter) return [leadingWs(string), trailingWs(string)];
	if (segmenter.resolvedOptions().granularity != "word") throw new Error("The segmenter passed must have a granularity of \"word\"");
	const segments = segment(string, segmenter);
	const firstSeg = segments[0];
	const lastSeg = segments[segments.length - 1];
	return [/\s/.test(firstSeg) ? firstSeg : "", /\s/.test(lastSeg) ? lastSeg : ""];
}

//#endregion
//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/word.js
const extendedWordChars = "a-zA-Z0-9_\\u{AD}\\u{C0}-\\u{D6}\\u{D8}-\\u{F6}\\u{F8}-\\u{2C6}\\u{2C8}-\\u{2D7}\\u{2DE}-\\u{2FF}\\u{1E00}-\\u{1EFF}";
const tokenizeIncludingWhitespace = new RegExp(`[${extendedWordChars}]+|\\s+|[^${extendedWordChars}]`, "ug");
var WordDiff = class extends Diff {
	equals(left, right, options) {
		if (options.ignoreCase) {
			left = left.toLowerCase();
			right = right.toLowerCase();
		}
		return left.trim() === right.trim();
	}
	tokenize(value, options = {}) {
		let parts;
		if (options.intlSegmenter) {
			const segmenter = options.intlSegmenter;
			if (segmenter.resolvedOptions().granularity != "word") throw new Error("The segmenter passed must have a granularity of \"word\"");
			parts = segment(value, segmenter);
		} else parts = value.match(tokenizeIncludingWhitespace) || [];
		const tokens = [];
		let prevPart = null;
		parts.forEach((part) => {
			if (/\s/.test(part)) {
				if (prevPart == null) tokens.push(part);
				else tokens.push(tokens.pop() + part);
			} else if (prevPart != null && /\s/.test(prevPart)) {
				if (tokens[tokens.length - 1] == prevPart) tokens.push(tokens.pop() + part);
				else tokens.push(prevPart + part);
			} else tokens.push(part);
			prevPart = part;
		});
		return tokens;
	}
	join(tokens) {
		return tokens.map((token, i) => {
			if (i == 0) return token;
			else return token.replace(/^\s+/, "");
		}).join("");
	}
	postProcess(changes, options) {
		if (!changes || options.oneChangePerToken) return changes;
		let lastKeep = null;
		let insertion = null;
		let deletion = null;
		changes.forEach((change) => {
			if (change.added) insertion = change;
			else if (change.removed) deletion = change;
			else {
				if (insertion || deletion) dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, change, options.intlSegmenter);
				lastKeep = change;
				insertion = null;
				deletion = null;
			}
		});
		if (insertion || deletion) dedupeWhitespaceInChangeObjects(lastKeep, deletion, insertion, null, options.intlSegmenter);
		return changes;
	}
};
const wordDiff = new WordDiff();
function dedupeWhitespaceInChangeObjects(startKeep, deletion, insertion, endKeep, segmenter) {
	if (deletion && insertion) {
		const [oldWsPrefix, oldWsSuffix] = leadingAndTrailingWs(deletion.value, segmenter);
		const [newWsPrefix, newWsSuffix] = leadingAndTrailingWs(insertion.value, segmenter);
		if (startKeep) {
			const commonWsPrefix = longestCommonPrefix(oldWsPrefix, newWsPrefix);
			startKeep.value = replaceSuffix(startKeep.value, newWsPrefix, commonWsPrefix);
			deletion.value = removePrefix(deletion.value, commonWsPrefix);
			insertion.value = removePrefix(insertion.value, commonWsPrefix);
		}
		if (endKeep) {
			const commonWsSuffix = longestCommonSuffix(oldWsSuffix, newWsSuffix);
			endKeep.value = replacePrefix(endKeep.value, newWsSuffix, commonWsSuffix);
			deletion.value = removeSuffix(deletion.value, commonWsSuffix);
			insertion.value = removeSuffix(insertion.value, commonWsSuffix);
		}
	} else if (insertion) {
		if (startKeep) {
			const ws = leadingWs(insertion.value, segmenter);
			insertion.value = insertion.value.substring(ws.length);
		}
		if (endKeep) {
			const ws = leadingWs(endKeep.value, segmenter);
			endKeep.value = endKeep.value.substring(ws.length);
		}
	} else if (startKeep && endKeep) {
		const newWsFull = leadingWs(endKeep.value, segmenter), [delWsStart, delWsEnd] = leadingAndTrailingWs(deletion.value, segmenter);
		const newWsStart = longestCommonPrefix(newWsFull, delWsStart);
		deletion.value = removePrefix(deletion.value, newWsStart);
		const newWsEnd = longestCommonSuffix(removePrefix(newWsFull, newWsStart), delWsEnd);
		deletion.value = removeSuffix(deletion.value, newWsEnd);
		endKeep.value = replacePrefix(endKeep.value, newWsFull, newWsEnd);
		startKeep.value = replaceSuffix(startKeep.value, newWsFull, newWsFull.slice(0, newWsFull.length - newWsEnd.length));
	} else if (endKeep) {
		const endKeepWsPrefix = leadingWs(endKeep.value, segmenter);
		const deletionWsSuffix = trailingWs(deletion.value, segmenter);
		const overlap = maximumOverlap(deletionWsSuffix, endKeepWsPrefix);
		deletion.value = removeSuffix(deletion.value, overlap);
	} else if (startKeep) {
		const startKeepWsSuffix = trailingWs(startKeep.value, segmenter);
		const deletionWsPrefix = leadingWs(deletion.value, segmenter);
		const overlap = maximumOverlap(startKeepWsSuffix, deletionWsPrefix);
		deletion.value = removePrefix(deletion.value, overlap);
	}
}
var WordsWithSpaceDiff = class extends Diff {
	tokenize(value) {
		const regex = new RegExp(`(\\r?\\n)|[${extendedWordChars}]+|[^\\S\\n\\r]+|[^${extendedWordChars}]`, "ug");
		return value.match(regex) || [];
	}
};
const wordsWithSpaceDiff = new WordsWithSpaceDiff();

//#endregion
//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/line.js
var LineDiff = class extends Diff {
	constructor() {
		super(...arguments);
		this.tokenize = tokenize;
	}
	equals(left, right, options) {
		if (options.ignoreWhitespace) {
			if (!options.newlineIsToken || !left.includes("\n")) left = left.trim();
			if (!options.newlineIsToken || !right.includes("\n")) right = right.trim();
		} else if (options.ignoreNewlineAtEof && !options.newlineIsToken) {
			if (left.endsWith("\n")) left = left.slice(0, -1);
			if (right.endsWith("\n")) right = right.slice(0, -1);
		}
		return super.equals(left, right, options);
	}
};
const lineDiff = new LineDiff();
function diffLines(oldStr, newStr, options) {
	return lineDiff.diff(oldStr, newStr, options);
}
function tokenize(value, options) {
	if (options.stripTrailingCr) value = value.replace(/\r\n/g, "\n");
	const retLines = [], linesAndNewlines = value.split(/(\n|\r\n)/);
	if (!linesAndNewlines[linesAndNewlines.length - 1]) linesAndNewlines.pop();
	for (let i = 0; i < linesAndNewlines.length; i++) {
		const line = linesAndNewlines[i];
		if (i % 2 && !options.newlineIsToken) retLines[retLines.length - 1] += line;
		else retLines.push(line);
	}
	return retLines;
}

//#endregion
//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/sentence.js
function isSentenceEndPunct(char) {
	return char == "." || char == "!" || char == "?";
}
var SentenceDiff = class extends Diff {
	tokenize(value) {
		var _a;
		const result = [];
		let tokenStartI = 0;
		for (let i = 0; i < value.length; i++) {
			if (i == value.length - 1) {
				result.push(value.slice(tokenStartI));
				break;
			}
			if (isSentenceEndPunct(value[i]) && value[i + 1].match(/\s/)) {
				result.push(value.slice(tokenStartI, i + 1));
				i = tokenStartI = i + 1;
				while ((_a = value[i + 1]) === null || _a === void 0 ? void 0 : _a.match(/\s/)) i++;
				result.push(value.slice(tokenStartI, i + 1));
				tokenStartI = i + 1;
			}
		}
		return result;
	}
};
const sentenceDiff = new SentenceDiff();

//#endregion
//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/css.js
var CssDiff = class extends Diff {
	tokenize(value) {
		return value.split(/([{}:;,]|\s+)/);
	}
};
const cssDiff = new CssDiff();

//#endregion
//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/json.js
var JsonDiff = class extends Diff {
	constructor() {
		super(...arguments);
		this.tokenize = tokenize;
	}
	get useLongestToken() {
		return true;
	}
	castInput(value, options) {
		const { undefinedReplacement, stringifyReplacer = (k, v) => typeof v === "undefined" ? undefinedReplacement : v } = options;
		return typeof value === "string" ? value : JSON.stringify(canonicalize(value, null, null, stringifyReplacer), null, "  ");
	}
	equals(left, right, options) {
		return super.equals(left.replace(/,([\r\n])/g, "$1"), right.replace(/,([\r\n])/g, "$1"), options);
	}
};
const jsonDiff = new JsonDiff();
function canonicalize(obj, stack, replacementStack, replacer, key) {
	stack = stack || [];
	replacementStack = replacementStack || [];
	if (replacer) obj = replacer(key === void 0 ? "" : key, obj);
	let i;
	for (i = 0; i < stack.length; i += 1) if (stack[i] === obj) return replacementStack[i];
	let canonicalizedObj;
	if ("[object Array]" === Object.prototype.toString.call(obj)) {
		stack.push(obj);
		canonicalizedObj = new Array(obj.length);
		replacementStack.push(canonicalizedObj);
		for (i = 0; i < obj.length; i += 1) canonicalizedObj[i] = canonicalize(obj[i], stack, replacementStack, replacer, String(i));
		stack.pop();
		replacementStack.pop();
		return canonicalizedObj;
	}
	if (obj && obj.toJSON) obj = obj.toJSON();
	if (typeof obj === "object" && obj !== null) {
		stack.push(obj);
		canonicalizedObj = {};
		replacementStack.push(canonicalizedObj);
		const sortedKeys = [];
		let key;
		for (key in obj)
 /* istanbul ignore else */
		if (Object.prototype.hasOwnProperty.call(obj, key)) sortedKeys.push(key);
		sortedKeys.sort();
		for (i = 0; i < sortedKeys.length; i += 1) {
			key = sortedKeys[i];
			canonicalizedObj[key] = canonicalize(obj[key], stack, replacementStack, replacer, key);
		}
		stack.pop();
		replacementStack.pop();
	} else canonicalizedObj = obj;
	return canonicalizedObj;
}

//#endregion
//#region node_modules/.pnpm/diff@9.0.0/node_modules/diff/libesm/diff/array.js
var ArrayDiff = class extends Diff {
	tokenize(value) {
		return value.slice();
	}
	join(value) {
		return value;
	}
	removeEmpty(value) {
		return value;
	}
};
const arrayDiff = new ArrayDiff();

//#endregion
//#region node_modules/.pnpm/xmlchars@2.2.0/node_modules/xmlchars/xml/1.0/ed5.js
var require_ed5 = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Character classes and associated utilities for the 5th edition of XML 1.0.
	*
	* @author Louis-Dominique Dubeau
	* @license MIT
	* @copyright Louis-Dominique Dubeau
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.CHAR = "	\n\r -퟿-�𐀀-􏿿";
	exports.S = " 	\r\n";
	exports.NAME_START_CHAR = ":A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�𐀀-󯿿";
	exports.NAME_CHAR = "-" + exports.NAME_START_CHAR + ".0-9·̀-ͯ‿-⁀";
	exports.CHAR_RE = new RegExp("^[" + exports.CHAR + "]$", "u");
	exports.S_RE = new RegExp("^[" + exports.S + "]+$", "u");
	exports.NAME_START_CHAR_RE = new RegExp("^[" + exports.NAME_START_CHAR + "]$", "u");
	exports.NAME_CHAR_RE = new RegExp("^[" + exports.NAME_CHAR + "]$", "u");
	exports.NAME_RE = new RegExp("^[" + exports.NAME_START_CHAR + "][" + exports.NAME_CHAR + "]*$", "u");
	exports.NMTOKEN_RE = new RegExp("^[" + exports.NAME_CHAR + "]+$", "u");
	var TAB = 9;
	var NL = 10;
	var CR = 13;
	var SPACE = 32;
	/** All characters in the ``S`` production. */
	exports.S_LIST = [
		SPACE,
		NL,
		CR,
		TAB
	];
	/**
	* Determines whether a codepoint matches the ``CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``CHAR``.
	*/
	function isChar(c) {
		return c >= SPACE && c <= 55295 || c === NL || c === CR || c === TAB || c >= 57344 && c <= 65533 || c >= 65536 && c <= 1114111;
	}
	exports.isChar = isChar;
	/**
	* Determines whether a codepoint matches the ``S`` (space) production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``S``.
	*/
	function isS(c) {
		return c === SPACE || c === NL || c === CR || c === TAB;
	}
	exports.isS = isS;
	/**
	* Determines whether a codepoint matches the ``NAME_START_CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``NAME_START_CHAR``.
	*/
	function isNameStartChar(c) {
		return c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 58 || c === 95 || c === 8204 || c === 8205 || c >= 192 && c <= 214 || c >= 216 && c <= 246 || c >= 248 && c <= 767 || c >= 880 && c <= 893 || c >= 895 && c <= 8191 || c >= 8304 && c <= 8591 || c >= 11264 && c <= 12271 || c >= 12289 && c <= 55295 || c >= 63744 && c <= 64975 || c >= 65008 && c <= 65533 || c >= 65536 && c <= 983039;
	}
	exports.isNameStartChar = isNameStartChar;
	/**
	* Determines whether a codepoint matches the ``NAME_CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``NAME_CHAR``.
	*/
	function isNameChar(c) {
		return isNameStartChar(c) || c >= 48 && c <= 57 || c === 45 || c === 46 || c === 183 || c >= 768 && c <= 879 || c >= 8255 && c <= 8256;
	}
	exports.isNameChar = isNameChar;
}));

//#endregion
//#region node_modules/.pnpm/xmlchars@2.2.0/node_modules/xmlchars/xml/1.1/ed2.js
var require_ed2 = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Character classes and associated utilities for the 2nd edition of XML 1.1.
	*
	* @author Louis-Dominique Dubeau
	* @license MIT
	* @copyright Louis-Dominique Dubeau
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.CHAR = "-퟿-�𐀀-􏿿";
	exports.RESTRICTED_CHAR = "-\b\v\f---";
	exports.S = " 	\r\n";
	exports.NAME_START_CHAR = ":A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�𐀀-󯿿";
	exports.NAME_CHAR = "-" + exports.NAME_START_CHAR + ".0-9·̀-ͯ‿-⁀";
	exports.CHAR_RE = new RegExp("^[" + exports.CHAR + "]$", "u");
	exports.RESTRICTED_CHAR_RE = new RegExp("^[" + exports.RESTRICTED_CHAR + "]$", "u");
	exports.S_RE = new RegExp("^[" + exports.S + "]+$", "u");
	exports.NAME_START_CHAR_RE = new RegExp("^[" + exports.NAME_START_CHAR + "]$", "u");
	exports.NAME_CHAR_RE = new RegExp("^[" + exports.NAME_CHAR + "]$", "u");
	exports.NAME_RE = new RegExp("^[" + exports.NAME_START_CHAR + "][" + exports.NAME_CHAR + "]*$", "u");
	exports.NMTOKEN_RE = new RegExp("^[" + exports.NAME_CHAR + "]+$", "u");
	var TAB = 9;
	var NL = 10;
	var CR = 13;
	var SPACE = 32;
	/** All characters in the ``S`` production. */
	exports.S_LIST = [
		SPACE,
		NL,
		CR,
		TAB
	];
	/**
	* Determines whether a codepoint matches the ``CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``CHAR``.
	*/
	function isChar(c) {
		return c >= 1 && c <= 55295 || c >= 57344 && c <= 65533 || c >= 65536 && c <= 1114111;
	}
	exports.isChar = isChar;
	/**
	* Determines whether a codepoint matches the ``RESTRICTED_CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``RESTRICTED_CHAR``.
	*/
	function isRestrictedChar(c) {
		return c >= 1 && c <= 8 || c === 11 || c === 12 || c >= 14 && c <= 31 || c >= 127 && c <= 132 || c >= 134 && c <= 159;
	}
	exports.isRestrictedChar = isRestrictedChar;
	/**
	* Determines whether a codepoint matches the ``CHAR`` production and does not
	* match the ``RESTRICTED_CHAR`` production. ``isCharAndNotRestricted(x)`` is
	* equivalent to ``isChar(x) && !isRestrictedChar(x)``. This function is faster
	* than running the two-call equivalent.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``CHAR`` and does not match
	* ``RESTRICTED_CHAR``.
	*/
	function isCharAndNotRestricted(c) {
		return c === 9 || c === 10 || c === 13 || c > 31 && c < 127 || c === 133 || c > 159 && c <= 55295 || c >= 57344 && c <= 65533 || c >= 65536 && c <= 1114111;
	}
	exports.isCharAndNotRestricted = isCharAndNotRestricted;
	/**
	* Determines whether a codepoint matches the ``S`` (space) production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``S``.
	*/
	function isS(c) {
		return c === SPACE || c === NL || c === CR || c === TAB;
	}
	exports.isS = isS;
	/**
	* Determines whether a codepoint matches the ``NAME_START_CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``NAME_START_CHAR``.
	*/
	function isNameStartChar(c) {
		return c >= 65 && c <= 90 || c >= 97 && c <= 122 || c === 58 || c === 95 || c === 8204 || c === 8205 || c >= 192 && c <= 214 || c >= 216 && c <= 246 || c >= 248 && c <= 767 || c >= 880 && c <= 893 || c >= 895 && c <= 8191 || c >= 8304 && c <= 8591 || c >= 11264 && c <= 12271 || c >= 12289 && c <= 55295 || c >= 63744 && c <= 64975 || c >= 65008 && c <= 65533 || c >= 65536 && c <= 983039;
	}
	exports.isNameStartChar = isNameStartChar;
	/**
	* Determines whether a codepoint matches the ``NAME_CHAR`` production.
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches ``NAME_CHAR``.
	*/
	function isNameChar(c) {
		return isNameStartChar(c) || c >= 48 && c <= 57 || c === 45 || c === 46 || c === 183 || c >= 768 && c <= 879 || c >= 8255 && c <= 8256;
	}
	exports.isNameChar = isNameChar;
}));

//#endregion
//#region node_modules/.pnpm/xmlchars@2.2.0/node_modules/xmlchars/xmlns/1.0/ed3.js
var require_ed3 = /* @__PURE__ */ __commonJSMin(((exports) => {
	/**
	* Character class utilities for XML NS 1.0 edition 3.
	*
	* @author Louis-Dominique Dubeau
	* @license MIT
	* @copyright Louis-Dominique Dubeau
	*/
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.NC_NAME_START_CHAR = "A-Z_a-zÀ-ÖØ-öø-˿Ͱ-ͽͿ-῿‌-‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�𐀀-󯿿";
	exports.NC_NAME_CHAR = "-" + exports.NC_NAME_START_CHAR + ".0-9·̀-ͯ‿-⁀";
	exports.NC_NAME_START_CHAR_RE = new RegExp("^[" + exports.NC_NAME_START_CHAR + "]$", "u");
	exports.NC_NAME_CHAR_RE = new RegExp("^[" + exports.NC_NAME_CHAR + "]$", "u");
	exports.NC_NAME_RE = new RegExp("^[" + exports.NC_NAME_START_CHAR + "][" + exports.NC_NAME_CHAR + "]*$", "u");
	/**
	* Determines whether a codepoint matches [[NC_NAME_START_CHAR]].
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches.
	*/
	function isNCNameStartChar(c) {
		return c >= 65 && c <= 90 || c === 95 || c >= 97 && c <= 122 || c >= 192 && c <= 214 || c >= 216 && c <= 246 || c >= 248 && c <= 767 || c >= 880 && c <= 893 || c >= 895 && c <= 8191 || c >= 8204 && c <= 8205 || c >= 8304 && c <= 8591 || c >= 11264 && c <= 12271 || c >= 12289 && c <= 55295 || c >= 63744 && c <= 64975 || c >= 65008 && c <= 65533 || c >= 65536 && c <= 983039;
	}
	exports.isNCNameStartChar = isNCNameStartChar;
	/**
	* Determines whether a codepoint matches [[NC_NAME_CHAR]].
	*
	* @param c The code point.
	*
	* @returns ``true`` if the codepoint matches.
	*/
	function isNCNameChar(c) {
		return isNCNameStartChar(c) || c === 45 || c === 46 || c >= 48 && c <= 57 || c === 183 || c >= 768 && c <= 879 || c >= 8255 && c <= 8256;
	}
	exports.isNCNameChar = isNCNameChar;
}));

//#endregion
//#region node_modules/.pnpm/saxes@6.0.0/node_modules/saxes/saxes.js
var require_saxes = /* @__PURE__ */ __commonJSMin(((exports) => {
	Object.defineProperty(exports, "__esModule", { value: true });
	exports.SaxesParser = exports.EVENTS = void 0;
	const ed5 = require_ed5();
	const ed2 = require_ed2();
	const NSed3 = require_ed3();
	var isS = ed5.isS;
	var isChar10 = ed5.isChar;
	var isNameStartChar = ed5.isNameStartChar;
	var isNameChar = ed5.isNameChar;
	var S_LIST = ed5.S_LIST;
	var NAME_RE = ed5.NAME_RE;
	var isChar11 = ed2.isChar;
	var isNCNameStartChar = NSed3.isNCNameStartChar;
	var isNCNameChar = NSed3.isNCNameChar;
	var NC_NAME_RE = NSed3.NC_NAME_RE;
	const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
	const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
	const rootNS = {
		__proto__: null,
		xml: XML_NAMESPACE,
		xmlns: XMLNS_NAMESPACE
	};
	const XML_ENTITIES = {
		__proto__: null,
		amp: "&",
		gt: ">",
		lt: "<",
		quot: "\"",
		apos: "'"
	};
	const EOC = -1;
	const NL_LIKE = -2;
	const S_BEGIN = 0;
	const S_BEGIN_WHITESPACE = 1;
	const S_DOCTYPE = 2;
	const S_DOCTYPE_QUOTE = 3;
	const S_DTD = 4;
	const S_DTD_QUOTED = 5;
	const S_DTD_OPEN_WAKA = 6;
	const S_DTD_OPEN_WAKA_BANG = 7;
	const S_DTD_COMMENT = 8;
	const S_DTD_COMMENT_ENDING = 9;
	const S_DTD_COMMENT_ENDED = 10;
	const S_DTD_PI = 11;
	const S_DTD_PI_ENDING = 12;
	const S_TEXT = 13;
	const S_ENTITY = 14;
	const S_OPEN_WAKA = 15;
	const S_OPEN_WAKA_BANG = 16;
	const S_COMMENT = 17;
	const S_COMMENT_ENDING = 18;
	const S_COMMENT_ENDED = 19;
	const S_CDATA = 20;
	const S_CDATA_ENDING = 21;
	const S_CDATA_ENDING_2 = 22;
	const S_PI_FIRST_CHAR = 23;
	const S_PI_REST = 24;
	const S_PI_BODY = 25;
	const S_PI_ENDING = 26;
	const S_XML_DECL_NAME_START = 27;
	const S_XML_DECL_NAME = 28;
	const S_XML_DECL_EQ = 29;
	const S_XML_DECL_VALUE_START = 30;
	const S_XML_DECL_VALUE = 31;
	const S_XML_DECL_SEPARATOR = 32;
	const S_XML_DECL_ENDING = 33;
	const S_OPEN_TAG = 34;
	const S_OPEN_TAG_SLASH = 35;
	const S_ATTRIB = 36;
	const S_ATTRIB_NAME = 37;
	const S_ATTRIB_NAME_SAW_WHITE = 38;
	const S_ATTRIB_VALUE = 39;
	const S_ATTRIB_VALUE_QUOTED = 40;
	const S_ATTRIB_VALUE_CLOSED = 41;
	const S_ATTRIB_VALUE_UNQUOTED = 42;
	const S_CLOSE_TAG = 43;
	const S_CLOSE_TAG_SAW_WHITE = 44;
	const TAB = 9;
	const NL = 10;
	const CR = 13;
	const SPACE = 32;
	const BANG = 33;
	const DQUOTE = 34;
	const AMP = 38;
	const SQUOTE = 39;
	const MINUS = 45;
	const FORWARD_SLASH = 47;
	const SEMICOLON = 59;
	const LESS = 60;
	const EQUAL = 61;
	const GREATER = 62;
	const QUESTION = 63;
	const OPEN_BRACKET = 91;
	const CLOSE_BRACKET = 93;
	const NEL = 133;
	const LS = 8232;
	const isQuote = (c) => c === DQUOTE || c === SQUOTE;
	const QUOTES = [DQUOTE, SQUOTE];
	const DOCTYPE_TERMINATOR = [
		...QUOTES,
		OPEN_BRACKET,
		GREATER
	];
	const DTD_TERMINATOR = [
		...QUOTES,
		LESS,
		CLOSE_BRACKET
	];
	const XML_DECL_NAME_TERMINATOR = [
		EQUAL,
		QUESTION,
		...S_LIST
	];
	const ATTRIB_VALUE_UNQUOTED_TERMINATOR = [
		...S_LIST,
		GREATER,
		AMP,
		LESS
	];
	function nsPairCheck(parser, prefix, uri) {
		switch (prefix) {
			case "xml":
				if (uri !== XML_NAMESPACE) parser.fail(`xml prefix must be bound to ${XML_NAMESPACE}.`);
				break;
			case "xmlns": if (uri !== XMLNS_NAMESPACE) parser.fail(`xmlns prefix must be bound to ${XMLNS_NAMESPACE}.`);
		}
		switch (uri) {
			case XMLNS_NAMESPACE:
				parser.fail(prefix === "" ? `the default namespace may not be set to ${uri}.` : `may not assign a prefix (even "xmlns") to the URI \
${XMLNS_NAMESPACE}.`);
				break;
			case XML_NAMESPACE: switch (prefix) {
				case "xml": break;
				case "":
					parser.fail(`the default namespace may not be set to ${uri}.`);
					break;
				default: parser.fail("may not assign the xml namespace to another prefix.");
			}
		}
	}
	function nsMappingCheck(parser, mapping) {
		for (const local of Object.keys(mapping)) nsPairCheck(parser, local, mapping[local]);
	}
	const isNCName = (name) => NC_NAME_RE.test(name);
	const isName = (name) => NAME_RE.test(name);
	const FORBIDDEN_START = 0;
	const FORBIDDEN_BRACKET = 1;
	const FORBIDDEN_BRACKET_BRACKET = 2;
	/**
	* The list of supported events.
	*/
	exports.EVENTS = [
		"xmldecl",
		"text",
		"processinginstruction",
		"doctype",
		"comment",
		"opentagstart",
		"attribute",
		"opentag",
		"closetag",
		"cdata",
		"error",
		"end",
		"ready"
	];
	const EVENT_NAME_TO_HANDLER_NAME = {
		xmldecl: "xmldeclHandler",
		text: "textHandler",
		processinginstruction: "piHandler",
		doctype: "doctypeHandler",
		comment: "commentHandler",
		opentagstart: "openTagStartHandler",
		attribute: "attributeHandler",
		opentag: "openTagHandler",
		closetag: "closeTagHandler",
		cdata: "cdataHandler",
		error: "errorHandler",
		end: "endHandler",
		ready: "readyHandler"
	};
	var SaxesParser = class {
		/**
		* @param opt The parser options.
		*/
		constructor(opt) {
			this.opt = opt !== null && opt !== void 0 ? opt : {};
			this.fragmentOpt = !!this.opt.fragment;
			const xmlnsOpt = this.xmlnsOpt = !!this.opt.xmlns;
			this.trackPosition = this.opt.position !== false;
			this.fileName = this.opt.fileName;
			if (xmlnsOpt) {
				this.nameStartCheck = isNCNameStartChar;
				this.nameCheck = isNCNameChar;
				this.isName = isNCName;
				this.processAttribs = this.processAttribsNS;
				this.pushAttrib = this.pushAttribNS;
				this.ns = Object.assign({ __proto__: null }, rootNS);
				const additional = this.opt.additionalNamespaces;
				if (additional != null) {
					nsMappingCheck(this, additional);
					Object.assign(this.ns, additional);
				}
			} else {
				this.nameStartCheck = isNameStartChar;
				this.nameCheck = isNameChar;
				this.isName = isName;
				this.processAttribs = this.processAttribsPlain;
				this.pushAttrib = this.pushAttribPlain;
			}
			this.stateTable = [
				this.sBegin,
				this.sBeginWhitespace,
				this.sDoctype,
				this.sDoctypeQuote,
				this.sDTD,
				this.sDTDQuoted,
				this.sDTDOpenWaka,
				this.sDTDOpenWakaBang,
				this.sDTDComment,
				this.sDTDCommentEnding,
				this.sDTDCommentEnded,
				this.sDTDPI,
				this.sDTDPIEnding,
				this.sText,
				this.sEntity,
				this.sOpenWaka,
				this.sOpenWakaBang,
				this.sComment,
				this.sCommentEnding,
				this.sCommentEnded,
				this.sCData,
				this.sCDataEnding,
				this.sCDataEnding2,
				this.sPIFirstChar,
				this.sPIRest,
				this.sPIBody,
				this.sPIEnding,
				this.sXMLDeclNameStart,
				this.sXMLDeclName,
				this.sXMLDeclEq,
				this.sXMLDeclValueStart,
				this.sXMLDeclValue,
				this.sXMLDeclSeparator,
				this.sXMLDeclEnding,
				this.sOpenTag,
				this.sOpenTagSlash,
				this.sAttrib,
				this.sAttribName,
				this.sAttribNameSawWhite,
				this.sAttribValue,
				this.sAttribValueQuoted,
				this.sAttribValueClosed,
				this.sAttribValueUnquoted,
				this.sCloseTag,
				this.sCloseTagSawWhite
			];
			this._init();
		}
		/**
		* Indicates whether or not the parser is closed. If ``true``, wait for
		* the ``ready`` event to write again.
		*/
		get closed() {
			return this._closed;
		}
		_init() {
			var _a;
			this.openWakaBang = "";
			this.text = "";
			this.name = "";
			this.piTarget = "";
			this.entity = "";
			this.q = null;
			this.tags = [];
			this.tag = null;
			this.topNS = null;
			this.chunk = "";
			this.chunkPosition = 0;
			this.i = 0;
			this.prevI = 0;
			this.carriedFromPrevious = void 0;
			this.forbiddenState = FORBIDDEN_START;
			this.attribList = [];
			const { fragmentOpt } = this;
			this.state = fragmentOpt ? S_TEXT : S_BEGIN;
			this.reportedTextBeforeRoot = this.reportedTextAfterRoot = this.closedRoot = this.sawRoot = fragmentOpt;
			this.xmlDeclPossible = !fragmentOpt;
			this.xmlDeclExpects = ["version"];
			this.entityReturnState = void 0;
			let { defaultXMLVersion } = this.opt;
			if (defaultXMLVersion === void 0) {
				if (this.opt.forceXMLVersion === true) throw new Error("forceXMLVersion set but defaultXMLVersion is not set");
				defaultXMLVersion = "1.0";
			}
			this.setXMLVersion(defaultXMLVersion);
			this.positionAtNewLine = 0;
			this.doctype = false;
			this._closed = false;
			this.xmlDecl = {
				version: void 0,
				encoding: void 0,
				standalone: void 0
			};
			this.line = 1;
			this.column = 0;
			this.ENTITIES = Object.create(XML_ENTITIES);
			(_a = this.readyHandler) === null || _a === void 0 || _a.call(this);
		}
		/**
		* The stream position the parser is currently looking at. This field is
		* zero-based.
		*
		* This field is not based on counting Unicode characters but is to be
		* interpreted as a plain index into a JavaScript string.
		*/
		get position() {
			return this.chunkPosition + this.i;
		}
		/**
		* The column number of the next character to be read by the parser.  *
		* This field is zero-based. (The first column in a line is 0.)
		*
		* This field reports the index at which the next character would be in the
		* line if the line were represented as a JavaScript string.  Note that this
		* *can* be different to a count based on the number of *Unicode characters*
		* due to how JavaScript handles astral plane characters.
		*
		* See [[column]] for a number that corresponds to a count of Unicode
		* characters.
		*/
		get columnIndex() {
			return this.position - this.positionAtNewLine;
		}
		/**
		* Set an event listener on an event. The parser supports one handler per
		* event type. If you try to set an event handler over an existing handler,
		* the old handler is silently overwritten.
		*
		* @param name The event to listen to.
		*
		* @param handler The handler to set.
		*/
		on(name, handler) {
			this[EVENT_NAME_TO_HANDLER_NAME[name]] = handler;
		}
		/**
		* Unset an event handler.
		*
		* @parma name The event to stop listening to.
		*/
		off(name) {
			this[EVENT_NAME_TO_HANDLER_NAME[name]] = void 0;
		}
		/**
		* Make an error object. The error object will have a message that contains
		* the ``fileName`` option passed at the creation of the parser. If position
		* tracking was turned on, it will also have line and column number
		* information.
		*
		* @param message The message describing the error to report.
		*
		* @returns An error object with a properly formatted message.
		*/
		makeError(message) {
			var _a;
			let msg = (_a = this.fileName) !== null && _a !== void 0 ? _a : "";
			if (this.trackPosition) {
				if (msg.length > 0) msg += ":";
				msg += `${this.line}:${this.column}`;
			}
			if (msg.length > 0) msg += ": ";
			return new Error(msg + message);
		}
		/**
		* Report a parsing error. This method is made public so that client code may
		* check for issues that are outside the scope of this project and can report
		* errors.
		*
		* @param message The error to report.
		*
		* @returns this
		*/
		fail(message) {
			const err = this.makeError(message);
			const handler = this.errorHandler;
			if (handler === void 0) throw err;
			else handler(err);
			return this;
		}
		/**
		* Write a XML data to the parser.
		*
		* @param chunk The XML data to write.
		*
		* @returns this
		*/
		write(chunk) {
			if (this.closed) return this.fail("cannot write after close; assign an onready handler.");
			let end = false;
			if (chunk === null) {
				end = true;
				chunk = "";
			} else if (typeof chunk === "object") chunk = chunk.toString();
			if (this.carriedFromPrevious !== void 0) {
				chunk = `${this.carriedFromPrevious}${chunk}`;
				this.carriedFromPrevious = void 0;
			}
			let limit = chunk.length;
			const lastCode = chunk.charCodeAt(limit - 1);
			if (!end && (lastCode === CR || lastCode >= 55296 && lastCode <= 56319)) {
				this.carriedFromPrevious = chunk[limit - 1];
				limit--;
				chunk = chunk.slice(0, limit);
			}
			const { stateTable } = this;
			this.chunk = chunk;
			this.i = 0;
			while (this.i < limit) stateTable[this.state].call(this);
			this.chunkPosition += limit;
			return end ? this.end() : this;
		}
		/**
		* Close the current stream. Perform final well-formedness checks and reset
		* the parser tstate.
		*
		* @returns this
		*/
		close() {
			return this.write(null);
		}
		/**
		* Get a single code point out of the current chunk. This updates the current
		* position if we do position tracking.
		*
		* This is the algorithm to use for XML 1.0.
		*
		* @returns The character read.
		*/
		getCode10() {
			const { chunk, i } = this;
			this.prevI = i;
			this.i = i + 1;
			if (i >= chunk.length) return EOC;
			const code = chunk.charCodeAt(i);
			this.column++;
			if (code < 55296) {
				if (code >= SPACE || code === TAB) return code;
				switch (code) {
					case NL:
						this.line++;
						this.column = 0;
						this.positionAtNewLine = this.position;
						return NL;
					case CR:
						if (chunk.charCodeAt(i + 1) === NL) this.i = i + 2;
						this.line++;
						this.column = 0;
						this.positionAtNewLine = this.position;
						return NL_LIKE;
					default:
						this.fail("disallowed character.");
						return code;
				}
			}
			if (code > 56319) {
				if (!(code >= 57344 && code <= 65533)) this.fail("disallowed character.");
				return code;
			}
			const final = 65536 + (code - 55296) * 1024 + (chunk.charCodeAt(i + 1) - 56320);
			this.i = i + 2;
			if (final > 1114111) this.fail("disallowed character.");
			return final;
		}
		/**
		* Get a single code point out of the current chunk. This updates the current
		* position if we do position tracking.
		*
		* This is the algorithm to use for XML 1.1.
		*
		* @returns {number} The character read.
		*/
		getCode11() {
			const { chunk, i } = this;
			this.prevI = i;
			this.i = i + 1;
			if (i >= chunk.length) return EOC;
			const code = chunk.charCodeAt(i);
			this.column++;
			if (code < 55296) {
				if (code > 31 && code < 127 || code > 159 && code !== LS || code === TAB) return code;
				switch (code) {
					case NL:
						this.line++;
						this.column = 0;
						this.positionAtNewLine = this.position;
						return NL;
					case CR: {
						const next = chunk.charCodeAt(i + 1);
						if (next === NL || next === NEL) this.i = i + 2;
					}
					case NEL:
					case LS:
						this.line++;
						this.column = 0;
						this.positionAtNewLine = this.position;
						return NL_LIKE;
					default:
						this.fail("disallowed character.");
						return code;
				}
			}
			if (code > 56319) {
				if (!(code >= 57344 && code <= 65533)) this.fail("disallowed character.");
				return code;
			}
			const final = 65536 + (code - 55296) * 1024 + (chunk.charCodeAt(i + 1) - 56320);
			this.i = i + 2;
			if (final > 1114111) this.fail("disallowed character.");
			return final;
		}
		/**
		* Like ``getCode`` but with the return value normalized so that ``NL`` is
		* returned for ``NL_LIKE``.
		*/
		getCodeNorm() {
			const c = this.getCode();
			return c === NL_LIKE ? NL : c;
		}
		unget() {
			this.i = this.prevI;
			this.column--;
		}
		/**
		* Capture characters into a buffer until encountering one of a set of
		* characters.
		*
		* @param chars An array of codepoints. Encountering a character in the array
		* ends the capture. (``chars`` may safely contain ``NL``.)
		*
		* @return The character code that made the capture end, or ``EOC`` if we hit
		* the end of the chunk. The return value cannot be NL_LIKE: NL is returned
		* instead.
		*/
		captureTo(chars) {
			let { i: start } = this;
			const { chunk } = this;
			while (true) {
				const c = this.getCode();
				const isNLLike = c === NL_LIKE;
				const final = isNLLike ? NL : c;
				if (final === EOC || chars.includes(final)) {
					this.text += chunk.slice(start, this.prevI);
					return final;
				}
				if (isNLLike) {
					this.text += `${chunk.slice(start, this.prevI)}\n`;
					start = this.i;
				}
			}
		}
		/**
		* Capture characters into a buffer until encountering a character.
		*
		* @param char The codepoint that ends the capture. **NOTE ``char`` MAY NOT
		* CONTAIN ``NL``.** Passing ``NL`` will result in buggy behavior.
		*
		* @return ``true`` if we ran into the character. Otherwise, we ran into the
		* end of the current chunk.
		*/
		captureToChar(char) {
			let { i: start } = this;
			const { chunk } = this;
			while (true) {
				let c = this.getCode();
				switch (c) {
					case NL_LIKE:
						this.text += `${chunk.slice(start, this.prevI)}\n`;
						start = this.i;
						c = NL;
						break;
					case EOC:
						this.text += chunk.slice(start);
						return false;
				}
				if (c === char) {
					this.text += chunk.slice(start, this.prevI);
					return true;
				}
			}
		}
		/**
		* Capture characters that satisfy ``isNameChar`` into the ``name`` field of
		* this parser.
		*
		* @return The character code that made the test fail, or ``EOC`` if we hit
		* the end of the chunk. The return value cannot be NL_LIKE: NL is returned
		* instead.
		*/
		captureNameChars() {
			const { chunk, i: start } = this;
			while (true) {
				const c = this.getCode();
				if (c === EOC) {
					this.name += chunk.slice(start);
					return EOC;
				}
				if (!isNameChar(c)) {
					this.name += chunk.slice(start, this.prevI);
					return c === NL_LIKE ? NL : c;
				}
			}
		}
		/**
		* Skip white spaces.
		*
		* @return The character that ended the skip, or ``EOC`` if we hit
		* the end of the chunk. The return value cannot be NL_LIKE: NL is returned
		* instead.
		*/
		skipSpaces() {
			while (true) {
				const c = this.getCodeNorm();
				if (c === EOC || !isS(c)) return c;
			}
		}
		setXMLVersion(version) {
			this.currentXMLVersion = version;
			if (version === "1.0") {
				this.isChar = isChar10;
				this.getCode = this.getCode10;
			} else {
				this.isChar = isChar11;
				this.getCode = this.getCode11;
			}
		}
		sBegin() {
			if (this.chunk.charCodeAt(0) === 65279) {
				this.i++;
				this.column++;
			}
			this.state = S_BEGIN_WHITESPACE;
		}
		sBeginWhitespace() {
			const iBefore = this.i;
			const c = this.skipSpaces();
			if (this.prevI !== iBefore) this.xmlDeclPossible = false;
			switch (c) {
				case LESS:
					this.state = S_OPEN_WAKA;
					if (this.text.length !== 0) throw new Error("no-empty text at start");
					break;
				case EOC: break;
				default:
					this.unget();
					this.state = S_TEXT;
					this.xmlDeclPossible = false;
			}
		}
		sDoctype() {
			var _a;
			const c = this.captureTo(DOCTYPE_TERMINATOR);
			switch (c) {
				case GREATER:
					(_a = this.doctypeHandler) === null || _a === void 0 || _a.call(this, this.text);
					this.text = "";
					this.state = S_TEXT;
					this.doctype = true;
					break;
				case EOC: break;
				default:
					this.text += String.fromCodePoint(c);
					if (c === OPEN_BRACKET) this.state = S_DTD;
					else if (isQuote(c)) {
						this.state = S_DOCTYPE_QUOTE;
						this.q = c;
					}
			}
		}
		sDoctypeQuote() {
			const q = this.q;
			if (this.captureToChar(q)) {
				this.text += String.fromCodePoint(q);
				this.q = null;
				this.state = S_DOCTYPE;
			}
		}
		sDTD() {
			const c = this.captureTo(DTD_TERMINATOR);
			if (c === EOC) return;
			this.text += String.fromCodePoint(c);
			if (c === CLOSE_BRACKET) this.state = S_DOCTYPE;
			else if (c === LESS) this.state = S_DTD_OPEN_WAKA;
			else if (isQuote(c)) {
				this.state = S_DTD_QUOTED;
				this.q = c;
			}
		}
		sDTDQuoted() {
			const q = this.q;
			if (this.captureToChar(q)) {
				this.text += String.fromCodePoint(q);
				this.state = S_DTD;
				this.q = null;
			}
		}
		sDTDOpenWaka() {
			const c = this.getCodeNorm();
			this.text += String.fromCodePoint(c);
			switch (c) {
				case BANG:
					this.state = S_DTD_OPEN_WAKA_BANG;
					this.openWakaBang = "";
					break;
				case QUESTION:
					this.state = S_DTD_PI;
					break;
				default: this.state = S_DTD;
			}
		}
		sDTDOpenWakaBang() {
			const char = String.fromCodePoint(this.getCodeNorm());
			const owb = this.openWakaBang += char;
			this.text += char;
			if (owb !== "-") {
				this.state = owb === "--" ? S_DTD_COMMENT : S_DTD;
				this.openWakaBang = "";
			}
		}
		sDTDComment() {
			if (this.captureToChar(MINUS)) {
				this.text += "-";
				this.state = S_DTD_COMMENT_ENDING;
			}
		}
		sDTDCommentEnding() {
			const c = this.getCodeNorm();
			this.text += String.fromCodePoint(c);
			this.state = c === MINUS ? S_DTD_COMMENT_ENDED : S_DTD_COMMENT;
		}
		sDTDCommentEnded() {
			const c = this.getCodeNorm();
			this.text += String.fromCodePoint(c);
			if (c === GREATER) this.state = S_DTD;
			else {
				this.fail("malformed comment.");
				this.state = S_DTD_COMMENT;
			}
		}
		sDTDPI() {
			if (this.captureToChar(QUESTION)) {
				this.text += "?";
				this.state = S_DTD_PI_ENDING;
			}
		}
		sDTDPIEnding() {
			const c = this.getCodeNorm();
			this.text += String.fromCodePoint(c);
			if (c === GREATER) this.state = S_DTD;
		}
		sText() {
			if (this.tags.length !== 0) this.handleTextInRoot();
			else this.handleTextOutsideRoot();
		}
		sEntity() {
			let { i: start } = this;
			const { chunk } = this;
			loop: while (true) switch (this.getCode()) {
				case NL_LIKE:
					this.entity += `${chunk.slice(start, this.prevI)}\n`;
					start = this.i;
					break;
				case SEMICOLON: {
					const { entityReturnState } = this;
					const entity = this.entity + chunk.slice(start, this.prevI);
					this.state = entityReturnState;
					let parsed;
					if (entity === "") {
						this.fail("empty entity name.");
						parsed = "&;";
					} else {
						parsed = this.parseEntity(entity);
						this.entity = "";
					}
					if (entityReturnState !== S_TEXT || this.textHandler !== void 0) this.text += parsed;
					break loop;
				}
				case EOC:
					this.entity += chunk.slice(start);
					break loop;
			}
		}
		sOpenWaka() {
			const c = this.getCode();
			if (isNameStartChar(c)) {
				this.state = S_OPEN_TAG;
				this.unget();
				this.xmlDeclPossible = false;
			} else switch (c) {
				case FORWARD_SLASH:
					this.state = S_CLOSE_TAG;
					this.xmlDeclPossible = false;
					break;
				case BANG:
					this.state = S_OPEN_WAKA_BANG;
					this.openWakaBang = "";
					this.xmlDeclPossible = false;
					break;
				case QUESTION:
					this.state = S_PI_FIRST_CHAR;
					break;
				default:
					this.fail("disallowed character in tag name");
					this.state = S_TEXT;
					this.xmlDeclPossible = false;
			}
		}
		sOpenWakaBang() {
			this.openWakaBang += String.fromCodePoint(this.getCodeNorm());
			switch (this.openWakaBang) {
				case "[CDATA[":
					if (!this.sawRoot && !this.reportedTextBeforeRoot) {
						this.fail("text data outside of root node.");
						this.reportedTextBeforeRoot = true;
					}
					if (this.closedRoot && !this.reportedTextAfterRoot) {
						this.fail("text data outside of root node.");
						this.reportedTextAfterRoot = true;
					}
					this.state = S_CDATA;
					this.openWakaBang = "";
					break;
				case "--":
					this.state = S_COMMENT;
					this.openWakaBang = "";
					break;
				case "DOCTYPE":
					this.state = S_DOCTYPE;
					if (this.doctype || this.sawRoot) this.fail("inappropriately located doctype declaration.");
					this.openWakaBang = "";
					break;
				default: if (this.openWakaBang.length >= 7) this.fail("incorrect syntax.");
			}
		}
		sComment() {
			if (this.captureToChar(MINUS)) this.state = S_COMMENT_ENDING;
		}
		sCommentEnding() {
			var _a;
			const c = this.getCodeNorm();
			if (c === MINUS) {
				this.state = S_COMMENT_ENDED;
				(_a = this.commentHandler) === null || _a === void 0 || _a.call(this, this.text);
				this.text = "";
			} else {
				this.text += `-${String.fromCodePoint(c)}`;
				this.state = S_COMMENT;
			}
		}
		sCommentEnded() {
			const c = this.getCodeNorm();
			if (c !== GREATER) {
				this.fail("malformed comment.");
				this.text += `--${String.fromCodePoint(c)}`;
				this.state = S_COMMENT;
			} else this.state = S_TEXT;
		}
		sCData() {
			if (this.captureToChar(CLOSE_BRACKET)) this.state = S_CDATA_ENDING;
		}
		sCDataEnding() {
			const c = this.getCodeNorm();
			if (c === CLOSE_BRACKET) this.state = S_CDATA_ENDING_2;
			else {
				this.text += `]${String.fromCodePoint(c)}`;
				this.state = S_CDATA;
			}
		}
		sCDataEnding2() {
			var _a;
			const c = this.getCodeNorm();
			switch (c) {
				case GREATER:
					(_a = this.cdataHandler) === null || _a === void 0 || _a.call(this, this.text);
					this.text = "";
					this.state = S_TEXT;
					break;
				case CLOSE_BRACKET:
					this.text += "]";
					break;
				default:
					this.text += `]]${String.fromCodePoint(c)}`;
					this.state = S_CDATA;
			}
		}
		sPIFirstChar() {
			const c = this.getCodeNorm();
			if (this.nameStartCheck(c)) {
				this.piTarget += String.fromCodePoint(c);
				this.state = S_PI_REST;
			} else if (c === QUESTION || isS(c)) {
				this.fail("processing instruction without a target.");
				this.state = c === QUESTION ? S_PI_ENDING : S_PI_BODY;
			} else {
				this.fail("disallowed character in processing instruction name.");
				this.piTarget += String.fromCodePoint(c);
				this.state = S_PI_REST;
			}
		}
		sPIRest() {
			const { chunk, i: start } = this;
			while (true) {
				const c = this.getCodeNorm();
				if (c === EOC) {
					this.piTarget += chunk.slice(start);
					return;
				}
				if (!this.nameCheck(c)) {
					this.piTarget += chunk.slice(start, this.prevI);
					const isQuestion = c === QUESTION;
					if (isQuestion || isS(c)) {
						if (this.piTarget === "xml") {
							if (!this.xmlDeclPossible) this.fail("an XML declaration must be at the start of the document.");
							this.state = isQuestion ? S_XML_DECL_ENDING : S_XML_DECL_NAME_START;
						} else this.state = isQuestion ? S_PI_ENDING : S_PI_BODY;
					} else {
						this.fail("disallowed character in processing instruction name.");
						this.piTarget += String.fromCodePoint(c);
					}
					break;
				}
			}
		}
		sPIBody() {
			if (this.text.length === 0) {
				const c = this.getCodeNorm();
				if (c === QUESTION) this.state = S_PI_ENDING;
				else if (!isS(c)) this.text = String.fromCodePoint(c);
			} else if (this.captureToChar(QUESTION)) this.state = S_PI_ENDING;
		}
		sPIEnding() {
			var _a;
			const c = this.getCodeNorm();
			if (c === GREATER) {
				const { piTarget } = this;
				if (piTarget.toLowerCase() === "xml") this.fail("the XML declaration must appear at the start of the document.");
				(_a = this.piHandler) === null || _a === void 0 || _a.call(this, {
					target: piTarget,
					body: this.text
				});
				this.piTarget = this.text = "";
				this.state = S_TEXT;
			} else if (c === QUESTION) this.text += "?";
			else {
				this.text += `?${String.fromCodePoint(c)}`;
				this.state = S_PI_BODY;
			}
			this.xmlDeclPossible = false;
		}
		sXMLDeclNameStart() {
			const c = this.skipSpaces();
			if (c === QUESTION) {
				this.state = S_XML_DECL_ENDING;
				return;
			}
			if (c !== EOC) {
				this.state = S_XML_DECL_NAME;
				this.name = String.fromCodePoint(c);
			}
		}
		sXMLDeclName() {
			const c = this.captureTo(XML_DECL_NAME_TERMINATOR);
			if (c === QUESTION) {
				this.state = S_XML_DECL_ENDING;
				this.name += this.text;
				this.text = "";
				this.fail("XML declaration is incomplete.");
				return;
			}
			if (!(isS(c) || c === EQUAL)) return;
			this.name += this.text;
			this.text = "";
			if (!this.xmlDeclExpects.includes(this.name)) switch (this.name.length) {
				case 0:
					this.fail("did not expect any more name/value pairs.");
					break;
				case 1:
					this.fail(`expected the name ${this.xmlDeclExpects[0]}.`);
					break;
				default: this.fail(`expected one of ${this.xmlDeclExpects.join(", ")}`);
			}
			this.state = c === EQUAL ? S_XML_DECL_VALUE_START : S_XML_DECL_EQ;
		}
		sXMLDeclEq() {
			const c = this.getCodeNorm();
			if (c === QUESTION) {
				this.state = S_XML_DECL_ENDING;
				this.fail("XML declaration is incomplete.");
				return;
			}
			if (isS(c)) return;
			if (c !== EQUAL) this.fail("value required.");
			this.state = S_XML_DECL_VALUE_START;
		}
		sXMLDeclValueStart() {
			const c = this.getCodeNorm();
			if (c === QUESTION) {
				this.state = S_XML_DECL_ENDING;
				this.fail("XML declaration is incomplete.");
				return;
			}
			if (isS(c)) return;
			if (!isQuote(c)) {
				this.fail("value must be quoted.");
				this.q = SPACE;
			} else this.q = c;
			this.state = S_XML_DECL_VALUE;
		}
		sXMLDeclValue() {
			const c = this.captureTo([this.q, QUESTION]);
			if (c === QUESTION) {
				this.state = S_XML_DECL_ENDING;
				this.text = "";
				this.fail("XML declaration is incomplete.");
				return;
			}
			if (c === EOC) return;
			const value = this.text;
			this.text = "";
			switch (this.name) {
				case "version": {
					this.xmlDeclExpects = ["encoding", "standalone"];
					const version = value;
					this.xmlDecl.version = version;
					if (!/^1\.[0-9]+$/.test(version)) this.fail("version number must match /^1\\.[0-9]+$/.");
					else if (!this.opt.forceXMLVersion) this.setXMLVersion(version);
					break;
				}
				case "encoding":
					if (!/^[A-Za-z][A-Za-z0-9._-]*$/.test(value)) this.fail("encoding value must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/.");
					this.xmlDeclExpects = ["standalone"];
					this.xmlDecl.encoding = value;
					break;
				case "standalone":
					if (value !== "yes" && value !== "no") this.fail("standalone value must match \"yes\" or \"no\".");
					this.xmlDeclExpects = [];
					this.xmlDecl.standalone = value;
			}
			this.name = "";
			this.state = S_XML_DECL_SEPARATOR;
		}
		sXMLDeclSeparator() {
			const c = this.getCodeNorm();
			if (c === QUESTION) {
				this.state = S_XML_DECL_ENDING;
				return;
			}
			if (!isS(c)) {
				this.fail("whitespace required.");
				this.unget();
			}
			this.state = S_XML_DECL_NAME_START;
		}
		sXMLDeclEnding() {
			var _a;
			if (this.getCodeNorm() === GREATER) {
				if (this.piTarget !== "xml") this.fail("processing instructions are not allowed before root.");
				else if (this.name !== "version" && this.xmlDeclExpects.includes("version")) this.fail("XML declaration must contain a version.");
				(_a = this.xmldeclHandler) === null || _a === void 0 || _a.call(this, this.xmlDecl);
				this.name = "";
				this.piTarget = this.text = "";
				this.state = S_TEXT;
			} else this.fail("The character ? is disallowed anywhere in XML declarations.");
			this.xmlDeclPossible = false;
		}
		sOpenTag() {
			var _a;
			const c = this.captureNameChars();
			if (c === EOC) return;
			const tag = this.tag = {
				name: this.name,
				attributes: Object.create(null)
			};
			this.name = "";
			if (this.xmlnsOpt) this.topNS = tag.ns = Object.create(null);
			(_a = this.openTagStartHandler) === null || _a === void 0 || _a.call(this, tag);
			this.sawRoot = true;
			if (!this.fragmentOpt && this.closedRoot) this.fail("documents may contain only one root.");
			switch (c) {
				case GREATER:
					this.openTag();
					break;
				case FORWARD_SLASH:
					this.state = S_OPEN_TAG_SLASH;
					break;
				default:
					if (!isS(c)) this.fail("disallowed character in tag name.");
					this.state = S_ATTRIB;
			}
		}
		sOpenTagSlash() {
			if (this.getCode() === GREATER) this.openSelfClosingTag();
			else {
				this.fail("forward-slash in opening tag not followed by >.");
				this.state = S_ATTRIB;
			}
		}
		sAttrib() {
			const c = this.skipSpaces();
			if (c === EOC) return;
			if (isNameStartChar(c)) {
				this.unget();
				this.state = S_ATTRIB_NAME;
			} else if (c === GREATER) this.openTag();
			else if (c === FORWARD_SLASH) this.state = S_OPEN_TAG_SLASH;
			else this.fail("disallowed character in attribute name.");
		}
		sAttribName() {
			const c = this.captureNameChars();
			if (c === EQUAL) this.state = S_ATTRIB_VALUE;
			else if (isS(c)) this.state = S_ATTRIB_NAME_SAW_WHITE;
			else if (c === GREATER) {
				this.fail("attribute without value.");
				this.pushAttrib(this.name, this.name);
				this.name = this.text = "";
				this.openTag();
			} else if (c !== EOC) this.fail("disallowed character in attribute name.");
		}
		sAttribNameSawWhite() {
			const c = this.skipSpaces();
			switch (c) {
				case EOC: return;
				case EQUAL:
					this.state = S_ATTRIB_VALUE;
					break;
				default:
					this.fail("attribute without value.");
					this.text = "";
					this.name = "";
					if (c === GREATER) this.openTag();
					else if (isNameStartChar(c)) {
						this.unget();
						this.state = S_ATTRIB_NAME;
					} else {
						this.fail("disallowed character in attribute name.");
						this.state = S_ATTRIB;
					}
			}
		}
		sAttribValue() {
			const c = this.getCodeNorm();
			if (isQuote(c)) {
				this.q = c;
				this.state = S_ATTRIB_VALUE_QUOTED;
			} else if (!isS(c)) {
				this.fail("unquoted attribute value.");
				this.state = S_ATTRIB_VALUE_UNQUOTED;
				this.unget();
			}
		}
		sAttribValueQuoted() {
			const { q, chunk } = this;
			let { i: start } = this;
			while (true) switch (this.getCode()) {
				case q:
					this.pushAttrib(this.name, this.text + chunk.slice(start, this.prevI));
					this.name = this.text = "";
					this.q = null;
					this.state = S_ATTRIB_VALUE_CLOSED;
					return;
				case AMP:
					this.text += chunk.slice(start, this.prevI);
					this.state = S_ENTITY;
					this.entityReturnState = S_ATTRIB_VALUE_QUOTED;
					return;
				case NL:
				case NL_LIKE:
				case TAB:
					this.text += `${chunk.slice(start, this.prevI)} `;
					start = this.i;
					break;
				case LESS:
					this.text += chunk.slice(start, this.prevI);
					this.fail("disallowed character.");
					return;
				case EOC:
					this.text += chunk.slice(start);
					return;
			}
		}
		sAttribValueClosed() {
			const c = this.getCodeNorm();
			if (isS(c)) this.state = S_ATTRIB;
			else if (c === GREATER) this.openTag();
			else if (c === FORWARD_SLASH) this.state = S_OPEN_TAG_SLASH;
			else if (isNameStartChar(c)) {
				this.fail("no whitespace between attributes.");
				this.unget();
				this.state = S_ATTRIB_NAME;
			} else this.fail("disallowed character in attribute name.");
		}
		sAttribValueUnquoted() {
			const c = this.captureTo(ATTRIB_VALUE_UNQUOTED_TERMINATOR);
			switch (c) {
				case AMP:
					this.state = S_ENTITY;
					this.entityReturnState = S_ATTRIB_VALUE_UNQUOTED;
					break;
				case LESS:
					this.fail("disallowed character.");
					break;
				case EOC: break;
				default:
					if (this.text.includes("]]>")) this.fail("the string \"]]>\" is disallowed in char data.");
					this.pushAttrib(this.name, this.text);
					this.name = this.text = "";
					if (c === GREATER) this.openTag();
					else this.state = S_ATTRIB;
			}
		}
		sCloseTag() {
			const c = this.captureNameChars();
			if (c === GREATER) this.closeTag();
			else if (isS(c)) this.state = S_CLOSE_TAG_SAW_WHITE;
			else if (c !== EOC) this.fail("disallowed character in closing tag.");
		}
		sCloseTagSawWhite() {
			switch (this.skipSpaces()) {
				case GREATER:
					this.closeTag();
					break;
				case EOC: break;
				default: this.fail("disallowed character in closing tag.");
			}
		}
		handleTextInRoot() {
			let { i: start, forbiddenState } = this;
			const { chunk, textHandler: handler } = this;
			scanLoop: while (true) switch (this.getCode()) {
				case LESS:
					this.state = S_OPEN_WAKA;
					if (handler !== void 0) {
						const { text } = this;
						const slice = chunk.slice(start, this.prevI);
						if (text.length !== 0) {
							handler(text + slice);
							this.text = "";
						} else if (slice.length !== 0) handler(slice);
					}
					forbiddenState = FORBIDDEN_START;
					break scanLoop;
				case AMP:
					this.state = S_ENTITY;
					this.entityReturnState = S_TEXT;
					if (handler !== void 0) this.text += chunk.slice(start, this.prevI);
					forbiddenState = FORBIDDEN_START;
					break scanLoop;
				case CLOSE_BRACKET:
					switch (forbiddenState) {
						case FORBIDDEN_START:
							forbiddenState = FORBIDDEN_BRACKET;
							break;
						case FORBIDDEN_BRACKET:
							forbiddenState = FORBIDDEN_BRACKET_BRACKET;
							break;
						case FORBIDDEN_BRACKET_BRACKET: break;
						default: throw new Error("impossible state");
					}
					break;
				case GREATER:
					if (forbiddenState === FORBIDDEN_BRACKET_BRACKET) this.fail("the string \"]]>\" is disallowed in char data.");
					forbiddenState = FORBIDDEN_START;
					break;
				case NL_LIKE:
					if (handler !== void 0) this.text += `${chunk.slice(start, this.prevI)}\n`;
					start = this.i;
					forbiddenState = FORBIDDEN_START;
					break;
				case EOC:
					if (handler !== void 0) this.text += chunk.slice(start);
					break scanLoop;
				default: forbiddenState = FORBIDDEN_START;
			}
			this.forbiddenState = forbiddenState;
		}
		handleTextOutsideRoot() {
			let { i: start } = this;
			const { chunk, textHandler: handler } = this;
			let nonSpace = false;
			outRootLoop: while (true) {
				const code = this.getCode();
				switch (code) {
					case LESS:
						this.state = S_OPEN_WAKA;
						if (handler !== void 0) {
							const { text } = this;
							const slice = chunk.slice(start, this.prevI);
							if (text.length !== 0) {
								handler(text + slice);
								this.text = "";
							} else if (slice.length !== 0) handler(slice);
						}
						break outRootLoop;
					case AMP:
						this.state = S_ENTITY;
						this.entityReturnState = S_TEXT;
						if (handler !== void 0) this.text += chunk.slice(start, this.prevI);
						nonSpace = true;
						break outRootLoop;
					case NL_LIKE:
						if (handler !== void 0) this.text += `${chunk.slice(start, this.prevI)}\n`;
						start = this.i;
						break;
					case EOC:
						if (handler !== void 0) this.text += chunk.slice(start);
						break outRootLoop;
					default: if (!isS(code)) nonSpace = true;
				}
			}
			if (!nonSpace) return;
			if (!this.sawRoot && !this.reportedTextBeforeRoot) {
				this.fail("text data outside of root node.");
				this.reportedTextBeforeRoot = true;
			}
			if (this.closedRoot && !this.reportedTextAfterRoot) {
				this.fail("text data outside of root node.");
				this.reportedTextAfterRoot = true;
			}
		}
		pushAttribNS(name, value) {
			var _a;
			const { prefix, local } = this.qname(name);
			const attr = {
				name,
				prefix,
				local,
				value
			};
			this.attribList.push(attr);
			(_a = this.attributeHandler) === null || _a === void 0 || _a.call(this, attr);
			if (prefix === "xmlns") {
				const trimmed = value.trim();
				if (this.currentXMLVersion === "1.0" && trimmed === "") this.fail("invalid attempt to undefine prefix in XML 1.0");
				this.topNS[local] = trimmed;
				nsPairCheck(this, local, trimmed);
			} else if (name === "xmlns") {
				const trimmed = value.trim();
				this.topNS[""] = trimmed;
				nsPairCheck(this, "", trimmed);
			}
		}
		pushAttribPlain(name, value) {
			var _a;
			const attr = {
				name,
				value
			};
			this.attribList.push(attr);
			(_a = this.attributeHandler) === null || _a === void 0 || _a.call(this, attr);
		}
		/**
		* End parsing. This performs final well-formedness checks and resets the
		* parser to a clean state.
		*
		* @returns this
		*/
		end() {
			var _a, _b;
			if (!this.sawRoot) this.fail("document must contain a root element.");
			const { tags } = this;
			while (tags.length > 0) {
				const tag = tags.pop();
				this.fail(`unclosed tag: ${tag.name}`);
			}
			if (this.state !== S_BEGIN && this.state !== S_TEXT) this.fail("unexpected end.");
			const { text } = this;
			if (text.length !== 0) {
				(_a = this.textHandler) === null || _a === void 0 || _a.call(this, text);
				this.text = "";
			}
			this._closed = true;
			(_b = this.endHandler) === null || _b === void 0 || _b.call(this);
			this._init();
			return this;
		}
		/**
		* Resolve a namespace prefix.
		*
		* @param prefix The prefix to resolve.
		*
		* @returns The namespace URI or ``undefined`` if the prefix is not defined.
		*/
		resolve(prefix) {
			var _a, _b;
			let uri = this.topNS[prefix];
			if (uri !== void 0) return uri;
			const { tags } = this;
			for (let index = tags.length - 1; index >= 0; index--) {
				uri = tags[index].ns[prefix];
				if (uri !== void 0) return uri;
			}
			uri = this.ns[prefix];
			if (uri !== void 0) return uri;
			return (_b = (_a = this.opt).resolvePrefix) === null || _b === void 0 ? void 0 : _b.call(_a, prefix);
		}
		/**
		* Parse a qname into its prefix and local name parts.
		*
		* @param name The name to parse
		*
		* @returns
		*/
		qname(name) {
			const colon = name.indexOf(":");
			if (colon === -1) return {
				prefix: "",
				local: name
			};
			const local = name.slice(colon + 1);
			const prefix = name.slice(0, colon);
			if (prefix === "" || local === "" || local.includes(":")) this.fail(`malformed name: ${name}.`);
			return {
				prefix,
				local
			};
		}
		processAttribsNS() {
			var _a;
			const { attribList } = this;
			const tag = this.tag;
			{
				const { prefix, local } = this.qname(tag.name);
				tag.prefix = prefix;
				tag.local = local;
				const uri = tag.uri = (_a = this.resolve(prefix)) !== null && _a !== void 0 ? _a : "";
				if (prefix !== "") {
					if (prefix === "xmlns") this.fail("tags may not have \"xmlns\" as prefix.");
					if (uri === "") {
						this.fail(`unbound namespace prefix: ${JSON.stringify(prefix)}.`);
						tag.uri = prefix;
					}
				}
			}
			if (attribList.length === 0) return;
			const { attributes } = tag;
			const seen = /* @__PURE__ */ new Set();
			for (const attr of attribList) {
				const { name, prefix, local } = attr;
				let uri;
				let eqname;
				if (prefix === "") {
					uri = name === "xmlns" ? XMLNS_NAMESPACE : "";
					eqname = name;
				} else {
					uri = this.resolve(prefix);
					if (uri === void 0) {
						this.fail(`unbound namespace prefix: ${JSON.stringify(prefix)}.`);
						uri = prefix;
					}
					eqname = `{${uri}}${local}`;
				}
				if (seen.has(eqname)) this.fail(`duplicate attribute: ${eqname}.`);
				seen.add(eqname);
				attr.uri = uri;
				attributes[name] = attr;
			}
			this.attribList = [];
		}
		processAttribsPlain() {
			const { attribList } = this;
			const attributes = this.tag.attributes;
			for (const { name, value } of attribList) {
				if (attributes[name] !== void 0) this.fail(`duplicate attribute: ${name}.`);
				attributes[name] = value;
			}
			this.attribList = [];
		}
		/**
		* Handle a complete open tag. This parser code calls this once it has seen
		* the whole tag. This method checks for well-formeness and then emits
		* ``onopentag``.
		*/
		openTag() {
			var _a;
			this.processAttribs();
			const { tags } = this;
			const tag = this.tag;
			tag.isSelfClosing = false;
			(_a = this.openTagHandler) === null || _a === void 0 || _a.call(this, tag);
			tags.push(tag);
			this.state = S_TEXT;
			this.name = "";
		}
		/**
		* Handle a complete self-closing tag. This parser code calls this once it has
		* seen the whole tag. This method checks for well-formeness and then emits
		* ``onopentag`` and ``onclosetag``.
		*/
		openSelfClosingTag() {
			var _a, _b, _c;
			this.processAttribs();
			const { tags } = this;
			const tag = this.tag;
			tag.isSelfClosing = true;
			(_a = this.openTagHandler) === null || _a === void 0 || _a.call(this, tag);
			(_b = this.closeTagHandler) === null || _b === void 0 || _b.call(this, tag);
			if ((this.tag = (_c = tags[tags.length - 1]) !== null && _c !== void 0 ? _c : null) === null) this.closedRoot = true;
			this.state = S_TEXT;
			this.name = "";
		}
		/**
		* Handle a complete close tag. This parser code calls this once it has seen
		* the whole tag. This method checks for well-formeness and then emits
		* ``onclosetag``.
		*/
		closeTag() {
			const { tags, name } = this;
			this.state = S_TEXT;
			this.name = "";
			if (name === "") {
				this.fail("weird empty close tag.");
				this.text += "</>";
				return;
			}
			const handler = this.closeTagHandler;
			let l = tags.length;
			while (l-- > 0) {
				const tag = this.tag = tags.pop();
				this.topNS = tag.ns;
				handler === null || handler === void 0 || handler(tag);
				if (tag.name === name) break;
				this.fail("unexpected close tag.");
			}
			if (l === 0) this.closedRoot = true;
			else if (l < 0) {
				this.fail(`unmatched closing tag: ${name}.`);
				this.text += `</${name}>`;
			}
		}
		/**
		* Resolves an entity. Makes any necessary well-formedness checks.
		*
		* @param entity The entity to resolve.
		*
		* @returns The parsed entity.
		*/
		parseEntity(entity) {
			if (entity[0] !== "#") {
				const defined = this.ENTITIES[entity];
				if (defined !== void 0) return defined;
				this.fail(this.isName(entity) ? "undefined entity." : "disallowed character in entity name.");
				return `&${entity};`;
			}
			let num = NaN;
			if (entity[1] === "x" && /^#x[0-9a-f]+$/i.test(entity)) num = parseInt(entity.slice(2), 16);
			else if (/^#[0-9]+$/.test(entity)) num = parseInt(entity.slice(1), 10);
			if (!this.isChar(num)) {
				this.fail("malformed character entity.");
				return `&${entity};`;
			}
			return String.fromCodePoint(num);
		}
	};
	exports.SaxesParser = SaxesParser;
}));

//#endregion
//#region packages/tui/src/components/xml-tool-output.ts
var import_saxes = require_saxes();
function parseXml(source, display) {
	const parser = new import_saxes.SaxesParser({ xmlns: false });
	const stack = [];
	let root;
	const state = { invalid: false };
	const reject = () => {
		state.invalid = true;
	};
	parser.on("opentag", (tag) => {
		const element = {
			name: tag.name,
			attributes: Object.entries(tag.attributes).map(([name, value]) => ({
				name,
				value: display(value)
			})),
			children: []
		};
		const parent = stack.at(-1);
		if (parent === void 0) {
			if (root !== void 0) reject();
			root = element;
		} else parent.children.push(element);
		stack.push(element);
	});
	parser.on("text", (text) => {
		const parent = stack.at(-1);
		if (parent === void 0) {
			if (text.trim() !== "") reject();
		} else parent.children.push(display(text));
	});
	parser.on("cdata", (text) => {
		const parent = stack.at(-1);
		if (parent === void 0) reject();
		else parent.children.push(display(text));
	});
	parser.on("closetag", () => {
		stack.pop();
	});
	parser.on("xmldecl", reject);
	parser.on("processinginstruction", reject);
	parser.on("doctype", reject);
	parser.on("comment", reject);
	parser.on("error", reject);
	parser.write(source).close();
	return state.invalid ? void 0 : root;
}
function elementLabel(element) {
	const attributes = element.attributes.map((attribute) => `${attribute.name}=${JSON.stringify(attribute.value)}`).join(" ");
	return attributes === "" ? element.name : `${element.name} (${attributes})`;
}
function meaningfulChildren(element) {
	return element.children.filter((child) => typeof child !== "string" || child.trim() !== "");
}
function textBlock(text, depth, body) {
	return text.replace(/^\n|\n$/gu, "").split("\n").map((line) => line === "" ? line : `${"  ".repeat(depth)}${body(line)}`);
}
function treeLines(element, depth, label, body) {
	const indent = "  ".repeat(depth);
	const children = meaningfulChildren(element);
	if (children.length === 0) return [`${indent}${label(elementLabel(element))}`];
	if (children.length === 1 && typeof children[0] === "string" && !children[0].includes("\n")) return [`${indent}${label(`${elementLabel(element)}:`)} ${body(children[0].trim())}`];
	const lines = [`${indent}${label(elementLabel(element))}`];
	for (const child of children) if (typeof child === "string") lines.push(...textBlock(child, depth + 1, body));
	else lines.push(...treeLines(child, depth + 1, label, body));
	return lines;
}
/**
* Collapse `lines` to a head/tail preview around one omitted-count marker.
* The single fold rule for every transcript card, so a card's fold never depends
* on how its body was rendered: tool cards share it with their tree output and
* context cards apply it to prose rows.
* @param lines - Fully rendered body rows.
* @param limit - Maximum retained rows, excluding the marker.
* @param omitted - Renders the marker for the omitted row count.
* @returns `lines` unchanged when within `limit`, else head rows, the marker, and tail rows.
*/
function preview(lines, limit, omitted) {
	if (lines.length <= limit) return [...lines];
	const head = Math.ceil(limit / 2);
	const tail = limit - head;
	return [
		...lines.slice(0, head),
		omitted(lines.length - limit),
		...lines.slice(lines.length - tail)
	];
}
/**
* Render a complete XML document as an indented tree, or decline without changing partial/mixed text.
* @param source - Raw model-facing text from an unknown tool result.
* @param maxChildLines - Collapsed budget independently applied to each top-level child's lines and
* to the number of top-level children, so many siblings cannot grow the collapsed card without bound.
* @param expanded - Whether to retain every rendered child line.
* @param display - Escapes parsed text and attribute values for terminal output; character references
* can expand to control characters that pre-parse escaping never saw.
* @param label - Styles element names and attributes.
* @param body - Styles the text content under those elements; the card's body tone, so tree
* content matches the surrounding card rows instead of falling back to the default foreground.
* @param omitted - Renders the omitted-line marker for a collapsed child or child range.
* @returns Tree rows, or `undefined` when `source` is not one supported complete XML document.
*/
function renderUnknownXml(source, maxChildLines, expanded, display, label, body, omitted) {
	const root = parseXml(source, display);
	if (root === void 0) return void 0;
	const blocks = meaningfulChildren(root).map((child) => typeof child === "string" ? textBlock(child, 1, body) : treeLines(child, 1, label, body));
	const rootLine = label(elementLabel(root));
	if (expanded) return [rootLine, ...blocks.flat()];
	const previewed = blocks.map((block) => preview(block, maxChildLines, omitted));
	if (previewed.length <= maxChildLines) return [rootLine, ...previewed.flat()];
	const head = Math.ceil(maxChildLines / 2);
	const tail = maxChildLines - head;
	const hidden = blocks.slice(head, blocks.length - tail).reduce((total, block) => total + block.length, 0);
	return [
		rootLine,
		...previewed.slice(0, head).flat(),
		omitted(hidden),
		...previewed.slice(previewed.length - tail).flat()
	];
}

//#endregion
//#region packages/tui/src/chat/timing.ts
const TIMING_BUCKET_LABELS = {
	ttft: "Model wait",
	thinking: "Thinking",
	responding: "Response",
	tools: "Tools"
};
const TIMING_BUCKETS = [
	"ttft",
	"thinking",
	"responding",
	"tools"
];
function emptyTimingTotals() {
	return {
		ttft: 0,
		thinking: 0,
		responding: 0,
		tools: 0
	};
}
function timingState(startedAt) {
	return {
		totals: emptyTimingTotals(),
		/* v8 ignore next -- production timing state always begins at a logged step timestamp. */
		active: startedAt === void 0 ? void 0 : {
			bucket: "ttft",
			since: startedAt
		}
	};
}
function closeTimingBucket(state, at) {
	if (state.active === void 0) return;
	state.totals[state.active.bucket] += Math.max(0, at - state.active.since);
	state.active = void 0;
}
function enterTimingBucket(state, bucket, at) {
	if (state.active?.bucket === bucket) return;
	closeTimingBucket(state, at);
	if (bucket !== void 0) state.active = {
		bucket,
		since: at
	};
}
function advanceStepTiming(state, event) {
	if (event.type === "assistant/chunk") {
		const chunk = event.data.chunk;
		if (state.active?.bucket === "ttft") enterTimingBucket(state, void 0, event.time);
		if (chunk.type === "reasoning-delta" || chunk.type === "block-start" && chunk.blockType === "reasoning") enterTimingBucket(state, "thinking", event.time);
		else if (chunk.type === "text-delta" || chunk.type === "block-start" && chunk.blockType === "text") enterTimingBucket(state, "responding", event.time);
	} else if (event.type === "tool/call") enterTimingBucket(state, "tools", event.time);
	else closeTimingBucket(state, event.time);
}
function timingTotalsAt(state, at) {
	const totals = { ...state.totals };
	if (state.active !== void 0 && at !== void 0) totals[state.active.bucket] += Math.max(0, at - state.active.since);
	return totals;
}
function stepKey(position) {
	return `${position.turn}:${position.step}`;
}
/**
* Incremental per-step timing accumulator shared by every step's timing footer
* in one transcript. One forward pass over the append-only session log serves
* all steps' totals: each query advances a cursor over the events appended
* since the previous query, so a transcript of S steps costs O(events) in
* total instead of the O(S × events) of replaying the whole log per footer.
*
* The log must be append-only with stable indices (the session `seq = log
* length` contract). Event times are consumed as logged: a backward wall-clock
* step clamps each bucket at zero rather than cutting the scan off at the
* query clock. The open bucket is accumulated to the query clock at lookup,
* never during the scan.
*/
var StepTimingTracker = class {
	scanned = 0;
	steps = /* @__PURE__ */ new Map();
	/**
	* Advance over events appended since the previous query, then return one
	* step's accumulated per-phase timing up to clock `at`.
	* @param events - Current session event log (append-only).
	* @param position - Turn/step coordinates of the queried step.
	* @param at - Render clock to accumulate the open bucket up to.
	* @returns The step's per-phase totals; empty when the step never started.
	*/
	totalsAt(events, position, at) {
		for (; this.scanned < events.length; this.scanned += 1) {
			const event = events[this.scanned];
			if (event.type === "step/start") {
				const key = stepKey(event.data);
				if (!this.steps.has(key)) this.steps.set(key, {
					...timingState(event.time),
					closed: false
				});
			} else if (event.type === "assistant/chunk" || event.type === "tool/call" || event.type === "step/end") {
				const state = this.steps.get(stepKey(event.data));
				if (state !== void 0 && !state.closed) {
					advanceStepTiming(state, event);
					if (event.type === "step/end") state.closed = true;
				}
			}
		}
		const state = this.steps.get(stepKey(position));
		return state === void 0 ? emptyTimingTotals() : timingTotalsAt(state, at);
	}
};
/** Phase-specific status glyph, keyed by the running step's active timing bucket. */
const TIMING_BUCKET_GLYPHS = {
	ttft: "◍",
	thinking: "✻",
	responding: "●",
	tools: "⚙"
};
/** Whether an event carries the given turn/step coordinates. */
function sameStep(event, position) {
	return event.data.turn === position.turn && event.data.step === position.step;
}
/**
* Derive the currently open step's active timing bucket, or `undefined` when no
* step is open. The open step is the last `step/start` with no later matching
* `step/end`; its bucket is replayed with the same rules as {@link StepTimingTracker}.
* @param events - Session events to scan from the tail.
* @returns The open step's active bucket, or `undefined`.
*/
function openStepPhase(events) {
	let startIndex = -1;
	let start;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event.type === "step/end") return void 0;
		if (event.type === "step/start") {
			startIndex = index;
			start = event;
			break;
		}
		if (event.type === "turn/end") return void 0;
	}
	if (start === void 0) return void 0;
	const position = start.data;
	const state = timingState(start.time);
	for (let index = startIndex + 1; index < events.length; index += 1) {
		const event = events[index];
		if ((event.type === "assistant/chunk" || event.type === "tool/call" || event.type === "step/end") && sameStep(event, position)) advanceStepTiming(state, event);
	}
	return state.active?.bucket;
}
/**
* The active status glyph, or `undefined` when idle. A running turn falls back
* to the pre-first-token wait glyph when no step is open.
* @param events - Session events to derive the phase from.
* @param running - Whether the agent is currently running.
* @returns The active status glyph, or `undefined` when idle.
*/
function runningPhaseGlyph(events, running) {
	if (!running) return void 0;
	const bucket = openStepPhase(events) ?? "ttft";
	return TIMING_BUCKET_GLYPHS[bucket];
}
/**
* Format the queued-steering badge shown on the running status line.
* @param queued - Number of queued steering messages.
* @returns The badge text, or `undefined` when nothing is queued.
*/
function formatQueuedStatus(queued) {
	return queued > 0 ? `${queued} queued` : void 0;
}
/**
* Format elapsed milliseconds as `1.2s` or `1m05.0s` (0.1-second resolution).
* @param elapsedMs - Elapsed wall time.
* @returns The formatted duration.
*/
function formatStatusDuration(elapsedMs) {
	const seconds = Math.floor(Math.max(0, elapsedMs) / 100) / 10;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m${(seconds - minutes * 60).toFixed(1).padStart(4, "0")}s`;
}
/**
* Format the non-zero timing buckets of one step as a middot-joined summary.
* @param totals - Per-phase totals to format.
* @param includeModelWait - Whether to always include the model-wait bucket.
* @returns The formatted timing summary.
*/
function formatTimingTotals(totals, includeModelWait = false) {
	return TIMING_BUCKETS.filter((bucket) => totals[bucket] > 0 || includeModelWait && bucket === "ttft").map((bucket) => `${TIMING_BUCKET_LABELS[bucket]} ${formatStatusDuration(totals[bucket])}`).join(" · ");
}
/**
* Format a completion timestamp as `YYYY-MM-DD HH:MM:SS` in local time.
* @param time - Epoch milliseconds.
* @returns The formatted local timestamp.
*/
function formatCompletionTime(time) {
	const date = new Date(time);
	const parts = [
		date.getFullYear().toString().padStart(4, "0"),
		(date.getMonth() + 1).toString().padStart(2, "0"),
		date.getDate().toString().padStart(2, "0")
	];
	const clock = [
		date.getHours(),
		date.getMinutes(),
		date.getSeconds()
	].map((value) => value.toString().padStart(2, "0")).join(":");
	return `${parts.join("-")} ${clock}`;
}

//#endregion
//#region packages/tui/src/components/transcript.ts
/**
* pi-tui transcript components: the startup banner, user/assistant messages,
* per-step timing footer, streaming assistant buffer, tool cards, and the
* injected-context card. Each is a pure function of its inputs and the active
* palette.
* @module @deepseek-ai/dsh-tui/components/transcript
*/
/** Concatenate the text of every block of one type, separated by blank lines. */
function textBlocks(content, type) {
	return content.filter((block) => block.type === type).map((block) => block.text).join("\n\n");
}
/** Render a value as terminal-safe text: strings escaped, other values as pretty JSON. */
function pretty(value) {
	if (typeof value === "string") return displayText(value);
	const serialized = JSON.stringify(value, null, 2);
	return displayText(serialized ?? String(value));
}
/**
* A side's content lines under the terminator rule the Web DiffBlock also
* applies: empty text is zero lines, a trailing newline terminates the last
* line, and an interior blank line survives.
*/
function diffContentLines(text) {
	if (text === "") return [];
	return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
}
/**
* A file diff whose unchanged context stays neutral and does not affect exact
* change totals. Comparisons beyond the edit-distance budget fall back to
* whole-side rendering so a model-authored pending edit cannot stall the TUI.
*/
function renderDiff(diff, maxDiffEditLength, palette) {
	const lines = [palette.bold(displayText(diff.path))];
	let added = 0;
	let removed = 0;
	if (diff.oldText === null) {
		const newLines = diffContentLines(displayText(diff.newText));
		added = newLines.length;
		for (const line of newLines) lines.push(palette.success(`+ ${line}`));
		return {
			lines,
			added,
			removed,
			approximate: false
		};
	}
	const changes = diffLines(diff.oldText, diff.newText, { maxEditLength: maxDiffEditLength });
	if (changes === void 0) {
		const oldLines = diffContentLines(displayText(diff.oldText));
		const newLines = diffContentLines(displayText(diff.newText));
		lines.push(palette.dim(`[exact line diff omitted: >${maxDiffEditLength} changed lines]`));
		removed = oldLines.length;
		added = newLines.length;
		for (const line of oldLines) lines.push(palette.error(`- ${line}`));
		for (const line of newLines) lines.push(palette.success(`+ ${line}`));
		return {
			lines,
			added,
			removed,
			approximate: true
		};
	}
	for (const change of changes) {
		const changedLines = diffContentLines(displayText(change.value));
		if (change.added) {
			added += changedLines.length;
			for (const line of changedLines) lines.push(palette.success(`+ ${line}`));
		} else if (change.removed) {
			removed += changedLines.length;
			for (const line of changedLines) lines.push(palette.error(`- ${line}`));
		} else for (const line of changedLines) lines.push(palette.dim(`  ${line}`));
	}
	return {
		lines,
		added,
		removed,
		approximate: false
	};
}
/**
* A message's bold, underlined role header in the role color. The underline
* bands each role without a background fill or per-line prefix, so it reads on
* any theme and a body drag-select copies the message text verbatim.
*/
function messageHeader(label, color, palette) {
	return palette.bold(palette.underline(color(displayText(label))));
}
/**
* Borderless startup banner: product title, an optional configured subtitle,
* and the session id. No box frame — each line renders as plain left-padded
* text (matching transcript notices) so it reads on any theme.
*/
var HeaderComponent = class {
	agent;
	subtitle;
	palette;
	gradient;
	/** Columns of the banner currently revealed; `undefined` renders it whole. */
	revealWidth;
	constructor(agent, subtitle, palette, gradient) {
		this.agent = agent;
		this.subtitle = subtitle;
		this.palette = palette;
		this.gradient = gradient;
	}
	/**
	* Clip the banner to `width` columns (the sweep reveal); `undefined` restores it.
	* @param width - Revealed banner width in columns, or `undefined` for the whole banner.
	*/
	setRevealWidth(width) {
		this.revealWidth = width;
	}
	invalidate() {}
	render(width) {
		const usable = Math.max(1, width - 2);
		const title = `${this.gradient ? this.palette.bold(gradientText("DEEPSEEK")) : this.palette.bold(this.palette.accent("DEEPSEEK"))} ${this.palette.bold("HARNESS")}`;
		const detail = displayText(this.agent.session.id);
		const subtitle = this.subtitle();
		const lines = [
			title,
			...subtitle === void 0 ? [] : [this.palette.dim(displayText(subtitle))],
			this.palette.dim(detail)
		].flatMap((line) => wrapTextWithAnsi(line, usable)).map((line) => ` ${truncateToWidth(line, usable, "")}`);
		if (this.revealWidth === void 0) return lines;
		const revealed = this.revealWidth;
		return lines.map((line) => truncateToWidth(line, revealed, ""));
	}
};
/**
* A user or steering prompt in the transcript. An underlined accent role header
* plus blank-line spacing separate it from surrounding blocks; body lines carry
* no prefix or indent, so a terminal drag-select copies the prompt verbatim.
*/
var UserMessageComponent = class extends Container {
	constructor(text, palette, mdTheme, label = "You") {
		super();
		this.addChild(new Text(messageHeader(label, palette.accent, palette), 0, 0));
		this.addChild(new Markdown(displayText(text), 0, 0, mdTheme, { color: (value) => palette.text(value) }, {
			preserveOrderedListMarkers: true,
			preserveBackslashEscapes: true
		}));
	}
};
/**
* Children of a settled assistant message: optional reasoning block then the
* response text. A folded continuation (a later step of a turn while tool cards
* are hidden) drops the `Assistant` header and renders nothing when it has no
* visible body, so tool-only steps leave no blank segment behind.
*/
function assistantMessageChildren(content, showReasoning, foldedContinuation, palette, mdTheme) {
	const reasoning = displayText(textBlocks(content, "reasoning").trim());
	const text = displayText(textBlocks(content, "text").trim());
	const showsReasoning = reasoning !== "" && showReasoning;
	if (foldedContinuation && !showsReasoning && text === "") return [];
	const children = [new Spacer(1)];
	if (!foldedContinuation) children.push(new Text(messageHeader("Assistant", palette.accent, palette), 0, 0));
	if (showsReasoning) children.push(new Text(palette.italic(palette.dim("Reasoning")), 0, 0), new Markdown(reasoning, 0, 0, mdTheme, {
		color: (value) => palette.dim(value),
		italic: true
	}));
	if (text) children.push(new Markdown(text, 0, 0, mdTheme, { color: (value) => palette.text(value) }));
	return children;
}
/**
* A step's timing summary, rendered as a self-refreshing footer that stays at
* the tail of the step's output. Kept separate from the assistant message so
* the timing line trails any tool cards the step appends after its message.
*/
var StepTimingComponent = class extends Container {
	position;
	events;
	tracker;
	now;
	palette;
	completionTime;
	constructor(position, events, tracker, now, palette) {
		super();
		this.position = position;
		this.events = events;
		this.tracker = tracker;
		this.now = now;
		this.palette = palette;
		this.rebuild();
	}
	complete(time) {
		this.completionTime = time;
		this.rebuild();
	}
	invalidate() {
		this.rebuild();
		super.invalidate();
	}
	rebuild() {
		this.clear();
		const totals = this.tracker.totalsAt(this.events(), this.position, this.completionTime ?? this.now());
		const timing = formatTimingTotals(totals, true);
		const header = this.completionTime === void 0 ? timing : `${timing} · Completed ${formatCompletionTime(this.completionTime)}`;
		this.addChild(new Text(this.palette.dim(header), 0, 0));
	}
};
/** A live assistant step: streamed reasoning/text blocks until the message settles. */
var StreamingAssistantComponent = class extends Container {
	position;
	showReasoning;
	palette;
	mdTheme;
	blocks = /* @__PURE__ */ new Map();
	settledContent;
	foldedContinuation = false;
	/**
	* The step's timing footer. The renderer keeps it at the tail of the chat so
	* it trails any tool cards the step appends after this assistant message; it
	* is not a child of this component.
	*/
	timing;
	constructor(position, events, tracker, now, showReasoning, palette, mdTheme) {
		super();
		this.position = position;
		this.showReasoning = showReasoning;
		this.palette = palette;
		this.mdTheme = mdTheme;
		this.timing = new StepTimingComponent(position, events, tracker, now, palette);
		this.rebuild();
	}
	/**
	* Replace the streamed blocks with the step's settled content.
	* @param content - The settled assistant content blocks.
	*/
	settle(content) {
		this.settledContent = content;
		this.rebuild();
	}
	/**
	* Whether this step's assistant message has settled.
	* @returns `true` once {@link settle} has run.
	*/
	isSettled() {
		return this.settledContent !== void 0;
	}
	/**
	* Pin the step's timing footer to its completion time.
	* @param time - Step completion time in epoch milliseconds.
	*/
	complete(time) {
		this.timing.complete(time);
	}
	invalidate() {
		this.rebuild();
		this.timing.invalidate();
		super.invalidate();
	}
	/**
	* Fold one streamed chunk into the live block buffer and re-render.
	* @param chunk - The streamed assistant chunk.
	*/
	update(chunk) {
		if (chunk.type === "block-start") this.blocks.set(chunk.index, {
			type: chunk.blockType,
			text: ""
		});
		else if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") {
			const type = chunk.type === "text-delta" ? "text" : "reasoning";
			const block = this.blocks.get(chunk.index) ?? {
				type,
				text: ""
			};
			block.text += chunk.text;
			this.blocks.set(chunk.index, block);
		} else if (chunk.type === "block-end" && (chunk.block.type === "text" || chunk.block.type === "reasoning")) this.blocks.set(chunk.index, {
			type: chunk.block.type,
			text: chunk.block.text
		});
		this.rebuild();
		this.timing.invalidate();
	}
	/**
	* Toggle whether reasoning blocks render, then re-render.
	* @param show - Whether to show reasoning blocks.
	*/
	setShowReasoning(show) {
		this.showReasoning = show;
		this.rebuild();
	}
	/**
	* Mark this step as a folded continuation of its turn: no `Assistant` header,
	* and no output at all while the step has no visible body. Used while tool
	* cards are hidden so a turn reads as one assistant message.
	* @param folded - Whether to render as a headerless continuation.
	*/
	setFoldedContinuation(folded) {
		if (this.foldedContinuation === folded) return;
		this.foldedContinuation = folded;
		this.rebuild();
	}
	/**
	* Whether the step currently renders visible reasoning or text.
	* @returns `true` when a header-owning render would show a body.
	*/
	hasVisibleBody() {
		const content = this.presentedContent();
		return textBlocks(content, "text").trim() !== "" || this.showReasoning && textBlocks(content, "reasoning").trim() !== "";
	}
	/** The settled content when available, otherwise the streamed blocks in model order. */
	presentedContent() {
		return this.settledContent ?? [...this.blocks.entries()].sort(([left], [right]) => left - right).flatMap(([, block]) => {
			if (block.type === "text") return [{
				type: "text",
				text: block.text
			}];
			if (block.type === "reasoning") return [{
				type: "reasoning",
				text: block.text
			}];
			return [];
		});
	}
	rebuild() {
		this.clear();
		const children = assistantMessageChildren(this.presentedContent(), this.showReasoning, this.foldedContinuation, this.palette, this.mdTheme);
		for (const child of children) this.addChild(child);
	}
};
/**
* Transcript card with a width-keyed rendered-row cache. pi-tui re-renders
* every component each frame and relies on per-component line caches (its own
* `Text`/`Markdown` do this); a card that rebuilds rows inside `render(width)`
* would re-wrap its output every frame. Subclasses render through
* {@link renderLines} and call {@link dropLines} from every state mutator; with
* `invalidate()` (pi-tui's tree-wide cascade) also dropping, a state change
* always re-renders.
*/
var CachedCardComponent = class {
	cached;
	/** Discard the cached rows so the next render recomputes them. */
	dropLines() {
		this.cached = void 0;
	}
	invalidate() {
		this.cached = void 0;
	}
	render(width) {
		if (this.cached?.width !== width) this.cached = {
			width,
			lines: this.renderLines(width)
		};
		return this.cached.lines;
	}
};
/** A tool call and its result, rendered as a collapsible status card. */
var ToolCardComponent = class extends CachedCardComponent {
	name;
	parsed;
	definition;
	maxOutputLines;
	maxDiffEditLength;
	palette;
	mdTheme;
	result;
	visibility = "collapsed";
	callView;
	resultView;
	diffBodyCache;
	constructor(name, parsed, definition, maxOutputLines, maxDiffEditLength, palette, mdTheme) {
		super();
		this.name = name;
		this.parsed = parsed;
		this.definition = definition;
		this.maxOutputLines = maxOutputLines;
		this.maxDiffEditLength = maxDiffEditLength;
		this.palette = palette;
		this.mdTheme = mdTheme;
		this.callView = this.presentCall();
	}
	presentCall() {
		if (this.parsed.valid && this.definition?.presentCall) try {
			const view = this.definition.presentCall(this.parsed.value);
			if (view !== void 0) return view;
		} catch (error) {
			return {
				card: "generic",
				title: displayText(this.name),
				rawInput: `Presenter failed: ${String(error)}`
			};
		}
		return {
			card: "generic",
			title: displayText(this.name),
			rawInput: this.parsed.value
		};
	}
	/**
	* Record the tool result and derive its result view.
	* @param event - The `tool/result` event payload.
	*/
	updateResult(event) {
		this.diffBodyCache = void 0;
		this.dropLines();
		const result = event.message.content[0];
		this.result = {
			content: [...result.content],
			isError: result.isError === true,
			...event.meta !== void 0 ? { meta: event.meta } : {}
		};
		if (this.parsed.valid && this.definition?.presentResult) try {
			const view = this.definition.presentResult(this.parsed.value, this.result);
			if (view !== void 0) this.resultView = view;
		} catch (error) {
			this.resultView = {
				card: "generic",
				content: [{
					type: "text",
					text: `Presenter failed: ${String(error)}`
				}]
			};
		}
	}
	/**
	* Set the card's visibility state.
	* @param visibility - Hidden, collapsed preview, or full body.
	*/
	setVisibility(visibility) {
		this.visibility = visibility;
		this.dropLines();
	}
	renderLines(width) {
		if (this.visibility === "hidden") return [];
		const isError = this.result?.isError ?? false;
		const glyph = this.result === void 0 ? "○" : "●";
		const rawBody = this.renderBody();
		const view = this.resultView ?? this.callView;
		const markdownContent = view.card === "generic" ? view.content ?? this.result?.content : view.card === "search" || view.card === "web" || view.card === "read" ? this.result?.content : void 0;
		const unknownXml = this.definition === void 0 && markdownContent !== void 0 ? renderUnknownXml(
			displayText(contentText(markdownContent)),
			this.maxOutputLines,
			this.visibility === "expanded",
			displayText,
			(text) => this.palette.dim(text),
			(text) => this.palette.dim(text),
			/* v8 ignore next -- renderUnknownXml calls the collapsed summary only when hidden XML children exceed this card's limit. */
			(count) => this.palette.dim(`  … +${count} lines (Ctrl+O to expand)`)
		) : void 0;
		const body = unknownXml ?? (markdownContent !== void 0 && rawBody.lines.length > 0 ? this.dimBody(rawBody, width) : [...rawBody.prelude, ...rawBody.lines]);
		const visibleBody = unknownXml !== void 0 || this.visibility === "expanded" ? body : preview(body, this.maxOutputLines, (count) => this.palette.dim(`… +${count} lines (Ctrl+O to expand)`));
		const statusColor = this.result === void 0 ? this.palette.warning : isError ? this.palette.error : this.palette.success;
		const desc = this.headerDescription();
		const headerText = `${glyph} Tool / ${displayText(this.name)}${desc === void 0 ? "" : ` / ${displayInlineText(desc)}`}`;
		const lines = ["", statusColor(truncateToWidth(headerText, Math.max(1, width - 2), ""))];
		if (visibleBody.length > 0) lines.push(...new Text(visibleBody.join("\n"), 0, 0).render(width));
		return lines;
	}
	/** The pending terminal call view, when this row is a terminal card. */
	terminalPending() {
		return this.callView.card === "terminal" ? this.callView : void 0;
	}
	/**
	* The optional header `/ <desc>` segment: a bash (terminal) card's
	* model-authored description. Non-terminal tools contribute no header detail.
	*/
	headerDescription() {
		const description = this.terminalPending()?.description;
		return description !== void 0 && description !== "" ? description : void 0;
	}
	/**
	* The presenter's title for a non-terminal card, shown as the first body line
	* now that the header is a fixed `Tool / <name>` frame. The result-state
	* title replaces the pending one.
	*/
	bodyTitle() {
		return this.resultView?.title ?? this.callView.title;
	}
	renderBody() {
		const view = this.resultView ?? this.callView;
		if (view.card === "terminal") {
			const pending = this.terminalPending();
			const prelude = [];
			const lines = [];
			const headlined = pending?.description !== void 0 && pending.description !== "";
			if (pending !== void 0 && (headlined || this.result === void 0)) prelude.push(this.palette.dim(`$ ${displayInlineText(pending.title)}`));
			if (pending?.cwd) prelude.push(this.palette.dim(displayInlineText(pending.cwd)));
			if (this.resultView?.card === "terminal") {
				if (this.resultView.output) lines.push(...this.dimOutput(this.resultView.output));
				if (this.resultView.exitCode !== void 0) lines.push(this.palette.dim(`[exit ${this.resultView.exitCode}]`));
				if (this.resultView.signal !== void 0) lines.push(this.palette.error(`[signal ${displayText(this.resultView.signal)}]`));
			} else if (this.result !== void 0) lines.push(...this.dimOutput(contentText(this.result.content)));
			return {
				prelude: prelude.filter(Boolean),
				lines: lines.filter(Boolean)
			};
		}
		if (view.card === "diff") {
			if (this.diffBodyCache?.view === view) return this.diffBodyCache.body;
			const renderedDiffs = view.diffs.map((diff) => renderDiff(diff, this.maxDiffEditLength, this.palette));
			const added = renderedDiffs.reduce((total, rendered) => total + rendered.added, 0);
			const removed = renderedDiffs.reduce((total, rendered) => total + rendered.removed, 0);
			const approximate = renderedDiffs.some((rendered) => rendered.approximate);
			const hunks = renderedDiffs.flatMap((rendered, index) => {
				return [...index > 0 ? [""] : [], ...rendered.lines];
			});
			const files = new Set(view.diffs.map((diff) => diff.path)).size;
			const footer = this.palette.dim(`└ +${added} -${removed} · ${files} file${files === 1 ? "" : "s"}${approximate ? " · approximate" : ""}`);
			const body = {
				prelude: [...hunks, footer],
				lines: []
			};
			this.diffBodyCache = {
				view,
				body
			};
			return body;
		}
		const content = (view.card === "generic" || view.card === "read" ? view.content : void 0) ?? this.result?.content;
		const prelude = [];
		const lines = [];
		const bodyTitle = this.bodyTitle();
		if (bodyTitle !== displayText(this.name)) prelude.push(displayInlineText(bodyTitle));
		if (content !== void 0) lines.push(...displayText(contentText(content)).split("\n"));
		const rawInput = this.result === void 0 && this.callView.card === "generic" ? this.callView.rawInput : void 0;
		if (rawInput !== void 0) lines.push(...pretty(rawInput).split("\n"));
		const total = prelude.length + lines.length;
		return {
			prelude,
			lines: lines.filter((line, index) => {
				const row = prelude.length + index;
				return line.length > 0 || row > 0 && row < total - 1;
			})
		};
	}
	/**
	* A tool's own output text as dim rows — the card's result-output color. A
	* blank row stays the empty string so the terminal branch's blank-row filter
	* still reads it as blank instead of as an ANSI-wrapped value.
	*/
	dimOutput(text) {
		return displayText(text).split("\n").map((line) => line === "" ? line : this.palette.dim(line));
	}
	/**
	* Render a generic card's prelude and result as one Markdown document under the
	* dim body tone. Rendering both together preserves the document's own block
	* spacing; dimming every row keeps the card body one uniform tone, so only
	* the status-colored header carries color.
	*/
	dimBody(body, width) {
		return new Markdown([...body.prelude, ...body.lines].join("\n"), 0, 0, this.mdTheme, { color: (value) => this.palette.text(value) }).render(width).map((row) => row.trim() === "" ? row : this.palette.dim(row));
	}
};
/**
* Matches a lone reminder-frame tag on its own line, capturing the element name.
*/
const REMINDER_FRAME_LINE = /^<(\/?)([a-zA-Z][\w:.-]*)>$/u;
/**
* Drop a producer's outer reminder frame, keeping the instruction body verbatim.
* The card header already names the source, so the frame lines carry nothing.
* Only a matched open/close pair on the first and last lines is removed, so a
* body that merely starts with a tag-like line is left intact.
* @param text - Complete model-facing context text.
* @returns The body without its outer frame lines, trimmed of the blank lines they leave.
*/
function stripReminderFrame(text) {
	const [first = "", ...rest] = text.split("\n");
	const last = rest.at(-1);
	if (last === void 0) return text;
	const open = REMINDER_FRAME_LINE.exec(first.trim());
	const close = REMINDER_FRAME_LINE.exec(last.trim());
	if (open?.[1] !== "" || close?.[1] !== "/" || open[2] !== close[2]) return text;
	return rest.slice(0, -1).join("\n").replace(/^\n+|\n+$/gu, "");
}
/**
* Injected context (plugin/goal source), rendered as a collapsible dim card that
* shares the tool-card `Ctrl+O` toggle. The header is `Context · <label>`; the
* body is the message text as dim prose, one tone with the header and the fold
* marker, folded to `maxOutputLines`, with a surrounding reminder frame stripped
* because the source label already names the context.
*
* Injected context is prose, not markup, so this card does not parse it.
*/
var ContextCardComponent = class extends CachedCardComponent {
	label;
	text;
	maxOutputLines;
	palette;
	expanded = false;
	constructor(label, text, maxOutputLines, palette) {
		super();
		this.label = label;
		this.text = text;
		this.maxOutputLines = maxOutputLines;
		this.palette = palette;
	}
	/**
	* Expand or collapse the card body.
	* @param expanded - Whether the full body is shown.
	*/
	setExpanded(expanded) {
		this.expanded = expanded;
		this.dropLines();
	}
	renderLines(width) {
		const header = this.palette.dim(`Context · ${displayText(this.label)}`);
		const stripped = stripReminderFrame(this.text);
		if (stripped === "") return [header];
		const body = stripped.split("\n").map((line) => line === "" ? line : this.palette.dim(displayText(line)));
		const visibleBody = this.expanded ? body : preview(body, this.maxOutputLines, (count) => this.palette.dim(`… +${count} lines (Ctrl+O to expand)`));
		return [header, ...new Text(visibleBody.join("\n"), 0, 0).render(width)];
	}
};

//#endregion
//#region packages/tui/src/components/dialogs.ts
/**
* Modal dialogs for the interactive channel: the question panel behind
* `ask_user_question` and the approval panel behind `approval/request`.
* @module @deepseek-ai/dsh-tui/components/dialogs
*/
/**
* Format a provider/model target as its `provider/model` label.
* @param target - The LLM target.
* @returns The `provider/model` label.
*/
function targetLabel(target) {
	return `${target.provider}/${target.model}`;
}
/**
* Format a target compactly as its model name with the provider in brackets and any selected effort appended.
* @param target - The LLM target.
* @returns The compact `<model> [provider] [effort]` label.
*/
function compactTargetLabel(target) {
	return `${target.model} [${target.provider}]${target.reasoningEffort === void 0 ? "" : ` ${target.reasoningEffort}`}`;
}
/**
* Resolve the display label for a choice's reasoning effort.
* @param choice - The model choice carrying advertised reasoning metadata.
* @param effort - The selected effort, or `undefined` for provider default.
* @returns The effort's display name, `Default`, or `undefined` when the model has no reasoning metadata.
*/
function targetReasoningLabel(choice, effort) {
	if (effort === void 0) return choice.reasoning === void 0 ? void 0 : "Default";
	return choice.reasoning?.efforts.find((candidate) => candidate.id === effort)?.name ?? effort;
}
/**
* Derive the agent's initial LLM target from its logged request header or options.
* @param agent - The driven agent.
* @returns The initial target, or `undefined` when unset.
*/
function initialTarget(agent) {
	const logged = agent.session.requestHeader()?.config;
	if (logged !== void 0) return {
		provider: logged.provider,
		model: logged.model,
		...logged.reasoningEffort === void 0 ? {} : { reasoningEffort: logged.reasoningEffort }
	};
	if (agent.options.provider === void 0 || agent.options.model === void 0) return void 0;
	return {
		provider: agent.options.provider,
		model: agent.options.model
	};
}
/**
* List every advertised model across registered providers, appending the current
* target when a provider does not advertise it.
* @param ctx - Context supplying the LLM service.
* @param current - The current target, appended when unadvertised.
* @returns The model choices, flattened across providers.
*/
async function readModelChoices(ctx, current) {
	const providers = ctx.llm.listProviders();
	return (await Promise.all(providers.map(async (provider) => {
		const models = [...await ctx.llm.listModels(provider.id)];
		if (current?.provider === provider.id && !models.some((model) => model.id === current.model)) models.push({
			provider: provider.id,
			id: current.model,
			name: current.model
		});
		return Promise.all(models.map(async (model) => {
			const reasoning = (await ctx.llm.resolveModelInfo(provider.id, model.id)).reasoning;
			return {
				provider: provider.id,
				model: model.id,
				modelName: model.name,
				...model.description === void 0 ? {} : { description: model.description },
				...reasoning === void 0 ? {} : { reasoning }
			};
		}));
	}))).flat();
}
/**
* Format a diagnostic integer with grouping separators.
* @param value - the integer to format.
* @returns the grouped decimal representation.
*/
function formatDiagnosticNumber(value) {
	return value.toLocaleString("en-US");
}
/**
* Format a diagnostic timestamp as an ISO date-time in UTC.
* @param value - Epoch milliseconds.
* @returns The formatted UTC timestamp.
*/
function formatDiagnosticTime(value) {
	return new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/u, " UTC");
}
/**
* Format a pluralized count for a diagnostic row.
* @param value - Count.
* @param singular - Singular noun; an `s` is appended for other counts.
* @returns The formatted count.
*/
function formatDiagnosticCount(value, singular) {
	return `${String(value)} ${singular}${value === 1 ? "" : "s"}`;
}
/**
* Render a fixed-width filled meter bar for a percentage.
* @param percent - Percentage in [0, 100].
* @param palette - Active role palette.
* @returns The rendered meter.
*/
function diagnosticMeter(percent, palette) {
	const width = 16;
	const filled = Math.round(Math.min(100, Math.max(0, percent)) / 100 * width);
	return `${palette.dim("[")}${palette.accent("█".repeat(filled))}${palette.dim(`${"░".repeat(width - filled)}]`)}`;
}
/** Bordered, grouped field card for one point-in-time status snapshot. */
var StatusCardComponent = class {
	groups;
	palette;
	constructor(groups, palette) {
		this.groups = groups;
		this.palette = palette;
	}
	invalidate() {}
	render(width) {
		const labels = this.groups.flatMap((group) => group.map(([label]) => `${label}:`));
		const naturalLabelWidth = Math.max(...labels.map((label) => label.length));
		const naturalBodyWidth = Math.max(...this.groups.flatMap((group) => group.map(([, value]) => 1 + naturalLabelWidth + 2 + visibleWidth(value))));
		const cardWidth = Math.min(Math.max(8, width), Math.max(19, naturalBodyWidth + 4));
		const innerWidth = Math.max(1, cardWidth - 4);
		const labelWidth = Math.min(naturalLabelWidth, Math.max(1, Math.floor(innerWidth / 3)));
		const body = [];
		for (const [groupIndex, group] of this.groups.entries()) {
			if (groupIndex > 0) body.push("");
			for (const [label, value] of group) {
				const plainLabel = truncateToWidth(`${label}:`, labelWidth, "");
				const prefix = ` ${this.palette.dim(plainLabel.padEnd(labelWidth))}  `;
				const continuation = " ".repeat(1 + labelWidth + 2);
				const valueWidth = Math.max(1, innerWidth - visibleWidth(prefix));
				const wrapped = wrapTextWithAnsi(value, valueWidth);
				for (const [lineIndex, line] of wrapped.entries()) body.push(`${lineIndex === 0 ? prefix : continuation}${line}`);
			}
		}
		const title = truncateToWidth("Session status", Math.max(1, cardWidth - 5), "");
		const topTail = "─".repeat(Math.max(0, cardWidth - visibleWidth(title) - 5));
		const lines = [`${this.palette.dim("╭─ ")}${this.palette.bold(this.palette.accent(title))}${this.palette.dim(` ${topTail}╮`)}`];
		for (const line of body) lines.push(`${this.palette.dim("│")} ${padRow(line, innerWidth)} ${this.palette.dim("│")}`);
		lines.push(this.palette.dim(`╰${"─".repeat(Math.max(0, cardWidth - 2))}╯`));
		return lines;
	}
};
/**
* Clip one dialog row to the inner width, pad it to the full inner width, and
* flank it with symmetric outer padding — the shared row-fitting idiom behind
* the bordered dialogs and the full-width question/approval panels.
* @param line - Row text (may carry SGR styling).
* @param innerWidth - Target visible width of the clipped+padded row.
* @param outerPad - Blank columns added on each side of the row.
* @param ellipsis - Marker appended when the row clips (empty for hard cuts).
* @returns The fitted row, exactly `innerWidth + 2 * outerPad` columns wide.
*/
function padRow(line, innerWidth, outerPad = 0, ellipsis = "") {
	const bounded = truncateToWidth(line, innerWidth, ellipsis);
	const pad = " ".repeat(Math.max(0, innerWidth - visibleWidth(bounded)));
	const outer = " ".repeat(outerPad);
	return `${outer}${bounded}${pad}${outer}`;
}
/**
* Render a bordered dialog frame around body lines with a titled top edge.
* @param title - Dialog title shown in the top border.
* @param body - Body lines.
* @param width - Dialog width in columns.
* @param palette - Active role palette.
* @returns The framed dialog lines.
*/
function renderDialog(title, body, width, palette) {
	const innerWidth = Math.max(1, width - 4);
	const topLabel = ` ${displayText(title)} `;
	const top = `╭${topLabel}${"─".repeat(Math.max(0, width - visibleWidth(topLabel) - 2))}╮`;
	const lines = [palette.accent(top)];
	for (const line of body) lines.push(`${palette.accent("│")} ${padRow(line, innerWidth)} ${palette.accent("│")}`);
	lines.push(palette.accent(`╰${"─".repeat(Math.max(0, width - 2))}╯`));
	return lines;
}
/** Keyboard model selector rendered as a bordered overlay, with a filter box and per-model reasoning-effort cycling. */
var ModelDialog = class {
	maxVisible;
	palette;
	done;
	cancel;
	list;
	filter = new Input();
	items;
	choices;
	efforts;
	currentValue;
	constructor(choices, current, maxVisible, palette, done, cancel) {
		this.maxVisible = maxVisible;
		this.palette = palette;
		this.done = done;
		this.cancel = cancel;
		this.items = /* @__PURE__ */ new Map();
		this.choices = /* @__PURE__ */ new Map();
		this.efforts = /* @__PURE__ */ new Map();
		this.currentValue = current === void 0 ? void 0 : targetLabel(current);
		for (const choice of choices) {
			const value = targetLabel(choice);
			const isCurrent = current?.provider === choice.provider && current.model === choice.model;
			this.choices.set(value, choice);
			this.efforts.set(value, isCurrent ? current.reasoningEffort ?? choice.reasoning?.defaultEffort : choice.reasoning?.defaultEffort);
			this.items.set(value, {
				value,
				label: displayText(value),
				description: this.describeChoice(choice, isCurrent)
			});
		}
		this.list = this.buildList(this.currentValue);
	}
	/** Build a SelectList over the currently filtered items, selecting `selectValue` when present. */
	buildList(selectValue) {
		const items = this.filteredItems();
		const list = new SelectList(items, this.maxVisible, selectTheme(this.palette));
		const index = selectValue === void 0 ? 0 : items.findIndex((item) => item.value === selectValue);
		list.setSelectedIndex(Math.max(0, index));
		list.onSelect = (item) => {
			this.confirm(item);
		};
		list.onCancel = this.cancel;
		return list;
	}
	/** Items matching the filter box, as a case-insensitive substring over the label, model name, and description. */
	filteredItems() {
		const query = this.filter.getValue().trim().toLocaleLowerCase();
		if (query === "") return [...this.items.values()];
		return [...this.items.values()].filter((item) => {
			const choice = this.choices.get(item.value);
			/* v8 ignore next -- items and choices share the same keys. */
			if (choice === void 0) return false;
			return [
				item.value,
				choice.modelName,
				choice.description ?? ""
			].some((field) => field.toLocaleLowerCase().includes(query));
		});
	}
	confirm(item) {
		const selected = this.choices.get(item.value);
		/* v8 ignore next -- SelectList only returns values built from `choices`. */
		if (selected === void 0) return;
		this.done({
			choice: selected,
			reasoningEffort: this.efforts.get(item.value)
		});
	}
	describeChoice(choice, isCurrent) {
		const effortLabel = targetReasoningLabel(choice, this.efforts.get(targetLabel(choice)));
		return [
			displayText(choice.modelName),
			...choice.description === void 0 ? [] : [displayText(choice.description)],
			...effortLabel === void 0 ? [] : [displayText(effortLabel)],
			...isCurrent ? ["current"] : []
		].join(" — ");
	}
	cycleReasoningEffort() {
		const selectedItem = this.list.getSelectedItem();
		/* v8 ignore next -- the dialog is opened only for a non-empty catalog. */
		if (selectedItem === null) return;
		const choice = this.choices.get(selectedItem.value);
		if (choice?.reasoning === void 0) return;
		const current = this.efforts.get(selectedItem.value);
		const efforts = [...choice.reasoning.defaultEffort === void 0 ? [void 0] : [], ...choice.reasoning.efforts.map((effort) => effort.id)];
		const next = efforts[(efforts.indexOf(current) + 1) % efforts.length];
		this.efforts.set(selectedItem.value, next);
		const item = this.items.get(selectedItem.value);
		/* v8 ignore next -- items and choices are constructed from the same values. */
		if (item === void 0) return;
		item.description = this.describeChoice(choice, selectedItem.value === this.currentValue);
	}
	invalidate() {
		this.filter.invalidate();
		this.list.invalidate();
	}
	handleInput(data) {
		if (matchesKey(data, Key.shift(Key.tab))) this.cycleReasoningEffort();
		else if (matchesKey(data, Key.escape)) {
			if (this.filter.getValue() === "") this.cancel();
			else {
				this.filter.setValue("");
				this.list = this.buildList(void 0);
			}
		} else if (matchesKey(data, Key.up) || matchesKey(data, Key.down) || matchesKey(data, Key.enter)) this.list.handleInput(data);
		else {
			const previous = this.filter.getValue();
			this.filter.focused = true;
			this.filter.handleInput(data);
			if (this.filter.getValue() !== previous) {
				const selected = this.list.getSelectedItem();
				this.list = this.buildList(selected?.value);
			}
		}
		this.invalidate();
	}
	render(width) {
		const innerWidth = Math.max(1, width - 4);
		this.filter.focused = true;
		const results = this.filteredItems();
		return renderDialog("Select model", [
			truncateToWidth(this.filter.render(innerWidth).join(""), innerWidth, ""),
			"",
			...results.length === 0 ? [this.palette.dim("  No models match the filter")] : this.list.render(innerWidth),
			"",
			this.palette.dim("type to filter • ↑/↓ move • Shift+Tab reasoning • Enter select • Esc")
		], width, this.palette);
	}
};
/** Keyboard agent-preset selector: a bordered list over the roster with the current preset marked. */
var PresetDialog = class {
	palette;
	done;
	cancel;
	list;
	items;
	constructor(choices, current, maxVisible, palette, done, cancel) {
		this.palette = palette;
		this.done = done;
		this.cancel = cancel;
		this.items = /* @__PURE__ */ new Map();
		for (const choice of choices) this.items.set(choice.id, {
			value: choice.id,
			label: displayText(choice.label),
			description: [
				choice.trust === "user" ? "user" : "shipped",
				...choice.broken === void 0 ? [] : [`broken: ${choice.broken}`],
				...choice.description === void 0 ? [] : [choice.description],
				...choice.id === current ? ["current"] : []
			].join(" — ")
		});
		const items = [...this.items.values()];
		this.list = new SelectList(items, maxVisible, selectTheme(this.palette));
		const index = current === void 0 ? 0 : items.findIndex((item) => item.value === current);
		this.list.setSelectedIndex(Math.max(0, index));
		this.list.onSelect = (item) => {
			this.done(item.value);
		};
		this.list.onCancel = this.cancel;
	}
	invalidate() {
		this.list.invalidate();
	}
	handleInput(data) {
		if (matchesKey(data, Key.escape)) this.cancel();
		else if (matchesKey(data, Key.up) || matchesKey(data, Key.down) || matchesKey(data, Key.enter)) this.list.handleInput(data);
		this.invalidate();
	}
	render(width) {
		const innerWidth = Math.max(1, width - 4);
		return renderDialog("Select agent preset", [
			...this.list.render(innerWidth),
			"",
			this.palette.dim("↑/↓ move • Enter select • Esc")
		], width, this.palette);
	}
};
/**
* Build one resume selector row from a record, its batch-folded title, and a
* metadata-derived activity time, deriving the workspace scope and any reason
* the session cannot be resumed here.
* @param record - The session record.
* @param title - The session's batch-folded title, absent for an untitled log.
* @param lastActivityAt - Metadata activity time; absent falls back to the header's creation time.
* @param currentId - The current session id.
* @param cwd - The CURRENT session's workspace, which decides the picker scope this row falls in.
* @param formatWorkspace - Renders THIS record's own cwd as its prompt-style label.
* @returns The summarized resume candidate.
*/
function summarizeResumeCandidate(record, title, lastActivityAt, currentId, cwd, formatWorkspace) {
	let disabledReason;
	if (record.header.id === currentId) disabledReason = "current session";
	else if (record.live) disabledReason = "session is already live in this runtime";
	else if (record.header.cwd === void 0) disabledReason = "session has no recorded workspace";
	return {
		record,
		title: title ?? "Untitled session",
		lastActivityAt: lastActivityAt ?? record.header.createdAt,
		currentWorkspace: record.header.cwd === cwd,
		workspaceLabel: formatWorkspace(record.header.cwd),
		...disabledReason === void 0 ? {} : { disabledReason }
	};
}
/** Full-viewport keyboard selector over detached, preflighted resume summaries. */
var ResumePicker = class {
	maxVisible;
	workspaceLabel;
	viewportRows;
	palette;
	done;
	cancel;
	search = new Input();
	pasteBuffer;
	selectedIndex = 0;
	error = "";
	scope = "workspace";
	candidates;
	focused = false;
	constructor(candidates, maxVisible, workspaceLabel, viewportRows, palette, done, cancel) {
		this.maxVisible = maxVisible;
		this.workspaceLabel = workspaceLabel;
		this.viewportRows = viewportRows;
		this.palette = palette;
		this.done = done;
		this.cancel = cancel;
		this.candidates = candidates;
	}
	invalidate() {
		this.search.invalidate();
	}
	/**
	* Replace the loading placeholder with the scanned candidate set.
	* @param candidates - The summarized rows the finished scan produced.
	*/
	setCandidates(candidates) {
		this.candidates = candidates;
		this.selectedIndex = 0;
		this.error = "";
		this.invalidate();
	}
	/** Candidates in the active scope, before the search query narrows them. */
	scoped() {
		const candidates = this.candidates ?? [];
		return this.scope === "all" ? [...candidates] : candidates.filter((candidate) => candidate.currentWorkspace);
	}
	filtered() {
		const query = this.search.getValue().trim().toLocaleLowerCase();
		const scoped = this.scoped();
		if (query === "") return scoped;
		return scoped.filter((candidate) => candidate.title.toLocaleLowerCase().includes(query) || candidate.record.header.id.toLocaleLowerCase().includes(query) || this.scope === "all" && candidate.workspaceLabel.toLocaleLowerCase().includes(query));
	}
	visibleCandidateCount() {
		const rowHeight = this.scope === "all" ? 4 : 3;
		const candidateBudget = Math.max(1, Math.floor((Math.max(1, this.viewportRows()) - 13) / rowHeight));
		return Math.min(this.maxVisible, candidateBudget);
	}
	handleBracketedPaste(data) {
		const start = data.indexOf(BRACKETED_PASTE_START);
		if (this.pasteBuffer === void 0 && start < 0) return false;
		if (this.pasteBuffer === void 0) {
			const prefix = data.slice(0, start);
			if (prefix !== "") this.handleInput(prefix);
			this.pasteBuffer = data.slice(start + BRACKETED_PASTE_START.length);
		} else this.pasteBuffer += data;
		const end = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);
		if (end < 0) return true;
		const pasted = sanitizePastedText(this.pasteBuffer.slice(0, end));
		const remaining = this.pasteBuffer.slice(end + BRACKETED_PASTE_END.length);
		this.pasteBuffer = void 0;
		const previous = this.search.getValue();
		this.search.handleInput(`${BRACKETED_PASTE_START}${pasted}${BRACKETED_PASTE_END}`);
		if (this.search.getValue() !== previous) {
			this.selectedIndex = 0;
			this.error = "";
		}
		if (remaining !== "") this.handleInput(remaining);
		this.invalidate();
		return true;
	}
	handleInput(data) {
		if (this.handleBracketedPaste(data)) return;
		const filtered = this.filtered();
		if (matchesKey(data, Key.ctrl("c"))) {
			this.cancel();
			return;
		}
		if (matchesKey(data, Key.escape)) {
			if (this.search.getValue() === "") this.cancel();
			else {
				this.search.setValue("");
				this.selectedIndex = 0;
				this.error = "";
			}
		} else if (matchesKey(data, Key.up)) this.selectedIndex = filtered.length === 0 ? 0 : (this.selectedIndex + filtered.length - 1) % filtered.length;
		else if (matchesKey(data, Key.down)) this.selectedIndex = filtered.length === 0 ? 0 : (this.selectedIndex + 1) % filtered.length;
		else if (matchesKey(data, Key.pageUp)) this.selectedIndex = Math.max(0, this.selectedIndex - this.visibleCandidateCount());
		else if (matchesKey(data, Key.pageDown)) this.selectedIndex = Math.min(Math.max(0, filtered.length - 1), this.selectedIndex + this.visibleCandidateCount());
		else if (matchesKey(data, Key.tab)) {
			this.scope = this.scope === "workspace" ? "all" : "workspace";
			this.search.setValue("");
			this.selectedIndex = 0;
			this.error = "";
		} else if (matchesKey(data, Key.enter)) {
			const selected = filtered[this.selectedIndex];
			if (this.candidates === void 0) this.error = "Sessions are still loading.";
			else if (selected === void 0) this.error = "No session matches this search.";
			else if (selected.disabledReason !== void 0) this.error = selected.disabledReason;
			else this.done(selected);
		} else {
			const previous = this.search.getValue();
			this.search.focused = this.focused;
			this.search.handleInput(data);
			if (this.search.getValue() !== previous) {
				this.selectedIndex = 0;
				this.error = "";
			}
		}
		this.invalidate();
	}
	/**
	* The scope line under the search box: the active scope with the current
	* workspace it means, and the inactive scope with the count Tab would reveal.
	*/
	renderScopeLine() {
		const candidates = this.candidates ?? [];
		const inWorkspace = candidates.filter((candidate) => candidate.currentWorkspace).length;
		const active = this.scope === "workspace" ? `this workspace ${displayText(this.workspaceLabel)}` : `all workspaces (${candidates.length})`;
		const other = this.scope === "workspace" ? `all workspaces (${candidates.length})` : `this workspace (${inWorkspace})`;
		return `${this.palette.accent(active)}${this.palette.dim(`  ⇥ ${other}`)}`;
	}
	render(width) {
		this.search.focused = this.focused;
		const height = Math.max(1, this.viewportRows());
		const horizontalPadding = width >= 12 ? 2 : 0;
		const contentWidth = Math.max(1, width - horizontalPadding * 2);
		const indent = " ".repeat(horizontalPadding);
		const filtered = this.filtered();
		if (this.selectedIndex >= filtered.length) this.selectedIndex = Math.max(0, filtered.length - 1);
		const position = filtered[this.selectedIndex] === void 0 ? 0 : this.selectedIndex + 1;
		const title = this.candidates === void 0 ? "Resume session" : `Resume session (${position} of ${filtered.length})`;
		const lines = [
			"",
			`${indent}${this.palette.bold(this.palette.accent(title))}`,
			""
		];
		const searchInnerWidth = Math.max(1, contentWidth - 4);
		lines.push(`${indent}${this.palette.dim(`╭${"─".repeat(Math.max(0, contentWidth - 2))}╮`)}`);
		const searchContent = this.search.render(searchInnerWidth).join("").replace(/^> /u, "⌕ ");
		const clippedSearch = truncateToWidth(searchContent, searchInnerWidth, "");
		lines.push(`${indent}${this.palette.dim("│")} ${clippedSearch}${" ".repeat(Math.max(0, searchInnerWidth - visibleWidth(clippedSearch)))} ${this.palette.dim("│")}`, `${indent}${this.palette.dim(`╰${"─".repeat(Math.max(0, contentWidth - 2))}╯`)}`, "", `${indent}${this.renderScopeLine()}`, "");
		const visibleCount = this.visibleCandidateCount();
		const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(visibleCount / 2), filtered.length - visibleCount));
		const end = Math.min(filtered.length, start + visibleCount);
		const push = (line) => {
			lines.push(`${indent}${truncateToWidth(line, contentWidth, "…")}`);
		};
		for (let index = start; index < end; index += 1) {
			const candidate = filtered[index];
			const active = index === this.selectedIndex;
			const status = [
				candidate.disabledReason === "current session" ? "current" : void 0,
				candidate.record.live ? "live" : void 0,
				candidate.record.persisted ? "persisted" : void 0
			].filter((value) => value !== void 0).join(" · ");
			const lead = `${active ? "❯" : " "} ${displayText(candidate.title)}`;
			push(active ? this.palette.bold(this.palette.accent(lead)) : lead);
			push(this.palette.dim(`  ${new Date(candidate.lastActivityAt).toISOString()} · ${status} · ${displayText(candidate.record.header.id)}`));
			if (this.scope === "all") push(this.palette.dim(`  workspace ${displayText(candidate.workspaceLabel)}`));
			if (candidate.disabledReason !== void 0) push(this.palette.warning(`  unavailable: ${displayText(candidate.disabledReason)}`));
		}
		if (this.candidates === void 0) push(this.palette.dim("Loading sessions…"));
		else if (filtered.length === 0) push(this.palette.warning("No matching sessions."));
		if (this.error !== "") {
			lines.push("");
			push(this.palette.error(displayText(this.error)));
		}
		const footer = `${indent}${this.palette.dim("Type to search  •  ↑/↓ navigate  •  Tab scope  •  Enter resume  •  Esc clear/cancel")}`;
		while (lines.length < height - 2) lines.push("");
		lines.push(footer, "");
		return lines.slice(0, height);
	}
};
/** Inline dialog for one user question with option or custom-answer modes. */
var QuestionDialog = class {
	question;
	position;
	total;
	unanswered;
	maxVisible;
	maxHeight;
	palette;
	done;
	cancel;
	selectedIndex = 0;
	selected = /* @__PURE__ */ new Set();
	headerPage = {
		offset: 0,
		size: 1,
		maxOffset: 0
	};
	selectedBlockPage = {
		offset: 0,
		size: 1,
		maxOffset: 0
	};
	mode;
	error = "";
	input = new Input();
	options;
	focused = false;
	constructor(question, position, total, unanswered, maxVisible, maxHeight, palette, done, cancel) {
		this.question = question;
		this.position = position;
		this.total = total;
		this.unanswered = unanswered;
		this.maxVisible = maxVisible;
		this.maxHeight = maxHeight;
		this.palette = palette;
		this.done = done;
		this.cancel = cancel;
		this.options = question.options ?? [];
		this.mode = this.options.length > 0 ? "options" : "custom";
		this.input.onSubmit = (value) => {
			this.submitCustom(value);
		};
		this.input.onEscape = () => {
			if (this.options.length > 0) {
				this.mode = "options";
				this.error = "";
			} else this.cancel();
		};
	}
	invalidate() {
		this.input.invalidate();
	}
	handleInput(data) {
		this.invalidate();
		if (matchesKey(data, Key.pageUp)) {
			this.pageBackward();
			return;
		}
		if (matchesKey(data, Key.pageDown)) {
			this.pageForward();
			return;
		}
		if (this.mode === "custom") {
			this.input.focused = this.focused;
			this.input.handleInput(data);
			return;
		}
		const options = this.options;
		if (matchesKey(data, Key.up)) {
			this.selectedBlockPage = {
				offset: 0,
				size: 1,
				maxOffset: 0
			};
			this.selectedIndex = this.selectedIndex === 0 ? options.length - 1 : this.selectedIndex - 1;
		} else if (matchesKey(data, Key.down)) {
			this.selectedBlockPage = {
				offset: 0,
				size: 1,
				maxOffset: 0
			};
			this.selectedIndex = this.selectedIndex === options.length - 1 ? 0 : this.selectedIndex + 1;
		} else if (matchesKey(data, Key.space) && this.question.multiSelect) {
			if (this.selected.has(this.selectedIndex)) this.selected.delete(this.selectedIndex);
			else this.selected.add(this.selectedIndex);
		} else if (matchesKey(data, Key.enter)) {
			const selected = this.question.multiSelect ? this.selectedOptionLabels() : [options[this.selectedIndex]?.label].filter((label) => label !== void 0);
			const custom = this.question.multiSelect ? this.input.getValue().trim() : "";
			if (selected.length === 0 && custom === "") {
				this.error = "Select at least one option, or press Tab for a custom answer.";
				return;
			}
			this.done({
				selected,
				...custom === "" ? {} : { custom }
			});
		} else if (matchesKey(data, Key.tab) || data.toLowerCase() === "c") {
			this.mode = "custom";
			this.selectedBlockPage = {
				offset: 0,
				size: 1,
				maxOffset: 0
			};
			this.error = "";
		} else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) this.cancel();
	}
	submitCustom(value) {
		const custom = value.trim();
		if (custom === "") {
			this.error = "Enter an answer before submitting.";
			return;
		}
		this.done({
			selected: this.question.multiSelect ? this.selectedOptionLabels() : [],
			custom
		});
	}
	selectedOptionLabels() {
		return [...this.selected].sort((a, b) => a - b).map((index) => this.options[index]?.label).filter((label) => label !== void 0);
	}
	/** Page backward through an oversized option, then through question detail. */
	pageBackward() {
		if (this.mode === "options" && this.selectedBlockPage.offset > 0) {
			this.selectedBlockPage = {
				...this.selectedBlockPage,
				offset: Math.max(0, this.selectedBlockPage.offset - this.selectedBlockPage.size)
			};
			return;
		}
		this.headerPage = {
			...this.headerPage,
			offset: Math.max(0, this.headerPage.offset - this.headerPage.size)
		};
	}
	/** Page forward through question detail, then through an oversized option. */
	pageForward() {
		if (this.headerPage.offset < this.headerPage.maxOffset) {
			this.headerPage = {
				...this.headerPage,
				offset: Math.min(this.headerPage.maxOffset, this.headerPage.offset + this.headerPage.size)
			};
			return;
		}
		if (this.mode === "custom") return;
		this.selectedBlockPage = {
			...this.selectedBlockPage,
			offset: Math.min(this.selectedBlockPage.maxOffset, this.selectedBlockPage.offset + this.selectedBlockPage.size)
		};
	}
	render(width) {
		this.input.focused = this.focused;
		const horizontalPadding = Math.min(2, Math.max(0, Math.floor((width - 1) / 2)));
		const innerWidth = Math.max(1, width - horizontalPadding * 2);
		const header = `Question ${this.position}/${this.total} (${this.unanswered} unanswered)${this.question.header === void 0 ? "" : ` · ${displayText(this.question.header)}`}`;
		const questionLines = wrapTextWithAnsi(this.palette.text(displayText(this.question.question)), innerWidth);
		const contentLines = [...questionLines];
		const headerLines = [...wrapTextWithAnsi(this.palette.dim(header), innerWidth), ...questionLines];
		if (this.question.detail !== void 0) {
			headerLines.push("");
			contentLines.push("");
			for (const line of wrapTextWithAnsi(displayText(this.question.detail), innerWidth)) {
				headerLines.push(line);
				contentLines.push(line);
			}
		}
		headerLines.push("");
		const customControls = [
			...this.options.length > 0 && this.question.multiSelect ? [`${this.selected.size} selected`] : [],
			"Enter submit",
			this.options.length > 0 ? "Esc options" : "Esc cancel"
		];
		const customHint = this.palette.dim(customControls.join(" • "));
		const footerLines = [];
		if (this.mode === "custom") {
			for (const line of this.input.render(innerWidth)) footerLines.push(line);
			for (const line of wrapTextWithAnsi(customHint, innerWidth)) footerLines.push(line);
		} else {
			const controls = [
				"Tab custom answer",
				...this.options.length > 1 ? ["↑/↓ navigate"] : [],
				...this.question.multiSelect ? ["Space toggle"] : [],
				"Enter submit",
				"Esc interrupt"
			];
			const hint = this.palette.dim(controls.join(" • "));
			for (const line of wrapTextWithAnsi(hint, innerWidth)) footerLines.push(line);
		}
		if (this.error) for (const line of wrapTextWithAnsi(this.palette.error(this.error), innerWidth)) footerLines.push(line);
		const positionLines = this.mode === "options" && this.options.length > this.maxVisible ? [this.palette.dim(`${this.selectedIndex + 1}/${this.options.length}`)] : [];
		const paddingRows = 2;
		const maxHeight = this.maxHeight();
		const availableForOptions = Math.max(this.mode === "options" ? 4 : 1, maxHeight - paddingRows - headerLines.length - positionLines.length - footerLines.length);
		const body = [...headerLines];
		const optionLines = [];
		if (this.mode === "custom") for (const line of footerLines) body.push(line);
		else {
			const optionBlocks = this.options.map((option, index) => this.renderOptionBlock(option, index, innerWidth));
			const { visibleBlocks, hiddenBefore, hiddenAfter } = this.windowBlocks(optionBlocks, availableForOptions, innerWidth);
			if (hiddenBefore > 0) optionLines.push(this.palette.dim(`↑ ${hiddenBefore} more`));
			for (const block of visibleBlocks) for (const line of block) optionLines.push(line);
			if (hiddenAfter > 0) optionLines.push(this.palette.dim(`↓ ${hiddenAfter} more`));
			for (const line of optionLines) body.push(line);
			for (const line of positionLines) body.push(line);
			for (const line of footerLines) body.push(line);
		}
		const rows = [
			"",
			...body,
			""
		];
		let visibleRows = rows;
		if (rows.length <= maxHeight) this.headerPage = {
			offset: 0,
			size: 1,
			maxOffset: 0
		};
		if (rows.length > maxHeight && this.mode === "options" && maxHeight >= 6) {
			const headerBudget = Math.max(0, maxHeight - optionLines.length - (this.error === "" ? 1 : 2));
			const compactFooter = [...this.error === "" ? [] : [truncateToWidth(this.palette.error(`Error: ${this.error}`), innerWidth, "…")], this.compactOptionControls(innerWidth, headerBudget === 1 && contentLines.length > headerBudget)];
			visibleRows = [
				...this.compactQuestionHeader(contentLines, headerBudget, innerWidth),
				...optionLines,
				...compactFooter
			];
		} else if (rows.length > maxHeight && this.mode === "custom" && maxHeight >= 2) {
			const compactFooterSource = [
				...this.input.render(innerWidth),
				this.compactCustomControls(innerWidth),
				...this.error === "" ? [] : [truncateToWidth(this.palette.error(this.error), innerWidth, "…")]
			];
			const footerBudget = Math.max(1, maxHeight - 1);
			const compactFooter = compactFooterSource.length <= footerBudget ? compactFooterSource : footerBudget === 1 ? compactFooterSource.slice(0, 1) : [...compactFooterSource.slice(0, 1), ...compactFooterSource.slice(-(footerBudget - 1))];
			visibleRows = [...this.compactQuestionHeader(contentLines, Math.max(0, maxHeight - compactFooter.length), innerWidth), ...compactFooter];
		}
		if (visibleRows.length > maxHeight) visibleRows = maxHeight === 1 ? [this.palette.dim(`↑ ${visibleRows.length} lines hidden`)] : [this.palette.dim(`↑ ${visibleRows.length - maxHeight + 1} lines hidden`), ...visibleRows.slice(-(maxHeight - 1))];
		return visibleRows.map((line) => padRow(line, innerWidth, horizontalPadding, "…"));
	}
	/** Render one option as wrapped label and indented description lines. */
	renderOptionBlock(option, index, innerWidth) {
		const labelPrefixPlain = ` ${index === this.selectedIndex ? "›" : " "} ${`${index + 1}. `}${this.question.multiSelect ? this.selected.has(index) ? "[x] " : "[ ] " : ""}`;
		const labelPrefixWidth = visibleWidth(labelPrefixPlain);
		const labelBodyWidth = Math.max(1, innerWidth - labelPrefixWidth);
		const labelLines = wrapTextWithAnsi(displayText(option.label), labelBodyWidth);
		const continuation = " ".repeat(labelPrefixWidth);
		const lines = [];
		for (const [lineIndex, labelLine] of labelLines.entries()) {
			const composed = `${lineIndex === 0 ? labelPrefixPlain : continuation}${labelLine}`;
			lines.push(index === this.selectedIndex ? this.palette.bold(this.palette.accent(composed)) : composed);
		}
		if (option.description !== void 0) {
			const descIndent = " ".repeat(labelPrefixWidth);
			const descBodyWidth = Math.max(1, innerWidth - labelPrefixWidth);
			const descLines = wrapTextWithAnsi(displayText(option.description), descBodyWidth);
			for (const descLine of descLines) lines.push(`${descIndent}${this.palette.dim(descLine)}`);
		}
		return lines;
	}
	/** Keep the question visible when fixed chrome must be compacted. */
	compactQuestionHeader(contentLines, budget, innerWidth) {
		/* v8 ignore next 2 -- a zero budget leaves no rows for the header at all. */
		if (budget <= 0) return [];
		if (contentLines.length <= budget) {
			this.headerPage = {
				offset: 0,
				size: 1,
				maxOffset: 0
			};
			return [...contentLines];
		}
		const pageSize = Math.max(1, budget - 1);
		const maxOffset = Math.max(0, contentLines.length - pageSize);
		const offset = Math.min(this.headerPage.offset, maxOffset);
		this.headerPage = {
			offset,
			size: pageSize,
			maxOffset
		};
		const keptLines = contentLines.slice(offset, offset + pageSize);
		if (budget === 1) return [keptLines[0]];
		return [...keptLines, this.pagerStatus(offset + 1, offset + keptLines.length, contentLines.length, innerWidth)];
	}
	/** Keep Page Up / Page Down discoverable when a full pager status cannot fit. */
	pagerStatus(first, last, total, innerWidth) {
		const full = `… lines ${first}-${last}/${total} • PgUp/PgDn`;
		const compact = `PgUp/PgDn ${first}/${total}`;
		return this.palette.dim(truncateToWidth(visibleWidth(full) <= innerWidth ? full : compact, innerWidth, "…"));
	}
	/** Render custom-mode controls on one row when the header must compact. */
	compactCustomControls(innerWidth) {
		const controls = this.options.length > 0 ? "Enter submit • Esc options" : "Enter submit • Esc cancel";
		const fallback = this.options.length > 0 ? "↵ Esc options" : "Enter Esc cancel";
		const line = visibleWidth(controls) <= innerWidth ? controls : fallback;
		return this.palette.dim(truncateToWidth(line, innerWidth, "…"));
	}
	/** Render a one-row option footer that retains every mode-specific control. */
	compactOptionControls(innerWidth, showPager = false) {
		const controls = [
			...this.options.length > 1 ? ["↑/↓"] : [],
			"Tab custom",
			...this.question.multiSelect ? ["Space toggle"] : [],
			"Enter",
			"Esc interrupt",
			...showPager ? ["PgUp/PgDn"] : []
		].join(" • ");
		const optionNavigation = this.options.length > 1 ? "↑↓ " : "";
		const fallback = showPager ? `P↑↓ ${optionNavigation}Tab${this.question.multiSelect ? " S" : ""}↵Esc` : this.question.multiSelect ? `${optionNavigation}Tab Sp ↵Esc` : `${optionNavigation}Tab ↵ Esc`;
		const line = visibleWidth(controls) <= innerWidth ? controls : fallback;
		return this.palette.dim(truncateToWidth(line, innerWidth, "…"));
	}
	/**
	* Choose option blocks that fit while keeping the selected option visible.
	* Omitted blocks are counted at each end for explicit overflow markers.
	*/
	windowBlocks(blocks, budget, innerWidth) {
		if (blocks.reduce((sum, block) => sum + block.length, 0) <= budget && blocks.length <= this.maxVisible) return {
			visibleBlocks: [...blocks],
			hiddenBefore: 0,
			hiddenAfter: 0
		};
		let start = this.selectedIndex;
		let end = this.selectedIndex + 1;
		/* v8 ignore next -- selectedIndex stays inside [0, options.length). */
		let used = blocks[this.selectedIndex]?.length ?? 0;
		const markerLines = (before, after) => (before > 0 ? 1 : 0) + (after > 0 ? 1 : 0);
		const fits = (nextStart, nextEnd, nextUsed) => nextEnd - nextStart <= this.maxVisible && nextUsed + markerLines(nextStart, blocks.length - nextEnd) <= budget;
		const selectedMarkers = markerLines(start, blocks.length - end);
		if (used + selectedMarkers > budget) {
			/* v8 ignore next -- selectedIndex stays inside [0, options.length). */
			const selectedBlock = blocks[this.selectedIndex] ?? [];
			const hiddenBefore = start;
			const hiddenAfter = blocks.length - end;
			const pageSize = budget - selectedMarkers - 1;
			const maxOffset = Math.max(0, selectedBlock.length - pageSize);
			const offset = Math.min(this.selectedBlockPage.offset, maxOffset);
			this.selectedBlockPage = {
				offset,
				size: pageSize,
				maxOffset
			};
			const keptLines = selectedBlock.slice(offset, offset + pageSize);
			const first = offset + 1;
			const last = offset + keptLines.length;
			const overflow = this.pagerStatus(first, last, selectedBlock.length, innerWidth);
			return {
				visibleBlocks: [[...keptLines, overflow]],
				hiddenBefore,
				hiddenAfter
			};
		}
		this.selectedBlockPage = {
			offset: 0,
			size: 1,
			maxOffset: 0
		};
		/* v8 ignore start -- the greedy walk only declines when both sides are already tight against the budget. */
		let expanded = true;
		while (expanded && (start > 0 || end < blocks.length)) {
			expanded = false;
			if (end < blocks.length) {
				const next = blocks[end]?.length ?? 0;
				if (fits(start, end + 1, used + next)) {
					used += next;
					end += 1;
					expanded = true;
					continue;
				}
			}
			if (start > 0) {
				const previous = blocks[start - 1]?.length ?? 0;
				if (fits(start - 1, end, used + previous)) {
					used += previous;
					start -= 1;
					expanded = true;
				}
			}
		}
		/* v8 ignore stop */
		return {
			visibleBlocks: blocks.slice(start, end),
			hiddenBefore: start,
			hiddenAfter: blocks.length - end
		};
	}
};
/** One pending approval decision, rendered as a two-option modal. */
var ApprovalDialog = class {
	toolName;
	reason;
	palette;
	done;
	cancel;
	selectedIndex = 0;
	focused = false;
	constructor(toolName, reason, palette, done, cancel) {
		this.toolName = toolName;
		this.reason = reason;
		this.palette = palette;
		this.done = done;
		this.cancel = cancel;
	}
	invalidate() {}
	handleInput(data) {
		if (matchesKey(data, Key.up)) this.selectedIndex = this.selectedIndex === 0 ? 1 : 0;
		else if (matchesKey(data, Key.down)) this.selectedIndex = this.selectedIndex === 1 ? 0 : 1;
		else if (matchesKey(data, Key.enter)) this.done(this.selectedIndex === 0 ? "allowed-once" : "rejected");
		else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) this.cancel();
	}
	render(width) {
		const horizontalPadding = Math.min(2, Math.max(0, Math.floor((width - 1) / 2)));
		const innerWidth = Math.max(1, width - horizontalPadding * 2);
		const lines = ["", this.palette.bold(this.palette.accent(`Approve ${displayText(this.toolName)}?`))];
		const push = (line) => {
			lines.push(padRow(line, innerWidth, horizontalPadding, "…"));
		};
		if (this.reason !== void 0 && this.reason !== "") for (const line of wrapTextWithAnsi(displayText(this.reason), innerWidth)) lines.push(this.palette.dim(line));
		lines.push("");
		for (const [index, label] of ["Allow once", "Reject"].entries()) {
			const row = ` ${index === this.selectedIndex ? "›" : " "} ${index + 1}. ${label}`;
			push(index === this.selectedIndex ? this.palette.bold(this.palette.accent(row)) : row);
		}
		lines.push("");
		push(this.palette.dim("Enter choose • Esc withdraw"));
		return lines;
	}
};

//#endregion
//#region packages/tui/src/chat/helpers.ts
/**
* Shared collaborators for the interactive channel: compaction-checkpoint
* recognition. Additional helpers (cwd formatting, git branch, hint editor)
* join in later rounds.
* @module @deepseek-ai/dsh-tui/chat/helpers
*/
/**
* Whether an event is a landed compaction checkpoint. Recognition goes through
* {@link isCompactCheckpointSource} — the compaction seam's backend-independent
* contract for the source every backend stamps on its replacement user message —
* rather than the shape of the replacement. Other replacements (a pruned
* `tool/result`, a regenerated `assistant/message`) rewrite one node for the
* model and mark no boundary in the conversation.
* @param event - event to test.
* @returns true when the event compacted a surface range.
*/
function isCompactCheckpoint(event) {
	return event.type === "user/message" && isCompactCheckpointSource(event.data.source) && isReplacementSurfaceEvent(event);
}
/**
* Format a working directory for the prompt, abbreviating the home prefix as
* `~`.
* @param cwd - Operational working directory.
* @returns The display label.
*/
function formatCwd(cwd) {
	if (cwd === void 0) return "cwd unset";
	const home = homedir$1();
	const rel = relative(resolve(home), resolve(cwd));
	if (rel === "") return "~";
	/* v8 ignore next -- Windows cross-drive coverage; POSIX relative() cannot return an absolute path. */
	if (isAbsolute(rel)) return cwd;
	if (rel !== ".." && !rel.startsWith(`..${sep}`)) return `~${sep}${rel}`;
	return cwd;
}
/**
* Read a session-reference context card's display labels from an event source.
* @param source - event source to inspect.
* @returns per-reference labels, or `undefined` when the source is not a reference card.
*/
function sessionReferenceCard(source) {
	if (typeof source !== "object" || source === null) return void 0;
	const record = source;
	if (record["kind"] !== "session-reference" || !Array.isArray(record["references"])) return void 0;
	const references = record["references"];
	const labels = [];
	for (const reference of references) {
		if (typeof reference !== "object" || reference === null) return void 0;
		const entry = reference;
		const sessionId = entry["sessionId"];
		const label = entry["label"];
		if (typeof sessionId !== "string" || typeof label !== "string") return void 0;
		labels.push(label === sessionId ? sessionId : `${label} (${sessionId})`);
	}
	return labels;
}
/**
* Resolve the current Git branch for the prompt context line. The query runs
* off the event loop (bounded, scrubbed environment) so the mount path never
* blocks on the subprocess; the prompt fills the branch in when it resolves.
* @param cwd - Operational working directory to query.
* @returns Branch name, or `undefined` outside a worktree or on any failure.
*/
function gitBranch(cwd) {
	return new Promise((resolve) => {
		execFile("git", ["branch", "--show-current"], {
			cwd,
			encoding: "utf8",
			env: scrubbedParentEnv(),
			timeout: 1e3
		}, (error, stdout) => {
			if (error !== null) {
				resolve(void 0);
				return;
			}
			const branch = stdout.trim();
			/* v8 ignore next -- detached-HEAD behavior is exercised by the runtime smoke, not the unit checkout. */
			resolve(branch === "" ? void 0 : branch);
		});
	});
}

//#endregion
//#region packages/tui/src/chat/questions.ts
/**
* Ask-user-question sub-machine for the interactive chat channel. Registers the
* user-questions provider, presents one question overlay at a time in FIFO
* order, and settles each request on answer, abort, overlay error, or channel
* shutdown.
* @module @deepseek-ai/dsh-tui/chat/questions
*/
/**
* Build the ask-user-question queue for one chat channel.
* @param deps - channel collaborators and overlay host.
* @returns the controller used at shutdown to drain and unregister.
*/
function createQuestionQueue(deps) {
	const { ctx, resolved, palette, overlayManager } = deps;
	const questionQueue = [];
	let activeQuestion;
	const removeAbortListener = (pending) => {
		pending.request.signal?.removeEventListener("abort", pending.onAbort);
	};
	const rejectQuestion = (pending) => {
		pending.overlay?.close();
		pending.overlay = void 0;
		removeAbortListener(pending);
		pending.reject(new UserQuestionError("ask_user_question was interrupted before the user answered", "ASK_ABORTED"));
	};
	const startNextQuestion = () => {
		if (activeQuestion !== void 0 || deps.isDisposed()) return;
		const pending = questionQueue.shift();
		if (pending === void 0) return;
		activeQuestion = pending;
		const show = () => {
			const question = pending.request.questions[pending.index];
			if (question === void 0) {
				activeQuestion = void 0;
				removeAbortListener(pending);
				pending.resolve({ answers: pending.answers });
				startNextQuestion();
				return;
			}
			const session = overlayManager.open({
				...pending.request.signal === void 0 ? {} : { signal: pending.request.signal },
				create: () => new QuestionDialog(question, pending.index + 1, pending.request.questions.length, pending.request.questions.length - pending.answers.length, resolved.maxQuestionOptions, () => deps.questionMaxHeight(), palette, (selection) => {
					pending.overlay = void 0;
					session.close();
					pending.answers.push({
						id: question.id,
						...selection
					});
					pending.index += 1;
					show();
				}, () => {
					activeQuestion = void 0;
					rejectQuestion(pending);
					startNextQuestion();
				}),
				options: {
					width: resolved.questionDialogWidth,
					maxHeight: resolved.questionDialogMaxHeight
				}
			}, "inline");
			pending.overlay = session;
			/* v8 ignore start -- answer, abort, and shutdown settle the owner before this callback runs */
			session.closed.then((result) => {
				if (pending.overlay !== session) return;
				pending.overlay = void 0;
				if (result.reason !== "error") return;
				activeQuestion = void 0;
				removeAbortListener(pending);
				pending.reject(new UserQuestionError(`ask_user_question TUI failed: ${errorChain(result.error)}`, "ASK_ABORTED"));
				startNextQuestion();
			});
			/* v8 ignore stop */
			deps.requestRender();
		};
		show();
	};
	return {
		rejectAll() {
			if (activeQuestion !== void 0) {
				const pending = activeQuestion;
				activeQuestion = void 0;
				rejectQuestion(pending);
			}
			for (const pending of questionQueue.splice(0)) rejectQuestion(pending);
		},
		unregister: ctx.userQuestions.registerProvider({ ask(request) {
			return new Promise((resolveAnswer, reject) => {
				const pending = {
					request,
					index: 0,
					answers: [],
					resolve: resolveAnswer,
					reject,
					overlay: void 0,
					onAbort: () => {
						if (activeQuestion === pending) {
							activeQuestion = void 0;
							rejectQuestion(pending);
							startNextQuestion();
							return;
						}
						questionQueue.splice(questionQueue.indexOf(pending), 1);
						rejectQuestion(pending);
					}
				};
				request.signal?.addEventListener("abort", pending.onAbort, { once: true });
				questionQueue.push(pending);
				startNextQuestion();
			});
		} })
	};
}

//#endregion
//#region packages/tui/src/chat/approval.ts
/**
* Install the terminal's approval answerer as an effect-owned waterfall
* listener.
* @param deps - channel collaborators and overlay host.
* @returns the exact disposer that unregisters the answerer.
*/
function installApprovalAnswerer(deps) {
	const { ctx, agent, palette, overlayManager } = deps;
	return ctx.on("approval/request", function(req, next) {
		if (req.agent !== agent) return next();
		/* v8 ignore next -- shutdown detaches the listener before any new request can arrive. */
		if (deps.isDisposed()) return Promise.resolve("cancelled");
		return new Promise((resolve) => {
			const settle = (choice) => {
				session.close();
				resolve(choice);
			};
			let session;
			try {
				session = overlayManager.open({
					...req.signal === void 0 ? {} : { signal: req.signal },
					create: () => new ApprovalDialog(req.toolName, req.reason, palette, settle, () => {
						settle("cancelled");
					}),
					options: {
						width: 72,
						maxHeight: 20
					}
				});
			} 
			/* v8 ignore next 5 -- the disposed guard above settles the same shutting-down window */
catch {
				resolve("cancelled");
				return;
			}
			session.closed.then((result) => {
				if (result.reason === "closed") return;
				resolve("cancelled");
			});
		});
	});
}

//#endregion
//#region packages/tui/src/chat/autocomplete.ts
/** Merge path-only file candidates and optional session snapshots with commands. */
var ReferenceAutocompleteProvider = class {
	base;
	files;
	sessions;
	agent;
	constructor(base, files, sessions, agent) {
		this.base = base;
		this.files = files;
		this.sessions = sessions;
		this.agent = agent;
	}
	async getSuggestions(lines, cursorLine, cursorCol, options) {
		const basePromise = this.base.getSuggestions(lines, cursorLine, cursorCol, options);
		const currentLine = lines[cursorLine];
		/* v8 ignore next -- Editor always supplies its current state line. */
		if (currentLine === void 0) return basePromise;
		const token = activeAtToken(currentLine, cursorCol);
		if (token === void 0) {
			this.files.invalidate();
			return basePromise;
		}
		const filePromise = this.files.list(token.query, options.signal).catch(() => []);
		const sessionPromise = this.sessions === void 0 || token.quoted ? Promise.resolve([]) : this.sessions.listCandidates(this.agent, token.query, void 0, options.signal).catch(() => []);
		const [base, fileCandidates, sessionCandidates] = await Promise.all([
			basePromise,
			filePromise,
			sessionPromise
		]);
		if (options.signal.aborted) return base;
		const fileItems = fileCandidates.flatMap((candidate) => {
			const value = formatFileMention(candidate, token.quoted);
			if (value === void 0) return [];
			const name = candidate.path.slice(candidate.path.lastIndexOf("/") + 1);
			const directory = candidate.kind === "directory";
			return [{
				value,
				label: `${directory ? "Folder" : "File"} · ${displayInlineText(name)}${directory ? "/" : ""}`,
				description: displayInlineText(candidate.path)
			}];
		});
		const sessionItems = sessionCandidates.map((candidate) => {
			const mentionLabel = displayInlineText(candidate.label);
			const sessionId = displayInlineText(candidate.sessionId);
			const location = candidate.cwd === void 0 ? "(no cwd)" : displayInlineText(candidate.cwd);
			const description = `${candidate.label === candidate.sessionId ? "" : `${sessionId} · `}${location} · ${new Date(candidate.createdAt).toISOString()}`;
			return {
				value: formatSessionReferenceMention({
					sessionId: candidate.sessionId,
					label: mentionLabel
				}),
				label: `Session · ${mentionLabel}`,
				description
			};
		});
		const items = [...fileItems, ...sessionItems];
		if (items.length === 0) return base;
		return {
			items: [...items, ...base?.items ?? []],
			prefix: token.prefix
		};
	}
	applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
		return this.base.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
	}
	shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
		return this.base.shouldTriggerFileCompletion(lines, cursorLine, cursorCol);
	}
};

//#endregion
//#region packages/tui/src/chat/commands.ts
/** Image slot value for executors that admit composer images (the TUI sends none). */
const NO_COMMAND_IMAGES = Object.freeze([]);
/**
* Dispatch one slash-command line through either host-runtime signature.
*
* Executors declare their arity before any defaults, so `execute.length`
* tells the two host generations apart: pass the empty image slot only to
* the published four-argument form and keep the signal in the final
* position for both.
*/
function executeCommandLine(commands, agent, line, signal) {
	const execute = commands.execute;
	const call = execute;
	return execute.length >= 4 ? Reflect.apply(call, commands, [
		agent,
		line,
		NO_COMMAND_IMAGES,
		signal
	]) : Reflect.apply(call, commands, [
		agent,
		line,
		signal
	]);
}
/**
* The one goal status row appended when the projection changes: the durable
* phase and round counters plus the process-local activation.
* @param ctx - plugin context; optional services make the row absent.
* @param agent - exact driven agent.
* @returns the row text, or `undefined` when no goal is current.
*/
function goalStatusText(ctx, agent) {
	const goal = ctx.sessionProjections.snapshot(agent.session).values["goal"];
	if (goal === void 0 || goal === null) return void 0;
	const activation = ctx.get("goals")?.get(agent)?.activation;
	/* v8 ignore next -- goals and the goal unit compose as one package. */
	return `goal: ${goal.goal.phase} · ${goal.roundsStarted}/${goal.goal.maxGoalRounds}` + (activation === void 0 ? "" : ` · ${activation}`);
}
/**
* Build the slash-command surface for one chat channel.
* @param deps - channel collaborators.
* @returns the controller used at shutdown to dispose and to dispatch lines.
*/
function createCommandController(deps) {
	const { ctx, agent, palette } = deps;
	const controllers = /* @__PURE__ */ new Set();
	const showHelp = () => {
		const commandLines = ctx.commands.list(agent).map((command) => {
			const input = command.input === void 0 ? "" : ` ${command.input.hint}`;
			return `/${command.name}${input} — ${command.description}`;
		});
		deps.appendNotice([
			"Keyboard shortcuts",
			"Enter send • Up/Down prompt history • Esc cancel turn",
			"Ctrl+O cycle cards (collapse/expand/hide) • Ctrl+R toggle reasoning • Ctrl+C×2/Ctrl+D exit",
			"",
			...commandLines
		].join("\n"), "info");
	};
	const showPalette = () => {
		deps.appendNotice(renderPalette(palette, "dark", deps.color).join("\n"), "info");
	};
	const runDetails = (rawInput) => {
		const tokens = rawInput.trim().split(/\s+/u).filter((token) => token !== "");
		let visibility;
		let reasoning;
		for (const token of tokens) if (token === "collapsed" || token === "expanded" || token === "hidden") {
			if (visibility !== void 0) return {
				kind: "error",
				text: `Duplicate visibility "${token}". Usage: /details [collapsed|expanded|hidden] [reasoning [on|off]]`
			};
			visibility = token;
		} else if (token === "reasoning") {
			if (reasoning !== void 0) return {
				kind: "error",
				text: "Duplicate reasoning keyword. Usage: /details [collapsed|expanded|hidden] [reasoning [on|off]]"
			};
			reasoning = true;
		} else if (token === "on" || token === "off") {
			if (reasoning === void 0) return {
				kind: "error",
				text: `Reasoning state "${token}" requires the reasoning keyword. Usage: /details [collapsed|expanded|hidden] [reasoning [on|off]]`
			};
			reasoning = token === "on";
		} else return {
			kind: "error",
			text: `Unknown /details argument "${token}". Usage: /details [collapsed|expanded|hidden] [reasoning [on|off]]`
		};
		if (reasoning !== void 0) deps.setShowReasoning(reasoning);
		if (visibility !== void 0) deps.setToolsVisibility(visibility);
		return { kind: "success" };
	};
	const refreshAutocomplete = () => {
		const base = new CombinedAutocompleteProvider(ctx.commands.list(agent).map((command) => ({
			name: command.name,
			description: command.description,
			...command.input === void 0 ? {} : { argumentHint: command.input.hint }
		})), deps.cwd, null);
		deps.editor.setAutocompleteProvider(new ReferenceAutocompleteProvider(base, deps.fileSearch, deps.referenceResolver, agent));
	};
	const disposeCommandChanges = ctx.on("commands/change", refreshAutocomplete);
	refreshAutocomplete();
	const commandFiber = agent.ctx.inject(["commands"], (commandCtx) => {
		commandCtx.commands.register({
			name: "help",
			description: "Show keyboard shortcuts and commands",
			handler: () => {
				showHelp();
				return { kind: "success" };
			}
		});
		commandCtx.commands.register({
			name: "model",
			description: "Show this session's model route; select with /model [provider/]model",
			input: { hint: "[provider/]model" },
			handler: ({ rawInput }) => {
				deps.queueModelCommand(rawInput);
				return { kind: "success" };
			}
		});
		commandCtx.commands.register({
			name: "preset",
			description: "Show this session's agent preset; switch with /preset [id] (blank sessions only)",
			input: { hint: "[id]" },
			handler: ({ rawInput }) => {
				deps.queuePresetCommand(rawInput);
				return { kind: "success" };
			}
		});
		commandCtx.commands.register({
			name: "more",
			description: "Load earlier transcript history",
			handler: () => {
				if (!deps.loadHistory()) deps.appendNotice("Already at the beginning of the transcript.", "info");
				return { kind: "success" };
			}
		});
		commandCtx.commands.register({
			name: "clear",
			description: "Clear the transcript view (session history is unchanged)",
			handler: () => {
				deps.clearChat();
				deps.requestRender();
				return { kind: "success" };
			}
		});
		commandCtx.commands.register({
			name: "details",
			description: "Select tool-card visibility and reasoning display",
			input: { hint: "[collapsed|expanded|hidden] [reasoning [on|off]]" },
			handler: ({ rawInput }) => runDetails(rawInput)
		});
		commandCtx.commands.register({
			name: "palette",
			description: "Show every color and attribute role this terminal renders",
			handler: () => {
				showPalette();
				return { kind: "success" };
			}
		});
		commandCtx.commands.register({
			name: "resume",
			description: "Open the resumable-sessions picker",
			handler: () => {
				deps.showResume();
				return { kind: "success" };
			}
		});
		commandCtx.commands.register({
			name: "status",
			description: "Show the session-status diagnostic card",
			handler: () => {
				deps.showStatusCard();
				return { kind: "success" };
			}
		});
		const exitHandler = () => {
			deps.requestExit();
			return { kind: "success" };
		};
		commandCtx.commands.register({
			name: "exit",
			description: "Exit after the active turn reaches idle",
			handler: exitHandler
		});
		commandCtx.commands.register({
			name: "quit",
			description: "Exit after the active turn reaches idle",
			handler: exitHandler
		});
	});
	const runCommand = (text) => {
		if (!text.startsWith("/")) return false;
		const controller = new AbortController();
		controllers.add(controller);
		executeCommandLine(ctx.commands, agent, text, controller.signal).then((execution) => {
			/* v8 ignore next -- a settled execution implies the channel survived. */
			if (deps.isDisposed()) return;
			if (execution === void 0) deps.appendNotice(`Unknown command: ${text}`, "warning");
			else if (execution.result.text !== void 0 && execution.result.text !== "") deps.appendNotice(execution.result.text, execution.result.kind === "error" ? "error" : "info");
		}, (error) => {
			/* v8 ignore next -- handler failures are contained per command */
			if (!deps.isDisposed()) deps.appendNotice(`Command failed: ${errorChain(error)}`, "error");
		}).finally(() => {
			controllers.delete(controller);
		});
		return true;
	};
	return {
		runCommand,
		dispose: async () => {
			for (const controller of controllers) controller.abort(/* @__PURE__ */ new Error("TUI disposed"));
			controllers.clear();
			disposeCommandChanges();
			await commandFiber.dispose();
		}
	};
}

//#endregion
//#region packages/tui/src/chat/model-command.ts
/**
* Build the model-selection controller for one chat channel.
* @param deps - channel collaborators and shared selected-model handle.
* @returns the controller wired to the channel's overlay and status views.
*/
function createModelController(deps) {
	const { ctx, resolved, palette, overlayManager, selection } = deps;
	let contextWindow;
	let contextResolution;
	let modelOverlay;
	let modelCommands = Promise.resolve();
	let awaitingAdapter = false;
	const resolveContextWindow = (selected) => {
		contextWindow = void 0;
		awaitingAdapter = false;
		const resolution = selected === void 0 ? Promise.resolve({
			kind: "resolved",
			contextWindow: void 0
		}) : ctx.llm.resolveModelInfo(selected.provider, selected.model).then((info) => ({
			kind: "resolved",
			contextWindow: info.context?.contextWindow
		}), (error) => ({
			kind: "error",
			error
		}));
		contextResolution = resolution;
		resolution.then((result) => {
			/* v8 ignore next -- resolutions settle in submission order */
			if (contextResolution !== resolution) return;
			if (result.kind === "error") {
				/* v8 ignore start -- unset selections resolve without querying the catalog */
				if (selected !== void 0 && result.error instanceof LlmError && result.error.code === "NO_ADAPTER") {
					awaitingAdapter = true;
					return;
				}
				/* v8 ignore stop */
				deps.appendNotice(`Could not resolve model context: ${errorChain(result.error)}`, "error");
				return;
			}
			contextWindow = result.contextWindow;
			deps.requestRender();
		});
	};
	const disposeAdapterListener = ctx.on("llm/adapters-updated", () => {
		if (deps.isDisposed() || !awaitingAdapter) return;
		resolveContextWindow(selection.current);
	});
	resolveContextWindow(selection.current);
	const selectModel = (selected, explicitReasoning) => {
		const sameRoute = selection.current?.provider === selected.provider && selection.current.model === selected.model;
		const reasoningEffort = explicitReasoning === void 0 ? sameRoute ? selection.current?.reasoningEffort ?? selected.reasoning?.defaultEffort : selected.reasoning?.defaultEffort : explicitReasoning.effort;
		if (sameRoute && selection.current?.reasoningEffort === reasoningEffort) {
			const reasoning = targetReasoningLabel(selected, reasoningEffort);
			deps.appendNotice(`Model is already ${targetLabel(selected)}${reasoning === void 0 ? "" : ` with reasoning effort ${displayText(reasoning)}`}.`);
			return;
		}
		selection.current = {
			provider: selected.provider,
			model: selected.model,
			...reasoningEffort === void 0 ? {} : { reasoningEffort }
		};
		resolveContextWindow(selection.current);
		const defaultModel = ctx.get?.("agentDefaultModel");
		if (defaultModel !== void 0) defaultModel.saveSelection(selection.current).catch((error) => {
			ctx.logger.warn(`tui: model selection changed but the default was not saved: ${errorChain(error)}`);
		});
		const reasoning = targetReasoningLabel(selected, reasoningEffort);
		deps.appendNotice([
			`Model selected: ${targetLabel(selected)}.`,
			...reasoning === void 0 ? [] : [`Reasoning effort: ${displayText(reasoning)}.`],
			"New steps will use it."
		].join(" "));
	};
	const showModelSelector = (choices) => {
		const current = selection.current === void 0 ? "unset" : targetLabel(selection.current);
		if (choices.length === 0) {
			deps.appendNotice(`Current model: ${current}\nNo models are advertised by registered providers.`, "warning");
			return;
		}
		modelOverlay?.close();
		const session = overlayManager.open({
			create: () => new ModelDialog(choices, selection.current, resolved.maxModelOptions, palette, (selectionResult) => {
				session.close();
				selectModel(selectionResult.choice, { effort: selectionResult.reasoningEffort });
			}, () => {
				session.close();
			}),
			options: {
				width: resolved.modelDialogWidth,
				maxHeight: resolved.modelDialogMaxHeight,
				anchor: "center",
				margin: 1
			}
		});
		modelOverlay = session;
		session.closed.then(() => {
			if (modelOverlay === session) modelOverlay = void 0;
		});
		deps.requestRender();
	};
	const handleModelCommand = async (raw) => {
		const choices = await readModelChoices(ctx, selection.current);
		if (deps.isDisposed()) return;
		const argument = raw.trim();
		if (argument === "") {
			showModelSelector(choices);
			return;
		}
		const parts = argument.split(/\s+/u);
		if (parts.length > 2) {
			deps.appendNotice("Usage: /model [provider/]model", "warning");
			return;
		}
		let matches;
		if (parts.length === 2) matches = choices.filter((choice) => choice.provider === parts[0] && choice.model === parts[1]);
		else {
			const value = argument;
			const qualified = choices.filter((choice) => targetLabel(choice) === value);
			matches = qualified.length > 0 ? qualified : choices.filter((choice) => choice.model === value);
		}
		if (matches.length === 0) {
			deps.appendNotice(`Unknown model: ${argument}. Run /model to list available models.`, "warning");
			return;
		}
		if (matches.length > 1) {
			deps.appendNotice(`Model "${argument}" is advertised by multiple providers; use /model <provider>/<model>.`, "warning");
			return;
		}
		const selected = matches[0];
		/* v8 ignore next -- a non-empty matches array always has index zero. */
		if (selected === void 0) return;
		selectModel(selected);
	};
	return {
		contextWindow: () => contextWindow,
		queueModelCommand(raw) {
			modelCommands = modelCommands.then(async () => {
				await handleModelCommand(raw);
			}).catch((error) => {
				if (!deps.isDisposed()) deps.appendNotice(`Could not read the model catalog: ${errorChain(error)}`, "error");
			});
		},
		resetContextResolution() {
			contextResolution = void 0;
		},
		clearOverlay() {
			modelOverlay = void 0;
		},
		detach() {
			disposeAdapterListener();
		}
	};
}

//#endregion
//#region packages/tui/src/chat/presets.ts
/** Map one roster entry to the selector row it presents. */
function toPresetChoice(preset) {
	return {
		id: preset.id,
		label: preset.name ?? preset.id,
		trust: preset.trust,
		...preset.description === void 0 ? {} : { description: preset.description },
		...preset.broken === void 0 ? {} : { broken: preset.broken }
	};
}
/**
* Build the preset-selection controller for one chat channel.
* @param deps - channel collaborators.
* @returns the controller wired to the channel's overlay and the roster service.
*/
function createPresetController(deps) {
	const { ctx, agent, palette, resolved, overlayManager } = deps;
	let presetOverlay;
	let presetCommands = Promise.resolve();
	const isBlank = () => !agent.session.events.some((event) => event.type === "turn/start");
	const selectPreset = async (id) => {
		const presets = ctx.get("agentPresets");
		if (presets === void 0) {
			deps.appendNotice("This deployment composes no agent presets.", "warning");
			return;
		}
		if (!isBlank()) {
			deps.appendNotice("Preset locked: this session has already started. Exit and start a new session to switch presets.", "warning");
			return;
		}
		try {
			const preset = await presets.recompose(agent.ctx, id);
			agent.session.append("agent-preset/selected", { agentPreset: preset.id });
			deps.appendNotice(`Agent preset set to ${preset.id}.`);
			deps.requestRender();
		} catch (error) {
			deps.appendNotice(`Could not switch agent preset: ${errorChain(error)}`, "error");
		}
	};
	const showPicker = async () => {
		const presets = ctx.get("agentPresets");
		if (presets === void 0) {
			deps.appendNotice("This deployment composes no agent presets.", "warning");
			return;
		}
		const list = await presets.list();
		if (deps.isDisposed()) return;
		if (list.length === 0) {
			deps.appendNotice("No agent presets are composed by any roster root.", "warning");
			return;
		}
		const current = presets.composedPreset(agent.ctx);
		const choices = list.map(toPresetChoice);
		presetOverlay?.close();
		const session = overlayManager.open({
			create: () => new PresetDialog(choices, current, resolved.maxModelOptions, palette, (id) => {
				session.close();
				selectPreset(id);
			}, () => {
				session.close();
			}),
			options: {
				width: resolved.modelDialogWidth,
				maxHeight: resolved.modelDialogMaxHeight,
				anchor: "center",
				margin: 1
			}
		});
		presetOverlay = session;
		session.closed.then(() => {
			if (presetOverlay === session) presetOverlay = void 0;
		});
		deps.requestRender();
	};
	return {
		queuePresetCommand(raw) {
			presetCommands = presetCommands.then(async () => {
				const argument = raw.trim();
				if (argument === "") await showPicker();
				else await selectPreset(argument);
			}).catch((error) => {
				if (!deps.isDisposed()) deps.appendNotice(`Could not read the preset roster: ${errorChain(error)}`, "error");
			});
		},
		clearOverlay() {
			presetOverlay = void 0;
		}
	};
}
/**
* The preset a session actually runs: the newest `agent-preset/selected`
* event wins over the creation header, so a session that switched while blank
* resumes under the composition its history was produced with.
* @param agent - exact driven agent.
* @returns the preset id, or `undefined` when the session records none.
*/
function sessionPreset(agent) {
	return resolveSessionPreset({
		header: agent.session.header,
		events: agent.session.events
	});
}

//#endregion
//#region packages/tui/src/chat/resume.ts
/**
* Session-resume sub-controller for the interactive chat channel: the
* `/resume` selector, one metadata-plus-title scan that tolerates a corrupt
* neighbor, the pre-handoff preflight, and the terminal handoff itself.
* @module @deepseek-ai/dsh-tui/chat/resume
*/
/**
* Build the session-resume controller for one chat channel.
* @param deps - channel collaborators, terminal handles, and optional services.
* @returns the controller wired to the `/resume` command.
*/
function createResumeController(deps) {
	const { ctx, agent, runtime, resolved, palette, overlayManager, sessionQuery } = deps;
	let resumeOverlay;
	let resumeInFlight = false;
	let resumeScan = 0;
	/** Label any session's own workspace the way the prompt labels the current one. */
	const workspaceLabel = (cwd) => runtime.formatCwd?.(cwd) ?? formatCwd(cwd);
	/** Summarize one record from metadata and its batch-folded title. */
	const summarize = (record, title, lastActivityAt) => summarizeResumeCandidate(record, title, lastActivityAt, agent.session.id, agent.session.header.cwd, workspaceLabel);
	/** The disabled fallback row for a session whose title read failed. */
	const unreadableCandidate = (record, lastActivityAt, error) => ({
		record,
		title: "Unreadable session",
		lastActivityAt: lastActivityAt ?? record.header.createdAt,
		currentWorkspace: record.header.cwd === agent.session.header.cwd,
		workspaceLabel: workspaceLabel(record.header.cwd),
		disabledReason: `session cannot be loaded: ${errorChain(error)}`
	});
	/**
	* Metadata-only activity time: a live session's last in-memory event time,
	* otherwise the persisted artifact's mtime. Never reads a log, so browsing
	* cost stays independent of log size; any append (including bookkeeping)
	* moves it.
	*/
	const lastActivityAt = async (record) => {
		const live = ctx.sessions.get(record.header.id);
		if (live !== void 0) return live.events.at(-1)?.time;
		const location = ctx.get("sessionPersistence")?.locate(record.header);
		if (location === void 0) return void 0;
		try {
			return (await stat(location.path)).mtimeMs;
		} catch {
			return;
		}
	};
	/**
	* One persisted row's title through the projection-cache ladder: the
	* zero-I/O checkpoint row when usable, otherwise a cold read that folds
	* only the log tail since the checkpoint and writes the refreshed row
	* back — so a store scanned once serves later scans without log reads.
	*/
	const projectedTitle = async (cache, record, signal) => {
		const live = ctx.sessions.get(record.header.id);
		if (live !== void 0) return ctx.get("sessionProjections")?.snapshot(live).values.title;
		const cached = cache.cachedSnapshot(record.header);
		if (cached !== void 0 && "title" in cached.values) return cached.values.title;
		return (await cache.coldSnapshot(record.header.id, signal)).values.title;
	};
	/**
	* Resolve every row's title without reading whole logs when the projection
	* cache is mounted (live registry snapshot / checkpoint row / tail-only
	* cold read, bounded by `resumeScanConcurrency`); a composition without
	* the cache falls back to one bounded raw-log title batch.
	*/
	const resolveTitles = async (listQuery, records, signal) => {
		const cache = ctx.get("sessionProjectionCache");
		if (cache === void 0) {
			const results = await listQuery.readTitleSnapshots(records.map((record) => record.header.id), signal);
			return records.map((record, index) => {
				const result = results[index];
				/* v8 ignore next -- readTitleSnapshots returns one result per unique listed id in input order */
				if (result === void 0 || result.sessionId !== record.header.id) throw new Error(`resume scan misaligned at "${record.header.id}"`);
				if (result.status === "rejected") return { failure: result.reason };
				const title = result.value.title?.title;
				return title === void 0 ? {} : { title };
			});
		}
		const resolutions = new Array(records.length);
		let cursor = 0;
		const worker = async () => {
			for (;;) {
				const index = cursor;
				if (index >= records.length) return;
				cursor += 1;
				const record = records[index];
				try {
					const value = await projectedTitle(cache, record, signal);
					resolutions[index] = typeof value === "string" ? { title: value } : {};
				} catch (failure) {
					resolutions[index] = { failure };
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(resolved.resumeScanConcurrency, records.length) }, () => worker()));
		return resolutions;
	};
	/** The latest logged provider/model route, for the preflight availability check. */
	const resumeRoute = (events) => {
		const header = events.findLast((item) => item.type === "request/header");
		if (header?.type === "request/header") return {
			provider: header.data.header.config.provider,
			model: header.data.header.config.model
		};
		const assistant = events.findLast((item) => item.type === "assistant/message");
		return assistant?.type === "assistant/message" ? {
			provider: assistant.data.message.source.provider,
			model: assistant.data.message.source.model
		} : void 0;
	};
	/**
	* Re-read every mutable precondition immediately before terminal handoff and
	* resolve the exact identity and workspace the host will re-exec into. This
	* is where the one chosen log is fully read, replay-validated, and checked
	* for a currently-available route — the listing never does any of that.
	*/
	const preflightResume = async (sessionId) => {
		const query = sessionQuery();
		/* v8 ignore start -- showResume alone calls this after proving the optional service exists */
		if (query === void 0) throw new Error("Resume is unavailable: session query is not mounted.");
		/* v8 ignore stop */
		const initialStatus = agent.status;
		if (initialStatus !== "idle") throw new Error(`Resume requires an idle agent (status: ${initialStatus}).`);
		const record = (await query.listSessions()).find((candidate) => candidate.header.id === sessionId);
		if (record === void 0) throw new Error(`Session "${sessionId}" is no longer available.`);
		const candidate = summarize(record, void 0, void 0);
		/* v8 ignore next -- the picker blocks disabled rows before preflight */
		if (candidate.disabledReason !== void 0) throw new Error(candidate.disabledReason);
		let events;
		try {
			events = (await query.readSession(record.header.id)).events;
		} catch (error) {
			throw new Error(`session cannot be loaded: ${errorChain(error)}`);
		}
		const route = resumeRoute(events);
		if (route !== void 0 && !ctx.llm.listProviders().some((provider) => provider.id === route.provider)) throw new Error(`session is complete, but route is currently unavailable (${route.provider}/${route.model})`);
		const cwd = record.header.cwd;
		/* v8 ignore next -- summarizeResumeCandidate disables a cwd-less record, so the check above already rejected it */
		if (cwd === void 0) throw new Error(`Session "${sessionId}" has no recorded workspace to resume in.`);
		const finalStatus = agent.status;
		/* v8 ignore next -- the initial idle check runs immediately above */
		if (finalStatus !== "idle") throw new Error(`Resume requires an idle agent (status: ${finalStatus}).`);
		return {
			id: record.header.id,
			cwd
		};
	};
	const handoffResume = async (candidate, overlay) => {
		if (resumeInFlight) return;
		resumeInFlight = true;
		let terminalReleased = false;
		try {
			const checked = await preflightResume(candidate.record.header.id);
			const hostHandoff = runtime.handoffResume;
			if (hostHandoff === void 0) {
				await overlay.close();
				resumeOverlay = void 0;
				deps.appendNotice("Session is resumable, but this host cannot hand it off in place.", "warning");
				return;
			}
			/* v8 ignore next -- shutdown during preflight invalidates an awaited service read or reaches this guard */
			if (deps.isDisposed()) return;
			await ctx.sessions.flush(agent.session);
			/* v8 ignore next -- shutdown during the flush reaches this guard; the overlay holds input until close() */
			if (deps.isDisposed()) return;
			/* v8 ignore next -- preflight re-reads idle and the overlay blocks input until close() */
			if (agent.status !== "idle") throw new Error(`Resume requires an idle agent (status: ${agent.status}).`);
			await overlay.close();
			resumeOverlay = void 0;
			await deps.releaseTerminal();
			terminalReleased = true;
			await hostHandoff(checked.id, checked.cwd);
			throw new Error("resume host returned without replacing the process");
		} catch (error) {
			/* v8 ignore next -- shutdown during the handoff is covered by owner teardown */
			if (!deps.isDisposed()) {
				if (terminalReleased) {
					deps.reacquireTerminal();
					deps.appendNotice(`Resume handoff failed: ${errorChain(error)}`, "error");
				} else {
					await overlay.close();
					resumeOverlay = void 0;
					deps.appendNotice(`Resume failed: ${errorChain(error)}`, "error");
				}
			}
		} finally {
			resumeInFlight = false;
		}
	};
	return { showResume() {
		if (agent.status !== "idle") {
			deps.appendNotice("Resume requires the current turn to finish or be cancelled first.", "warning");
			return;
		}
		const listQuery = sessionQuery();
		if (listQuery === void 0) {
			deps.appendNotice("Resume is not available: session query is not mounted.", "warning");
			return;
		}
		const scan = ++resumeScan;
		resumeOverlay?.close();
		let picker;
		let scanned;
		const session = overlayManager.open({
			create: (host) => {
				picker = new ResumePicker(scanned, resolved.maxResumeOptions, workspaceLabel(agent.session.header.cwd), () => host.viewport.rows, palette, (candidate) => {
					handoffResume(candidate, session);
				}, () => {
					session.close();
				});
				return picker;
			},
			options: {
				width: "100%",
				maxHeight: "100%",
				anchor: "top-left",
				margin: 0
			}
		});
		resumeOverlay = session;
		const scanAbort = new AbortController();
		session.closed.then(() => {
			scanAbort.abort();
			/* v8 ignore next -- overlay FIFO closes this session before a replacement can become the tracked resume overlay */
			if (resumeOverlay === session) resumeOverlay = void 0;
		});
		deps.requestRender();
		/** Whether this scan's overlay, session generation, or TUI is gone. */
		const scanStale = () => deps.isDisposed() || scan !== resumeScan || scanAbort.signal.aborted;
		const scanCandidates = async () => {
			const records = await listQuery.listSessions(scanAbort.signal);
			if (scanStale()) return;
			const [titles, activity] = await Promise.all([resolveTitles(listQuery, records, scanAbort.signal), Promise.all(records.map((record) => lastActivityAt(record)))]);
			const candidates = records.map((record, index) => {
				const resolution = titles[index];
				return "failure" in resolution ? unreadableCandidate(record, activity[index], resolution.failure) : summarize(record, resolution.title, activity[index]);
			});
			candidates.sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.record.header.id.localeCompare(b.record.header.id));
			/* v8 ignore next -- covered behaviorally by the in-flight cancel test */
			if (scanStale()) return;
			scanned = candidates;
			picker?.setCandidates(candidates);
			deps.requestRender();
		};
		scanCandidates().catch((error) => {
			if (scanStale()) return;
			session.close();
			deps.appendNotice(`Resume session scan failed: ${errorChain(error)}`, "error");
		});
	} };
}

//#endregion
//#region packages/tui/src/chat/tokens.ts
/**
* Fold one step's usage into the running totals, replacing any prior usage
* logged for the same turn/step.
* @param totals - Running totals mutated in place.
* @param turn - Turn index of the usage.
* @param step - Step index of the usage.
* @param usage - The step's token usage.
*/
function recordTokenUsage(totals, turn, step, usage) {
	const key = `${turn}:${step}`;
	const previous = totals.byStep.get(key);
	if (previous !== void 0) {
		totals.input -= previous.inputTokens;
		totals.output -= previous.outputTokens;
		totals.cacheRead -= previous.cacheReadTokens ?? 0;
		totals.cacheWrite -= previous.cacheWriteTokens ?? 0;
	}
	totals.byStep.set(key, usage);
	totals.input += usage.inputTokens;
	totals.output += usage.outputTokens;
	totals.cacheRead += usage.cacheReadTokens ?? 0;
	totals.cacheWrite += usage.cacheWriteTokens ?? 0;
}
/**
* Fold a usage-bearing session event into the running totals.
* @param totals - Running totals mutated in place.
* @param event - Session event; ignored when it carries no usage.
*/
function recordEventUsage(totals, event) {
	if (event.type === "assistant/chunk" && event.data.chunk.type === "usage") recordTokenUsage(totals, event.data.turn, event.data.step, event.data.chunk.usage);
	else if (event.type === "assistant/message" && event.data.usage !== void 0) recordTokenUsage(totals, event.data.turn, event.data.step, event.data.usage);
}
/**
* Share of billed input (prompt) tokens served from the provider cache, as an
* integer percent, or `undefined` before any input is billed (avoids 0/0 and a
* meaningless rate on an empty session).
* @param totals - Running totals to measure.
* @returns The cache hit rate percent, or `undefined` when no input is billed.
*/
function cacheHitRate(totals) {
	const billedInput = totals.input + totals.cacheRead + totals.cacheWrite;
	if (billedInput === 0) return void 0;
	return Math.round(totals.cacheRead / billedInput * 100);
}
/**
* Fold every usage-bearing event in a session into fresh totals.
* @param session - Session whose events supply usage.
* @returns The accumulated token totals.
*/
function sessionTokens(session) {
	const totals = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		byStep: /* @__PURE__ */ new Map()
	};
	for (const event of session.events) recordEventUsage(totals, event);
	return totals;
}
/**
* Format a token count with a compact k/m suffix for the footer.
* @param value - Token count.
* @returns The compact display string.
*/
function formatTokens(value) {
	if (value < 1e3) return String(value);
	if (value < 1e4) return `${(value / 1e3).toFixed(1)}k`;
	if (value < 1e6) return `${Math.round(value / 1e3)}k`;
	return `${(value / 1e6).toFixed(1)}m`;
}

//#endregion
//#region packages/tui/src/extension-service.ts
/**
* The public extension-overlay service one mounted TUI provides, and its
* concrete fiber-bound implementation.
*
* The abstract contract keeps pi-tui, focus, and terminal lifecycle state
* private to the manager; plugins receive only effect-owned overlay sessions.
* @module @deepseek-ai/dsh-tui/extension-service
*/
/** Public terminal-local interaction service provided by one mounted TUI. */
var TuiExtensionService = class extends Service {};
/** Cordis service whose method effects bind to the calling plugin fiber. */
var TuiExtensionServiceImpl = class extends Service {
	agent;
	overlays;
	constructor(ctx, agent, overlays) {
		super(ctx, "tui");
		this.agent = agent;
		this.overlays = overlays;
	}
	/** @inheritdoc */
	openOverlay(request) {
		let operation;
		const disposeOwner = this.ctx.effect(() => () => operation?.closeWith("owner-disposed"), "tui.openOverlay()");
		try {
			operation = this.overlays.open(request);
		} catch (error) {
			disposeOwner();
			throw error;
		}
		operation.closed.then(() => {
			disposeOwner();
		});
		return operation;
	}
};

//#endregion
//#region packages/tui/src/extension/overlay-manager.ts
/** Turn a close reason into its immutable public outcome. */
function outcome(reason) {
	return Object.freeze({ reason });
}
/** Retain only supported layout fields before a queued request returns to its caller. */
function retainOptions(options) {
	return Object.freeze({
		...options.width === void 0 ? {} : { width: options.width },
		...options.minWidth === void 0 ? {} : { minWidth: options.minWidth },
		...options.maxHeight === void 0 ? {} : { maxHeight: options.maxHeight },
		...options.anchor === void 0 ? {} : { anchor: options.anchor },
		...options.margin === void 0 ? {} : { margin: typeof options.margin === "object" ? Object.freeze({ ...options.margin }) : options.margin }
	});
}
/** Guard plugin component methods while preserving focus and key-release state. */
var GuardedOverlayComponent = class {
	component;
	fail;
	constructor(component, fail) {
		this.component = component;
		this.fail = fail;
	}
	get focused() {
		try {
			return this.component.focused ?? false;
		} catch (error) {
			this.fail(error);
			return false;
		}
	}
	set focused(value) {
		try {
			if ("focused" in this.component) this.component.focused = value;
		} catch (error) {
			this.fail(error);
		}
	}
	get wantsKeyRelease() {
		try {
			return this.component.wantsKeyRelease ?? false;
		} catch (error) {
			this.fail(error);
			return false;
		}
	}
	render(width) {
		try {
			return this.component.render(width);
		} catch (error) {
			this.fail(error);
			return [];
		}
	}
	handleInput(data) {
		try {
			this.component.handleInput?.(data);
		} catch (error) {
			this.fail(error);
		}
	}
	invalidate() {
		try {
			this.component.invalidate();
			return true;
		} catch (error) {
			this.fail(error);
			return false;
		}
	}
};
/** FIFO modal owner for one mounted TUI. */
var TuiOverlayManager = class {
	driver;
	queue = [];
	active;
	accepting = true;
	disposeTask;
	constructor(driver) {
		this.driver = driver;
	}
	/**
	* Whether one extension or built-in overlay currently owns terminal focus.
	* @returns `true` while an overlay is active.
	*/
	hasActiveOverlay() {
		return this.active !== void 0;
	}
	/** Reject new work while the TUI unloads dependent extension fibers. */
	beginShutdown() {
		this.accepting = false;
	}
	/**
	* Queue one modal without assigning Cordis ownership.
	* @param request - component factory, constraints, and request signal.
	* @param placement - terminal overlay for extensions, or inline for the built-in question panel.
	* @returns an internal session that can close with an ownership reason.
	*/
	open(request, placement = "overlay") {
		if (!this.accepting) throw new Error("TUI is shutting down");
		const requestSignal = request.signal;
		const retainedRequest = Object.freeze({
			create: request.create,
			...request.options === void 0 ? {} : { options: retainOptions(request.options) },
			...requestSignal === void 0 ? {} : { signal: requestSignal }
		});
		const controller = new AbortController();
		const signal = requestSignal === void 0 ? controller.signal : AbortSignal.any([requestSignal, controller.signal]);
		const deferred = Promise.withResolvers();
		const session = {
			get state() {
				return entry.state;
			},
			closed: deferred.promise,
			close: () => this.close(entry, outcome("closed")),
			closeWith: (reason) => this.close(entry, outcome(reason))
		};
		const entry = {
			request: retainedRequest,
			controller,
			signal,
			closed: deferred.promise,
			resolveClosed: deferred.resolve,
			session,
			placement,
			state: "queued"
		};
		if (requestSignal?.aborted === true) {
			this.close(entry, outcome("aborted"));
			return session;
		}
		if (requestSignal !== void 0) {
			const onAbort = () => {
				this.close(entry, outcome("aborted"));
			};
			requestSignal.addEventListener("abort", onAbort, { once: true });
			entry.removeRequestAbort = () => {
				requestSignal.removeEventListener("abort", onAbort);
			};
		}
		this.queue.push(entry);
		this.activateNext();
		return session;
	}
	/** Stop accepting work and settle every active or queued overlay. */
	dispose() {
		if (this.disposeTask !== void 0) return this.disposeTask;
		this.beginShutdown();
		const entries = [...this.active === void 0 ? [] : [this.active], ...this.queue];
		return this.disposeTask = Promise.all(entries.map((entry) => this.close(entry, outcome("tui-disposed")))).then(() => {});
	}
	activateNext() {
		if (!this.accepting || this.active !== void 0) return;
		const entry = this.queue.shift();
		if (entry === void 0) return;
		this.active = entry;
		entry.state = "active";
		const host = this.host(entry);
		let component;
		try {
			component = entry.request.create(host);
		} catch (error) {
			this.fail(entry, error);
			return;
		}
		if (this.active !== entry) return;
		const guarded = new GuardedOverlayComponent(component, (error) => {
			this.fail(entry, error);
		});
		entry.component = guarded;
		try {
			const handle = this.driver.show(guarded, entry.request.options, entry.placement);
			if (this.active !== entry) {
				this.hide(handle);
				return;
			}
			entry.handle = handle;
			this.driver.invalidate();
		} catch (error) {
			this.fail(entry, error);
		}
	}
	host(entry) {
		const driver = this.driver;
		return Object.freeze({
			get signal() {
				return entry.signal;
			},
			get viewport() {
				return Object.freeze({ ...driver.viewport() });
			},
			get theme() {
				return driver.theme();
			},
			display: (value) => this.driver.display(value),
			invalidate: () => {
				if (this.active !== entry || entry.component === void 0 || entry.failing === true) return;
				if (!entry.component.invalidate() || this.active !== entry) return;
				try {
					this.driver.invalidate();
				} catch (error) {
					this.fail(entry, error);
				}
			},
			close: () => {
				this.close(entry, outcome("closed"));
			}
		});
	}
	fail(entry, error) {
		if (entry.state === "closed" || entry.failing === true) return;
		entry.failing = true;
		this.report(error);
		queueMicrotask(() => {
			this.close(entry, Object.freeze({
				reason: "error",
				error
			}));
		});
	}
	report(error) {
		try {
			this.driver.reportError(error);
		} catch {}
	}
	hide(handle) {
		try {
			handle.hide();
		} catch (error) {
			this.report(error);
		}
	}
	close(entry, result) {
		if (entry.outcome !== void 0) return entry.closed;
		entry.outcome = result;
		entry.state = "closed";
		entry.removeRequestAbort?.();
		delete entry.removeRequestAbort;
		if (!entry.controller.signal.aborted) entry.controller.abort(result);
		const queuedIndex = this.queue.indexOf(entry);
		if (queuedIndex >= 0) this.queue.splice(queuedIndex, 1);
		if (this.active === entry) {
			this.active = void 0;
			if (entry.handle !== void 0) this.hide(entry.handle);
			delete entry.handle;
		}
		delete entry.component;
		entry.resolveClosed(result);
		try {
			this.driver.invalidate();
		} catch (error) {
			this.report(error);
		}
		queueMicrotask(() => {
			this.activateNext();
		});
		return entry.closed;
	}
};

//#endregion
//#region packages/tui/src/runtime.ts
/** Service provided by the tui bundle's startup row and consumed by the tui row's lazy config. */
const TUI_STARTUP_SERVICE = "tuiStartup";

//#endregion
//#region packages/tui/src/index.ts
/**
* Interactive pi-tui front door for DeepSeek Harness agents. It renders the
* durable session transcript, drives one root agent, and owns the terminal
* lifecycle: raw mode and the alternate screen are entered only after the
* agent is ready, and every exit path releases the terminal before the
* process ends.
* @module @deepseek-ai/dsh-tui
*/
/** Stable Cordis plugin name. */
const name = "tui";
/**
* Core services required before the interactive session can be driven. Every
* name is a base-layer row or a row the tui bundle inserts; the loader
* rejects a composition that omits one.
*/
const inject = [
	"agents",
	"agentDefaultModel",
	"sessions",
	"commands",
	"tools",
	"llm",
	"systemPrompt",
	"tokenMeter",
	"userQuestions",
	"approval",
	"sessionProjections",
	"sessionQuery",
	"sessionReferenceResolver"
];
/**
* Transcript row standing in for one compacted range. The conversation the
* compaction replaced stays rendered above it: the marker reports where the
* model stopped seeing that history, not that the history is gone.
*/
const COMPACTION_MARKER = "… earlier context was compacted …";
/**
* Two Ctrl+C presses inside this window mean "exit to the shell". A single
* press keeps its in-channel meaning: cancel a running turn, or clear a
* non-empty editor. The window uses the runtime clock, so tests and host
* overrides keep deterministic control over the double-press boundary.
*/
const CTRL_C_EXIT_WINDOW_MS = 1e3;
/** Width/height adapter for a modal component rendered inside the base TUI flow. */
var InlineModalComponent = class extends Container {
	width;
	maxHeight;
	constructor(component, width, maxHeight) {
		super();
		this.width = width;
		this.maxHeight = maxHeight;
		this.addChild(component);
	}
	render(width) {
		return super.render(Math.max(1, Math.min(width, this.width))).slice(0, Math.max(1, this.maxHeight));
	}
};
/**
* Start the interactive pi-tui channel for an already-created target agent.
* @param ctx - agent, session, and event context.
* @param config - banner and TUI presentation config.
* @param runtime - terminal and process-exit boundary.
* @param handle - owned agent handle; disposed by this channel on shutdown.
* @param selection - shared selected-model handle installed into the agent's
*   prompt assembly by the caller's setup hook.
* @returns lifecycle controller used by the Cordis effect disposer.
*/
function createTuiChat(ctx, config, runtime, handle, selection) {
	const agent = handle.agent;
	const resolved = resolveTuiConfig(config);
	const palette = createPalette(resolved.theme.color);
	const mdTheme = markdownTheme(palette);
	const ui = new TUI(runtime.terminal, resolved.showHardwareCursor);
	const chat = new Container();
	const editor = new Editor(ui, {
		borderColor: palette.dim,
		selectList: selectTheme(palette)
	}, {
		paddingX: 1,
		frame: "none",
		prompt: {
			first: "",
			continuation: ""
		}
	});
	const inputBox = new BorderedEditor(editor, palette, { leftLabel: displayInlineText(" dsh ") });
	const promptLine = new Text("", 0, 0);
	const statusLine = new Text("", 0, 0);
	const questionContainer = new Container();
	const cwd = agent.session.header.cwd ?? process.cwd();
	const formattedCwd = displayText(runtime.formatCwd?.(cwd) ?? cwd);
	let branch;
	const branchQuery = runtime.gitBranch?.(cwd);
	if (branchQuery !== void 0) branchQuery.then((value) => {
		if (disposed) return;
		branch = value;
		requestRender();
	});
	const fileSearch = new WorkspaceFileSearch(cwd, {
		maxResults: resolved.fileSearchMaxResults,
		maxEntries: resolved.fileSearchMaxEntries,
		excludedDirectories: resolved.fileSearchExcludedDirectories
	});
	const tokens = sessionTokens(agent.session);
	const referenceResolver = ctx.get("sessionReferenceResolver");
	const pendingSteering = /* @__PURE__ */ new Set();
	const pendingReferenceIds = /* @__PURE__ */ new Set();
	const messageReferences = /* @__PURE__ */ new Map();
	const referenceControllers = /* @__PURE__ */ new Set();
	let runningSince;
	let modelController;
	let disposed = false;
	let shuttingDown;
	let lastCtrlCPressAt = Number.NEGATIVE_INFINITY;
	let ctrlCExitHint = false;
	let ctrlCExitHintTimer;
	let showReasoning = resolved.showReasoning;
	let toolsVisibility = "collapsed";
	let streaming;
	const stepTimingTracker = new StepTimingTracker();
	const assistantSteps = /* @__PURE__ */ new Map();
	const toolCards = /* @__PURE__ */ new Map();
	const allToolCards = /* @__PURE__ */ new Set();
	const contextCards = /* @__PURE__ */ new Set();
	const now = () => runtime.now?.() ?? Date.now();
	/** Drop the pending double-press state and its prompt hint. */
	const clearCtrlCPending = () => {
		if (ctrlCExitHintTimer !== void 0) {
			clearTimeout(ctrlCExitHintTimer);
			ctrlCExitHintTimer = void 0;
		}
		lastCtrlCPressAt = Number.NEGATIVE_INFINITY;
		ctrlCExitHint = false;
	};
	let sessionTitle = foldSessionTitle(agent.session.events)?.title;
	const header = new HeaderComponent(agent, () => sessionTitle ?? config.welcome, palette, resolved.theme.color && resolved.theme.truecolor);
	ui.addChild(header);
	ui.addChild(chat);
	ui.addChild(new Spacer(1));
	ui.addChild(promptLine);
	ui.addChild(statusLine);
	ui.addChild(questionContainer);
	ui.addChild(inputBox);
	ui.setFocus(editor);
	const updatePromptLine = () => {
		promptLine.setText(palette.dim(`${formattedCwd}${branch === void 0 ? "" : ` (${displayText(branch)})`}  ${agent.status === "running" ? "running" : "idle"}` + (ctrlCExitHint ? "  ·  press Ctrl+C again to exit" : "")));
	};
	updatePromptLine();
	const updateStatusLine = () => {
		const segments = [];
		const running = agent.status === "running";
		const glyph = runningPhaseGlyph(agent.session.events, running);
		if (glyph !== void 0) {
			const phase = openStepPhase(agent.session.events);
			segments.push(`${glyph} ${phase === void 0 ? "running" : phase}`);
		} else segments.push("idle");
		if (runningSince !== void 0) segments.push(formatStatusDuration(now() - runningSince));
		const queued = formatQueuedStatus(pendingSteering.size);
		if (queued !== void 0) segments.push(queued);
		const usage = `↑${formatTokens(tokens.input)} ↓${formatTokens(tokens.output)}`;
		const rate = cacheHitRate(tokens);
		segments.push(rate === void 0 ? usage : `${usage} · cache ${rate}%`);
		const contextWindow = modelController.contextWindow();
		const tokenMeter = ctx.get("tokenMeter");
		if (contextWindow !== void 0 && tokenMeter !== void 0) {
			const used = Math.max(0, Math.round(tokenMeter.measure(agent.session).totalTokens));
			segments.push(`${Math.min(100, Math.round(used / contextWindow * 100))}% context`);
		}
		segments.push(selection.current === void 0 ? "unset" : compactTargetLabel(selection.current));
		segments.push(`tools ${toolsVisibility}`);
		const composed = segments.join(" · ");
		const width = Math.max(1, runtime.terminal.columns);
		statusLine.setText(palette.dim(displayText(visibleWidth(composed) <= width ? composed : `${sliceByColumn(composed, 0, Math.max(1, width - 1))}…`)));
	};
	const updateInputBox = () => {
		inputBox.setRightLabel(selection.current === void 0 ? void 0 : displayText(compactTargetLabel(selection.current)));
	};
	const updateTerminalTitle = () => {
		runtime.terminal.setTitle(displayText(sessionTitle === void 0 ? resolved.title : `${sessionTitle} — ${resolved.title}`));
	};
	updateTerminalTitle();
	const requestRender = () => {
		if (disposed) return;
		updatePromptLine();
		updateStatusLine();
		updateInputBox();
		ui.invalidate();
		ui.requestRender();
	};
	const residentOrder = [];
	const residentBytesBy = /* @__PURE__ */ new Map();
	let residentBytes = 0;
	const evictComponent = (component) => {
		if (component instanceof StreamingAssistantComponent) {
			/* v8 ignore start -- resident steps are always registered with their footers attached */
			const steps = assistantSteps.get(component.position.turn);
			if (steps !== void 0) {
				const index = steps.indexOf(component);
				if (index >= 0) steps.splice(index, 1);
				if (steps.length === 0) assistantSteps.delete(component.position.turn);
			}
			const footerIndex = chat.children.indexOf(component.timing);
			if (footerIndex >= 0) chat.children.splice(footerIndex, 1);
		} else if (component instanceof ToolCardComponent) allToolCards.delete(component);
		else if (component instanceof ContextCardComponent) contextCards.delete(component);
		const chatIndex = chat.children.indexOf(component);
		if (chatIndex >= 0) chat.children.splice(chatIndex, 1);
	};
	const evictResident = () => {
		while ((residentBytes > resolved.transcriptResidentMaxBytes || residentOrder.length > resolved.cardCacheEntries) && residentOrder.length > 0) {
			const oldest = residentOrder[0];
			/* v8 ignore next -- the loop guard guarantees a non-empty ledger */
			if (oldest === void 0) break;
			const onlyChild = residentOrder.length === 1;
			residentOrder.shift();
			if (oldest instanceof StreamingAssistantComponent && !oldest.isSettled()) {
				if (onlyChild) {
					residentOrder.unshift(oldest);
					break;
				}
				residentOrder.push(oldest);
				continue;
			}
			/* v8 ignore next -- accountResident always records the charge */
			residentBytes = Math.max(0, residentBytes - (residentBytesBy.get(oldest) ?? 0));
			residentBytesBy.delete(oldest);
			evictComponent(oldest);
		}
	};
	/** Charge one resident transcript row or card and enforce the budgets. */
	const accountResident = (component, bytes) => {
		residentOrder.push(component);
		residentBytesBy.set(component, bytes);
		residentBytes += bytes;
		evictResident();
	};
	/** Release a component's resident charge when the channel removes it. */
	const releaseResident = (component) => {
		const ledgerIndex = residentOrder.indexOf(component);
		/* v8 ignore next -- charged components are always present in the ledger */
		if (ledgerIndex < 0) return;
		residentOrder.splice(ledgerIndex, 1);
		/* v8 ignore next -- accountResident always records the charge */
		residentBytes = Math.max(0, residentBytes - (residentBytesBy.get(component) ?? 0));
		residentBytesBy.delete(component);
	};
	/** Append a transcript notice row (info/warning/error tone). */
	const appendNotice = (message, kind = "info") => {
		const color = kind === "error" ? palette.error : kind === "warning" ? palette.warning : palette.dim;
		chat.addChild(new Spacer(1));
		chat.addChild(new Text(color(displayText(message)), 0, 0));
		requestRender();
	};
	const appendUser = (text) => {
		chat.addChild(new Spacer(1));
		const row = new UserMessageComponent(text, palette, mdTheme);
		chat.addChild(row);
		accountResident(row, text.length + 64);
	};
	const appendContext = (label, text) => {
		const card = new ContextCardComponent(label, text, resolved.maxToolOutputLines, palette);
		card.setExpanded(toolsVisibility === "expanded");
		contextCards.add(card);
		chat.addChild(new Spacer(1));
		chat.addChild(card);
		accountResident(card, label.length + text.length + 64);
	};
	const renderCompactionMarker = () => {
		chat.addChild(new Spacer(1));
		chat.addChild(new Text(palette.dim(COMPACTION_MARKER), 0, 0));
	};
	/**
	* Re-derive hidden-mode folding for one turn: the first step with a visible
	* body owns the turn's single Assistant header, every other step renders as a
	* headerless continuation (empty ones render nothing). Any other visibility
	* restores the per-step headers.
	*/
	const applyTurnFolding = (turn) => {
		const steps = assistantSteps.get(turn);
		/* v8 ignore next -- every folding call site holds a registered step list for its turn. */
		if (steps === void 0) return;
		let headerSeen = false;
		for (const step of steps) if (toolsVisibility !== "hidden") step.setFoldedContinuation(false);
		else if (!headerSeen && step.hasVisibleBody()) {
			headerSeen = true;
			step.setFoldedContinuation(false);
		} else step.setFoldedContinuation(true);
	};
	const registerAssistantStep = (component) => {
		const steps = assistantSteps.get(component.position.turn) ?? [];
		steps.push(component);
		assistantSteps.set(component.position.turn, steps);
		applyTurnFolding(component.position.turn);
	};
	const removeStreaming = (current) => {
		if (current === void 0) return;
		releaseResident(current);
		for (const child of [current, current.timing]) {
			const index = chat.children.indexOf(child);
			/* v8 ignore next -- streaming components and their timing footers are retained only while attached to the chat. */
			if (index >= 0) chat.children.splice(index, 1);
		}
		const steps = assistantSteps.get(current.position.turn);
		/* v8 ignore next -- every attached streaming component is registered in the fold map. */
		if (steps === void 0) return;
		const index = steps.indexOf(current);
		/* v8 ignore next -- registration precedes attachment, so the component is present until this removal. */
		if (index < 0) return;
		steps.splice(index, 1);
		applyTurnFolding(current.position.turn);
	};
	const clearStreaming = () => {
		removeStreaming(streaming);
		streaming = void 0;
	};
	const startAssistantStep = (position) => {
		streaming = new StreamingAssistantComponent(position, () => agent.session.events, stepTimingTracker, now, showReasoning, palette, mdTheme);
		registerAssistantStep(streaming);
		chat.addChild(streaming);
		chat.addChild(streaming.timing);
		accountResident(streaming, 64);
	};
	const parsedTool = (event) => {
		const parsed = parseArguments(event.data.arguments);
		const card = new ToolCardComponent(event.data.name, parsed, ctx.tools.get(event.data.name, agent), resolved.maxToolOutputLines, resolved.maxDiffEditLength, palette, mdTheme);
		card.setVisibility(toolsVisibility);
		toolCards.set(event.data.callId, card);
		allToolCards.add(card);
		accountResident(card, 512);
		return card;
	};
	/**
	* Render one session event; returns whether it changed the visible chat so
	* the caller can skip a pointless render pass (the TUI emits no frame for an
	* unchanged view, and the frame waiter would stall on it).
	*/
	const renderEvent = (event, renderChunks) => {
		switch (event.type) {
			case "user/message": {
				const source = event.data.source;
				if (source.kind === "user") {
					const text = displayText(contentText(event.data.content).trim());
					if (!text) return false;
					appendUser(text);
					return true;
				}
				const references = sessionReferenceCard(source);
				if (references !== void 0) {
					chat.addChild(new Text(palette.dim(`Referenced sessions · ${references.map(displayText).join(", ")}`), 0, 0));
					return true;
				}
				const text = contentText(event.data.content).trim();
				if (!text) return false;
				const labelled = source;
				const label = typeof labelled.plugin === "string" ? labelled.plugin : typeof labelled.kind === "string" ? labelled.kind : "context";
				appendContext(label, text);
				return true;
			}
			case "step/start":
				startAssistantStep(event.data);
				return true;
			case "assistant/chunk":
				if (!renderChunks || streaming === void 0) return false;
				streaming.update(event.data.chunk);
				applyTurnFolding(streaming.position.turn);
				return true;
			case "assistant/message":
				if (streaming === void 0 || streaming.isSettled() || !chat.children.includes(streaming)) startAssistantStep(event.data);
				/* v8 ignore next -- startAssistantStep always assigns, so the settled component is present here. */
				if (streaming !== void 0) {
					streaming.settle(event.data.message.content);
					applyTurnFolding(streaming.position.turn);
				}
				return true;
			case "step/end":
				if (streaming === void 0) startAssistantStep(event.data);
				streaming?.complete(event.time);
				streaming = void 0;
				return true;
			case "tool/call":
				chat.addChild(parsedTool(event));
				return true;
			case "tool/result": {
				const callId = event.data.message.source.callId;
				let card = toolCards.get(callId);
				if (card === void 0) {
					card = new ToolCardComponent("tool", {
						value: {},
						valid: true
					}, void 0, resolved.maxToolOutputLines, resolved.maxDiffEditLength, palette, mdTheme);
					card.setVisibility(toolsVisibility);
					chat.addChild(card);
					allToolCards.add(card);
					accountResident(card, 512);
				}
				card.updateResult(event.data);
				toolCards.delete(callId);
				return true;
			}
			case "turn/end": {
				clearStreaming();
				const reason = event.data.reason;
				switch (reason.kind) {
					case "completed": break;
					case "error":
						appendNotice(reason.error.message, "error");
						break;
					case "aborted":
						appendNotice("Turn cancelled.", "warning");
						break;
					case "max-tokens":
						appendNotice("The model reached its output-token limit.", "warning");
						break;
					case "interrupted":
						appendNotice("The previous process ended during this turn.", "warning");
						break;
					default: appendNotice(`Turn ended: ${reason.kind}.`, "warning");
				}
				return true;
			}
			default: return false;
		}
	};
	const disposeSessionEvents = ctx.on("session/event", (session, event) => {
		if (session !== agent.session) return;
		if (event.type === "tool/result") fileSearch.invalidate();
		recordEventUsage(tokens, event);
		if (event.type === "session/title") {
			sessionTitle = event.data.title;
			header.invalidate();
			updateTerminalTitle();
		}
		if (isReplacementSurfaceEvent(event)) {
			if (isCompactCheckpoint(event)) {
				renderCompactionMarker();
				requestRender();
			}
			return;
		}
		if (renderEvent(event, true)) requestRender();
	});
	let replayCursor = mountWindowStart(agent.session.events, resolved.maxInitialMessages);
	for (let index = replayCursor; index < agent.session.events.length; index += 1) renderEvent(agent.session.events[index], false);
	/**
	* Deliver one user turn to the agent: inject any attached snapshot into the
	* pre-step queue, then steer while running or follow up while idle. Returns
	* the message id so callers can track steering and reference claims.
	* @param text - readable message content.
	* @param attachedContext - optional referenced-session snapshot queued before the message.
	* @returns the submitted message id.
	*/
	const dispatchMessage = (text, attachedContext) => {
		const message = createUserMessage({
			content: [{
				type: "text",
				text
			}],
			source: { kind: "user" }
		});
		if (attachedContext !== void 0) agent.inject(attachedContext);
		if (agent.status === "running") {
			agent.steer(message);
			pendingSteering.add(message.id);
		} else agent.followup(message);
		requestRender();
		return message.id;
	};
	/** Load one earlier history page into the transcript head; false at the start. */
	const loadHistory = () => {
		/* v8 ignore next -- the walk's zero-message check reports the start */
		if (replayCursor <= 0) return false;
		const events = agent.session.events;
		let pageStart = Math.max(0, replayCursor - 1);
		let messages = 0;
		for (let index = replayCursor - 1; index >= 0 && messages < resolved.historyPageSize; index -= 1) {
			const event = events[index];
			if (event.type === "user/message" && event.data.source.kind === "user") {
				messages += 1;
				pageStart = index;
			}
		}
		if (messages === 0) return false;
		const ledgerBefore = residentOrder.length;
		for (let index = pageStart; index < replayCursor; index += 1) renderEvent(events[index], false);
		const moved = residentOrder.splice(ledgerBefore);
		residentOrder.unshift(...moved);
		replayCursor = pageStart;
		requestRender();
		return true;
	};
	const setToolsVisibility = (visibility) => {
		toolsVisibility = visibility;
		for (const card of allToolCards) card.setVisibility(visibility);
		for (const card of contextCards) card.setExpanded(visibility === "expanded");
		for (const steps of assistantSteps.values()) for (const step of steps) applyTurnFolding(step.position.turn);
	};
	const toggleTools = () => {
		setToolsVisibility(toolsVisibility === "collapsed" ? "expanded" : toolsVisibility === "expanded" ? "hidden" : "collapsed");
	};
	const setShowReasoning = (show) => {
		showReasoning = show;
		const set = (step) => {
			step.setShowReasoning(showReasoning);
		};
		for (const steps of assistantSteps.values()) for (const step of steps) set(step);
		streaming?.setShowReasoning(showReasoning);
	};
	const toggleReasoning = () => {
		setShowReasoning(!showReasoning);
	};
	editor.onSubmit = (text) => {
		const value = text.trim();
		if (value === "") return;
		editor.addToHistory(text);
		editor.setText("");
		if (commands.runCommand(value)) return;
		let parsed;
		try {
			parsed = parseSessionReferenceText(value);
		} catch (error) {
			editor.setText(value);
			appendNotice(`Invalid session reference: ${errorChain(error)}`, "error");
			return;
		}
		if (parsed.references.length === 0) {
			dispatchMessage(parsed.text);
			return;
		}
		if (referenceResolver === void 0) {
			editor.setText(value);
			appendNotice("Session reference capability unavailable.", "error");
			return;
		}
		const duplicate = parsed.references.find((reference) => pendingReferenceIds.has(reference.sessionId));
		if (duplicate !== void 0) {
			editor.setText(value);
			appendNotice(`Session "${displayText(duplicate.sessionId)}" is already referenced by a pending submission.`, "warning");
			return;
		}
		const refs = parsed.references.map((reference) => reference.sessionId);
		for (const sessionId of refs) pendingReferenceIds.add(sessionId);
		const controller = new AbortController();
		referenceControllers.add(controller);
		referenceResolver.prepare(agent, [{
			type: "text",
			text: parsed.text
		}], parsed.references, controller.signal).then((prepared) => {
			if (disposed) return;
			const id = dispatchMessage(parsed.text, prepared.additionalContext);
			messageReferences.set(id, refs);
			requestRender();
		}, (error) => {
			for (const sessionId of refs) pendingReferenceIds.delete(sessionId);
			if (!disposed && !controller.signal.aborted) {
				editor.setText(value);
				appendNotice(`Session reference failed: ${errorChain(error)}`, "error");
			}
		}).finally(() => {
			referenceControllers.delete(controller);
		});
	};
	const removeInputListener = ui.addInputListener((data) => {
		if (isKeyRelease(data)) return void 0;
		if (!matchesKey(data, Key.ctrl("c"))) {
			const hintVisible = ctrlCExitHint;
			clearCtrlCPending();
			if (hintVisible) requestRender();
		}
		if (overlayManager.hasActiveOverlay()) return void 0;
		if (matchesKey(data, Key.ctrl("o"))) {
			toggleTools();
			requestRender();
			return { consume: true };
		}
		if (matchesKey(data, Key.ctrl("r"))) {
			toggleReasoning();
			requestRender();
			return { consume: true };
		}
		if (matchesKey(data, Key.pageUp)) {
			loadHistory();
			requestRender();
			return { consume: true };
		}
		if (matchesKey(data, Key.escape) && agent.status === "running") {
			agent.cancel({ kind: "user" });
			requestRender();
			return { consume: true };
		}
		if (matchesKey(data, Key.ctrl("c"))) {
			const pressedAt = now();
			if (lastCtrlCPressAt !== Number.NEGATIVE_INFINITY && pressedAt - lastCtrlCPressAt <= CTRL_C_EXIT_WINDOW_MS) {
				clearCtrlCPending();
				requestExit();
				return { consume: true };
			}
			clearCtrlCPending();
			lastCtrlCPressAt = pressedAt;
			if (agent.status === "running") agent.cancel({ kind: "user" });
			else if (editor.getText() !== "") editor.setText("");
			else {
				ctrlCExitHint = true;
				ctrlCExitHintTimer = setTimeout(() => {
					ctrlCExitHintTimer = void 0;
					if (disposed) return;
					clearCtrlCPending();
					requestRender();
				}, CTRL_C_EXIT_WINDOW_MS);
			}
			requestRender();
			return { consume: true };
		}
		if (matchesKey(data, Key.ctrl("d"))) {
			requestExit();
			return { consume: true };
		}
	});
	let statusTimer;
	const startStatusTimer = () => {
		if (statusTimer !== void 0) return;
		statusTimer = setInterval(() => {
			requestRender();
		}, resolved.statusIntervalMs);
	};
	const stopStatusTimer = () => {
		if (statusTimer === void 0) return;
		clearInterval(statusTimer);
		statusTimer = void 0;
	};
	const disposeStatus = ctx.on("agent/status", ({ agent: subject, status }) => {
		if (subject !== agent) return;
		runtime.terminal.setProgress(status === "running");
		if (status === "running") {
			if (runningSince === void 0) runningSince = now();
			startStatusTimer();
		} else {
			runningSince = void 0;
			pendingSteering.clear();
			stopStatusTimer();
		}
		requestRender();
	});
	/** Drop a message's steering and reference claims once the inbox settles them. */
	const releaseReferences = (messageId) => {
		pendingSteering.delete(messageId);
		const refs = messageReferences.get(messageId);
		if (refs === void 0) return;
		messageReferences.delete(messageId);
		for (const sessionId of refs) pendingReferenceIds.delete(sessionId);
	};
	const disposeInboxClaimed = ctx.on("agent/inbox/claimed", ({ agent: subject, message }) => {
		if (subject !== agent) return;
		releaseReferences(message.id);
		requestRender();
	});
	const disposeInboxDiscarded = ctx.on("agent/inbox/discarded", ({ agent: subject, message }) => {
		if (subject !== agent) return;
		releaseReferences(message.id);
		requestRender();
	});
	const shutdown = (exitProcess) => {
		shuttingDown ??= (async () => {
			disposed = true;
			clearCtrlCPending();
			overlayManager.beginShutdown();
			disposeSessionEvents();
			removeInputListener();
			stopStatusTimer();
			disposeStatus();
			disposeInboxClaimed();
			disposeInboxDiscarded();
			disposeGoalStatus();
			for (const controller of referenceControllers) controller.abort(/* @__PURE__ */ new Error("TUI disposed"));
			referenceControllers.clear();
			modelController.resetContextResolution();
			modelController.clearOverlay();
			modelController.detach();
			presetController.clearOverlay();
			await commands.dispose();
			fileSearch.dispose();
			disposeApproval();
			if (agent.status === "running") agent.cancel({ kind: "user" });
			await agent.whenIdle();
			await ctx.sessions.flush(agent.session);
			questions.rejectAll();
			await overlayManager.dispose();
			questions.unregister();
			await handle.dispose();
			await runtime.terminal.drainInput(100, 20);
			ui.stop();
			if (exitProcess) {
				if (runtime.goodbyeMessage !== void 0) runtime.terminal.write(`${palette.dim(displayText(runtime.goodbyeMessage))}\n`);
				runtime.exit(0);
			}
		})();
		return shuttingDown;
	};
	const requestExit = () => {
		if (agent.status === "running") {
			agent.cancel({ kind: "user" });
			agent.whenIdle().then(() => void shutdown(true));
			return;
		}
		shutdown(true);
	};
	const extensionTheme = Object.freeze({
		text: (value) => palette.text(value),
		brand: (value) => palette.brand(value),
		dim: (value) => palette.dim(value),
		accent: (value) => palette.accent(value),
		success: (value) => palette.success(value),
		warning: (value) => palette.warning(value),
		error: (value) => palette.error(value),
		bold: (value) => palette.bold(value)
	});
	const overlayManager = new TuiOverlayManager({
		viewport: () => Object.freeze({
			columns: runtime.terminal.columns,
			rows: runtime.terminal.rows
		}),
		theme: () => extensionTheme,
		display: displayText,
		show: (component, options, placement) => {
			if (placement === "overlay") return ui.showOverlay(component, options === void 0 ? void 0 : {
				...options,
				...typeof options.margin === "object" ? { margin: { ...options.margin } } : {}
			});
			const modal = new InlineModalComponent(component, resolved.questionDialogWidth, resolved.questionDialogMaxHeight);
			questionContainer.clear();
			questionContainer.addChild(modal);
			ui.setFocus(component);
			return { hide() {
				questionContainer.clear();
				ui.setFocus(editor);
			} };
		},
		invalidate: requestRender,
		reportError: (error) => {
			const message = errorChain(error);
			ctx.logger.warn(`tui: overlay failed: ${message}`);
			/* v8 ignore next -- shutdown removes overlays before the terminal stops */
			if (disposed) return;
			appendNotice(`TUI overlay failed: ${message}`, "error");
		}
	});
	modelController = createModelController({
		ctx,
		resolved,
		palette,
		overlayManager,
		selection,
		appendNotice,
		requestRender,
		isDisposed: () => disposed
	});
	const presetController = createPresetController({
		ctx,
		agent,
		resolved,
		palette,
		overlayManager,
		appendNotice,
		requestRender,
		isDisposed: () => disposed
	});
	const showStatusCard = () => {
		const events = agent.session.events;
		const turns = events.filter((event) => event.type === "turn/start").length;
		const steps = events.filter((event) => event.type === "step/start").length;
		const toolCalls = events.filter((event) => event.type === "tool/call").length;
		const tokenMeter = ctx.get("tokenMeter");
		const usedContext = tokenMeter === void 0 ? 0 : Math.max(0, Math.round(tokenMeter.measure(agent.session).totalTokens));
		let context = `${formatDiagnosticNumber(usedContext)} used · capacity unknown`;
		const contextWindow = modelController.contextWindow();
		if (contextWindow !== void 0) {
			const contextPercent = Math.min(100, Math.round(usedContext / contextWindow * 100));
			context = `${diagnosticMeter(contextPercent, palette)} ${String(contextPercent)}% used (${formatDiagnosticNumber(usedContext)} / ${formatDiagnosticNumber(contextWindow)})`;
		}
		const rate = cacheHitRate(tokens);
		const selected = selection.current;
		const model = selected === void 0 ? "unset" : displayText(targetLabel(selected));
		const effort = selected === void 0 ? "unset" : selected.reasoningEffort === void 0 ? "default" : displayText(selected.reasoningEffort);
		const groups = [
			[
				["Session", displayText(agent.session.id)],
				["Title", displayText(sessionTitle ?? "untitled")],
				["Directory", displayText(cwd)],
				["Model", `${model} ${palette.dim(`(effort ${effort}; reasoning blocks ${showReasoning ? "shown" : "hidden"})`)}`],
				["Preset", displayText(ctx.get("agentPresets")?.composedPreset(agent.ctx) ?? "none")]
			],
			[["Agent", [
				agent.status,
				formatDiagnosticCount(events.length, "event"),
				formatDiagnosticCount(turns, "turn"),
				formatDiagnosticCount(steps, "step"),
				formatDiagnosticCount(toolCalls, "tool call")
			].join(" · ")]],
			[
				["Tokens", `${formatDiagnosticNumber(tokens.input)} input + ${formatDiagnosticNumber(tokens.output)} output`],
				["KV cache", rate === void 0 ? `n/a (${formatDiagnosticNumber(tokens.cacheRead)} read + ${formatDiagnosticNumber(tokens.cacheWrite)} write)` : `${diagnosticMeter(rate, palette)} ${String(rate)}% hit (${formatDiagnosticNumber(tokens.cacheRead)} read + ${formatDiagnosticNumber(tokens.cacheWrite)} write)`],
				["Context", context]
			],
			[["Created", formatDiagnosticTime(agent.session.header.createdAt)], ["Active", formatDiagnosticTime(events.at(-1)?.time ?? agent.session.header.createdAt)]]
		];
		chat.addChild(new Spacer(1));
		chat.addChild(new StatusCardComponent(groups, palette));
		requestRender();
	};
	const resume = createResumeController({
		ctx,
		resolved,
		palette,
		overlayManager,
		agent,
		runtime,
		sessionQuery: () => ctx.get("sessionQuery"),
		appendNotice,
		requestRender,
		isDisposed: () => disposed,
		releaseTerminal: async () => {
			await runtime.terminal.drainInput(100, 20);
			ui.stop();
		},
		reacquireTerminal: () => {
			ui.start();
			ui.setFocus(editor);
		}
	});
	const questions = createQuestionQueue({
		ctx,
		resolved,
		palette,
		overlayManager,
		questionMaxHeight: () => Math.max(1, Math.min(resolved.questionDialogMaxHeight, runtime.terminal.rows - 4)),
		requestRender,
		isDisposed: () => disposed
	});
	const disposeApproval = installApprovalAnswerer({
		ctx,
		agent,
		palette,
		overlayManager,
		isDisposed: () => disposed
	});
	const commands = createCommandController({
		ctx,
		agent,
		palette,
		color: resolved.theme.color,
		editor,
		cwd,
		fileSearch,
		referenceResolver,
		queueModelCommand: (raw) => {
			modelController.queueModelCommand(raw);
		},
		queuePresetCommand: (raw) => {
			presetController.queuePresetCommand(raw);
		},
		showResume: () => {
			resume.showResume();
		},
		showStatusCard,
		loadHistory,
		appendNotice,
		requestRender,
		isDisposed: () => disposed,
		requestExit,
		clearChat: () => {
			residentOrder.length = 0;
			residentBytesBy.clear();
			residentBytes = 0;
			assistantSteps.clear();
			allToolCards.clear();
			contextCards.clear();
			toolCards.clear();
			streaming = void 0;
			chat.clear();
		},
		setToolsVisibility,
		setShowReasoning
	});
	const renderGoalStatus = () => {
		const status = goalStatusText(ctx, agent);
		if (status !== void 0) appendNotice(status, "info");
	};
	const disposeGoalStatus = ctx.sessionProjections.onChanged((session, key) => {
		if (session !== agent.session || key !== "goal") return;
		renderGoalStatus();
	});
	renderGoalStatus();
	new TuiExtensionServiceImpl(ctx, agent, overlayManager);
	ui.start();
	return { dispose: () => shutdown(false) };
}
/**
* Create or resume the root agent this terminal drives, then mount the
* interactive channel as an effect-owned child of the plugin fiber.
* @param ctx - plugin context carrying the agent registry and startup values.
* @param config - validated terminal config, including launcher identity.
* @param runtime - terminal and process-exit boundary.
*/
function mountTui(ctx, config, runtime) {
	run(ctx, config, runtime).catch((error) => {
		runtime.terminal.write(displayText(`tui: failed to start: ${errorChain(error)}\n`));
		runtime.exit(1);
	});
}
/** Parse `provider/model` from the launcher flag; absent keeps the session default. */
function parseModelRoute(value) {
	if (value === void 0) return void 0;
	const slash = value.indexOf("/");
	if (slash <= 0 || slash === value.length - 1) return void 0;
	return {
		provider: value.slice(0, slash),
		model: value.slice(slash + 1)
	};
}
async function run(ctx, config, runtime) {
	const startup = ctx.get(TUI_STARTUP_SERVICE);
	const route = parseModelRoute(config.model);
	const defaultSelection = route === void 0 ? ctx.get("agentDefaultModel")?.currentSelection() : void 0;
	const agentOptions = route !== void 0 ? {
		provider: route.provider,
		model: route.model
	} : defaultSelection === void 0 ? void 0 : {
		provider: defaultSelection.provider,
		model: defaultSelection.model
	};
	const modelSelection = {
		current: void 0,
		assembled: void 0
	};
	const installSelection = (agentCtx) => {
		installModelSelection(agentCtx, modelSelection);
	};
	const presets = ctx.get("agentPresets");
	const requestedPreset = startup?.preset;
	const creationPreset = presets === void 0 ? void 0 : await presets.resolve(requestedPreset);
	const handle = startup?.resumeSessionId !== void 0 ? await ctx.agents.resume({
		resumeSessionId: SessionId(startup.resumeSessionId),
		...agentOptions === void 0 ? {} : { agentOptions },
		setup: async (agentCtx) => {
			installSelection(agentCtx);
			if (presets === void 0) return;
			const subject = agentCtx.agent;
			/* v8 ignore next -- the factory contract mints agentCtx around the agent before setup runs */
			if (subject === void 0) throw new Error("tui: agent setup ran without an agent context");
			const recorded = sessionPreset(subject);
			if (requestedPreset !== void 0 && recorded !== void 0 && recorded !== requestedPreset) throw new Error(`agent preset conflict: session "${startup.resumeSessionId}" runs preset "${recorded}", not "${requestedPreset}"`);
			const preset = await presets.resolve(recorded ?? requestedPreset);
			await presets.mount(agentCtx, preset.id);
		}
	}) : await ctx.agents.create({
		sessionId: SessionId(config.sessionId ?? "main"),
		...creationPreset === void 0 ? { meta: { cwd: process.cwd() } } : { meta: {
			cwd: process.cwd(),
			agentPreset: creationPreset.id
		} },
		...agentOptions === void 0 ? {} : { agentOptions },
		setup: async (agentCtx) => {
			installSelection(agentCtx);
			if (presets !== void 0 && creationPreset !== void 0) await presets.mount(agentCtx, creationPreset.id);
		}
	});
	const initial = initialTarget(handle.agent);
	modelSelection.current = handle.agent.session.requestHeader() === void 0 ? defaultSelection ?? initial : initial ?? defaultSelection;
	ctx.effect(() => {
		const controller = createTuiChat(ctx, config, runtime, handle, modelSelection);
		return () => controller.dispose();
	}, "tui");
}
/**
* The event index at which a mount replay begins: the initial window holds the
* most recent `maxInitialMessages` user messages, aligned back to the nearest
* open turn or title boundary so lifecycle state replays consistently.
* @param events - The durable session log.
* @param maxInitialMessages - User messages retained in the initial window.
* @returns The replay start index.
*/
function mountWindowStart(events, maxInitialMessages) {
	let messages = 0;
	let start = 0;
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event.type !== "user/message") continue;
		if (event.data.source.kind !== "user") continue;
		messages += 1;
		if (messages >= maxInitialMessages) {
			start = index;
			break;
		}
	}
	if (start > 0) for (let index = start - 1; index >= 0; index -= 1) {
		const event = events[index];
		if (event.type === "turn/start" || event.type === "session/title") return index;
	}
	return start;
}
const ROOT_DISPOSE_TIMEOUT_MS = 5e3;
/**
* Dispose the whole application before process exit, with a bounded fallback.
* @param ctx - The TUI plugin context whose root owns sibling resources.
* @param code - Process status to report.
* @param exit - Exit boundary, replaceable by tests.
*/
function disposeRootAndExit(ctx, code, exit) {
	let exited = false;
	const exitOnce = () => {
		/* v8 ignore next -- disposal always settles before the timeout in tests */
		if (exited) return;
		exited = true;
		exit(code);
	};
	const timeout = setTimeout(exitOnce, ROOT_DISPOSE_TIMEOUT_MS);
	ctx.root.fiber.dispose().then(
		() => {
			clearTimeout(timeout);
			exitOnce();
		},
		/* v8 ignore next 3 -- a disposal rejection cannot be forced through the public API */
		() => {
			clearTimeout(timeout);
			exitOnce();
		}
	);
}
/**
* Cordis entry point using the process terminal; explicit TUI composition
* requires a TTY pair, so a piped invocation fails loud before any terminal
* takeover.
* @param ctx - plugin context carrying core services and launcher values.
* @param config - validated terminal config.
*/
/* v8 ignore start -- production process wiring; fake-terminal tests cover mountTui/createTuiChat,
and the PTY smokes cover the real entry */
function apply(ctx, config) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("tui: both stdin and stdout must be TTYs; use the one-shot headless profile for pipes");
	const truecolor = config.theme?.truecolor ?? ["truecolor", "24bit"].includes(process.env.COLORTERM ?? "");
	mountTui(ctx, {
		...config,
		theme: {
			...config.theme,
			truecolor
		}
	}, {
		terminal: new ProcessTerminal(),
		exit: (code) => {
			disposeRootAndExit(ctx, code, (status) => {
				process.exit(status);
			});
		},
		formatCwd,
		gitBranch
	});
}
/* v8 ignore stop */

//#endregion
export { Config, ContextCardComponent, HeaderComponent, StreamingAssistantComponent, TUI_STARTUP_SERVICE, ToolCardComponent, TuiExtensionService, TuiExtensionServiceImpl, UserMessageComponent, apply, createTuiChat, displayInlineText, displayText, disposeRootAndExit, inject, mountTui, mountWindowStart, name, sanitizePastedText };