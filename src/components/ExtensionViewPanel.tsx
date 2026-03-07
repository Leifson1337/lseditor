import React, { useEffect, useRef, useState } from 'react';
import { ViewPaneContainer } from '@codingame/monaco-vscode-views-service-override';
import { IExtensionService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensions.service';
import { IInstantiationService, IViewDescriptorService, StandaloneServices } from '@codingame/monaco-vscode-api/services';
import { ExtensionService } from '../services/ExtensionService';

interface ExtensionViewPanelProps {
    viewContainerId: string;
}

export const ExtensionViewPanel: React.FC<ExtensionViewPanelProps> = ({ viewContainerId }) => {
    const [containerTitle, setContainerTitle] = useState(viewContainerId);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const viewHostRef = useRef<HTMLDivElement>(null);
    const containerInstanceRef = useRef<{ cleanup: () => void } | null>(null);

    useEffect(() => {
        // Update header label from loaded extension metadata as a fallback
        const items = ExtensionService.getInstance().getSidebarItems();
        const item = items.find(i => i.id === viewContainerId);
        if (item) {
            setContainerTitle(item.title);
        }
    }, [viewContainerId]);

    useEffect(() => {
        let disposed = false;

        // Clean up any existing view host before switching containers
        containerInstanceRef.current?.cleanup();
        containerInstanceRef.current = null;

        let retryTimer: number | null = null;
        let retries = 0;
        const maxRetries = 12;

        const attachViewContainer = async () => {
            try {
                setError(null);
                setIsLoading(true);

                const viewDescriptorService = StandaloneServices.get(IViewDescriptorService);
                const extensionService = StandaloneServices.get(IExtensionService) as any;
                if (typeof extensionService?.whenInstalledExtensionsRegistered === 'function') {
                    await extensionService.whenInstalledExtensionsRegistered();
                }

                const descriptor = viewDescriptorService.getViewContainerById(viewContainerId);

                if (!descriptor) {
                    if (retries < maxRetries && !disposed) {
                        retries += 1;
                        retryTimer = window.setTimeout(attachViewContainer, 300);
                        return;
                    }
                    setError('View-Container wurde nicht gefunden.');
                    return;
                }

                const descriptorTitle = (descriptor.title as any)?.value || descriptor.id || viewContainerId;
                setContainerTitle(descriptorTitle);

                const instantiationService = StandaloneServices.get(IInstantiationService);
                const ctor = descriptor.ctorDescriptor?.ctor ?? ViewPaneContainer;
                const args = descriptor.ctorDescriptor?.staticArguments?.length
                    ? descriptor.ctorDescriptor.staticArguments
                    : [descriptor.id ?? viewContainerId, { mergeViewWithContainerWhenSingleView: true }];

                const container = instantiationService.createInstance(ctor as any, ...(args ?? [])) as ViewPaneContainer;
                const host = document.createElement('div');
                host.style.height = '100%';
                host.style.width = '100%';
                container.create(host);
                container.setVisible(true);

                if (disposed) {
                    container.dispose();
                    return;
                }

                const target = viewHostRef.current;
                if (!target) {
                    container.dispose();
                    return;
                }

                target.innerHTML = '';
                target.appendChild(host);

                const runLayout = () => {
                    const rect = target.getBoundingClientRect();
                    (container as any).layout({ width: rect.width, height: rect.height });
                };

                runLayout();
                const resizeObserver = new ResizeObserver(runLayout);
                resizeObserver.observe(target);

                containerInstanceRef.current = {
                    cleanup: () => {
                        resizeObserver.disconnect();
                        container.dispose();
                    }
                };
                setIsLoading(false);
            } catch (err) {
                console.error('Failed to render view container', err);
                if (!disposed) {
                    setError('View-Inhalte konnten nicht geladen werden.');
                    setIsLoading(false);
                }
            }
        };

        attachViewContainer();

        const handleExtensionsChanged = () => {
            if (!disposed) {
                retries = 0;
                attachViewContainer();
            }
        };
        window.addEventListener('extensions:changed', handleExtensionsChanged);

        return () => {
            disposed = true;
            if (retryTimer !== null) {
                window.clearTimeout(retryTimer);
            }
            window.removeEventListener('extensions:changed', handleExtensionsChanged);
            containerInstanceRef.current?.cleanup();
            containerInstanceRef.current = null;
        };
    }, [viewContainerId]);

    return (
        <div className="extension-view-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="extension-view-header" style={{
                padding: '10px 20px',
                borderBottom: '1px solid var(--border-primary)',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                fontSize: '11px',
                color: 'var(--text-secondary)'
            }}>
                {containerTitle}
            </div>
            <div className="extension-view-content" style={{ flex: 1, overflow: 'hidden' }}>
                {error ? (
                    <div style={{ padding: 20, color: 'var(--text-secondary)', fontSize: 13 }}>
                        {error}
                    </div>
                ) : isLoading ? (
                    <div style={{ padding: 20, color: 'var(--text-secondary)', fontSize: 13 }}>
                        View-Container wird geladen...
                    </div>
                ) : (
                    <div ref={viewHostRef} style={{ height: '100%', width: '100%' }} />
                )}
            </div>
        </div>
    );
};
