// GitService.ts
// Type definitions for Git service operations and data structures.

import { StatusResult } from 'simple-git';

/**
 * ResourceUsage represents the resource usage of a process.
 */
export interface ResourceUsage {
  /**
   * CPU usage as a percentage.
   */
  cpu: number;
  /**
   * Memory usage statistics.
   */
  memory: {
    /**
     * Heap memory used by the process.
     */
    heapUsed: number;
    /**
     * Total heap memory available to the process.
     */
    heapTotal: number;
    /**
     * External memory used by the process.
     */
    external: number;
  };
  /**
   * Load average of the system.
   */
  loadAverage: number[];
}

/**
 * Re-export of StatusResult from simple-git for convenience.
 */
export { StatusResult }; 