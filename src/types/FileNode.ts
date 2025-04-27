// FileNode.ts
// Type definition for representing a file or directory node in the project tree.

/**
 * FileNode represents a file or directory in the project structure.
 */
export interface FileNode {
  name: string;         // Name of the file or directory
  path: string;         // Path to the file or directory
  type: 'file' | 'directory'; // Type of the node, either 'file' or 'directory'
  children?: FileNode[];// Optional: Child nodes (for directories)
}