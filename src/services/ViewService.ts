import React from 'react';
import { EventEmitter } from '../utils/EventEmitter';
import { PluginService } from './PluginService'; // Assuming PluginService is in the same directory

export interface RegisteredView {
  id: string; // e.g., "pluginId.viewId"
  pluginId: string;
  viewId: string; // Original viewId from plugin
  component: React.ComponentType<any>; // The React component
  title?: string; // Optional user-facing title for the view
  icon?: string; // Optional icon for the view
  // defaultLocation?: string; // Example: 'sidebar', 'panel', 'editor' - can be added later
}

export class ViewService extends EventEmitter {
  private views: Map<string, RegisteredView> = new Map();
  private pluginService: PluginService;

  constructor(pluginService: PluginService) {
    super();
    this.pluginService = pluginService;

    // Subscribe to pluginService events for view registration
    this.pluginService.on('viewRegistered', this.handleViewRegistered);
    // Consider handling plugin unload to unregister views if plugins can be dynamically unloaded
    // this.pluginService.on('pluginUnloaded', this.handlePluginUnloaded);
  }

  private handleViewRegistered = ({ pluginId, viewId, component, title, icon }: { 
    pluginId: string, 
    viewId: string, 
    component: React.ComponentType<any>,
    title?: string,
    icon?: string 
  }) => {
    this.registerView(pluginId, viewId, component, title, icon);
  };

  // private handlePluginUnloaded = (pluginId: string) => {
  //   const viewsToRemove = Array.from(this.views.values()).filter(view => view.pluginId === pluginId);
  //   viewsToRemove.forEach(view => {
  //     this.views.delete(view.id);
  //     this.emit('viewRemoved', view.id);
  //   });
  //   console.log(`Views for plugin ${pluginId} unloaded.`);
  // };

  public registerView(
    pluginId: string,
    viewId: string,
    component: React.ComponentType<any>,
    title?: string,
    icon?: string
  ): void {
    const id = `${pluginId}.${viewId}`;
    if (this.views.has(id)) {
      console.warn(`View with id ${id} already registered. Overwriting.`);
      // Optionally, decide if overwriting is allowed or should throw an error
    }

    const registeredView: RegisteredView = {
      id,
      pluginId,
      viewId,
      component,
      title: title || viewId, // Default title to viewId if not provided
      icon,
    };

    this.views.set(id, registeredView);
    this.emit('viewAdded', registeredView);
    console.log(`View registered: ${id}`);
  }

  public getView(id: string): RegisteredView | undefined {
    return this.views.get(id);
  }

  public getAllViews(): RegisteredView[] {
    return Array.from(this.views.values());
  }
  
  public getViewsByPlugin(pluginId: string): RegisteredView[] {
    return Array.from(this.views.values()).filter(view => view.pluginId === pluginId);
  }

  public dispose(): void {
    this.pluginService.off('viewRegistered', this.handleViewRegistered);
    // this.pluginService.off('pluginUnloaded', this.handlePluginUnloaded);
    this.views.clear();
    this.removeAllListeners();
    console.log("ViewService disposed.");
  }
}
