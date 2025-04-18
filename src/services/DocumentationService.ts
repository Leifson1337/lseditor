import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { marked } from 'marked';
import hljs from 'highlight.js';

interface Documentation {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  lastUpdated: Date;
  author: string;
}

interface Tutorial {
  id: string;
  title: string;
  description: string;
  steps: TutorialStep[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedTime: number;
  prerequisites: string[];
}

interface TutorialStep {
  id: string;
  title: string;
  content: string;
  code?: string;
  expectedOutput?: string;
}

interface CheatSheet {
  id: string;
  title: string;
  category: string;
  items: CheatSheetItem[];
}

interface CheatSheetItem {
  id: string;
  title: string;
  description: string;
  code: string;
  example?: string;
}

export class DocumentationService extends EventEmitter {
  private documentation: Map<string, Documentation> = new Map();
  private tutorials: Map<string, Tutorial> = new Map();
  private cheatSheets: Map<string, CheatSheet> = new Map();
  private docsPath: string;
  private tutorialsPath: string;
  private cheatsheetsPath: string;

  constructor(docsPath: string, tutorialsPath: string, cheatsheetsPath: string) {
    super();
    this.docsPath = docsPath;
    this.tutorialsPath = tutorialsPath;
    this.cheatsheetsPath = cheatsheetsPath;

    this.initializeMarked();
  }

  private initializeMarked(): void {
    marked.setOptions({
      highlight: (code: string, lang: string) => {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch (err) {
            console.error('Error highlighting code:', err);
          }
        }
        return code;
      },
      gfm: true,
      breaks: true,
      sanitize: true
    });
  }

  public async renderMarkdown(content: string): Promise<string> {
    return marked(content);
  }

  private initialize(): void {
    this.loadDocumentation();
    this.loadTutorials();
    this.loadCheatSheets();
  }

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

  public getDocumentation(id: string): Documentation | undefined {
    return this.documentation.get(id);
  }

  public getTutorial(id: string): Tutorial | undefined {
    return this.tutorials.get(id);
  }

  public getCheatSheet(id: string): CheatSheet | undefined {
    return this.cheatSheets.get(id);
  }

  public getAllDocumentation(): Documentation[] {
    return Array.from(this.documentation.values());
  }

  public getAllTutorials(): Tutorial[] {
    return Array.from(this.tutorials.values());
  }

  public getAllCheatSheets(): CheatSheet[] {
    return Array.from(this.cheatSheets.values());
  }

  public dispose(): void {
    this.documentation.clear();
    this.tutorials.clear();
    this.cheatSheets.clear();
    this.removeAllListeners();
  }
} 