import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    message: ''
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unknown renderer error'
    };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Renderer crashed:', error, errorInfo);
  }

  override render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          background: '#1e1e1e',
          color: '#f5f5f5',
          textAlign: 'center'
        }}
      >
        <h2 style={{ margin: 0 }}>Renderer Error</h2>
        <p style={{ margin: 0, maxWidth: 760 }}>{this.state.message}</p>
        <p style={{ margin: 0, opacity: 0.75 }}>Open the app again after the fix or share this message.</p>
      </div>
    );
  }
}

export default ErrorBoundary;
