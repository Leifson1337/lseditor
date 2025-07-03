import React, { useState, useRef, useEffect, useCallback } from 'react';
import './AIChatPanel.css';
import '../styles/AIChatPanel-fixes.css';
import { formatFileSize } from '../utils/fileUtils';
import { store } from '../store/store';
import OpenAI from 'openai';
import { toast } from 'react-toastify';
// @ts-ignore - diff package has no type definitions
import { diffLines, Change } from 'diff';

// Copy to clipboard function
const copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Code in die Zwischenablage kopiert');
  } catch (err) {
    console.error('Fehler beim Kopieren in die Zwischenablage:', err);
    toast.error('Fehler beim Kopieren in die Zwischenablage');
  }
};

// Icons
const SendIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
    <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
  </svg>
);

const FileIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
    <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
  </svg>
);

const CodeIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
    <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
  </svg>
);

const LightbulbIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
    <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36-.98 1.37-2.58 2.26-4.4 2.26-2.98 0-5.4-2.42-5.4-5.4 0-1.81.89-3.42 2.26-4.4-.44-.06-.9-.1-1.36-.1z" />
  </svg>
);

// Describes a single code change with before/after content
export interface CodeChange {
  filePath: string;
  oldContent: string;
  newContent: string;
  startLine: number;
  endLine: number;
  description?: string;
}

// ChatMessage describes a single message in the AI chat panel
export interface ChatMessage {
  id: string;
  content: string;
  sender: 'user' | 'ai' | 'system';
  timestamp: Date;
  codeSnippet?: string;
  filePath?: string;
  fileContent?: string;
  needsConfirmation?: boolean;
  isAnalyzing?: boolean;
  isFileOperation?: boolean;
  codeChanges?: CodeChange[]; // Track multiple code changes
  isCodeProposal?: boolean; // Whether this message contains code proposals
}

// AIChatPanel provides a simple chat interface for user/AI interaction
interface AIChatPanelProps {
  style?: React.CSSProperties;
  onCodeProposal?: (code: string, filePath?: string) => void;
  readFile?: (path: string) => Promise<string>;
  fileStructure?: Array<{
    name: string;
    path: string;
    type: 'file' | 'directory';
    children?: any[];
  }>;
  projectPath?: string;
  // Add new props for controlled messages
  messages?: ChatMessage[];
  onMessagesChange?: (messages: ChatMessage[]) => void;
}

interface AIChatPanelState {
  position: 'left' | 'right';
}

const AIChatPanel: React.FC<AIChatPanelProps> = ({ 
  style, 
  onCodeProposal, 
  readFile, 
  fileStructure = [],
  projectPath = '',
  messages: externalMessages = [],
  onMessagesChange
}) => {
  const [position, setPosition] = useState<'left' | 'right'>('left');
  const [selectedModel, setSelectedModel] = useState('llama-3.3-70b-versatile');
  const [pendingCode, setPendingCode] = useState<{code: string; filePath?: string} | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  
  // Use controlled messages if provided, otherwise use local state
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>([]);
  const isControlled = onMessagesChange !== undefined;
  const messages = isControlled ? externalMessages : localMessages;
  
  // Create a stable reference to the current messages
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  
  // Create a type-safe setMessages function
  const setMessages = useCallback((newMessages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    if (isControlled) {
      if (typeof newMessages === 'function') {
        onMessagesChange?.(newMessages([...messagesRef.current]));
      } else {
        onMessagesChange?.(newMessages);
      }
    } else {
      if (typeof newMessages === 'function') {
        setLocalMessages(prev => newMessages([...prev]));
      } else {
        setLocalMessages(newMessages);
      }
    }
  }, [isControlled, onMessagesChange]);
  
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // List of supported models with display names
  const SUPPORTED_MODELS = [
    { id: 'llama3-8b-8192', name: 'Llama 3 8B' },
    { id: 'llama3-70b-8192', name: 'Llama 3 70B' },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
    { id: 'gemma-7b-it', name: 'Gemma 7B' },
  ];
  
  // Load saved model from store on component mount
  useEffect(() => {
    const savedModel = store.get('ai')?.model;
    if (savedModel) {
      setSelectedModel(savedModel);
    }
  }, []);
  
  const togglePosition = () => {
    setPosition(prev => prev === 'left' ? 'right' : 'left');
  };
  
  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModel = e.target.value;
    setSelectedModel(newModel);
    
    // Update the store with the new model
    const currentSettings = store.get('ai') || {};
    store.set('ai', {
      ...currentSettings,
      model: newModel
    });
    
    // Update the AIService configuration
    const aiService = store.aiService;
    if (aiService) {
      // Store the current configuration
      const currentConfig = { ...aiService['config'] };
      
      // Update the model in the configuration
      const updatedConfig = {
        ...currentConfig,
        model: newModel,
        openAIConfig: {
          ...currentConfig.openAIConfig,
          model: newModel
        }
      };
      
      // Update the configuration directly (using type assertion to bypass TypeScript)
      (aiService as any).config = updatedConfig;
      
      // If using OpenAI, update the client with the new model
      if (aiService['openai']) {
        aiService['openai'] = new OpenAI({
          apiKey: currentConfig.openAIConfig?.apiKey || '',
          dangerouslyAllowBrowser: true
        });
      }
    }
  };
  const GROQ_API_KEY = 'Your API Key';
  const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

  // Debug effect to log messages when they change
  useEffect(() => {
    console.log('Current messages:', messages);
  }, [messages]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior
      });
    }
  }, []);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Scroll to bottom immediately when component mounts
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToBottom('auto');
    }, 100);
    return () => clearTimeout(timer);
  }, [scrollToBottom]);

  // Find file in project structure with fuzzy matching
  const findFileInStructure = useCallback((fileName: string): { path: string; content: string } | null => {
    if (!fileStructure?.length || !readFile) return null;
    
    // Normalize the search term
    const searchTerm = fileName.toLowerCase().trim();
    if (!searchTerm) return null;
    
    // Score function for fuzzy matching
    const getMatchScore = (str: string, term: string): number => {
      const strLower = str.toLowerCase();
      if (strLower === term) return 100; // Exact match
      if (strLower.endsWith(term)) return 75; // Ends with term
      if (strLower.includes(term)) return 50; // Contains term
      return 0;
    };
    
    const searchFile = (nodes: any[]): { node: any; score: number } | null => {
      let bestMatch: { node: any; score: number } | null = null;
      
      for (const node of nodes) {
        if (node.type === 'file') {
          // Score based on name and path
          const nameScore = getMatchScore(node.name, searchTerm);
          const pathScore = getMatchScore(node.path, searchTerm) * 0.8; // Slightly prefer name matches
          const score = Math.max(nameScore, pathScore);
          
          if (score > 0 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = { node, score };
          }
        }
        
        // Search in children if they exist
        if (node.children?.length) {
          const childMatch = searchFile(node.children);
          if (childMatch && (!bestMatch || childMatch.score > bestMatch.score)) {
            bestMatch = childMatch;
          }
        }
      }
      
      return bestMatch;
    };
    
    const result = searchFile(fileStructure);
    return result ? { path: result.node.path, content: '' } : null;
  }, [fileStructure, readFile]);

  // Analyze file content with progress tracking
  const analyzeFile = useCallback(async (fileName: string) => {
    if (!readFile) return null;
    
    const file = findFileInStructure(fileName);
    if (!file) {
      console.warn(`File not found: ${fileName}`);
      return null;
    }
    
    try {
      const content = await readFile(file.path);
      if (!content) {
        console.warn(`File is empty: ${file.path}`);
        return null;
      }
      return { path: file.path, content };
    } catch (error) {
      console.error(`Error reading file ${file.path}:`, error);
      return null;
    }
  }, [findFileInStructure, readFile]);

  // Extract file names from message with better pattern matching
  const extractFileNames = useCallback((text: string): string[] => {
    // Match file patterns like:
    // - `file.js`
    // - [file.js]
    // - "file.js"
    // - file.js (as a standalone word)
    const filePatterns = [
      /[`\[\"']([^\s`\]\"']+\.[a-zA-Z0-9]+)[`\]\"']/g,  // Matches quoted filenames
      /(?:^|\s)([^\s\/\\]+\.[a-zA-Z0-9]+)(?=\s|$)/g,  // Matches standalone filenames
    ];
    
    const extensions = ['js', 'ts', 'jsx', 'tsx', 'css', 'html', 'json', 'md', 'txt', 'py', 'java', 'c', 'cpp', 'h', 'hpp'];
    const extensionPattern = new RegExp(`\\.(${extensions.join('|')})$`, 'i');
    
    const matches = new Set<string>();
    
    // Check each pattern and collect matches
    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        // Remove any surrounding quotes or brackets
        const fileName = match[1] || match[0];
        if (extensionPattern.test(fileName)) {
          matches.add(fileName.trim());
        }
      }
    }
    
    return Array.from(matches);
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      content: input,
      sender: 'user',
      timestamp: new Date()
    };

    // Add user message immediately
    setMessages(prev => {
      const newMessages = [...prev, userMessage];
      console.log('Adding user message. New messages:', newMessages);
      return newMessages;
    });
    
    setInput('');
    setIsLoading(true);
    
    // Store a reference to the user message ID
    const userMessageId = userMessage.id;

    try {
      // Extract file names from the message
      const fileNames = extractFileNames(input);
      
      // Prepare system message with context
const systemContext = [
  'Your Name is "LS-Assistant", a highly efficient, security-aware, and professional assistant, specialized in coding and technical guidance, but also capable of answering general questions naturally and clearly.',

  '',

  '=== TECHNICAL TASKS ===',
  '- CODE FIRST: Always respond to coding questions with complete, functional, and executable code.',
  '- Include all necessary imports, dependencies, and setup.',
  '- Code must run without assumptions unless otherwise specified.',
  '- Prefer clarity and maintainability over clever or abstract solutions.',
  '- Add brief comments only where they improve immediate understanding.',
  '- Use proper syntax highlighting and language tags for all code blocks.',
  '- Avoid partial code unless explicitly asked.',
  '- When providing code changes, you can specify line numbers using the z//<line-number> syntax at the start of a code block. For example:\n\n```\nz//10\nconst example = "This will replace line 10";\n',

  '',

  'FILE AND PROJECT STRUCTURE',
  '- Always include exact file paths and names.',
  `- Project files: ${fileStructure?.map(f => f.name).join(', ') || 'none'}`,
  '- Clearly separate multiple files.',
  '- Follow logical and consistent structure. Never invent structure unless told to.',
  '- Respect any provided file or directory layout.',

  '',

  'SECURITY AND CODE QUALITY',
  '- Use secure coding practices by default.',
  '- Sanitize and validate all external inputs.',
  '- Avoid deprecated or insecure packages and APIs.',
  '- Never use dangerous constructs like eval, open CORS, or raw SQL without parameterization.',
  '- Implement proper error handling and safe defaults.',
  '- Follow security best practices (e.g. OWASP, CERT, ESLint).',

  '',

  'BEHAVIOR FOR TECHNICAL TASKS',
  '- Stay on task, code-focused, and precise.',
  '- Never speculate; provide only verifiable, accurate responses.',
  '- Ask for clarification if something is unclear or missing.',
  '- Use naming and styles matching the project or common best practices.',
  '- Do not add unnecessary comments, summaries, or greetings unless requested.',

  '',

  'RESPONSE FORMAT (FOR CODE)',
  '- Use Markdown triple backticks with proper language tags (e.g., ```ts, ```js).',
  '- Separate code files and sections clearly.',
  '- Avoid inline snippets except for very short examples.',
  '- Prioritize readability and copy-paste usability.',

  '',

  'OPTIONAL OUTPUT (IF EXPLICITLY REQUESTED)',
  '- May include README.md, tests, Dockerfiles, CI/CD configs, performance insights, or architecture notes.',
  '- May include optimizations, refactoring, or modularization if asked.',

  '',

  '=== GENERAL BEHAVIOR ===',
  '- For non-technical or general questions, reply naturally and helpfully.',
  '- Use clear, concise language appropriate to the question.',
  '- Add context or explanations if helpful or necessary for understanding.',
  '- Maintain professionalism and factual accuracy at all times.',
].join('\n');



      
      let messagesToSend: Array<{role: 'system' | 'user' | 'assistant', content: string}> = [
        { role: 'system', content: systemContext },
        { role: 'user', content: input }
      ];

      // Process file references if any
      if (fileNames.length > 0 && readFile) {
        const analysisResults = [];
        
        for (const fileName of fileNames) {
          // Show analyzing indicator
          const analyzingId = `analyzing-${Date.now()}-${fileName}`;
          const analyzingMessage: ChatMessage = {
            id: analyzingId,
            content: `🔍 Analyzing ${fileName}...`,
            sender: 'system',
            timestamp: new Date(),
            isAnalyzing: true
          };
          
          setMessages(prevMessages => [...prevMessages, analyzingMessage]);
          
          try {
            const fileData = await analyzeFile(fileName);
            if (fileData) {
              const relativePath = fileData.path.replace(projectPath, '').replace(/^[\\/]/, '');
              const fileContent = fileData.content.length > 5000 
                ? fileData.content.substring(0, 5000) + '\n... (truncated)' 
                : fileData.content;
              
              analysisResults.push({
                path: relativePath,
                content: fileContent
              });
              
              // Update with success
              setMessages(prevMessages => prevMessages.map(msg => 
                msg.id === analyzingId ? {
                  ...msg,
                  content: `📄 ${relativePath} (${formatFileSize(fileData.content.length)})`,
                  isAnalyzing: false,
                  fileContent: fileData.content
                } : msg
              ));
            } else {
              // Update with not found
              setMessages(prevMessages => prevMessages.map(msg => 
                msg.id === analyzingId ? {
                  ...msg,
                  content: `❌ File not found: ${fileName}`,
                  isAnalyzing: false
                } : msg
              ));
            }
          } catch (error) {
            console.error(`Error processing file ${fileName}:`, error);
            setMessages(prevMessages => prevMessages.map(msg => 
              msg.id === analyzingId ? {
                ...msg,
                content: `⚠️ Error reading: ${fileName}`,
                isAnalyzing: false
              } : msg
            ));
          }
        }
        
        // Add file contents to the context
        if (analysisResults.length > 0) {
          const fileContext = analysisResults
            .map(f => `File: ${f.path}\n\`\`\`${f.path.split('.').pop()}\n${f.content}\n\`\`\``)
            .join('\n\n');
            
          messagesToSend = [
            { role: 'system', content: systemContext },
            { role: 'system', content: 'Here are the referenced files:\n' + fileContext },
            { role: 'user', content: input }
          ];
        }
      }

      const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: messagesToSend,
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response from Groq API');
      }

      const data = await response.json();
      let aiResponse = data.choices[0].message.content;

      // Check if this is a file operation or contains file content
      const isFileOperation = /(create|make|write|edit|update|modify|change|erstelle|schreibe|erzeuge).*\.[a-zA-Z0-9]+|\.[a-zA-Z0-9]+.*(create|make|write|edit|update|modify|change|erstelle|schreibe|erzeuge)/i.test(input);
      const hasFileExtension = /\.[a-zA-Z0-9]+$/.test(input.split(' ').find(word => word.includes('.')) || '');
      const isExplicitFileRequest = /(erstelle|schreibe|erzeuge|create|write)\s+(?:eine|ein|einen|a|an)?\s*([^\s]+\.(?:html?|css|js|jsx|ts|tsx|json|py|java|cpp|c|h|hpp|php|rb|go|rs|swift|kt|dart))/i.test(input);
      
      // Process file operations if this is a file-related request
      if (isFileOperation || hasFileExtension || isExplicitFileRequest) {
        try {
          // Handle file creation/update from code blocks or direct file content
          const filePattern = /(?:```(?:[\w\s]+\.\w+)?\n([\s\S]*?)```|(?:File|Datei):?\s*([^\n:]+)[\s\n]*```(?:[\w]*\n)?([\s\S]*?)```)/g;
          let match;
          
          while ((match = filePattern.exec(aiResponse)) !== null) {
            const fullMatch = match[0];
            let fileName = '';
            let fileContent = '';
            
            // Check which pattern matched
            if (match[1]) {
              // Pattern 1: ```filename
              const fileNameMatch = match[0].match(/```([\w\s]+\.\w+)/);
              fileName = fileNameMatch ? fileNameMatch[1].trim() : '';
              fileContent = match[1];
            } else if (match[2] && match[3]) {
              // Pattern 2: File: filename
              fileName = match[2].trim();
              fileContent = match[3];
            }
            
            // If no file name in code block, try to extract from input
            if (!fileName) {
              // Try to extract from explicit file requests first
              const explicitFileMatch = input.match(/(?:erstelle|schreibe|erzeuge|create|write)\s+(?:eine|ein|einen|a|an)?\s*([^\s]+\.(?:html?|css|js|jsx|ts|tsx|json|py|java|cpp|c|h|hpp|php|rb|go|rs|swift|kt|dart))/i);
              if (explicitFileMatch && explicitFileMatch[1]) {
                fileName = explicitFileMatch[1].trim();
              } 
              // Fall back to any file extension in input
              else if (hasFileExtension) {
                const fileMatch = input.match(/[\w\s-]+\.(html?|css|js|jsx|ts|tsx|json|py|java|cpp|c|h|hpp|php|rb|go|rs|swift|kt|dart)(?![\w.-])/i);
                if (fileMatch) {
                  fileName = fileMatch[0].trim();
                }
              }
              
              // If we still don't have a filename but have content, use a default name
              if (!fileName && fileContent) {
                const extension = fileContent.trim().startsWith('<html') ? 'html' : 'txt';
                fileName = `newfile.${extension}`;
              }
            }
            
            if (fileName && fileContent) {
              // Just show the code block without creating the file
              aiResponse = aiResponse.replace(fullMatch, `\`\`\`${fileName}\n${fileContent}\n\`\`\``);
            }
          }
          
          // If no code blocks found but input contains a file creation request
          if (!aiResponse.includes('✅') && (hasFileExtension || isExplicitFileRequest)) {
            let fileName = '';
            
            // Try to extract filename from explicit request
            const explicitFileMatch = input.match(/(?:erstelle|schreibe|erzeuge|create|write)\s+(?:eine|ein|einen|a|an)?\s*([^\s]+\.(?:html?|css|js|jsx|ts|tsx|json|py|java|cpp|c|h|hpp|php|rb|go|rs|swift|kt|dart))/i);
            if (explicitFileMatch && explicitFileMatch[1]) {
              fileName = explicitFileMatch[1].trim();
            } 
            // Fall back to any file extension in input
            else if (hasFileExtension) {
              const fileMatch = input.match(/[\w\s-]+\.(html?|css|js|jsx|ts|tsx|json|py|java|cpp|c|h|hpp|php|rb|go|rs|swift|kt|dart)(?![\w.-])/i);
              if (fileMatch) {
                fileName = fileMatch[0].trim();
              }
            }
            
            // If we have a filename, create the file
            if (fileName) {
              const workspacePath = store.projectService.getWorkspacePath();
              const filePath = `${workspacePath}/${fileName}`;
              
              // Generate default content based on file type
              let defaultContent = '';
              if (fileName.endsWith('.html')) {
                defaultContent = `<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Neue Seite</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            margin: 0;
            padding: 20px;
            max-width: 1200px;
            margin: 0 auto;
        }
        h1 {
            color: #333;
        }
    </style>
</head>
<body>
    <h1>Willkommen auf meiner neuen Seite</h1>
    <p>Dies ist eine neu erstellte HTML-Datei.</p>
</body>
</html>`;
              } else if (fileName.endsWith('.css')) {
                defaultContent = `/* Stile für ${fileName} */
body {
    font-family: Arial, sans-serif;
    line-height: 1.6;
    margin: 0;
    padding: 0;
    color: #333;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 20px;
}`;
              } else if (fileName.endsWith('.js') || fileName.endsWith('.jsx') || 
                        fileName.endsWith('.ts') || fileName.endsWith('.tsx')) {
                defaultContent = `// ${fileName}
// Hier kommt dein JavaScript/TypeScript Code

function init() {
    console.log('${fileName} wurde erfolgreich geladen');
}

// Event-Listener, wenn das DOM vollständig geladen ist
document.addEventListener('DOMContentLoaded', init);`;
              }
              
              const shouldCreate = window.confirm(`Möchten Sie die Datei erstellen: ${fileName}?`);
              if (shouldCreate) {
                try {
                  await store.projectService.createFile(filePath, defaultContent);
                  
                  // If it's an HTML file, also create a default CSS file if it doesn't exist
                  if (fileName.endsWith('.html')) {
                    const cssFileName = fileName.replace(/\.html?$/, '.css');
                    const cssFilePath = `${workspacePath}/${cssFileName}`;
                    try {
                      await store.projectService.createFile(cssFilePath, `/* Stile für ${cssFileName} */\n`);
                      aiResponse = `✅ Dateien erstellt:\n- [${fileName}](${filePath})\n- [${cssFileName}](${cssFilePath})`;
                    } catch (cssError) {
                      // Ignore if CSS file already exists
                      aiResponse = `✅ Datei erstellt: [${fileName}](${filePath})`;
                    }
                  } else {
                    aiResponse = `✅ Datei erstellt: [${fileName}](${filePath})`;
                  }
                } catch (error) {
                  aiResponse = `❌ Fehler beim Erstellen der Datei ${fileName}: ${error instanceof Error ? error.message : String(error)}`;
                }
              }
            }
          }
        } catch (error) {
          console.error('Fehler bei der Dateiverarbeitung:', error);
          aiResponse = 'Fehler bei der Dateiverarbeitung: ' + (error instanceof Error ? error.message : String(error));
        }
      }

          // Parse the response for code changes
      const codeChanges = await parseCodeChanges(aiResponse);
      const hasCodeChanges = codeChanges.length > 0;

      const aiMessage: ChatMessage = {
        id: `ai-${Date.now()}`,
        content: aiResponse,
        sender: 'ai',
        timestamp: new Date(),
        codeSnippet: hasCodeChanges ? codeChanges[0].newContent : undefined,
        needsConfirmation: hasCodeChanges && !isFileOperation,
        isFileOperation,
        isCodeProposal: hasCodeChanges,
        codeChanges: hasCodeChanges ? codeChanges : undefined
      };

      // Add AI response to messages, ensuring we don't lose any existing messages
      setMessages(prevMessages => {
        // Make sure we don't duplicate the user's message
        const userMessageExists = prevMessages.some(msg => msg.id === userMessageId);
        const newMessages = userMessageExists 
          ? [...prevMessages, aiMessage] 
          : [...prevMessages, userMessage, aiMessage];
        
        console.log('Adding AI response. All messages:', newMessages);
        return newMessages;
      });
      
      // Clear any pending code since we're handling it in the message now
      setPendingCode(null);
    } catch (error) {
      console.error('Error calling Groq API:', error);
      setMessages(prevMessages => {
        const userMessageExists = prevMessages.some(msg => msg.id === userMessageId);
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          content: 'Sorry, I encountered an error processing your request. Please try again.',
          sender: 'ai',
          timestamp: new Date()
        };
        
        const newMessages = userMessageExists 
          ? [...prevMessages, errorMessage]
          : [...prevMessages, userMessage, errorMessage];
          
        console.log('Error occurred. Messages:', newMessages);
        return newMessages;
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Parse AI response for multiple code changes
  const parseCodeChanges = async (content: string): Promise<CodeChange[]> => {
    const changes: CodeChange[] = [];
    const codeBlockRegex = /```(?:\w+)?\n([\s\S]*?)\n```/g;
    const filePathRegex = /File: (\S+)/g;
    
    // First, try to find file paths mentioned in the response
    const fileMatches = Array.from(content.matchAll(filePathRegex));
    const filePaths = fileMatches.map(match => match[1]);
    
    // Then find all code blocks
    let match;
    let blockIndex = 0;
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const codeContent = match[1];
      const filePath = filePaths[blockIndex] || '';
      
      // Try to get existing content for diffing
      let oldContent = '';
      if (filePath && readFile) {
        try {
          oldContent = await readFile(filePath);
        } catch (error) {
          console.log(`File ${filePath} not found, will be created`);
        }
      }
      
      changes.push({
        filePath,
        oldContent,
        newContent: codeContent,
        startLine: 1,
        endLine: codeContent.split('\n').length,
        description: `Code change ${blockIndex + 1} in ${filePath || 'unknown file'}`
      });
      
      blockIndex++;
    }
    
    return changes;
  };

  const handleConfirmCode = async (messageId: string) => {
    const message = messages.find(msg => msg.id === messageId);
    if (!message?.codeChanges?.length) return;
    
    try {
      // Apply each code change
      for (const change of message.codeChanges) {
        if (change.filePath) {
          // For file changes, read the current content and apply the change
          let currentContent = '';
          try {
            currentContent = await readFile?.(change.filePath) || '';
          } catch (error) {
            console.log(`File ${change.filePath} not found, will be created`);
          }
          
          // Process the new content to handle z//<line-number> syntax
          let newContent = change.newContent;
          let startLine = change.startLine;
          let endLine = change.endLine;
          
          // Check for z//<line-number> or z//<start-line>-<end-line> syntax
          const lineNumberMatch = newContent.match(/^z\/\/(\d+)(?:-(\d+))?\n/);
          if (lineNumberMatch) {
            // Extract line numbers
            const [, start, end] = lineNumberMatch;
            startLine = parseInt(start, 10);
            endLine = end ? parseInt(end, 10) : startLine;
            
            // Remove the z// line from the content
            newContent = newContent.substring(lineNumberMatch[0].length);
          }
          
          // Replace the relevant lines in the file
          const lines = currentContent.split('\n');
          const beforeLines = lines.slice(0, startLine - 1);
          const afterLines = lines.slice(endLine);
          const finalContent = [...beforeLines, newContent, ...afterLines].join('\n');
          
          // Update the file
          await store.projectService.createFile(change.filePath, finalContent);
        } else if (onCodeProposal) {
          // For non-file changes, use the existing proposal handler
          onCodeProposal(change.newContent, change.filePath);
        }
      }
      
      // Update the message to show it was applied
      setMessages(prevMessages => prevMessages.map(msg => 
        msg.id === messageId 
          ? { 
              ...msg, 
              needsConfirmation: false,
              content: msg.content + '\n\n✅ Changes applied successfully.'
            } 
          : msg
      ));
    } catch (error) {
      console.error('Error applying changes:', error);
      setMessages(prevMessages => prevMessages.map(msg => 
        msg.id === messageId
          ? {
              ...msg,
              content: msg.content + `\n\n❌ Error applying changes: ${error instanceof Error ? error.message : String(error)}`,
              timestamp: new Date()
            }
          : msg
      ));
    }
  };

  const handleRejectCode = useCallback((messageId: string) => {
    setMessages(prevMessages => 
      prevMessages.map(msg => 
        msg.id === messageId 
          ? { ...msg, needsConfirmation: false } 
          : msg
      )
    );
  }, [setMessages]);

  // Handle Enter key to send message
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Format message content with proper line breaks and code blocks
  const formatMessageContent = (message: ChatMessage): { 
    __html: string; 
    hasFilePreview: boolean; 
    hasFileBadge: boolean 
  } => {
    // Skip rendering for file operation messages that were already processed
    if (message.isFileOperation && message.content.includes('✅ File created:')) {
      return { 
        __html: `<div class="file-created-message">${message.content}</div>`,
        hasFilePreview: false,
        hasFileBadge: false
      };
    }
    let content = message.content;
    let filePreview = '';
    let fileBadge = '';
    
    // Add file content preview for analyzed files
    if (message.fileContent) {
      const fileName = message.filePath ? message.filePath.split(/[\\/]/).pop() : 'file';
      fileBadge = `<div class="file-badge">📄 ${fileName}</div>`;
      
      filePreview = `
        <div class="file-preview">
          <details>
            <summary>View file content</summary>
            <pre><code>${escapeHtml(message.fileContent)}</code></pre>
          </details>
        </div>
      `;
    }
    
    // Convert markdown code blocks to HTML and handle bold text
    const formatted = content
      // Handle code blocks first
      .replace(/```(\w+)?\n([\s\S]*?)\n```/g, (match, lang, code) => {
        return `<pre class="code-block"><code class="language-${lang || 'text'}">${escapeHtml(code)}</code></pre>`;
      })
      // Handle inline code
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      // Handle bold text with **
      .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      // Convert line breaks
      .replace(/\n/g, '<br/>');
    
    return { 
      __html: `${fileBadge}${formatted}${filePreview}`,
      hasFilePreview: !!message.fileContent,
      hasFileBadge: !!message.fileContent
    };
  };
  
  // Helper function to escape HTML
  const escapeHtml = (unsafe: string) => {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // Component to display code changes with diff view
  const CodeChangeView = React.memo<{ change: CodeChange }>(({ change }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const diff = diffLines(change.oldContent, change.newContent);
    
    return (
      <div className="code-change">
        <div className="code-change-header" onClick={() => setIsExpanded(!isExpanded)}>
          <span className={`toggle-icon ${isExpanded ? 'expanded' : ''}`}>▸</span>
          <span className="file-path">{change.filePath}</span>
          <span className="change-location">Lines {change.startLine}-{change.endLine}</span>
        </div>
        {isExpanded && (
          <div className="code-diff">
            {diff.map((part: Change, index: number) => {
              const className = part.added ? 'added' : part.removed ? 'removed' : 'unchanged';
              return (
                <div key={index} className={`diff-line ${className}`}>
                  <span className="line-number">
                    {part.added ? '+' : part.removed ? '-' : ' '}
                  </span>
                  <span className="line-content">
                    {part.value}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  });
  
  // Add display name for better debugging
  CodeChangeView.displayName = 'CodeChangeView';

  return (
    <div className={`ai-chat-panel ${position}`} style={style}>
      <button 
        className="position-toggle" 
        onClick={togglePosition}
        title={position === 'left' ? 'Nach rechts verschieben' : 'Nach links verschieben'}
      >
        {position === 'left' ? '→' : '←'}
      </button>
      <div className="ai-chat-header">
        <div className="ai-chat-header-content">
          <h3>KI Assistent</h3>
          <div className="ai-chat-model">Groq LLaMA 3.3 70B</div>
        </div>
      </div>
      <div 
        className="ai-chat-messages" 
        ref={messagesContainerRef}
        onScroll={(e) => {
          // Keep track of scroll position if needed
        }}
      >
        {messages.length === 0 ? (
          <div className="ai-chat-empty">
            <div className="ai-chat-welcome">
              <h3>Wie kann ich Ihnen heute helfen?</h3>
              <p>Ich bin Ihr KI-Programmierassistent. Hier sind einige Beispiele, was Sie fragen können:</p>
              <div className="suggestion-grid">
                <div className="suggestion-card" onClick={() => setInput('Erkläre diesen Code:')}>
                  <div className="suggestion-icon">💡</div>
                  <div className="suggestion-text">Code erklären</div>
                </div>
                <div className="suggestion-card" onClick={() => setInput('Behebe diesen Fehler:')}>
                  <div className="suggestion-icon">🐛</div>
                  <div className="suggestion-text">Fehler beheben</div>
                </div>
                <div className="suggestion-card" onClick={() => setInput('Refaktoriere diesen Code:')}>
                  <div className="suggestion-icon">♻️</div>
                  <div className="suggestion-text">Code refaktorieren</div>
                </div>
                <div className="suggestion-card" onClick={() => setInput('Erstelle eine React-Komponente, die...')}>
                  <div className="suggestion-icon">⚛️</div>
                  <div className="suggestion-text">Komponente erstellen</div>
                </div>
              </div>
              <div className="file-tip">
                <span className="tip-icon">💡</span>
                <span>Tipp: Erwähnen Sie Dateinamen (z.B. 'app.js'), um sie in den Kontext einzubeziehen</span>
              </div>
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`ai-chat-message ${msg.sender} ${msg.isAnalyzing ? 'analyzing' : ''}`}>
              <div className="ai-chat-message-sender">
                {msg.sender === 'user' ? 'Sie' : msg.sender === 'ai' ? 'KI' : 'System'}
              </div>
              <div 
                className={`ai-chat-message-content ${
                  formatMessageContent(msg).hasFilePreview ? 'has-file-preview' : ''
                } ${msg.sender === 'system' ? 'system-message' : ''}`} 
                dangerouslySetInnerHTML={formatMessageContent(msg)} 
              />
              {msg.needsConfirmation && (
                <div className="ai-chat-confirmation">
                  {msg.codeChanges?.map((change: CodeChange, index: number) => (
                    <div key={index} className="code-change-container">
                      <div className="code-change-header">
                        <span className="file-path">{change.filePath || 'Code change'}</span>
                        {change.description && (
                          <span className="change-description">{change.description}</span>
                        )}
                      </div>
                      <CodeChangeView change={change} />
                    </div>
                  ))}
                  <p>Möchten Sie diese Änderungen übernehmen?</p>
                  <div className="ai-chat-buttons">
                    <button 
                      onClick={() => handleConfirmCode(msg.id)} 
                      className="ai-chat-confirm"
                    >
                      <span className="button-icon">✓</span> Änderungen übernehmen
                    </button>
                    <button 
                      onClick={() => handleRejectCode(msg.id)} 
                      className="ai-chat-cancel"
                    >
                      <span className="button-icon">×</span> Abbrechen
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        {isLoading && (
          <div className="ai-chat-message ai">
            <div className="ai-chat-loading">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
        <div 
          ref={messagesEndRef} 
          style={{ 
            float: 'left', 
            clear: 'both',
            height: '1px',
            width: '100%',
            paddingBottom: '16px' // Add some padding at the bottom
          }} 
        />
      </div>
      <div className="ai-chat-input-container">
        <div className="ai-chat-input">
          <input
            type="text"
            placeholder={isLoading ? 'Die KI denkt nach...' : 'Fragen Sie mich etwas zu Ihrem Code...'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleInputKeyDown}
            disabled={isLoading}
            aria-label="Nachricht eingeben"
          />
          <button 
            onClick={handleSend} 
            disabled={isLoading || !input.trim()}
            className="ai-chat-send"
            aria-label="Nachricht senden"
            title="Nachricht senden (Enter)"
          >
            {isLoading ? (
              <div className="sending-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" className="send-icon">
                <path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path>
              </svg>
            )}
          </button>
        </div>
        <div className="ai-chat-footer">
          <div className="model-selector">
            <select 
              value={selectedModel} 
              onChange={handleModelChange}
              className="model-select"
              disabled={isLoading}
            >
              {SUPPORTED_MODELS.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>
          <span className="ai-tip">Zeilenschaltung mit Shift+Enter</span>
        </div>
      </div>
    </div>
  );
};

export default AIChatPanel;