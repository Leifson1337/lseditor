import { EventEmitter } from 'events';
import marked from 'marked';
import hljs from 'highlight.js';
import fs from 'fs';
import path from 'path';

// Documentation represents a documentation article or page
interface Documentation {
  id: string;              // Unique documentation ID
  title: string;           // Title of the documentation
  content: string;         // Markdown or HTML content
  category: string;        // Category for grouping
  tags: string[];          // List of tags for searching
  lastUpdated: Date;       // Last updated timestamp
  author: string;          // Author of the documentation
}

// Tutorial represents a multi-step guide or tutorial
interface Tutorial {
  id: string;              // Unique tutorial ID
  title: string;           // Title of the tutorial
  description: string;     // Short description
  steps: TutorialStep[];   // Steps in the tutorial
  difficulty: 'beginner' | 'intermediate' | 'advanced'; // Difficulty level
  estimatedTime: number;   // Estimated time to complete (minutes)
  prerequisites: string[]; // Prerequisites for the tutorial
}

// TutorialStep represents a single step in a tutorial
interface TutorialStep {
  id: string;              // Unique step ID
  title: string;           // Title of the step
  content: string;         // Step content
  code?: string;           // Optional code sample
  expectedOutput?: string; // Optional expected output
}

// CheatSheet represents a quick reference sheet
interface CheatSheet {
  id: string;              // Unique cheat sheet ID
  title: string;           // Title of the cheat sheet
  category: string;        // Category for grouping
  items: CheatSheetItem[]; // Items in the cheat sheet
}

// CheatSheetItem represents a single item in a cheat sheet
interface CheatSheetItem {
  id: string;              // Unique item ID
  title: string;           // Title of the item
  description: string;     // Description of the item
  code: string;            // Code example
  example?: string;        // Optional example usage
}

// DocumentationService manages documentation, tutorials, and cheat sheets
export class DocumentationService extends EventEmitter {
  // Map of all documentation articles
  private documentation: Map<string, Documentation> = new Map();
  // Map of all tutorials
  private tutorials: Map<string, Tutorial> = new Map();
  // Map of all cheat sheets
  private cheatSheets: Map<string, CheatSheet> = new Map();
  // Path to documentation files
  private docsPath: string;
  // Path to tutorial files
  private tutorialsPath: string;
  // Path to cheat sheet files
  private cheatsheetsPath: string;

  /**
   * Constructor for the DocumentationService class.
   * Initializes the service with the paths to documentation, tutorials, and cheat sheets.
   * @param docsPath Path to documentation files
   * @param tutorialsPath Path to tutorial files
   * @param cheatsheetsPath Path to cheat sheet files
   */
  constructor(docsPath: string, tutorialsPath: string, cheatsheetsPath: string) {
    super();
    this.docsPath = docsPath;
    this.tutorialsPath = tutorialsPath;
    this.cheatsheetsPath = cheatsheetsPath;
    // Initialize the markdown renderer with syntax highlighting
    this.initializeMarked();
  }

  /**
   * Initialize the markdown renderer with syntax highlighting.
   * This method sets up the marked library to render markdown content with syntax highlighting.
   */
  private initializeMarked(): void {
    const markedAny = marked as any;
    if (typeof markedAny.use === 'function') {
      markedAny.use({
        highlight: (code: string, lang: string) => {
          if (lang && hljs.getLanguage(lang)) {
            try {
              return hljs.highlight(lang, code).value;
            } catch (err) {
              return code;
            }
          }
          return code;
        }
      });
    } else if (typeof markedAny.setOptions === 'function') {
      markedAny.setOptions({
        highlight: (code: string, lang: string) => {
          if (lang && hljs.getLanguage(lang)) {
            try {
              return hljs.highlight(lang, code).value;
            } catch (err) {
              return code;
            }
          }
          return code;
        }
      });
    }
  }

  /**
   * Render markdown content to HTML.
   * This method takes markdown content as input and returns the rendered HTML.
   * @param content Markdown content to render
   * @returns Rendered HTML content
   */
  public async renderMarkdown(content: string): Promise<string> {
    const markedAny = marked as any;
    if (typeof markedAny.parse === 'function') {
      return markedAny.parse(content);
    } else if (typeof markedAny === 'function') {
      return markedAny(content);
    }
    return content;
  }

  /**
   * Initialize the documentation, tutorials, and cheat sheets.
   * This method loads the documentation, tutorials, and cheat sheets from disk.
   */
  private initialize(): void {
    this.loadDocumentation();
    this.loadTutorials();
    this.loadCheatSheets();
  }

  /**
   * Load documentation articles from disk.
   * This method reads the documentation files from disk and populates the documentation map.
   */
  private async loadDocumentation(): Promise<void> {
    if (!fs.existsSync(this.docsPath)) {
      fs.mkdirSync(this.docsPath, { recursive: true });
      return;
    }
    const files = fs.readdirSync(this.docsPath);
    for (const file of files) {
      if (file.endsWith('.md')) {
        try {
          const content = fs.readFileSync(
            path.join(this.docsPath, file),
            'utf-8'
          );
          const doc = await this.parseMarkdownDocumentation(content);
          this.documentation.set(doc.id, doc);
        } catch (error) {
          console.error(`Failed to load documentation ${file}:`, error);
        }
      }
    }
  }

  /**
   * Load tutorials from disk.
   * This method reads the tutorial files from disk and populates the tutorials map.
   */
  private loadTutorials(): void {
    if (!fs.existsSync(this.tutorialsPath)) {
      fs.mkdirSync(this.tutorialsPath, { recursive: true });
      return;
    }
    const files = fs.readdirSync(this.tutorialsPath);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(
            path.join(this.tutorialsPath, file),
            'utf-8'
          );
          const tutorial = JSON.parse(content);
          this.tutorials.set(tutorial.id, tutorial);
        } catch (error) {
          console.error(`Failed to load tutorial ${file}:`, error);
        }
      }
    }
  }

  /**
   * Load cheat sheets from disk.
   * This method reads the cheat sheet files from disk and populates the cheatSheets map.
   */
  private loadCheatSheets(): void {
    if (!fs.existsSync(this.cheatsheetsPath)) {
      fs.mkdirSync(this.cheatsheetsPath, { recursive: true });
      return;
    }
    const files = fs.readdirSync(this.cheatsheetsPath);
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const content = fs.readFileSync(
            path.join(this.cheatsheetsPath, file),
            'utf-8'
          );
          const cheatSheet = JSON.parse(content);
          this.cheatSheets.set(cheatSheet.id, cheatSheet);
        } catch (error) {
          console.error(`Failed to load cheat sheet ${file}:`, error);
        }
      }
    }
  }

  /**
   * Parse markdown documentation content.
   * This method takes markdown content as input and returns a Documentation object.
   * @param content Markdown content to parse
   * @returns Parsed Documentation object
   */
  private async parseMarkdownDocumentation(content: string): Promise<Documentation> {
    const lines = content.split('\n');
    const metadata: Record<string, string> = {};
    let body = '';
    let inMetadata = false;

    for (const line of lines) {
      if (line.startsWith('---')) {
        inMetadata = !inMetadata;
        continue;
      }

      if (inMetadata) {
        const [key, value] = line.split(':').map(s => s.trim());
        metadata[key] = value;
      } else {
        body += line + '\n';
      }
    }

    return {
      id: metadata.id || Math.random().toString(36).substr(2, 9),
      title: metadata.title || '',
      content: await this.renderMarkdown(body),
      category: metadata.category || 'general',
      tags: metadata.tags ? metadata.tags.split(',').map(t => t.trim()) : [],
      lastUpdated: new Date(metadata.lastUpdated || Date.now()),
      author: metadata.author || 'Unknown'
    };
  }

  /**
   * Add a new documentation article.
   * This method creates a new documentation article and saves it to disk.
   * @param doc Documentation article to add
   */
  public async addDocumentation(doc: Documentation): Promise<void> {
    try {
      const content = this.generateMarkdownContent(doc);
      const filePath = path.join(
        this.docsPath,
        `${doc.id}.md`
      );

      fs.writeFileSync(filePath, content);
      this.documentation.set(doc.id, doc);
      this.emit('documentationAdded', doc);
    } catch (error) {
      console.error('Failed to add documentation:', error);
      throw error;
    }
  }

  /**
   * Update an existing documentation article.
   * This method updates the content of an existing documentation article and saves it to disk.
   * @param doc Documentation article to update
   */
  public async updateDocumentation(doc: Documentation): Promise<void> {
    try {
      const content = this.generateMarkdownContent(doc);
      const filePath = path.join(
        this.docsPath,
        `${doc.id}.md`
      );

      fs.writeFileSync(filePath, content);
      this.documentation.set(doc.id, doc);
      this.emit('documentationUpdated', doc);
    } catch (error) {
      console.error('Failed to update documentation:', error);
      throw error;
    }
  }

  /**
   * Delete a documentation article.
   * This method removes a documentation article from disk and from the documentation map.
   * @param id ID of the documentation article to delete
   */
  public async deleteDocumentation(id: string): Promise<void> {
    try {
      const filePath = path.join(
        this.docsPath,
        `${id}.md`
      );

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      this.documentation.delete(id);
      this.emit('documentationDeleted', id);
    } catch (error) {
      console.error('Failed to delete documentation:', error);
      throw error;
    }
  }

  /**
   * Add a new tutorial.
   * This method creates a new tutorial and saves it to disk.
   * @param tutorial Tutorial to add
   */
  public async addTutorial(tutorial: Tutorial): Promise<void> {
    try {
      const filePath = path.join(
        this.tutorialsPath,
        `${tutorial.id}.json`
      );

      fs.writeFileSync(filePath, JSON.stringify(tutorial, null, 2));
      this.tutorials.set(tutorial.id, tutorial);
      this.emit('tutorialAdded', tutorial);
    } catch (error) {
      console.error('Failed to add tutorial:', error);
      throw error;
    }
  }

  /**
   * Update an existing tutorial.
   * This method updates the content of an existing tutorial and saves it to disk.
   * @param tutorial Tutorial to update
   */
  public async updateTutorial(tutorial: Tutorial): Promise<void> {
    try {
      const filePath = path.join(
        this.tutorialsPath,
        `${tutorial.id}.json`
      );

      fs.writeFileSync(filePath, JSON.stringify(tutorial, null, 2));
      this.tutorials.set(tutorial.id, tutorial);
      this.emit('tutorialUpdated', tutorial);
    } catch (error) {
      console.error('Failed to update tutorial:', error);
      throw error;
    }
  }

  /**
   * Delete a tutorial.
   * This method removes a tutorial from disk and from the tutorials map.
   * @param id ID of the tutorial to delete
   */
  public async deleteTutorial(id: string): Promise<void> {
    try {
      const filePath = path.join(
        this.tutorialsPath,
        `${id}.json`
      );

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      this.tutorials.delete(id);
      this.emit('tutorialDeleted', id);
    } catch (error) {
      console.error('Failed to delete tutorial:', error);
      throw error;
    }
  }

  /**
   * Add a new cheat sheet.
   * This method creates a new cheat sheet and saves it to disk.
   * @param cheatSheet Cheat sheet to add
   */
  public async addCheatSheet(cheatSheet: CheatSheet): Promise<void> {
    try {
      const filePath = path.join(
        this.cheatsheetsPath,
        `${cheatSheet.id}.json`
      );

      fs.writeFileSync(filePath, JSON.stringify(cheatSheet, null, 2));
      this.cheatSheets.set(cheatSheet.id, cheatSheet);
      this.emit('cheatSheetAdded', cheatSheet);
    } catch (error) {
      console.error('Failed to add cheat sheet:', error);
      throw error;
    }
  }

  /**
   * Update an existing cheat sheet.
   * This method updates the content of an existing cheat sheet and saves it to disk.
   * @param cheatSheet Cheat sheet to update
   */
  public async updateCheatSheet(cheatSheet: CheatSheet): Promise<void> {
    try {
      const filePath = path.join(
        this.cheatsheetsPath,
        `${cheatSheet.id}.json`
      );

      fs.writeFileSync(filePath, JSON.stringify(cheatSheet, null, 2));
      this.cheatSheets.set(cheatSheet.id, cheatSheet);
      this.emit('cheatSheetUpdated', cheatSheet);
    } catch (error) {
      console.error('Failed to update cheat sheet:', error);
      throw error;
    }
  }

  /**
   * Delete a cheat sheet.
   * This method removes a cheat sheet from disk and from the cheatSheets map.
   * @param id ID of the cheat sheet to delete
   */
  public async deleteCheatSheet(id: string): Promise<void> {
    try {
      const filePath = path.join(
        this.cheatsheetsPath,
        `${id}.json`
      );

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      this.cheatSheets.delete(id);
      this.emit('cheatSheetDeleted', id);
    } catch (error) {
      console.error('Failed to delete cheat sheet:', error);
      throw error;
    }
  }

  /**
   * Generate markdown content for a documentation article.
   * This method takes a Documentation object as input and returns the markdown content.
   * @param doc Documentation article to generate markdown content for
   * @returns Markdown content
   */
  private generateMarkdownContent(doc: Documentation): string {
    return `---
id: ${doc.id}
title: ${doc.title}
category: ${doc.category}
tags: ${doc.tags.join(', ')}
lastUpdated: ${doc.lastUpdated.toISOString()}
author: ${doc.author}
---

${doc.content}`;
  }

  /**
   * Search for documentation articles.
   * This method takes a query string as input and returns a list of matching documentation articles.
   * @param query Query string to search for
   * @returns List of matching documentation articles
   */
  public searchDocumentation(query: string): Documentation[] {
    const results: Documentation[] = [];
    const lowerQuery = query.toLowerCase();

    for (const doc of this.documentation.values()) {
      if (
        doc.title.toLowerCase().includes(lowerQuery) ||
        doc.content.toLowerCase().includes(lowerQuery) ||
        doc.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      ) {
        results.push(doc);
      }
    }

    return results;
  }

  /**
   * Search for tutorials.
   * This method takes a query string as input and returns a list of matching tutorials.
   * @param query Query string to search for
   * @returns List of matching tutorials
   */
  public searchTutorials(query: string): Tutorial[] {
    const results: Tutorial[] = [];
    const lowerQuery = query.toLowerCase();

    for (const tutorial of this.tutorials.values()) {
      if (
        tutorial.title.toLowerCase().includes(lowerQuery) ||
        tutorial.description.toLowerCase().includes(lowerQuery) ||
        tutorial.prerequisites.some(prereq => prereq.toLowerCase().includes(lowerQuery))
      ) {
        results.push(tutorial);
      }
    }

    return results;
  }

  /**
   * Search for cheat sheets.
   * This method takes a query string as input and returns a list of matching cheat sheets.
   * @param query Query string to search for
   * @returns List of matching cheat sheets
   */
  public searchCheatSheets(query: string): CheatSheet[] {
    const results: CheatSheet[] = [];
    const lowerQuery = query.toLowerCase();

    for (const cheatSheet of this.cheatSheets.values()) {
      if (
        cheatSheet.title.toLowerCase().includes(lowerQuery) ||
        cheatSheet.category.toLowerCase().includes(lowerQuery) ||
        cheatSheet.items.some(item => 
          item.title.toLowerCase().includes(lowerQuery) ||
          item.description.toLowerCase().includes(lowerQuery)
        )
      ) {
        results.push(cheatSheet);
      }
    }

    return results;
  }

  /**
   * Get a documentation article by ID.
   * This method takes a documentation ID as input and returns the corresponding documentation article.
   * @param id ID of the documentation article to get
   * @returns Documentation article
   */
  public getDocumentation(id: string): Documentation | undefined {
    return this.documentation.get(id);
  }

  /**
   * Get a tutorial by ID.
   * This method takes a tutorial ID as input and returns the corresponding tutorial.
   * @param id ID of the tutorial to get
   * @returns Tutorial
   */
  public getTutorial(id: string): Tutorial | undefined {
    return this.tutorials.get(id);
  }

  /**
   * Get a cheat sheet by ID.
   * This method takes a cheat sheet ID as input and returns the corresponding cheat sheet.
   * @param id ID of the cheat sheet to get
   * @returns Cheat sheet
   */
  public getCheatSheet(id: string): CheatSheet | undefined {
    return this.cheatSheets.get(id);
  }

  /**
   * Get all documentation articles.
   * This method returns a list of all documentation articles.
   * @returns List of documentation articles
   */
  public getAllDocumentation(): Documentation[] {
    return Array.from(this.documentation.values());
  }

  /**
   * Get all tutorials.
   * This method returns a list of all tutorials.
   * @returns List of tutorials
   */
  public getAllTutorials(): Tutorial[] {
    return Array.from(this.tutorials.values());
  }

  /**
   * Get all cheat sheets.
   * This method returns a list of all cheat sheets.
   * @returns List of cheat sheets
   */
  public getAllCheatSheets(): CheatSheet[] {
    return Array.from(this.cheatSheets.values());
  }

  /**
   * Dispose of the service.
   * This method clears all data and removes all event listeners.
   */
  public dispose(): void {
    this.documentation.clear();
    this.tutorials.clear();
    this.cheatSheets.clear();
    this.removeAllListeners();
  }
}