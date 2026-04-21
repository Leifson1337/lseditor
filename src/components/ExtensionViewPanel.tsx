import React, { useEffect, useRef, useState } from 'react';
import { renderSidebarPart } from '@codingame/monaco-vscode-views-service-override';
import { StandaloneServices } from '@codingame/monaco-vscode-api/services';
import { IViewsService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/views/common/viewsService.service';

interface ExtensionViewPanelProps {
    viewContainerId: string;
}

export const ExtensionViewPanel: React.FC<ExtensionViewPanelProps> = ({ viewContainerId }) => {
    const [error, setError] = useState<string | null>(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const sidebarDisposableRef = useRef<{ dispose: () => void } | null>(null);

    // Attach VS Code sidebar part into our host div (once on mount).
    // renderSidebarPart moves the workbench sidebar DOM element into the provided
    // container and sets up a ResizeObserver for automatic layout.
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        try {
            const disposable = renderSidebarPart(host);
            sidebarDisposableRef.current = disposable;
        } catch (e) {
            console.error('[ExtensionViewPanel] Failed to attach sidebar part', e);
            setError('Could not load sidebar.');
        }
        return () => {
            sidebarDisposableRef.current?.dispose();
            sidebarDisposableRef.current = null;
        };
    }, []);

    // Whenever the requested view container changes, tell the VS Code sidebar
    // to activate it via IViewsService. Retries until the container is available
    // (extensions may still be registering their views).
    useEffect(() => {
        if (!viewContainerId) return;
        let cancelled = false;
        let retryTimer: number | null = null;
        let retries = 0;
        const maxRetries = 30;

        const tryOpen = async () => {
            try {
                const viewsService = StandaloneServices.get(IViewsService);
                const result = await viewsService.openViewContainer(viewContainerId, false);
                // null means the container isn't registered yet — retry
                if (result == null && !cancelled && retries < maxRetries) {
                    retries++;
                    retryTimer = window.setTimeout(tryOpen, 500);
                }
            } catch (e) {
                if (!cancelled) {
                    if (retries < maxRetries) {
                        retries++;
                        retryTimer = window.setTimeout(tryOpen, 500);
                    } else {
                        console.error('[ExtensionViewPanel] Failed to open view container', viewContainerId, e);
                        setError(`Could not open view "${viewContainerId}".`);
                    }
                }
            }
        };

        tryOpen();

        return () => {
            cancelled = true;
            if (retryTimer !== null) window.clearTimeout(retryTimer);
        };
    }, [viewContainerId]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
            <div ref={hostRef} style={{ height: '100%', width: '100%', overflow: 'hidden' }} />
            {error && (
                <div style={{
                    position: 'absolute', inset: 0,
                    padding: 20, color: 'var(--text-secondary)', fontSize: 13,
                    background: 'var(--bg-primary, #1e1e1e)'
                }}>
                    {error}
                </div>
            )}
        </div>
    );
};
