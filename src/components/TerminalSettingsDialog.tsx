import React, { useState, useEffect } from 'react';
import './TerminalSettingsDialog.css';

interface TerminalSettingsDialogProps {
    initialFontSize: number;
    initialFontFamily: string;
    onSave: (fontSize: number, fontFamily: string) => void;
    onClose: () => void;
    isOpen: boolean;
}

export const TerminalSettingsDialog: React.FC<TerminalSettingsDialogProps> = ({
    initialFontSize,
    initialFontFamily,
    onSave,
    onClose,
    isOpen
}) => {
    const [fontSize, setFontSize] = useState(initialFontSize);
    const [fontFamily, setFontFamily] = useState(initialFontFamily);

    useEffect(() => {
        if (isOpen) {
            setFontSize(initialFontSize);
            setFontFamily(initialFontFamily);
        }
    }, [isOpen, initialFontSize, initialFontFamily]);

    if (!isOpen) return null;

    const handleSave = () => {
        onSave(fontSize, fontFamily);
        onClose();
    };

    return (
        <div className="terminal-settings-overlay">
            <div className="terminal-settings-dialog">
                <div className="terminal-settings-header">
                    <h3>Terminal Settings</h3>
                    <button className="close-button" onClick={onClose}>×</button>
                </div>
                <div className="terminal-settings-content">
                    <div className="form-group">
                        <label>Font Size (px)</label>
                        <input
                            type="number"
                            min="8"
                            max="32"
                            value={fontSize}
                            onChange={(e) => setFontSize(Number(e.target.value))}
                        />
                    </div>
                    <div className="form-group">
                        <label>Font Family</label>
                        <input
                            type="text"
                            value={fontFamily}
                            onChange={(e) => setFontFamily(e.target.value)}
                            placeholder="e.g. Consolas, monospace"
                        />
                    </div>
                </div>
                <div className="terminal-settings-actions">
                    <button className="cancel-button" onClick={onClose}>Cancel</button>
                    <button className="save-button" onClick={handleSave}>Save</button>
                </div>
            </div>
        </div>
    );
};
