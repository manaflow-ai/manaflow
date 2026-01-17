/**
 * Create test conversations using internal Convex functions.
 * This bypasses auth to create realistic test data.
 *
 * Usage:
 *   cd packages/convex && bunx convex run scripts/create-test-conversations.ts
 */

import { execSync } from "child_process";

const TEAM_ID = "780c4397-90dd-47f1-b336-b8c376039db5"; // Your team ID
const USER_ID = "test-user-for-ios";

interface ConversationPrompt {
  providerId: string;
  prompt: string;
  response: string;
}

const testConversations: ConversationPrompt[] = [
  {
    providerId: "claude",
    prompt: "Help me write a Python function to calculate fibonacci numbers recursively with memoization",
    response: `Here's a Python function that calculates Fibonacci numbers using recursion with memoization:

\`\`\`python
from functools import lru_cache

@lru_cache(maxsize=None)
def fibonacci(n: int) -> int:
    """Calculate the nth Fibonacci number using memoization."""
    if n < 0:
        raise ValueError("n must be non-negative")
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

# Example usage
for i in range(10):
    print(f"fib({i}) = {fibonacci(i)}")
\`\`\`

The \`@lru_cache\` decorator from functools automatically memoizes the function results. This makes the time complexity O(n) instead of O(2^n) for naive recursion.`,
  },
  {
    providerId: "codex",
    prompt: "What's the difference between useState and useReducer in React?",
    response: `**useState vs useReducer**

Both manage state in React functional components, but they're suited for different use cases:

**useState** - Simple state
- Single values or simple objects
- Independent state updates
- Example: \`const [count, setCount] = useState(0)\`

**useReducer** - Complex state
- Multiple sub-values that change together
- State transitions depend on previous state
- More predictable with complex logic

\`\`\`typescript
// useReducer example
const reducer = (state, action) => {
  switch (action.type) {
    case 'increment': return { count: state.count + 1 };
    case 'decrement': return { count: state.count - 1 };
    default: return state;
  }
};

const [state, dispatch] = useReducer(reducer, { count: 0 });
\`\`\`

**Rule of thumb:** Start with useState, switch to useReducer when state logic gets complex.`,
  },
  {
    providerId: "claude",
    prompt: "Explain how to set up a basic Express.js server with TypeScript",
    response: `Here's how to set up an Express.js server with TypeScript:

**1. Initialize project**
\`\`\`bash
mkdir my-server && cd my-server
npm init -y
npm install express
npm install -D typescript @types/express @types/node ts-node nodemon
\`\`\`

**2. Create tsconfig.json**
\`\`\`json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true
  }
}
\`\`\`

**3. Create src/index.ts**
\`\`\`typescript
import express, { Request, Response } from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Hello, TypeScript!' });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});
\`\`\`

**4. Add scripts to package.json**
\`\`\`json
{
  "scripts": {
    "dev": "nodemon --exec ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
\`\`\`

Run with \`npm run dev\` for development!`,
  },
  {
    providerId: "gemini",
    prompt: "What are the best practices for error handling in async/await?",
    response: `**Async/Await Error Handling Best Practices**

**1. Use try/catch blocks**
\`\`\`typescript
async function fetchData() {
  try {
    const response = await fetch('/api/data');
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch:', error);
    throw error; // Re-throw or handle appropriately
  }
}
\`\`\`

**2. Handle errors at the right level**
- Catch where you can meaningfully handle the error
- Don't swallow errors silently

**3. Use error boundaries in React**
\`\`\`typescript
class ErrorBoundary extends React.Component {
  componentDidCatch(error, info) {
    logError(error, info);
  }
  render() {
    return this.props.children;
  }
}
\`\`\`

**4. Create custom error classes**
\`\`\`typescript
class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
\`\`\`

**5. Always clean up resources**
\`\`\`typescript
async function withConnection() {
  const conn = await getConnection();
  try {
    return await doWork(conn);
  } finally {
    await conn.close(); // Always runs
  }
}
\`\`\`

**Key takeaway:** Never ignore errors. Log them, report them, or handle them gracefully.`,
  },
];

async function createConversation(conv: ConversationPrompt) {
  const sessionId = `test-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Create conversation
  const createResult = execSync(
    `bunx convex run conversations:createInternal '${JSON.stringify({
      teamId: TEAM_ID,
      userId: USER_ID,
      sessionId,
      providerId: conv.providerId,
      cwd: "/workspace",
      status: "active",
    })}'`,
    { encoding: "utf-8", cwd: process.cwd() }
  );

  const conversationId = createResult.trim().replace(/"/g, "");
  console.log(`Created conversation: ${conversationId}`);

  // Add user message
  execSync(
    `bunx convex run conversationMessages:create '${JSON.stringify({
      conversationId,
      role: "user",
      content: [{ type: "text", text: conv.prompt }],
    })}'`,
    { encoding: "utf-8", cwd: process.cwd() }
  );
  console.log(`  Added user message`);

  // Add assistant response
  execSync(
    `bunx convex run conversationMessages:create '${JSON.stringify({
      conversationId,
      role: "assistant",
      content: [{ type: "text", text: conv.response }],
    })}'`,
    { encoding: "utf-8", cwd: process.cwd() }
  );
  console.log(`  Added assistant response`);

  return conversationId;
}

async function main() {
  console.log("Creating test conversations...\n");

  for (const conv of testConversations) {
    try {
      await createConversation(conv);
      console.log();
    } catch (error) {
      console.error(`Failed to create conversation:`, error);
    }
  }

  console.log("Done!");
}

main();
