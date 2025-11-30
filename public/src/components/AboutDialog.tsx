import React from 'react';
import './AboutDialog.css';
import { FaExternalLinkAlt, FaInfoCircle, FaSyncAlt } from 'react-icons/fa';

export interface RemoteProgramInfo {
  name?: string;
  version?: string;
  description?: string;
  repository?: string;
}

interface AboutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  programInfo?: RemoteProgramInfo | null;
  currentVersion: string;
  remoteVersion?: string;
  updateAvailable: boolean;
  lastChecked?: Date | null;
  isChecking?: boolean;
  onCheckUpdates?: () => void;
  error?: string | null;
}

const formatDateTime = (value?: Date | null) => {
  if (!value) {
    return 'Nie';
  }
  return `${value.toLocaleDateString()} ${value.toLocaleTimeString()}`;
};

const AboutDialog: React.FC<AboutDialogProps> = ({
  isOpen,
  onClose,
  programInfo,
  currentVersion,
  remoteVersion,
  updateAvailable,
  lastChecked,
  isChecking,
  onCheckUpdates,
  error
}) => {
  if (!isOpen) {
    return null;
  }

  const handleOpenRepository = () => {
    if (programInfo?.repository) {
      window.open(programInfo.repository, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="about-dialog-backdrop">
      <div className="about-dialog">
        <div className="about-dialog__header">
          <div className="about-dialog__title">
            <FaInfoCircle />
            <span>About</span>
          </div>
          <button type="button" className="about-dialog__close" onClick={onClose} title="Schliessen">
            x
          </button>
        </div>

        <div className="about-dialog__content">
          <section className="about-dialog__section">
            <h3>Programm</h3>
            <div className="about-dialog__rows">
              <div className="about-dialog__row">
                <span>Name</span>
                <span>{programInfo?.name || 'LSEditor'}</span>
              </div>
              <div className="about-dialog__row">
                <span>Installierte Version</span>
                <span>{currentVersion || 'unbekannt'}</span>
              </div>
              <div className="about-dialog__row">
                <span>Neueste Version</span>
                <span>{remoteVersion || programInfo?.version || 'unbekannt'}</span>
              </div>
              <div className="about-dialog__row">
                <span>Status</span>
                <span className={updateAvailable ? 'about-dialog__status about-dialog__status--update' : 'about-dialog__status'}>
                  {updateAvailable ? 'Neue Version verfuegbar' : 'Auf dem neuesten Stand'}
                </span>
              </div>
              <div className="about-dialog__row">
                <span>Zuletzt geprueft</span>
                <span>{formatDateTime(lastChecked)}</span>
              </div>
            </div>
          </section>

          {programInfo?.description && (
            <section className="about-dialog__section">
              <h3>Beschreibung</h3>
              <p className="about-dialog__description">{programInfo.description}</p>
            </section>
          )}

          <section className="about-dialog__actions">
            <button
              type="button"
              className="about-dialog__primary"
              onClick={onCheckUpdates}
              disabled={isChecking}
            >
              <FaSyncAlt />
              <span>{isChecking ? 'Pruefe...' : 'Nach Updates suchen'}</span>
            </button>
            {programInfo?.repository && (
              <button type="button" onClick={handleOpenRepository}>
                <FaExternalLinkAlt />
                <span>Repository oeffnen</span>
              </button>
            )}
          </section>

          {error && (
            <div className="about-dialog__error">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AboutDialog;
