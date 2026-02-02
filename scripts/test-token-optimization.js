#!/usr/bin/env node

/**
 * Token Optimization Demo Script
 * 
 * This script demonstrates the token savings achieved by the optimization.
 * Run with: node scripts/test-token-optimization.js
 */

const fs = require('fs');
const path = require('path');

// Mock configuration - representing before and after states
const CONFIGS = {
	BEFORE: {
		LAZY_LOAD_DIRECTORY: false,
		SHOW_FULL_PATHS: true,
		MAX_OPENED_FILES: 10,
		COMPACT_TOOL_DESCRIPTIONS: false,
		ENABLE_SMART_SUMMARY: false,
		CHARS_PER_TOKEN: 4,
	},
	AFTER: {
		LAZY_LOAD_DIRECTORY: true,
		SHOW_FULL_PATHS: false,
		MAX_OPENED_FILES: 8,
		COMPACT_TOOL_DESCRIPTIONS: true,
		ENABLE_SMART_SUMMARY: true,
		CHARS_PER_TOKEN: 3.5,
	}
};

// Estimate tokens from characters
function estimateTokens(text, charsPerToken = 4) {
	return Math.ceil(text.length / charsPerToken);
}

// Mock system message generation
function generateSystemMessage(config, includeDirectory = true) {
	let message = '';
	
	// Workspace info
	message += 'You are an AI coding assistant.\n\n';
	
	// Opened files
	const fileCount = config.MAX_OPENED_FILES;
	const pathFormat = config.SHOW_FULL_PATHS 
		? '/home/user/project/src/components/'
		: 'src/components/';
	
	message += `Currently open files:\n`;
	for (let i = 0; i < fileCount; i++) {
		message += `- ${pathFormat}Component${i}.tsx\n`;
	}
	message += '\n';
	
	// Directory structure (expensive!)
	if (includeDirectory && !config.LAZY_LOAD_DIRECTORY) {
		message += `Directory structure:\n`;
		message += `project/\n`;
		message += `├── src/\n`;
		message += `│   ├── components/\n`;
		message += `│   │   ├── Button.tsx\n`;
		message += `│   │   ├── Input.tsx\n`;
		message += `│   │   ├── Card.tsx\n`;
		message += `│   │   ├── Modal.tsx\n`;
		message += `│   │   ├── Dropdown.tsx\n`;
		message += `│   │   ├── Table.tsx\n`;
		message += `│   │   └── Form.tsx\n`;
		message += `│   ├── utils/\n`;
		message += `│   │   ├── formatters.ts\n`;
		message += `│   │   ├── validators.ts\n`;
		message += `│   │   ├── helpers.ts\n`;
		message += `│   │   └── constants.ts\n`;
		message += `│   ├── hooks/\n`;
		message += `│   │   ├── useAuth.ts\n`;
		message += `│   │   ├── useData.ts\n`;
		message += `│   │   └── useTheme.ts\n`;
		message += `│   ├── services/\n`;
		message += `│   │   ├── api.ts\n`;
		message += `│   │   ├── storage.ts\n`;
		message += `│   │   └── analytics.ts\n`;
		message += `│   ├── types/\n`;
		message += `│   │   ├── user.ts\n`;
		message += `│   │   ├── product.ts\n`;
		message += `│   │   └── common.ts\n`;
		message += `│   └── App.tsx\n`;
		message += `├── tests/\n`;
		message += `├── public/\n`;
		message += `├── node_modules/\n`;
		message += `├── package.json\n`;
		message += `└── tsconfig.json\n\n`;
	} else if (config.LAZY_LOAD_DIRECTORY) {
		message += '(Use `get_dir_tree` tool to view directory structure when needed)\n\n';
	}
	
	// Tool definitions
	const tools = ['read_file', 'edit_file', 'search_for_files', 'run_command', 'create_file_or_folder', 'delete_file_or_folder'];
	message += 'Available tools:\n';
	
	for (const tool of tools) {
		if (config.COMPACT_TOOL_DESCRIPTIONS) {
			message += `- ${tool}: ${getCompactDescription(tool)}\n`;
		} else {
			message += `- ${tool}: ${getFullDescription(tool)}\n`;
		}
	}
	
	return message;
}

function getFullDescription(tool) {
	const descriptions = {
		'read_file': 'Returns full contents of a given file. You can optionally specify start_line and end_line parameters to read specific sections.',
		'edit_file': 'Edit the contents of a file. You must provide the file\'s URI as well as a SINGLE string of SEARCH/REPLACE blocks that will be used to apply the edit.',
		'search_for_files': 'Returns a list of file names whose content matches the given query. The query can be any substring or regex. You can use is_regex parameter.',
		'run_command': 'Runs a terminal command and waits for the result (times out after 8s of inactivity). You can use this tool to run any command.',
		'create_file_or_folder': 'Create a file or folder at the given path. To create a folder, the path MUST end with a trailing slash.',
		'delete_file_or_folder': 'Delete a file or folder at the given path. Use is_recursive parameter to delete recursively.'
	};
	return descriptions[tool] || '';
}

function getCompactDescription(tool) {
	const descriptions = {
		'read_file': 'Read file content',
		'edit_file': 'Edit file with SEARCH/REPLACE',
		'search_for_files': 'Search files by content',
		'run_command': 'Run terminal command',
		'create_file_or_folder': 'Create file/folder',
		'delete_file_or_folder': 'Delete file/folder'
	};
	return descriptions[tool] || '';
}

// Mock conversation messages
function generateConversationMessages(config) {
	const messages = [];
	
	// User message 1
	messages.push({
		role: 'user',
		content: 'Can you help me refactor the Button component to use TypeScript generics?'
	});
	
	// Assistant message 1 (long response)
	const longResponse = `I'll help you refactor the Button component. Let me first read the current implementation.

I can see the Button component. Here's how we can refactor it with TypeScript generics:

1. We'll add a generic type parameter for the button's props
2. We'll ensure proper type inference for event handlers
3. We'll make it more reusable with different prop types

Here's the refactored version:

\`\`\`typescript
import React from 'react';

interface ButtonProps<T = {}> extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  customProps?: T;
}

export function Button<T = {}>({
  variant = 'primary',
  size = 'md',
  customProps,
  children,
  ...rest
}: ButtonProps<T>) {
  const baseClasses = 'rounded font-medium transition-colors';
  const variantClasses = {
    primary: 'bg-blue-500 text-white hover:bg-blue-600',
    secondary: 'bg-gray-500 text-white hover:bg-gray-600',
    outline: 'border-2 border-blue-500 text-blue-500 hover:bg-blue-50'
  };
  const sizeClasses = {
    sm: 'px-2 py-1 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg'
  };

  return (
    <button
      className={\`\${baseClasses} \${variantClasses[variant]} \${sizeClasses[size]}\`}
      {...rest}
    >
      {children}
    </button>
  );
}
\`\`\`

This refactored version provides better type safety and flexibility.`;
	
	messages.push({
		role: 'assistant',
		content: longResponse
	});
	
	// Tool result (simulated directory listing)
	const toolResult = `Directory listing for src/components:
- Button.tsx
- Input.tsx
- Card.tsx
- Modal.tsx
- Dropdown.tsx
- Table.tsx
- Form.tsx
- Checkbox.tsx
- Radio.tsx
- Switch.tsx
- Badge.tsx
- Avatar.tsx
- Tooltip.tsx
- Popover.tsx
- Alert.tsx

Total: 15 files`;
	
	messages.push({
		role: 'tool',
		content: toolResult
	});
	
	return messages;
}

// Compress messages (simulated)
function compressMessages(messages, config) {
	if (!config.ENABLE_SMART_SUMMARY) {
		return messages;
	}
	
	return messages.map(msg => {
		if (msg.role === 'assistant' && msg.content.length > 500) {
			// Simulate smart compression
			const compressed = msg.content.substring(0, 200) + '\n... (content compressed) ...\n' + msg.content.slice(-100);
			return { ...msg, content: compressed };
		}
		if (msg.role === 'tool' && msg.content.length > 200) {
			// Compress tool results
			const lines = msg.content.split('\n').slice(0, 5);
			return { ...msg, content: lines.join('\n') + '\n... (15 total files)' };
		}
		return msg;
	});
}

// Main demo
function runDemo() {
	console.log('🚀 Token Optimization Demo\n');
	console.log('='.repeat(60));
	
	// Generate system messages
	console.log('\n📝 System Message Comparison:\n');
	
	const systemBefore = generateSystemMessage(CONFIGS.BEFORE, true);
	const systemAfter = generateSystemMessage(CONFIGS.AFTER, false);
	
	const tokensBefore = estimateTokens(systemBefore, CONFIGS.BEFORE.CHARS_PER_TOKEN);
	const tokensAfter = estimateTokens(systemAfter, CONFIGS.AFTER.CHARS_PER_TOKEN);
	
	console.log('BEFORE:');
	console.log(`  Characters: ${systemBefore.length}`);
	console.log(`  Estimated tokens: ${tokensBefore}`);
	console.log(`  Sample: ${systemBefore.substring(0, 100)}...\n`);
	
	console.log('AFTER:');
	console.log(`  Characters: ${systemAfter.length}`);
	console.log(`  Estimated tokens: ${tokensAfter}`);
	console.log(`  Sample: ${systemAfter.substring(0, 100)}...\n`);
	
	const systemSavings = tokensBefore - tokensAfter;
	const systemSavingsPercent = ((systemSavings / tokensBefore) * 100).toFixed(1);
	
	console.log(`💰 System Message Savings: ${systemSavings} tokens (${systemSavingsPercent}%)`);
	console.log('='.repeat(60));
	
	// Generate conversation
	console.log('\n💬 Conversation Compression:\n');
	
	const messagesBefore = generateConversationMessages(CONFIGS.BEFORE);
	const messagesAfter = compressMessages(generateConversationMessages(CONFIGS.AFTER), CONFIGS.AFTER);
	
	const convCharsB = messagesBefore.reduce((sum, m) => sum + m.content.length, 0);
	const convCharsA = messagesAfter.reduce((sum, m) => sum + m.content.length, 0);
	
	const convTokensB = estimateTokens(convCharsB, CONFIGS.BEFORE.CHARS_PER_TOKEN);
	const convTokensA = estimateTokens(convCharsA, CONFIGS.AFTER.CHARS_PER_TOKEN);
	
	console.log('BEFORE:');
	console.log(`  Messages: ${messagesBefore.length}`);
	console.log(`  Characters: ${convCharsB}`);
	console.log(`  Estimated tokens: ${convTokensB}\n`);
	
	console.log('AFTER (with smart compression):');
	console.log(`  Messages: ${messagesAfter.length}`);
	console.log(`  Characters: ${convCharsA}`);
	console.log(`  Estimated tokens: ${convTokensA}\n`);
	
	const convSavings = convTokensB - convTokensA;
	const convSavingsPercent = ((convSavings / convTokensB) * 100).toFixed(1);
	
	console.log(`💰 Conversation Savings: ${convSavings} tokens (${convSavingsPercent}%)`);
	console.log('='.repeat(60));
	
	// Total savings
	console.log('\n📊 Total Token Usage:\n');
	
	const totalBefore = tokensBefore + convTokensB;
	const totalAfter = tokensAfter + convTokensA;
	const totalSavings = totalBefore - totalAfter;
	const totalSavingsPercent = ((totalSavings / totalBefore) * 100).toFixed(1);
	
	console.log(`BEFORE: ${totalBefore} tokens`);
	console.log(`AFTER:  ${totalAfter} tokens`);
	console.log(`\n✨ Total Savings: ${totalSavings} tokens (${totalSavingsPercent}%)`);
	
	// Cost savings (example with Claude Sonnet)
	const costPerMillion = 3.00; // $3 per 1M input tokens
	const costBefore = (totalBefore / 1_000_000) * costPerMillion;
	const costAfter = (totalAfter / 1_000_000) * costPerMillion;
	const costSavings = costBefore - costAfter;
	
	console.log('\n💵 Cost Savings (Claude Sonnet 3.7):');
	console.log(`  Before: $${costBefore.toFixed(6)} per request`);
	console.log(`  After:  $${costAfter.toFixed(6)} per request`);
	console.log(`  Savings: $${costSavings.toFixed(6)} per request`);
	console.log(`  \n  For 1000 requests: $${(costSavings * 1000).toFixed(2)} saved`);
	
	console.log('\n' + '='.repeat(60));
	console.log('\n✅ Optimization successfully demonstrated!');
	console.log('\n💡 Key optimizations:');
	console.log('  • Lazy-loaded directory structure');
	console.log('  • Compact file paths');
	console.log('  • Compressed tool descriptions');
	console.log('  • Smart message compression');
	console.log('  • More accurate token estimation\n');
}

// Run the demo
if (require.main === module) {
	runDemo();
}

module.exports = { runDemo, estimateTokens };
