import React, { useCallback, useEffect, useMemo, useState } from 'react';
import path from 'path';
import { FaCube, FaFolderOpen, FaPlusCircle, FaSyncAlt } from 'react-icons/fa';
import './ExtensionsPanel.css';

interface ExtensionInfo {
  id: string;
  name: string;
  version?: string;
  description?: string;
  location: string;
  manifestPath: string;
}

interface ExtensionsPanelProps {
  projectPath?: string;
  onOpenExtension?: (manifestPath: string) => void;
}

const EXTENSIONS_DIR_NAME = 'extensions';
const DEFAULT_EXTENSION_VERSION = '0.1.0';

const sanitizeExtensionName = (input: string): string => {
  return input
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '')
    .toLowerCase();
};

const safeInvoke = async <T,>(channel: string, ...args: any[]): Promise<T | null> => {
  try {
    return (await window.electron?.ipcRenderer?.invoke(channel, ...args)) ?? null;
  } catch (error) {
    console.error(`ExtensionsPanel IPC error on ${channel}:`, error);
    return null;
  }
};

export const ExtensionsPanel: React.FC<ExtensionsPanelProps> = ({
  projectPath,
  onOpenExtension
}) => {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const baseExtensionsPath = useMemo(() => {
    if (!projectPath) {
      return null;
    }
    return path.join(projectPath, EXTENSIONS_DIR_NAME);
  }, [projectPath]);

  const loadExtensions = useCallback(async () => {
    if (!baseExtensionsPath) {
      setExtensions([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const exists = await safeInvoke<boolean>('fs:checkPathExistsAndIsDirectory', baseExtensionsPath);
      if (!exists) {
        setExtensions([]);
        setIsLoading(false);
        return;
      }

      const entries = (await safeInvoke<Array<{ name: string; isDirectory: boolean }>>(
        'fs:readDir',
        baseExtensionsPath
      )) ?? [];

      const collected: ExtensionInfo[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory) {
          continue;
        }
        const extensionDir = path.join(baseExtensionsPath, entry.name);
        const manifestPath = path.join(extensionDir, 'extension.json');
        let manifest: any = null;

        try {
          const manifestContent = await safeInvoke<string>('fs:readFile', manifestPath);
          if (manifestContent) {
            manifest = JSON.parse(manifestContent);
          }
        } catch (manifestError) {
          console.warn('Failed to read extension manifest:', manifestError);
        }

        collected.push({
          id: entry.name,
          name: manifest?.name ?? entry.name,
          version: manifest?.version,
          description: manifest?.description,
          location: extensionDir,
          manifestPath
        });
      }

      collected.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      setExtensions(collected);
    } catch (loadError) {
      console.error('Failed to load extensions:', loadError);
      setError('Extensions konnten nicht geladen werden.');
    } finally {
      setIsLoading(false);
    }
  }, [baseExtensionsPath]);

  useEffect(() => {
    loadExtensions().catch(err => console.error('Extension load error:', err));
  }, [loadExtensions]);

  const handleCreateExtension = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!baseExtensionsPath) {
      setError('Kein Projekt geoeffnet.');
      return;
    }

    const normalizedName = sanitizeExtensionName(createName || '');
    if (!normalizedName) {
      setError('Bitte einen gueltigen Namen angeben.');
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      await safeInvoke('fs:createDirectory', baseExtensionsPath);

      const extensionDir = path.join(baseExtensionsPath, normalizedName);
      const exists = await safeInvoke<boolean>('fs:checkPathExistsAndIsDirectory', extensionDir);
      if (exists) {
        setError('Eine Extension mit diesem Namen existiert bereits.');
        setIsCreating(false);
        return;
      }

      await safeInvoke('fs:createDirectory', extensionDir);

      const manifest = {
        name: createName.trim() || normalizedName,
        version: DEFAULT_EXTENSION_VERSION,
        description: createDescription.trim(),
        main: './index.js',
        createdAt: new Date().toISOString()
      };

      await safeInvoke('fs:writeFile', path.join(extensionDir, 'extension.json'), JSON.stringify(manifest, null, 2));
      await safeInvoke(
        'fs:writeFile',
        path.join(extensionDir, 'index.js'),
        `module.exports = function activate() {\n  console.log('Extension ${manifest.name} activated');\n};\n`
      );
      await safeInvoke(
        'fs:writeFile',
        path.join(extensionDir, 'README.md'),
        `# ${manifest.name}\n\n${manifest.description || 'Neue Extension.'}\n`
      );

      setShowCreateForm(false);
      setCreateName('');
      setCreateDescription('');
      await loadExtensions();
    } catch (createError) {
      console.error('Failed to create extension:', createError);
      setError('Extension konnte nicht erstellt werden.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleOpenExtension = (info: ExtensionInfo) => {
    if (onOpenExtension) {
      onOpenExtension(info.manifestPath);
    }
  };

  return (
    <div className="extensions-panel">
      <div className="extensions-panel__header">
        <div className="extensions-panel__title">
          <FaCube />
          <span>Extensions</span>
          <span className="extensions-panel__count">{extensions.length}</span>
        </div>
        <div className="extensions-panel__actions">
          <button
            type="button"
            className="extensions-panel__icon-button"
            onClick={() => loadExtensions()}
            title="Neu laden"
            disabled={isLoading}
          >
            <FaSyncAlt />
          </button>
          <button
            type="button"
            className="extensions-panel__icon-button"
            onClick={() => setShowCreateForm(true)}
            title="Neue Extension erstellen"
          >
            <FaPlusCircle />
          </button>
        </div>
      </div>

      {error && <div className="extensions-panel__error">{error}</div>}

      {isLoading && <div className="extensions-panel__loading">Lade Extensions...</div>}

      {!isLoading && extensions.length === 0 && (
        <div className="extensions-panel__empty">
          <p>Noch keine Extensions gefunden.</p>
          <button type="button" onClick={() => setShowCreateForm(true)}>
            Neue Extension erstellen
          </button>
        </div>
      )}

      {!isLoading && extensions.length > 0 && (
        <ul className="extensions-panel__list">
          {extensions.map(extension => (
            <li key={extension.id} className="extensions-panel__item">
              <div className="extensions-panel__item-main">
                <div className="extensions-panel__item-name">{extension.name}</div>
                <div className="extensions-panel__item-meta">
                  <span>Version: {extension.version ?? 'unbekannt'}</span>
                </div>
                {extension.description && (
                  <div className="extensions-panel__item-description">{extension.description}</div>
                )}
              </div>
              <div className="extensions-panel__item-actions">
                <button type="button" onClick={() => handleOpenExtension(extension)}>
                  <FaFolderOpen /> Manifest oeffnen
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showCreateForm && (
        <div className="extensions-panel__create">
          <form onSubmit={handleCreateExtension}>
            <h3>Neue Extension</h3>
            <label>
              Name
              <input
                type="text"
                value={createName}
                onChange={event => setCreateName(event.target.value)}
                placeholder="Meine Extension"
                required
              />
            </label>
            <label>
              Beschreibung
              <textarea
                value={createDescription}
                onChange={event => setCreateDescription(event.target.value)}
                placeholder="Kurzbeschreibung..."
                rows={3}
              />
            </label>
            <div className="extensions-panel__create-actions">
              <button type="button" onClick={() => setShowCreateForm(false)} disabled={isCreating}>
                Abbrechen
              </button>
              <button type="submit" disabled={isCreating}>
                {isCreating ? 'Erstelle...' : 'Erstellen'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default ExtensionsPanel;
