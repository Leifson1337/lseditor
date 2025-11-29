import React from 'react';
import './ErrorCounter.css';

// Props for the ErrorCounter component
interface ErrorCounterProps {
  errorCount: number; // Number of errors to display
}

// ErrorCounter displays an error icon and the current error count
const ErrorCounter: React.FC<ErrorCounterProps> = ({ errorCount }) => {
  return (
    <div className="error-counter">
      {/* Error icon (SVG) */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      {/* Display the error count */}
      <span className="error-count">{errorCount}</span>
    </div>
  );
};

export default ErrorCounter;