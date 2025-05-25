import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useServices } from '../contexts/ServiceContext';
import { RegisteredCommand } from '../services/CommandService'; // Assuming RegisteredCommand is exported
import './CommandPalette.css';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const { commandService, uiService } = useServices();
  const [commands, setCommands] = useState<RegisteredCommand[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredCommands, setFilteredCommands] = useState<RegisteredCommand[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const refreshCommands = useCallback(() => {
    if (commandService) {
      const allCommands = commandService.getAllCommands();
      setCommands(allCommands);
      // Filtering will be handled by the other useEffect
    }
  }, [commandService]);

  useEffect(() => {
    if (isOpen && commandService) {
      refreshCommands();
      inputRef.current?.focus();
    } else if (!isOpen) {
      setSearchTerm(''); // Reset search term when palette closes
    }

    const handleCommandAdded = (command: RegisteredCommand) => {
      if (isOpen) { // Refresh if open
        refreshCommands();
      }
      // Or, more efficiently, add to existing state:
      // setCommands(prev => [...prev, command]); 
      // However, getAllCommands might provide sorting or other logic, so refresh is safer.
    };
    
    commandService?.on('commandAdded', handleCommandAdded);
    // TODO: Add listener for commandRemoved if that event is implemented

    return () => {
      commandService?.off('commandAdded', handleCommandAdded);
    };
  }, [isOpen, commandService, refreshCommands]);

  useEffect(() => {
    if (!searchTerm) {
      setFilteredCommands(commands);
    } else {
      setFilteredCommands(
        commands.filter(cmd =>
          cmd.label?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          cmd.id.toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    }
    setSelectedIndex(0); // Reset index on new filter results
  }, [searchTerm, commands]);

  useEffect(() => {
    // Scroll to selected item
    if (isOpen && selectedIndex >= 0 && listRef.current) {
      const selectedItem = listRef.current.children[selectedIndex] as HTMLLIElement;
      if (selectedItem) {
        selectedItem.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }
  }, [selectedIndex, isOpen]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filteredCommands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        commandService?.executeCommand(filteredCommands[selectedIndex].id);
        onClose(); // Close palette after execution
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [isOpen, filteredCommands, selectedIndex, commandService, onClose]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    } else {
      document.removeEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  const handleCommandClick = (commandId: string) => {
    commandService?.executeCommand(commandId);
    onClose();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette-modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a command..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="command-palette-input"
        />
        <ul ref={listRef} className="command-palette-list">
          {filteredCommands.length > 0 ? (
            filteredCommands.map((cmd, index) => (
              <li
                key={cmd.id}
                className={`command-palette-item ${index === selectedIndex ? 'selected' : ''}`}
                onClick={() => handleCommandClick(cmd.id)}
                onMouseEnter={() => setSelectedIndex(index)} // Optional: change selection on hover
              >
                {/* TODO: Add icon rendering if cmd.icon is available */}
                <span className="command-palette-item-label">{cmd.label || cmd.id}</span>
                <span className="command-palette-item-id">{cmd.id !== cmd.label ? cmd.id : ''}</span>
              </li>
            ))
          ) : (
            <li className="command-palette-item-empty">No commands found.</li>
          )}
        </ul>
      </div>
    </div>
  );
};

export default CommandPalette;
