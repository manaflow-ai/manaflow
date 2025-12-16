import { APITester } from "./APITester";
import { useEffect } from "react";
import { initCmuxComments } from "./cmux-comments/cmux-comments";
import "./zindex.css";
import "./index.css";

import logo from "./logo.svg";
import reactLogo from "./react.svg";

export function App() {
  useEffect(() => {
    // Initialize cmux-comments widget with local Convex URL
    const cleanup = initCmuxComments("http://localhost:9777");
    
    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  return (
    <div className="max-w-7xl mx-auto p-8 text-center relative z-10">
      <div className="flex justify-center items-center gap-8 mb-8">
        <img
          src={logo}
          alt="Bun Logo"
          className="h-24 p-6 transition-all duration-300 hover:drop-shadow-[0_0_2em_#646cffaa] scale-120"
        />
        <img
          src={reactLogo}
          alt="React Logo"
          className="h-24 p-6 transition-all duration-300 hover:drop-shadow-[0_0_2em_#61dafbaa] animate-[spin_20s_linear_infinite]"
        />
      </div>

      <h1 className="text-5xl font-bold my-4 leading-tight">Bun + React</h1>
      <p>
        Edit{" "}
        <code className="bg-[#1a1a1a] px-2 py-1 rounded font-mono">
          src/App.tsx
        </code>{" "}
        and save to test HMR
      </p>
      <p className="mt-4 text-sm text-gray-500">
        Press "C" to add a comment anywhere on the page. The widget supports dark mode!
      </p>
      <p className="text-xs text-gray-400 mt-2">
        After pressing "C", a cursor indicator will follow your mouse. Click to place a comment.
      </p>
      
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-6 bg-gray-100 rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Feature 1</h2>
          <p>Click anywhere on this card to add a comment about this feature.</p>
        </div>
        <div className="p-6 bg-gray-100 rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Feature 2</h2>
          <p>Comments are anchored to specific elements and persist across page loads.</p>
        </div>
        <div className="p-6 bg-gray-100 rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Feature 3</h2>
          <p>The widget uses Shadow DOM to isolate styles from your application.</p>
        </div>
        <div className="p-6 bg-gray-100 rounded-lg">
          <h2 className="text-xl font-semibold mb-2">Feature 4</h2>
          <p>Comments support different screen sizes and responsive layouts.</p>
        </div>
      </div>
      
      <APITester />
    </div>
  );
}

export default App;
