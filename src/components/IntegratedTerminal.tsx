import React from 'react';
import { TerminalTabs } from './TerminalTabs';

interface IntegratedTerminalProps {
  projectPath?: string;
  onClose: () => void;
}

/**
 * IntegratedTerminal hosts the tabbed terminal experience.
 */
export const IntegratedTerminal: React.FC<IntegratedTerminalProps> = ({ projectPath, onClose }) => {
  return <TerminalTabs projectPath={projectPath} onClose={onClose} />;
};

export default IntegratedTerminal;
