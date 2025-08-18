#!/usr/bin/env node
(async () => {
const { Command } = require('commander');

const openaiImport = await import('openai');
const { AzureOpenAI } = openaiImport;
const inquirerImport = await import('inquirer');
const inquirer = inquirerImport.default;
const fs = require('fs').promises;
const path = require('path');
const chalkImport = await import('chalk');
const chalk = chalkImport.default;
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fetchImport = await import('node-fetch');
const fetch = fetchImport.default;
const glob = require('glob');
const tiktoken = require('tiktoken');
require('dotenv').config();

const program = new Command();
if (!process.env.AZURE_OPENAI_API_KEY || !process.env.AZURE_OPENAI_ENDPOINT || !process.env.AZURE_OPENAI_DEPLOYMENT) {
    console.error(chalk.red('Error: Azure OpenAI environment variables are not set.'));
    process.exit(1);
  }
  
const openai = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    deployment: process.env.AZURE_OPENAI_DEPLOYMENT,
    apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview',
    maxRetries: 15,
    timeout: 1200000
  });



if (!process.env.BING_API_KEY) {
  console.warn(chalk.yellow('Warning: BING_API_KEY not set; search tool disabled.'));
}

// Simple memory store (in-memory for now; persist to file if needed)
const memoryStore = {};

// Function to check if current directory is a Git repository
async function isGitRepository(dir) {
  try {
    await execPromise('git rev-parse --is-inside-work-tree', { cwd: dir });
    return true;
  } catch {
    return false;
  }
}

// Adapted system prompt generation
async function getCoreSystemPrompt(userMemory = '') {
  let systemMdPath = path.resolve(path.join(process.cwd(), '.openai-cli/system.md'));
  if (process.env.OPENAI_SYSTEM_MD) {
    systemMdPath = path.resolve(process.env.OPENAI_SYSTEM_MD);
    if (!await fs.access(systemMdPath).then(() => true).catch(() => false)) {
      console.error(chalk.red(`Missing system prompt file: ${systemMdPath}`));
      process.exit(1);
    }
    return (await fs.readFile(systemMdPath, 'utf8')) + (userMemory ? `\n\n---\n\n${userMemory}` : '');
  }

  const basePrompt = `
You are an interactive CLI agent specializing in software engineering tasks. Your primary goal is to help users safely and efficiently, adhering strictly to the following instructions and utilizing your available tools.

# Core Mandates

- **Conventions:** Rigorously adhere to existing project conventions when reading or modifying code. Analyze surrounding code, tests, and configuration first.
- **Libraries/Frameworks:** NEVER assume a library/framework is available or appropriate. Verify its established usage within the project (check imports, configuration files like 'package.json', 'Cargo.toml', 'requirements.txt', 'build.gradle', etc., or observe neighboring files) before employing it.
- **Style & Structure:** Mimic the style (formatting, naming), structure, framework choices, typing, and architectural patterns of existing code in the project.
- **Idiomatic Changes:** When editing, understand the local context (imports, functions/classes) to ensure your changes integrate naturally and idiomatically.
- **Comments:** Add code comments sparingly. Focus on *why* something is done, especially for complex logic, rather than *what* is done. Only add high-value comments if necessary for clarity or if requested by the user. Do not edit comments that are separate from the code you are changing. *NEVER* talk to the user or describe your changes through comments.
- **Proactiveness:** Fulfill the user's request thoroughly, including reasonable, directly implied follow-up actions.
- **Confirm Ambiguity/Expansion:** Do not take significant actions beyond the clear scope of the request without confirming with the user. If asked *how* to do something, explain first, don't just do it.
- **Explaining Changes:** After completing a code modification or file operation *do not* provide summaries unless asked.
- **Path Construction:** Before using any file system tool (e.g., 'read_file' or 'write_file'), you must construct the full absolute path for the file_path argument. Always combine the absolute path of the project's root directory with the file's path relative to the root. For example, if the project root is /path/to/project/ and the file is foo/bar/baz.txt, the final path you must use is /path/to/project/foo/bar/baz.txt. If the user provides a relative path, you must resolve it against the root directory to create an absolute path.
- **Do Not revert changes:** Do not revert changes to the codebase unless asked to do so by the user. Only revert changes made by you if they have resulted in an error or if the user has explicitly asked you to revert the changes.

# Primary Workflows

## Software Engineering Tasks
When requested to perform tasks like fixing bugs, adding features, refactoring, or explaining code, follow this sequence:
1. **Understand:** Think about the user's request and the relevant codebase context. Use 'grep' and 'ls' search tools extensively (in parallel if independent) to understand file structures, existing code patterns, and conventions. Use 'read_file' to understand context and validate any assumptions you may have.
2. **Plan:** Build a coherent and grounded (based on the understanding in step 1) plan for how you intend to resolve the user's task. Share an extremely concise yet clear plan with the user if it would help the user understand your thought process. As part of the plan, you should try to use a self-verification loop by writing unit tests if relevant to the task. Use output logs or debug statements as part of this self verification loop to arrive at a solution.
3. **Implement:** Use the available tools (e.g., 'edit_file', 'write_file' 'run_shell_command' ...) to act on the plan, strictly adhering to the project's established conventions (detailed under 'Core Mandates').
4. **Verify (Tests):** If applicable and feasible, verify the changes using the project's testing procedures. Identify the correct test commands and frameworks by examining 'README' files, build/package configuration (e.g., 'package.json'), or existing test execution patterns. NEVER assume standard test commands.
5. **Verify (Standards):** VERY IMPORTANT: After making code changes, execute the project-specific build, linting and type-checking commands (e.g., 'tsc', 'npm run lint', 'ruff check .') that you have identified for this project (or obtained from the user). This ensures code quality and adherence to standards. If unsure about these commands, you can ask the user if they'd like you to run them and if so how to.

## New Applications

**Goal:** Autonomously implement and deliver a visually appealing, substantially complete, and functional prototype. Utilize all tools at your disposal to implement the application. Some tools you may especially find useful are 'write_file', 'edit_file' and 'run_shell_command'.

1. **Understand Requirements:** Analyze the user's request to identify core features, desired user experience (UX), visual aesthetic, application type/platform (web, mobile, desktop, CLI, library, 2D or 3D game), and explicit constraints. If critical information for initial planning is missing or ambiguous, ask concise, targeted clarification questions.
2. **Propose Plan:** Formulate an internal development plan. Present a clear, concise, high-level summary to the user. This summary must effectively convey the application's type and core purpose, key technologies to be used, main features and how users will interact with them, and the general approach to the visual design and user experience (UX) with the intention of delivering something beautiful, modern, and polished, especially for UI-based applications. For applications requiring visual assets (like games or rich UIs), briefly describe the strategy for sourcing or generating placeholders (e.g., simple geometric shapes, procedurally generated patterns, or open-source assets if feasible and licenses permit) to ensure a visually complete initial prototype. Ensure this information is presented in a structured and easily digestible manner.
  - When key technologies aren't specified, prefer the following:
  - **Websites (Frontend):** React (JavaScript/TypeScript) with Bootstrap CSS, incorporating Material Design principles for UI/UX.
  - **Back-End APIs:** Node.js with Express.js (JavaScript/TypeScript) or Python with FastAPI.
  - **Full-stack:** Next.js (React/Node.js) using Bootstrap CSS and Material Design principles for the frontend, or Python (Django/Flask) for the backend with a React/Vue.js frontend styled with Bootstrap CSS and Material Design principles.
  - **CLIs:** Python or Go.
  - **Mobile App:** Compose Multiplatform (Kotlin Multiplatform) or Flutter (Dart) using Material Design libraries and principles, when sharing code between Android and iOS. Jetpack Compose (Kotlin JVM) with Material Design principles or SwiftUI (Swift) for native apps targeted at either Android or iOS, respectively.
  - **3d Games:** HTML/CSS/JavaScript with Three.js.
  - **2d Games:** HTML/CSS/JavaScript.
3. **User Approval:** Obtain user approval for the proposed plan.
4. **Implementation:** Autonomously implement each feature and design element per the approved plan utilizing all available tools. When starting ensure you scaffold the application using 'run_shell_command' for commands like 'npm init', 'npx create-react-app'. Aim for full scope completion. Proactively create or source necessary placeholder assets (e.g., images, icons, game sprites, 3D models using basic primitives if complex assets are not generatable) to ensure the application is visually coherent and functional, minimizing reliance on the user to provide these. If the model can generate simple assets (e.g., a uniformly colored square sprite, a simple 3D cube), it should do so. Otherwise, it should clearly indicate what kind of placeholder has been used and, if absolutely necessary, what the user might replace it with. Use placeholders only when essential for progress, intending to replace them with more refined versions or instruct the user on replacement during polishing if generation is not feasible.
5. **Verify:** Review work against the original request, the approved plan. Fix bugs, deviations, and all placeholders where feasible, or ensure placeholders are visually adequate for a prototype. Ensure styling, interactions, produce a high-quality, functional and beautiful prototype aligned with design goals. Finally, but MOST importantly, build the application and ensure there are no compile errors.
6. **Solicit Feedback:** If still applicable, provide instructions on how to start the application and request user feedback on the prototype.

# Operational Guidelines

## Tone and Style (CLI Interaction)
- **Concise & Direct:** Adopt a professional, direct, and concise tone suitable for a CLI environment.
- **Minimal Output:** Aim for fewer than 3 lines of text output (excluding tool use/code generation) per response whenever practical. Focus strictly on the user's query.
- **Clarity over Brevity (When Needed):** While conciseness is key, prioritize clarity for essential explanations or when seeking necessary clarification if a request is ambiguous.
- **No Chitchat:** Avoid conversational filler, preambles ("Okay, I will now..."), or postambles ("I have finished the changes..."). Get straight to the action or answer.
- **Formatting:** Use GitHub-flavored Markdown. Responses will be rendered in monospace.
- **Tools vs. Text:** Use tools for actions, text output *only* for communication. Do not add explanatory comments within tool calls or code blocks unless specifically part of the required code/command itself.
- **Handling Inability:** If unable/unwilling to fulfill a request, state so briefly (1-2 sentences) without excessive justification. Offer alternatives if appropriate.

## Security and Safety Rules
- **Explain Critical Commands:** Before executing commands with 'run_shell_command' that modify the file system, codebase, or system state, you *must* provide a brief explanation of the command's purpose and potential impact. Prioritize user understanding and safety. You should not ask permission to use the tool; the user will be presented with a confirmation dialogue upon use (you do not need to tell them this).
- **Security First:** Always apply security best practices. Never introduce code that exposes, logs, or commits secrets, API keys, or other sensitive information.

## Tool Usage
- **File Paths:** Always use absolute paths when referring to files with tools like 'read_file' or 'write_file'. Relative paths are not supported. You must provide an absolute path.
- **Parallelism:** Execute multiple independent tool calls in parallel when feasible (i.e. searching the codebase).
- **Bing Search:** Use the 'bing_search' tool to fetch real-time information from the web when a query requires up-to-date facts, research, or external knowledge (e.g., current events, library docs, or trends). The tool returns JSON with 'results' array (each with title, snippet, link). ALWAYS parse the JSON, extract the most relevant facts, and synthesize into an exact, concise answer. Do NOT return raw JSON, links, or snippets unless requested—instead, provide the key information directly (e.g., for temperature, extract and state the exact value). If results are inconclusive, state so and suggest alternatives.

// At the end of basePrompt, add examples
# Examples for Search Handling
<example>
Tool Output: {"results": [{"title": "Weather in San Jose", "snippet": "Current temp: 62°F", "link": "accuweather.com"}]}
Response: The current temperature in San Jose is 62°F.
</example>

<example>
User: What is the temperature in San Jose CA?
[Internal: Call bing_search with "current temperature in San Jose CA"]
Tool Output: [JSON with results]
Final Answer: The current temperature in San Jose, CA is 62°F (16°C) at 00:03 local time, with clear conditions.
</example>
- **Command Execution:** Use the 'run_shell_command' tool for running shell commands, remembering the safety rule to explain modifying commands first.
- **Background Processes:** Use background processes (via \`&\`) for commands that are unlikely to stop on their own, e.g. \`node server.js &\`. If unsure, ask the user.
- **Interactive Commands:** Try to avoid shell commands that are likely to require user interaction (e.g. \`git rebase -i\`). Use non-interactive versions of commands (e.g. \`npm init -y\` instead of \`npm init\`) when available, and otherwise remind the user that interactive shell commands are not supported and may cause hangs until canceled by the user.
- **Respect User Confirmations:** Most tool calls (also denoted as 'function calls') will first require confirmation from the user, where they will either approve or cancel the function call. If a user cancels a function call, respect their choice and do _not_ try to make the function call again. It is okay to request the tool call again _only_ if the user requests that same tool call on a subsequent prompt. When a user cancels a function call, assume best intentions from the user and consider inquiring if they prefer any alternative paths forward.
# Sandbox and Git
${await (async () => {
  // Simplified sandbox check (adapt as needed)
  const isSandbox = !!process.env.SANDBOX;
  if (isSandbox) {
    return '# Sandbox\nYou are running in a sandbox with limited access to files outside the project directory or system temp directory, and limited access to host system resources such as ports. If you encounter failures due to sandboxing, explain to the user.';
  } else {
    return '# Outside of Sandbox\nYou are running directly on the user\'s system. For critical commands, remind the user to consider enabling sandboxing.';
  }
})()}

${await (async () => {
  if (await isGitRepository(process.cwd())) {
    return '# Git Repository\n- The current working directory is managed by a git repository.\n- When committing, use run_shell_command for git status, diff, log, etc.\n- Propose draft commit messages.\n- Never push without user request.';
  }
  return '';
})()}

# Final Reminder
Your core function is efficient and safe assistance. Balance extreme conciseness with the crucial need for clarity, especially regarding safety and potential system modifications. Always prioritize user control and project conventions. Never make assumptions about the contents of files; instead use 'read_file' to ensure you aren't making broad assumptions. Finally, you are an agent - please keep going until the user's query is completely resolved.
For every response, use chain-of-thought reasoning with GPT-4.1: Break down your thinking into clear steps before providing the final answer. Structure as:
 [Analysis]
 [Planning]
 [Generate Answer with error handling].
 [Final Answer]
SKIP any step if not needed.
NO PREAMBLE AND POSTAMBLE EVER
`.trim();
  const memorySuffix = userMemory ? `\n\n---\n\n${userMemory}` : '';
  return `${basePrompt}${memorySuffix}`;
}

// Compression prompt (adapted from Gemini)
function getCompressionPrompt() {
  return `
You are the component that summarizes internal chat history into a given structure.

When the conversation history grows too large, you will be invoked to distill the entire history into a concise, structured XML snapshot. This snapshot is CRITICAL, as it will become the agent's *only* memory of the past. The agent will resume its work based solely on this snapshot. All crucial details, plans, errors, and user directives MUST be preserved.

First, you will think through the entire history in a private <scratchpad>. Review the user's overall goal, the agent's actions, tool outputs, file modifications, and any unresolved questions. Identify every piece of information that is essential for future actions.

After your reasoning is complete, generate the final <state_snapshot> XML object. Be incredibly dense with information. Omit any irrelevant conversational filler.

The structure MUST be as follows:

<state_snapshot>
    <overall_goal>
        <!-- A single, concise sentence describing the user's high-level objective. -->
        <!-- Example: "Refactor the authentication service to use a new JWT library." -->
    </overall_goal>

    <key_knowledge>
        <!-- Crucial facts, conventions, and constraints the agent must remember based on the conversation history and interaction with the user. Use bullet points. -->
        <!-- Example:
         - Build Command: \`npm run build\`
         - Testing: Tests are run with \`npm test\`. Test files must end in \`.test.ts\`.
         - API Endpoint: The primary API endpoint is \`https://api.example.com/v2\`.
         
        -->
    </key_knowledge>

    <file_system_state>
        <!-- List files that have been created, read, modified, or deleted. Note their status and critical learnings. -->
        <!-- Example:
         - CWD: \`/home/user/project/src\`
         - READ: \`package.json\` - Confirmed 'axios' is a dependency.
         - MODIFIED: \`services/auth.ts\` - Replaced 'jsonwebtoken' with 'jose'.
         - CREATED: \`tests/new-feature.test.ts\` - Initial test structure for the new feature.
        -->
    </file_system_state>

    <recent_actions>
        <!-- A summary of the last few significant agent actions and their outcomes. Focus on facts. -->
        <!-- Example:
         - Ran \`grep 'old_function'\` which returned 3 results in 2 files.
         - Ran \`npm run test\`, which failed due to a snapshot mismatch in \`UserProfile.test.ts\`.
         - Ran \`ls -F static/\` and discovered image assets are stored as \`.webp\`.
        -->
    </recent_actions>

    <current_plan>
        <!-- The agent's step-by-step plan. Mark completed steps. -->
        <!-- Example:
         1. [DONE] Identify all files using the deprecated 'UserAPI'.
         2. [IN PROGRESS] Refactor \`src/components/UserProfile.tsx\` to use the new 'ProfileAPI'.
         3. [TODO] Refactor the remaining files.
         4. [TODO] Update tests to reflect the API change.
        -->
    </current_plan>
</state_snapshot>`.trim();
}

// Compress history if too long
async function compressHistory(conversation) {
    const encoder = tiktoken.encoding_for_model('gpt-4o');
    const tokenCount = conversation.reduce((sum, msg) => {
      if (msg && msg.content && typeof msg.content === 'string') {  // Add null/undefined/type check
        return sum + encoder.encode(msg.content).length;
      }
      return sum;  // Skip invalid messages
    }, 0);
    if (tokenCount < 5000) return conversation;

  const summaryResponse = await openai.chat.completions.create({
    model: 'gpt-4.1',
    stream: true,
    messages: [{ role: 'system', content: getCompressionPrompt() }, { role: 'user', content: JSON.stringify(conversation) }],
  });
  const snapshot = summaryResponse.choices[0].message.content;
  return [{ role: 'system', content: await getCoreSystemPrompt() }, { role: 'assistant', content: `History snapshot: ${snapshot}` }];
}

// Define tools (added glob, read_many_files, memory)
const tools = [
 {
      type: 'function',
      function: {
        name: 'run_shell_command',
        description: 'Run a safe shell command and return output. Only use for non-destructive commands.',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: 'The shell command to run' } },
          required: ['command'],
        },
      },
    },
    {
        type: 'function',
        function: {
          name: 'bing_search',
          description: 'Perform a search to get real-time information, including current dates, times, news, or facts. Use for any time-sensitive or external data needs.',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string', description: 'The search query, e.g., "current date and time"' } },
            required: ['query'],
          },
        },
      },
      
   
    {
      type: 'function',
      function: {
        name: 'ls',
        description: 'List files in a directory',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string', description: 'Absolute directory path' } },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the content of a file',
        parameters: {
          type: 'object',
          properties: { file_path: { type: 'string', description: 'Absolute file path' } },
          required: ['file_path'],
        },
      },
    },
    // {
    //   type: 'function',
    //   function: {
    //     name: 'write_file',
    //     description: 'Write content to a file (with confirmation)',
    //     parameters: {
    //       type: 'object',
    //       properties: {
    //         file_path: { type: 'string', description: 'Absolute file path' },
    //         content: { type: 'string', description: 'Content to write' }
    //       },
    //       required: ['file_path', 'content'],
    //     },
    //   },
    // },
    {
      type: 'function',
      function: {
        name: 'grep',
        description: 'Search for a pattern in files',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Search pattern' },
            path: { type: 'string', description: 'Absolute path to search in' }
          },
          required: ['pattern', 'path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Edit a file by replacing or appending content',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Absolute file path' },
            new_content: { type: 'string', description: 'New content to replace with' }
          },
          required: ['file_path', 'new_content'],
        },
      },
    },

  
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files matching a pattern',
      parameters: {
        type: 'object',
        properties: { pattern: { type: 'string', description: 'Glob pattern, e.g., **/*.js' } },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_many_files',
      description: 'Read contents of multiple files',
      parameters: {
        type: 'object',
        properties: { file_paths: { type: 'array', items: { type: 'string' }, description: 'Array of absolute file paths' } },
        required: ['file_paths'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory',
      description: 'Store or recall user-specific facts',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['store', 'recall'], description: 'store or recall' },
          key: { type: 'string' },
          value: { type: 'string' }
        },
        required: ['action', 'key'],
      },
    },
  },
  // Other tools from previous...
];

// Updated executeTool (added handlers)
async function executeTool(toolCall) {
  const { name, arguments: args } = toolCall.function;
  const parsedArgs = JSON.parse(args);

  switch (name) {
   
    case 'run_shell_command':
      const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Run command: ${parsedArgs.command}?` }]);
      if (!confirm) return 'Command execution cancelled by user.';
      try {
        const { stdout, stderr } = await execPromise(parsedArgs.command);
        return stderr ? `Error: ${stderr}` : `Output: ${stdout}`;
      } catch (error) {
        return `Execution error: ${error.message}`;
      }
      case 'bing_search':
        try {
          const { getJson } = await import('serpapi');
          const results = await getJson({
            engine: 'bing',
            api_key: process.env.BING_API_KEY,
            q: encodeURIComponent(parsedArgs.query),
            count: 5,  // Adjust as needed
            mkt: 'en-US'  // Market/language
          });
          if (results.organic_results) {
            return results.organic_results.map(item => `Title: ${item.title}\nSnippet: ${item.snippet}\nLink: ${item.link}`).join('\n\n');
          } else {
            return 'No search results found.';
          }
        } catch (error) {
          return `Search error: ${error.message}`;
        }
      
   
    case 'ls':
      try {
        const files = await fs.readdir(parsedArgs.path);
        return files.join('\n');
      } catch (error) {
        return `LS error: ${error.message}`;
      }
    case 'read_file':
      try {
        return await fs.readFile(parsedArgs.file_path, 'utf-8');
      } catch (error) {
        return `Read error: ${error.message}`;
      }
    // case 'write_file':
    //   const writeConfirm = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Write to ${parsedArgs.file_path}?` }]);
     
      
    //   if (!writeConfirm.confirm) return 'Write cancelled.';
    //   try {
    //     await fs.writeFile(parsedArgs.file_path, parsedArgs.content);
    //     return 'File written successfully.';
    //   } catch (error) {
    //     return `Write error: ${error.message}`;
    //   }
    case 'grep':
      try {
        const files = glob.sync(`${parsedArgs.path}/**/*`);
        let results = [];
        for (const file of files) {
          const content = await fs.readFile(file, 'utf-8');
          if (content.includes(parsedArgs.pattern)) {
            results.push(`Found in ${file}`);
          }
        }
        return results.join('\n') || 'No matches found.';
      } catch (error) {
        return `Grep error: ${error.message}`;
      }
    case 'edit_file':
      const editConfirm = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: `Edit ${parsedArgs.file_path}?` }]);
      if (!editConfirm.confirm) return 'Edit cancelled.';
      try {
        await fs.writeFile(parsedArgs.file_path, parsedArgs.new_content);
        return 'File edited successfully.';
      } catch (error) {
        return `Edit error: ${error.message}`;
      }
    case 'glob':
      try {
        const files = glob.sync(parsedArgs.pattern, { absolute: true });
        return files.join('\n');
      } catch (error) {
        return `Glob error: ${error.message}`;
      }
    case 'read_many_files':
      try {
        const contents = {};
        for (const fp of parsedArgs.file_paths) {
          contents[fp] = await fs.readFile(fp, 'utf-8');
        }
        return JSON.stringify(contents);
      } catch (error) {
        return `Read many error: ${error.message}`;
      }
    case 'memory':
      if (parsedArgs.action === 'store') {
        memoryStore[parsedArgs.key] = parsedArgs.value;
        return 'Stored.';
      } else if (parsedArgs.action === 'recall') {
        return memoryStore[parsedArgs.key] || 'Not found.';
      }
      return 'Invalid action.';

    default:
      return 'Unknown tool.';
  }
}

async function getAIResponse(messages, thinkingInterval, model = 'gpt-4.1') {
    let currentMessages = await compressHistory(messages);
    let toolCallRounds = 0;
    const maxRounds = 2;  // Lowered to reduce long thinking
    const timeoutPromise = (promise, ms) => new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('Operation timed out')), ms);
      promise.then(resolve, reject).finally(() => clearTimeout(timeoutId));
    });
    while (toolCallRounds < maxRounds) {
      try {
        const completion = await timeoutPromise(openai.chat.completions.create({
          model,
          messages: currentMessages,
          tools,
          tool_choice: 'auto',
          temperature: 0.1
        }), 240000);
  
        const responseMessage = completion.choices[0].message;
        currentMessages.push(responseMessage);
  
        if (!responseMessage.tool_calls) {
          // Clear spinner before returning final response
          if (thinkingInterval) {
            clearInterval(thinkingInterval);
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
          }
          return responseMessage.content.trim();
        }
  
        for (const toolCall of responseMessage.tool_calls) {
          if (process.env.DEBUG == 'true') {
            console.log('Tool Call:', toolCall);
          }
          // Pause spinner before tool
          if (thinkingInterval) {
            clearInterval(thinkingInterval);
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
          }
  
          const toolResponse = await executeTool(toolCall);
  
          // Resume spinner after tool
          process.stdout.write(chalk.yellow('Thinking'));
          dots = 0;
          thinkingInterval = setInterval(() => {
            process.stdout.write('.');
            dots++;
            if (dots > 3) {
              process.stdout.clearLine(0);
              process.stdout.cursorTo(0);
              process.stdout.write(chalk.yellow('Thinking'));
              dots = 0;
            }
          }, 500);
  
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: toolResponse,
          });
        }
  
        toolCallRounds++;
      } catch (error) {
        console.error(chalk.red('API Error:'), error.message);
        return 'Error occurred during processing. Please try again or check logs.';
      }
    }
  
    return 'Max tool call rounds reached. Please try again.';
  }
  
  
  function formatResponse(response) {
    // Check for exact answer structure
    const exactMatch = response.match(/Exact Answer:([\s\S]*?)(Links:[\s\S]*?)?$/);
    if (exactMatch) {
      const exact = chalk.bold(exactMatch[1].trim());
      const links = exactMatch[2] ? chalk.dim(exactMatch[2].trim()) : '';
      return `${exact}\n${links}`;
    }
  
    // Existing code block extraction and fallback
    const codeBlocks = response.match(/``````/g);
    if (codeBlocks) {
      let codeOutput = '';
      codeBlocks.forEach(block => {
        const code = block.replace(/``````/g, '').trim();
        codeOutput += chalk.bgBlack.white(code) + '\n\n';
      });
      return codeOutput.trim();
    }
  
    response = response.replace(/\*\*(.*?)\*\*/g, chalk.bold('$1'));
    response = response.replace(/``````/g, chalk.bgBlack.white('$1'));
    response = response.replace(/^- (.*)/gm, chalk.green('• $1'));
    return response;
  }
  

// Interactive REPL mode
async function repl() {
  console.log(chalk.green('Welcome to Enhanced OpenAI CLI! Type "exit" to quit, "/help" for info.'));
  const systemPrompt = await getCoreSystemPrompt();
  let conversation = [{ role: 'system', content: systemPrompt }];

  while (true) {
    try{
    const { prompt } = await inquirer.prompt([{ type: 'input', name: 'prompt', message: 'You:' }]);
    if (prompt.toLowerCase() === 'exit') break;

    if (prompt.startsWith('/')) {
      if (prompt === '/help') {
        console.log(chalk.yellow('Help: Use chat for AI, /refactor <file>, /explain <file>, etc. Tools auto-called.'));
        continue;
      } else if (prompt === '/bug') {
        console.log(chalk.yellow('Report bugs to: [your feedback channel]'));
        continue;
      }
      await handleCommand(prompt, conversation);
    } else {
      conversation.push({ role: 'user', content: prompt });
       // Start thinking indicator
       process.stdout.write(chalk.yellow('Thinking'));
       let dots = 0;
       const thinkingInterval = setInterval(() => {
         process.stdout.write('.');
         dots++;
         if (dots > 3) {
           process.stdout.clearLine(0);
           process.stdout.cursorTo(0);
           process.stdout.write(chalk.yellow('Thinking'));
           dots = 0;
         }
       }, 500);
       let response;
        try {
          response = await getAIResponse(conversation, thinkingInterval);  // Now with timeout
        } catch (error) {
          response = `Error: ${error.message}. Try simplifying the query.`;
        } finally {
             // Stop thinking indicator
          clearInterval(thinkingInterval);
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
        }
       
     
        const formatted = formatResponse(response);
        console.log(chalk.blue('AI:'), formatted);
      conversation.push({ role: 'assistant', content: response });
    }
  }
  catch(error){
    if (error.name === 'ExitPromptError') {
        console.log(chalk.yellow('\nExiting CLI. Goodbye!'));
        process.exit(0);
      } else {
        console.error(chalk.red('Unexpected error:'), error.message);
        //process.exit(1);
      }
  }
}

}



async function handleCommand(input, conversation) {
    const parts = input.slice(1).split(' ');
    const cmd = parts[0];
    const arg = parts.slice(1).join(' ');

    let filePath, content;
    if (arg) filePath = path.resolve(arg);

    switch (cmd) {
      case 'refactor':
        if (!filePath) {
          const { file } = await inquirer.prompt([{ type: 'input', name: 'file', message: 'Enter file path:' }]);
          filePath = path.resolve(file);
        }
        try {
          content = await fs.readFile(filePath, 'utf-8');
        } catch (err) {
          console.error(chalk.red('File read error:'), err.message);
          return;
        }
        conversation.push({ role: 'user', content: `Refactor this code:\n${content}` });
        const refactored = await getAIResponse(conversation);
        console.log(chalk.blue('Refactored Code:'), refactored);

        const { confirm } = await inquirer.prompt([{ type: 'confirm', name: 'confirm', message: 'Write to file?' }]);
        if (confirm) {
          // Strip Markdown code fences if present
          const cleanRefactored = refactored.replace(/^```$/, '').trim();
          await fs.writeFile(filePath, cleanRefactored);
          console.log(chalk.green('File updated!'));
        }
        break;

      case 'explain':
        if (!filePath) {
          const { file } = await inquirer.prompt([{ type: 'input', name: 'file', message: 'Enter file path:' }]);
          filePath = path.resolve(file);
        }
        try {
          content = await fs.readFile(filePath, 'utf-8');
        } catch (err) {
          console.error(chalk.red('File read error:'), err.message);
          return;
        }
        conversation.push({ role: 'user', content: `Explain this code:\n${content}` });
        const explanation = await getAIResponse(conversation);
        console.log(chalk.blue('Explanation:'), explanation);
        break;

      case 'generate':
        conversation.push({ role: 'user', content: `Generate code for: ${arg}` });
        const generated = await getAIResponse(conversation);
        console.log(chalk.blue('Generated Code:'), generated);

        const { file } = await inquirer.prompt([{ type: 'input', name: 'file', message: 'Save to file (leave blank to skip):' }]);
        if (file) {
          await fs.writeFile(path.resolve(file), generated);
          console.log(chalk.green('File created!'));
        }
        break;

      case 'debug':
        conversation.push({ role: 'user', content: `Debug this: ${arg}` });
        const debugInfo = await getAIResponse(conversation);
        console.log(chalk.blue('Debug Suggestions:'), debugInfo);
        break;

      default:
        console.log(chalk.yellow('Unknown command. Try /refactor, /explain, /generate, or /debug.'));
    }
  }

program
  .name('openai-cli')
  .description('OpenAI CLI with extensive Gemini-like features')
  .action(repl);

program.parse(process.argv);
})();

