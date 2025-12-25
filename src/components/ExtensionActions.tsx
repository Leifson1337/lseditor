import React, { useEffect, useState, useRef } from 'react';
import { StandaloneServices } from 'vscode/services';
import { FaEllipsisV } from 'react-icons/fa';
import '../styles/ExtensionActions.css';

interface ExtensionActionsProps {
    menuId?: string;
}

/**
 * ExtensionActions renders buttons contributed by VS Code extensions.
 * It uses the internal Monaco/VSCode MenuService to find actions for a given menu ID.
 */
export const ExtensionActions: React.FC<ExtensionActionsProps> = ({
    menuId = 'EditorTitle'
}) => {
    const [actions, setActions] = useState<any[]>([]);
    const [showMore, setShowMore] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let disposed = false;
        let menu: any = null;

        const initMenu = async () => {
            try {
                // Try to get services. In different versions of monaco-vscode-api, 
                // these might be named differently or accessed differently.
                const menuService = (StandaloneServices as any).get?.('IMenuService');
                const contextKeyService = (StandaloneServices as any).get?.('IContextKeyService');

                if (!menuService || !contextKeyService) {
                    console.warn('ExtensionActions: Required services (IMenuService/IContextKeyService) not found.');
                    return;
                }

                // Map string IDs to internal MenuId enum if possible
                // 14 = EditorTitle (standard in many VS Code versions)
                const targetMenuId = menuId === 'EditorTitle' ? 14 : menuId;

                menu = menuService.createMenu(targetMenuId, contextKeyService);

                const updateActions = () => {
                    if (disposed) return;
                    const allActions = menu.getActions({ shouldLogTelemetry: false });
                    const primary: any[] = [];

                    for (const [, groupActions] of allActions) {
                        for (const action of groupActions) {
                            // Standard MenuItemAction check (internal)
                            if (action && (action.id || action.label)) {
                                primary.push(action);
                            }
                        }
                    }
                    setActions(primary);
                };

                updateActions();
                menu.onDidChange(() => updateActions());
            } catch (e) {
                console.warn('ExtensionActions: Failed to initialize menu actions', e);
            }
        };

        initMenu();

        return () => {
            disposed = true;
            if (menu?.dispose) menu.dispose();
        };
    }, [menuId]);

    if (actions.length === 0) return null;

    const visibleActions = actions.slice(0, 3);
    const overflowActions = actions.slice(3);

    return (
        <div className="extension-actions" ref={containerRef}>
            {visibleActions.map(action => (
                <button
                    key={action.id || action.label}
                    className="extension-action-btn"
                    title={action.label || action.tooltip || ''}
                    onClick={() => {
                        try {
                            action.run();
                        } catch (err) {
                            console.error(`Failed to run extension action: ${action.id}`, err);
                        }
                    }}
                >
                    {action.item?.icon ? (
                        <i className={`codicon codicon-${action.item.icon}`} />
                    ) : (
                        <span>{action.label}</span>
                    )}
                </button>
            ))}

            {overflowActions.length > 0 && (
                <div className="extension-action-overflow">
                    <button
                        className="extension-action-btn overflow-trigger"
                        onClick={() => setShowMore(!showMore)}
                        title="Weitere Aktionen..."
                    >
                        <FaEllipsisV />
                    </button>

                    {showMore && (
                        <div className="extension-action-dropdown">
                            {overflowActions.map(action => (
                                <div
                                    key={action.id || action.label}
                                    className="extension-dropdown-item"
                                    onClick={() => {
                                        action.run();
                                        setShowMore(false);
                                    }}
                                >
                                    {action.label}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
