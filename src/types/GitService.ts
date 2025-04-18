import { StatusResult } from 'simple-git';

export interface ResourceUsage {
  cpu: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  loadAverage: number[];
}

export { StatusResult }; 