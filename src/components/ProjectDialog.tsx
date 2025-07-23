import React, { useState } from 'react';

interface ProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenProject: (path: string) => void;
  onCreateProject: (projectData: { name: string; path: string }) => void;
  recentProjects: string[];
  onSelectRecentProject: (path: string) => void;
}

export const ProjectDialog: React.FC<ProjectDialogProps> = ({
  isOpen,
  onClose,
  onOpenProject,
  onCreateProject,
  recentProjects,
  onSelectRecentProject,
}) => {
  const [activeTab, setActiveTab] = useState<'open' | 'create'>('open');
  const [projectPath, setProjectPath] = useState('');
  const [projectName, setProjectName] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) {
    return null;
  }

  const handleBrowse = async () => {
    try {
      const result = await window.electron?.ipcRenderer?.invoke('dialog:openDirectory');
      if (result) {
        setProjectPath(result);
        if (!projectName) {
          setProjectName(result.split(/[\\/]/).pop() || '');
        }
      }
    } catch (error) {
      console.error('Error browsing for directory:', error);
    }
  };

  const handleOpenProject = async () => {
    if (!projectPath) return;
    
    setIsLoading(true);
    try {
      await onOpenProject(projectPath);
      onClose();
    } catch (error) {
      console.error('Error opening project:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!projectPath || !projectName) return;
    
    setIsLoading(true);
    try {
      await onCreateProject({
        name: projectName,
        path: projectPath,
      });
      onClose();
    } catch (error) {
      console.error('Error creating project:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="project-dialog-overlay">
      <div className="project-dialog">
        <div className="project-dialog-header">
          <h2>Project</h2>
          <button className="close-button" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="project-dialog-tabs">
          <button
            className={`tab-button ${activeTab === 'open' ? 'active' : ''}`}
            onClick={() => setActiveTab('open')}
          >
            Open Project
          </button>
          <button
            className={`tab-button ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => setActiveTab('create')}
          >
            Create Project
          </button>
        </div>

        <div className="project-dialog-content">
          {activeTab === 'open' ? (
            <div className="open-project">
              <div className="form-group">
                <label>Project Directory</label>
                <div className="path-input-group">
                  <input
                    type="text"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder="Select project directory..."
                    readOnly
                  />
                  <button onClick={handleBrowse}>Browse...</button>
                </div>
              </div>

              <div className="recent-projects">
                <h3>Recent Projects</h3>
                {recentProjects.length > 0 ? (
                  <ul>
                    {recentProjects.map((path) => (
                      <li
                        key={path}
                        onClick={() => onSelectRecentProject(path)}
                        title={path}
                      >
                        {path}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No recent projects</p>
                )}
              </div>

              <div className="dialog-buttons">
                <button onClick={onClose}>Cancel</button>
                <button
                  onClick={handleOpenProject}
                  disabled={!projectPath || isLoading}
                >
                  {isLoading ? 'Opening...' : 'Open Project'}
                </button>
              </div>
            </div>
          ) : (
            <div className="create-project">
              <div className="form-group">
                <label>Project Name</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="Enter project name..."
                />
              </div>

              <div className="form-group">
                <label>Project Location</label>
                <div className="path-input-group">
                  <input
                    type="text"
                    value={projectPath}
                    onChange={(e) => setProjectPath(e.target.value)}
                    placeholder="Select project location..."
                    readOnly
                  />
                  <button onClick={handleBrowse}>Browse...</button>
                </div>
              </div>

              <div className="dialog-buttons">
                <button onClick={onClose}>Cancel</button>
                <button
                  onClick={handleCreateProject}
                  disabled={!projectPath || !projectName || isLoading}
                >
                  {isLoading ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectDialog;
