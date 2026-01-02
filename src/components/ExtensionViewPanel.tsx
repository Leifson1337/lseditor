import React, { useEffect, useState } from 'react';
import { ExtensionService } from '../services/ExtensionService';

interface ExtensionViewPanelProps {
    viewContainerId: string;
}

export const ExtensionViewPanel: React.FC<ExtensionViewPanelProps> = ({ viewContainerId }) => {
    const [views, setViews] = useState<{ id: string; name: string }[]>([]);
    const [containerTitle, setContainerTitle] = useState(viewContainerId);

    useEffect(() => {
        // Get views for this container
        const vs = ExtensionService.getInstance().getViewsForContainer(viewContainerId);
        setViews(vs);

        // Get container title
        const items = ExtensionService.getInstance().getSidebarItems();
        const item = items.find(i => i.id === viewContainerId);
        if (item) {
            setContainerTitle(item.title);
        }
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
            <div className="extension-view-content" style={{ flex: 1, overflow: 'auto' }}>
                {views.length === 0 ? (
                    <div style={{ padding: 20, color: 'var(--text-secondary)', fontSize: 13 }}>
                        No views registered for this container.
                    </div>
                ) : (
                    views.map(view => (
                        <div key={view.id} className="extension-view-section">
                            <div className="view-header" style={{
                                backgroundColor: 'var(--bg-tertiary)',
                                padding: '4px 8px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                display: 'flex',
                                alignItems: 'center',
                                cursor: 'pointer'
                            }}>
                                <span style={{ marginRight: 4 }}>▼</span>
                                {view.name}
                            </div>
                            <div className="view-body" style={{ padding: 10 }}>
                                {/* This is where the actual Tree View or Webview would go. 
                       For now, we indicate that the view is active. */}
                                <div style={{ fontStyle: 'italic', color: 'var(--text-secondary)', fontSize: 12 }}>
                                    View content provider not yet fully bridged.
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
