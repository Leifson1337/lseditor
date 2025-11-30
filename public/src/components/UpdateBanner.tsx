import React from 'react';
import './UpdateBanner.css';
import { FaInfoCircle } from 'react-icons/fa';

interface UpdateBannerProps {
  remoteVersion?: string;
  currentVersion: string;
  onShowDetails: () => void;
  onDismiss: () => void;
}

const UpdateBanner: React.FC<UpdateBannerProps> = ({
  remoteVersion,
  currentVersion,
  onShowDetails,
  onDismiss
}) => {
  return (
    <div className="update-banner">
      <div className="update-banner__info">
        <FaInfoCircle />
        <span>
          Neue Version {remoteVersion ?? 'verfuegbar'} verfuegbar.
          <span className="update-banner__small">
            Aktuell installiert: {currentVersion || 'unbekannt'}.
          </span>
        </span>
      </div>
      <div className="update-banner__actions">
        <button type="button" onClick={onShowDetails}>
          Details
        </button>
        <button type="button" onClick={onDismiss}>
          Ausblenden
        </button>
      </div>
    </div>
  );
};

export default UpdateBanner;
