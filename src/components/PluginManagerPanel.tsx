import React, { useState, useEffect, useCallback } from 'react';
import { useServices } from '../contexts/ServiceContext';
import { Plugin } from '../services/PluginService'; // Assuming Plugin interface is exported from PluginService
import './PluginManagerPanel.css';

export const PluginManagerPanel: React.FC = () => {
  const { pluginService } = useServices();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchAndUpdatePlugins = useCallback(async () => {
    if (pluginService) {
      setIsLoading(true);
      try {
        // Assuming getPlugins() might be async if it needs to load them on demand
        // or if it's a synchronous getter for already loaded plugins.
        // For this setup, PluginService.loadPlugins() is called in App.tsx
        // and getPlugins() should be synchronous.
        const currentPlugins = pluginService.getPlugins();
        setPlugins(currentPlugins);
      } catch (error) {
        console.error("Failed to fetch plugins:", error);
        // Handle error (e.g., show error message in UI)
      } finally {
        setIsLoading(false);
      }
    }
  }, [pluginService]);

  useEffect(() => {
    if (!pluginService) {
      setIsLoading(false); // No service, not loading
      return;
    }

    fetchAndUpdatePlugins(); // Initial fetch

    const handlePluginChange = (pluginId?: string) => {
      // Re-fetch all plugins to ensure UI is consistent with the service state
      fetchAndUpdatePlugins();
    };
    
    // Using a generic 'pluginChanged' event if PluginService emits one
    // Or individual events as specified
    pluginService.on('pluginsLoaded', fetchAndUpdatePlugins);
    pluginService.on('pluginInstalled', handlePluginChange);
    pluginService.on('pluginUninstalled', handlePluginChange);
    pluginService.on('pluginEnabled', handlePluginChange);
    pluginService.on('pluginDisabled', handlePluginChange);

    return () => {
      pluginService.off('pluginsLoaded', fetchAndUpdatePlugins);
      pluginService.off('pluginInstalled', handlePluginChange);
      pluginService.off('pluginUninstalled', handlePluginChange);
      pluginService.off('pluginEnabled', handlePluginChange);
      pluginService.off('pluginDisabled', handlePluginChange);
    };
  }, [pluginService, fetchAndUpdatePlugins]);

  const togglePluginState = async (plugin: Plugin) => {
    if (!pluginService) return;
    setIsLoading(true); // Indicate activity
    try {
      if (plugin.enabled) {
        await pluginService.disablePlugin(plugin.id);
      } else {
        await pluginService.enablePlugin(plugin.id);
      }
      // fetchAndUpdatePlugins(); // Event listener should handle this
    } catch (error) {
      console.error(`Failed to toggle plugin ${plugin.id}:`, error);
      // Handle error (e.g., show error message in UI)
      fetchAndUpdatePlugins(); // Re-fetch on error to ensure UI consistency
    } finally {
      // setIsLoading(false); // isLoading should be managed by fetchAndUpdatePlugins if called
    }
  };
  
  const handleUninstallPlugin = async (pluginId: string) => {
    if (!pluginService) return;
    if (window.confirm(`Are you sure you want to uninstall plugin "${pluginId}"?`)) {
        setIsLoading(true);
        try {
            await pluginService.uninstallPlugin(pluginId);
            // Event listener 'pluginUninstalled' will call fetchAndUpdatePlugins
        } catch (error) {
            console.error(`Failed to uninstall plugin ${pluginId}:`, error);
            alert(`Failed to uninstall plugin: ${error}`);
            fetchAndUpdatePlugins(); // Ensure UI consistency on error
        }
    }
  };


  if (isLoading && plugins.length === 0) { // Show loading only on initial load
    return <div className="plugin-manager-loading">Loading plugins...</div>;
  }

  if (!pluginService) {
    return <div className="plugin-manager-error">Plugin Service not available.</div>;
  }
  
  if (plugins.length === 0 && !isLoading) {
    return <div className="plugin-manager-empty">No plugins installed or loaded.</div>;
  }

  return (
    <div className="plugin-manager-panel">
      <h2>Plugin Management</h2>
      <div className="plugin-list">
        {plugins.map((plugin) => (
          <div key={plugin.id} className="plugin-item">
            <div className="plugin-info">
              <h3>{plugin.name} <span className="plugin-version">v{plugin.version}</span></h3>
              <p className="plugin-author">by {plugin.author}</p>
              <p className="plugin-description">{plugin.description}</p>
            </div>
            <div className="plugin-actions">
              <p className={`plugin-status ${plugin.enabled ? 'enabled' : 'disabled'}`}>
                Status: {plugin.enabled ? 'Enabled' : 'Disabled'}
              </p>
              <button 
                onClick={() => togglePluginState(plugin)}
                disabled={isLoading}
                className={`plugin-toggle-button ${plugin.enabled ? 'disable' : 'enable'}`}
              >
                {plugin.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                onClick={() => handleUninstallPlugin(plugin.id)}
                disabled={isLoading}
                className="plugin-uninstall-button"
              >
                Uninstall
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PluginManagerPanel;
