import React, { useCallback, useEffect, useMemo, useState } from 'react';
import path from 'path';
import { FaCube, FaPlusCircle, FaSyncAlt, FaSearch, FaDownload, FaStore, FaTimes } from 'react-icons/fa';
import './ExtensionsPanel.css';

interface ExtensionInfo {
  id: string;
  name: string;
  version?: string;
  description?: string;
  location: string;
  manifestPath: string;
  publisher?: string;
}

interface OpenVSXExtension {
  namespace: string;
  name: string;
  version: string;
  description: string;
  displayName: string;
  downloadUrl: string;
  iconUrl?: string;
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
  const [activeView, setActiveView] = useState<'installed' | 'marketplace'>('installed');
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Marketplace states
  const [searchQuery, setSearchQuery] = useState('');
  const [marketplaceExtensions, setMarketplaceExtensions] = useState<OpenVSXExtension[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [selectedExtension, setSelectedExtension] = useState<ExtensionInfo | OpenVSXExtension | null>(null);
  const [isUninstalling, setIsUninstalling] = useState<string | null>(null);
  const [marketplaceResultsCount, setMarketplaceResultsCount] = useState<number>(0);

  const [userDataPath, setUserDataPath] = useState<string | null>(null);

  useEffect(() => {
    const fetchUserDataPath = async () => {
      const path = await safeInvoke<string>('app:getUserDataPath');
      if (path) setUserDataPath(path);
    };
    fetchUserDataPath();
  }, []);

  const baseExtensionsPath = useMemo(() => {
    if (!userDataPath) return null;
    return path.join(userDataPath, EXTENSIONS_DIR_NAME);
  }, [userDataPath]);

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
        if (!entry.isDirectory) continue;

        const extensionDir = path.join(baseExtensionsPath, entry.name);
        const manifestPath = path.join(extensionDir, 'extension.json');
        const packageJsonPath = path.join(extensionDir, 'package.json');
        let manifest: any = null;

        try {
          const extExists = await safeInvoke<boolean>('fs:exists', manifestPath);
          if (extExists) {
            const content = await safeInvoke<string>('fs:readFile', manifestPath);
            if (content) manifest = JSON.parse(content);
          } else {
            const pkgExists = await safeInvoke<boolean>('fs:exists', packageJsonPath);
            if (pkgExists) {
              const content = await safeInvoke<string>('fs:readFile', packageJsonPath);
              if (content) manifest = JSON.parse(content);
            }
          }
        } catch (manifestError) {
          console.warn('Failed to read extension manifest:', manifestError);
        }

        collected.push({
          id: entry.name,
          name: manifest?.displayName ?? manifest?.name ?? entry.name,
          version: manifest?.version,
          description: manifest?.description,
          location: extensionDir,
          manifestPath: manifestPath,
          publisher: manifest?.publisher
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

  // Marketplace search effector
  useEffect(() => {
    const timer = setTimeout(() => {
      const trimmed = searchQuery.trim();
      if (trimmed.length > 2) {
        searchMarketplace(trimmed);
      } else if (trimmed.length === 0) {
        setMarketplaceExtensions([]);
        setMarketplaceResultsCount(0);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const searchMarketplace = async (query: string, offset = 0) => {
    if (!query) {
      setMarketplaceExtensions([]);
      setMarketplaceResultsCount(0);
      return;
    }

    setIsSearching(true);
    if (offset === 0) {
      setMarketplaceExtensions([]);
    }

    try {
      const data = await safeInvoke<{ extensions: any[]; totalSize?: number }>('extension:search', query, offset);

      if (data && data.extensions) {
        const results: OpenVSXExtension[] = data.extensions.map((ext: any) => ({
          namespace: ext.namespace,
          name: ext.name,
          version: ext.version,
          description: ext.description,
          displayName: ext.displayName || ext.name,
          downloadUrl: ext.files.download,
          iconUrl: ext.files.icon
        }));

        if (offset === 0) {
          setMarketplaceExtensions(results);
        } else {
          setMarketplaceExtensions(prev => [...prev, ...results]);
        }
        setMarketplaceResultsCount(data.totalSize || (offset === 0 ? results.length : marketplaceResultsCount));
      } else {
        if (offset === 0) {
          setMarketplaceExtensions([]);
          setMarketplaceResultsCount(0);
        }
      }
    } catch (err) {
      console.error('Marketplace search error:', err);
      setError('Fehler bei der Marketplace-Suche.');
      if (offset === 0) setMarketplaceResultsCount(0);
    } finally {
      setIsSearching(false);
    }
  };

  const loadMoreMarketplace = () => {
    if (marketplaceExtensions.length < marketplaceResultsCount) {
      searchMarketplace(searchQuery.trim(), marketplaceExtensions.length);
    }
  };

  const handleUninstall = async (info: ExtensionInfo) => {
    if (!baseExtensionsPath) return;

    const confirm = window.confirm(`Möchtest du die Extension "${info.name}" wirklich deinstallieren?`);
    if (!confirm) return;

    setIsUninstalling(info.id);
    try {
      const result = await safeInvoke<boolean>('fs:deleteDirectory', info.location);
      if (result) {
        if (selectedExtension && 'id' in selectedExtension && selectedExtension.id === info.id) {
          setSelectedExtension(null);
        }
        await loadExtensions();
        window.dispatchEvent(new CustomEvent('extensions:changed'));
      } else {
        setError('Fehler beim Deinstallieren.');
      }
    } catch (err) {
      console.error('Uninstall error:', err);
      setError('Deinstallation fehlgeschlagen.');
    } finally {
      setIsUninstalling(null);
    }
  };

  const handleInstall = async (ext: OpenVSXExtension) => {
    if (!baseExtensionsPath) {
      setError('Kein Extensions-Verzeichnis verfügbar.');
      return;
    }

    const extId = `${ext.namespace}.${ext.name}`;
    setInstallingIds(prev => new Set(prev).add(extId));

    try {
      const targetDir = path.join(baseExtensionsPath, extId);
      const result = await safeInvoke<{ success: boolean; error?: string }>('extension:install', {
        url: ext.downloadUrl,
        fileName: `${extId}-${ext.version}.vsix`,
        targetDir
      });

      if (result?.success) {
        await loadExtensions();
        window.dispatchEvent(new CustomEvent('extensions:changed'));
      } else {
        setError(`Fehler beim Installieren: ${result?.error || 'Unbekannter Fehler'}`);
      }
    } catch (err) {
      console.error('Installation error:', err);
      setError('Installation fehlgeschlagen.');
    } finally {
      setInstallingIds(prev => {
        const next = new Set(prev);
        next.delete(extId);
        return next;
      });
    }
  };

  const handleOpenExtension = (info: ExtensionInfo) => {
    if (onOpenExtension) {
      onOpenExtension(info.manifestPath);
    }
  };

  const handleCreateExtension = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!baseExtensionsPath) return;

    const normalizedName = sanitizeExtensionName(createName || '');
    if (!normalizedName) return;

    setIsCreating(true);
    try {
      await safeInvoke('fs:createDirectory', baseExtensionsPath);
      const extensionDir = path.join(baseExtensionsPath, normalizedName);
      await safeInvoke('fs:createDirectory', extensionDir);

      const manifest = {
        name: normalizedName,
        publisher: 'local',
        displayName: createName.trim() || normalizedName,
        version: DEFAULT_EXTENSION_VERSION,
        description: createDescription.trim(),
        engines: {
          vscode: '*'
        },
        activationEvents: ['*'],
        main: './index.js'
      };

      await safeInvoke('fs:writeFile', path.join(extensionDir, 'package.json'), JSON.stringify(manifest, null, 2));
      const entrypoint = [
        "exports.activate = () => {",
        "  // Extension entrypoint",
        "};",
        "",
        "exports.deactivate = () => {};",
        ""
      ].join('\n');
      await safeInvoke('fs:writeFile', path.join(extensionDir, 'index.js'), entrypoint);
      setShowCreateForm(false);
      setCreateName('');
      setCreateDescription('');
      await loadExtensions();
      window.dispatchEvent(new CustomEvent('extensions:changed'));
    } catch (err) {
      console.error('Create error:', err);
    } finally {
      setIsCreating(false);
    }
  };

  if (selectedExtension) {
    const isMarketplace = 'downloadUrl' in selectedExtension;
    const isInstalled = isMarketplace
      ? extensions.some(e => e.id === `${(selectedExtension as OpenVSXExtension).namespace}.${(selectedExtension as OpenVSXExtension).name}`)
      : true;

    return (
      <div className="extensions-panel extensions-panel--detail">
        <div className="extensions-panel__header">
          <button
            type="button"
            className="extensions-panel__back-button"
            onClick={() => setSelectedExtension(null)}
          >
            ← Zurück
          </button>
        </div>
        <div className="extensions-panel__detail-content">
          <div className="extensions-panel__detail-header">
            {isMarketplace && (selectedExtension as OpenVSXExtension).iconUrl && (
              <img src={(selectedExtension as OpenVSXExtension).iconUrl} className="extensions-panel__detail-icon" alt="" />
            )}
            <div className="extensions-panel__detail-title">
              <h2>{isMarketplace ? (selectedExtension as OpenVSXExtension).displayName : (selectedExtension as ExtensionInfo).name}</h2>
              <p className="extensions-panel__detail-publisher">
                {isMarketplace
                  ? `@${(selectedExtension as OpenVSXExtension).namespace}`
                  : `by ${(selectedExtension as ExtensionInfo).publisher || 'unbekannt'}`}
              </p>
            </div>
          </div>

          <div className="extensions-panel__detail-actions">
            {isMarketplace ? (
              isInstalled ? (
                <span className="extensions-panel__installed-badge">Installiert</span>
              ) : (
                <button
                  type="button"
                  onClick={() => handleInstall(selectedExtension as OpenVSXExtension)}
                  disabled={installingIds.has(`${(selectedExtension as OpenVSXExtension).namespace}.${(selectedExtension as OpenVSXExtension).name}`)}
                  className="extensions-panel__install-button"
                >
                  {installingIds.has(`${(selectedExtension as OpenVSXExtension).namespace}.${(selectedExtension as OpenVSXExtension).name}`)
                    ? <FaSyncAlt className="spin" />
                    : <FaDownload />}
                  {' Install'}
                </button>
              )
            ) : (
              <button
                type="button"
                className="extensions-panel__uninstall-button"
                onClick={() => handleUninstall(selectedExtension as ExtensionInfo)}
                disabled={isUninstalling === (selectedExtension as ExtensionInfo).id}
              >
                Deinstallieren
              </button>
            )}

            {!isMarketplace && (
              <button type="button" onClick={() => handleOpenExtension(selectedExtension as ExtensionInfo)} className="extensions-panel__secondary-button">
                Manifest öffnen
              </button>
            )}
          </div>

          <div className="extensions-panel__detail-body">
            <p className="extensions-panel__detail-description">
              {selectedExtension.description || 'Keine Beschreibung verfügbar.'}
            </p>

            <div className="extensions-panel__detail-meta">
              <span>Version: {selectedExtension.version || 'unbekannt'}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="extensions-panel">
      <div className="extensions-panel__header">
        <div className="extensions-panel__tabs">
          <button
            type="button"
            className={`extensions-panel__tab ${activeView === 'installed' ? 'active' : ''}`}
            onClick={() => setActiveView('installed')}
          >
            <FaCube /> Eingebaut
          </button>
          <button
            type="button"
            className={`extensions-panel__tab ${activeView === 'marketplace' ? 'active' : ''}`}
            onClick={() => setActiveView('marketplace')}
          >
            <FaStore /> Marketplace
          </button>
        </div>
        <div className="extensions-panel__actions">
          <button
            type="button"
            className="extensions-panel__icon-button"
            onClick={() => loadExtensions()}
            title="Neu laden"
            disabled={isLoading}
          >
            <FaSyncAlt className={isLoading ? 'spin' : ''} />
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

      <div className="extensions-panel__content">
        {activeView === 'installed' ? (
          <>
            {error && <div className="extensions-panel__error">{error}</div>}
            {isLoading && !extensions.length && <div className="extensions-panel__loading">Lade Extensions...</div>}

            <ul className="extensions-panel__list">
              {extensions.map(extension => (
                <li
                  key={extension.id}
                  className="extensions-panel__item"
                  onClick={() => setSelectedExtension(extension)}
                >
                  <div className="extensions-panel__item-main">
                    <div className="extensions-panel__item-name">
                      {extension.name}
                      {extension.publisher && <span className="extensions-panel__item-publisher">by {extension.publisher}</span>}
                    </div>
                    <div className="extensions-panel__item-meta">
                      <span>v{extension.version ?? 'unbekannt'}</span>
                    </div>
                    {extension.description && (
                      <div className="extensions-panel__item-description">{extension.description}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="extensions-panel__marketplace">
            <div className="extensions-panel__search">
              <div className="extensions-panel__search-container">
                <input
                  type="text"
                  placeholder="Marketplace durchsuchen..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchMarketplace(searchQuery)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="extensions-panel__search-clear"
                    onClick={() => {
                      setSearchQuery('');
                      setMarketplaceExtensions([]);
                      setMarketplaceResultsCount(0);
                    }}
                  >
                    <FaTimes size={10} />
                  </button>
                )}
              </div>
              <button type="button" onClick={() => searchMarketplace(searchQuery)}>
                <FaSearch />
              </button>
            </div>

            {isSearching && <div className="extensions-panel__loading">Suche im Marketplace...</div>}

            {!isSearching && marketplaceExtensions.length > 0 && (
              <div className="extensions-panel__search-info">
                {marketplaceResultsCount} Ergebnisse gefunden
              </div>
            )}

            <ul className="extensions-panel__list">
              {marketplaceExtensions.map(ext => {
                const extId = `${ext.namespace}.${ext.name}`;
                const isInstalling = installingIds.has(extId);
                const isInstalled = extensions.some(e => e.id === extId);

                return (
                  <li
                    key={extId}
                    className="extensions-panel__item marketplace"
                    onClick={() => setSelectedExtension(ext)}
                  >
                    {ext.iconUrl && <img src={ext.iconUrl} alt="" className="extensions-panel__item-icon" />}
                    <div className="extensions-panel__item-main">
                      <div className="extensions-panel__item-name">
                        {ext.displayName}
                        <span className="extensions-panel__item-publisher">@{ext.namespace}</span>
                      </div>
                      <div className="extensions-panel__item-meta">
                        <span>v{ext.version}</span>
                      </div>
                      <div className="extensions-panel__item-description">{ext.description}</div>
                    </div>
                    <div className="extensions-panel__item-actions">
                      {isInstalled ? (
                        <span className="extensions-panel__installed-badge">Installiert</span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleInstall(ext);
                          }}
                          disabled={isInstalling}
                          className="extensions-panel__install-button"
                        >
                          {isInstalling ? <FaSyncAlt className="spin" /> : <FaDownload />}
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
              {marketplaceExtensions.length < marketplaceResultsCount && searchQuery.trim().length > 0 && !isSearching && (
                <div className="extensions-panel__load-more">
                  <button type="button" onClick={loadMoreMarketplace}>
                    Mehr laden...
                  </button>
                </div>
              )}
              {!isSearching && searchQuery.trim().length > 0 && marketplaceExtensions.length === 0 && (
                <div className="extensions-panel__empty">Keine Erweiterungen für "{searchQuery}" gefunden.</div>
              )}
            </ul>
          </div>
        )}
      </div>

      {showCreateForm && (
        <div className="extensions-panel__create">
          <form onSubmit={handleCreateExtension}>
            <h3>Neue lokale Extension</h3>
            <label>
              Anzeigename
              <input
                type="text"
                value={createName}
                onChange={event => setCreateName(event.target.value)}
                placeholder="Meine tolle Extension"
                required
              />
            </label>
            <label>
              Beschreibung
              <textarea
                value={createDescription}
                onChange={event => setCreateDescription(event.target.value)}
                placeholder="Was macht diese Erweiterung?"
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
