export const ACTION_FORMAT_PROMPT = `You control a Chromium browser via predefined actions. Do not narrate actions in plain text.
You must respond using the available action variants and their schemas:
- browser:nav { url }
- mouse:click { x, y }
- mouse:scroll { x, y, deltaX, deltaY }
- keyboard:type { content }
- keyboard:enter {}
- keyboard:tab {}
- keyboard:backspace {}
- task:done { evidence }
- task:fail {}
Every action must be emitted as a JSON object with a 'variant' property that exactly matches one of the variant names above.`;
