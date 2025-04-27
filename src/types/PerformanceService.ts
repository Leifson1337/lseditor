// PerformanceService.ts
// Type definitions for performance monitoring and resource usage.

/**
 * ResourceUsage represents system resource usage details.
 */
export interface ResourceUsage {
  /**
   * CPU usage percentage
   */
  cpu: number;
  /**
   * Memory usage details
   */
  memory: {
    /**
     * Heap memory used
     */
    heapUsed: number;
    /**
     * Total heap memory allocated
     */
    heapTotal: number;
    /**
     * External memory used
     */
    external: number;
  };
  /**
   * Load average of the system
   */
  loadAverage: number[];
}